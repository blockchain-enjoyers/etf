// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IKeeperPay { function pay(address vaultShare, address to, uint256 amount) external returns (uint256); }
interface IRebVault {
    function executeRebalance(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address recipient
    ) external;
    function manager() external view returns (address);
}

/// @title RebalanceAuction — minimal-viable Dutch executor that pays the keeper from the escrow
/// @notice The vault's registered executor. open() (gated by execMode) starts a linear-decay auction: the
///         acquire requirement decays from `startIn` (fund-favorable) to `endIn` (fair) over `duration`.
///         bid() fills the WHOLE delta at the current requirement via vault.executeRebalance, and pays the
///         opener (keeper) a bounded tip from the KeeperModule escrow (clamped). Settlement is the
///         delivered ratio — no estimate settles (iron rule). MEV-neutral: FCFS L2 + auction.
/// @dev    VALUE CONSERVATION: the per-leg release `minOut` passed to the core is `bal - releaseOut`, so
///         after executeRebalance sends exactly `releaseOut`, the core's `balanceOf >= minOut` check holds
///         at equality — i.e. the release-side floor only asserts the vault releases NO MORE than
///         `releaseOut` of each leg. The REAL value floor is the ACQUIRE side: the bidder MUST deliver
///         `currentAcquireIn`, which the Dutch decay FLOORS at `endIn`. Value is conserved iff the curator
///         sets `endIn` to the fair value of the released legs in acquire-token terms; the oracle-free core
///         cannot verify cross-leg value without a price (iron rule). This curator-set `endIn` + atomic
///         delivery IS the red-line-#1 realization for the MVP. A STRONGER hardening — a post-swap L4
///         `navOfHoldings` value-floor CHECK (decide-only, never settle) — is a recommended IMP follow-up.
///         This is the MINIMAL-VIABLE single-fill version; partial fills / exponential decay / CoW routing
///         are deferred.
/// @dev    WARNINGS (operational, security review M2/I1 follow-ups):
///         - PERMISSIONLESS mode with a funded keeper escrow is UNSAFE until the post-swap L4
///           navOfHoldings value-floor check lands: a keeper can self-open+self-bid to extract the bounded
///           keeper-escrow (never principal). Ship MANAGER_ONLY / ALLOWLIST for now. ExecMode defaults to
///           MANAGER_ONLY (the zero value) so an un-configured vault is closed by default; PERMISSIONLESS
///           must be explicitly enabled and remains unsafe with a funded escrow until the L4 navOfHoldings
///           value-floor lands.
///         - The rebalance auction is the ONE curator action with NO timelock (unlike scheduleTarget); a
///           compromised manager can set endIn low and self-bid in MANAGER_ONLY. manager==curator is the
///           trust root.
///         - Acquire/release tokens MUST be standard ERC20 (no fee-on-transfer, no transfer hooks);
///           FoT safe-fails the bid but is not supported.
///         - Wiring precondition: the auction must be registered via BOTH vault.setExecutor(auction,true)
///           (meridian) AND keeperModule.setExecutor(auction,true) (km owner); otherwise bid reverts at the
///           pay step.
contract RebalanceAuction is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum ExecMode { MANAGER_ONLY, ALLOWLIST, PERMISSIONLESS }

    IKeeperPay public immutable keeperModule;
    uint256 public immutable maxTip; // hard tip ceiling (vault shares); KeeperModule clamps further

    struct Auction {
        address opener; uint64 start; uint64 duration; bool active;
        address[] release; uint256[] releaseOut; uint256[] minOut;
        address[] acquire; uint256[] startIn; uint256[] endIn;
    }
    mapping(address => Auction) private _auc;            // vault -> current auction
    mapping(address => ExecMode) public execMode;        // vault -> who may open
    mapping(address => mapping(address => bool)) public openAllow; // vault -> opener -> allowed (ALLOWLIST)

    error NotAllowedToOpen();
    error NoActiveAuction();
    error InvalidAuctionParams();
    error AuctionExpired();

    constructor(IKeeperPay km, uint256 maxTip_) { keeperModule = km; maxTip = maxTip_; }

    function setExecMode(address vault, ExecMode m) external {
        if (msg.sender != IRebVault(vault).manager()) revert NotAllowedToOpen();
        execMode[vault] = m;
    }
    function setOpenAllow(address vault, address who, bool ok) external {
        if (msg.sender != IRebVault(vault).manager()) revert NotAllowedToOpen();
        openAllow[vault][who] = ok;
    }

    function _mayOpen(address vault) internal view returns (bool) {
        ExecMode m = execMode[vault];
        if (m == ExecMode.PERMISSIONLESS) return true;
        if (m == ExecMode.MANAGER_ONLY) return msg.sender == IRebVault(vault).manager();
        return openAllow[vault][msg.sender];
    }

    /// @notice Open the auction (gated by execMode). Curator/keeper supplies the leg plan + decay bounds.
    function open(
        address vault,
        address[] calldata release, uint256[] calldata releaseOut,
        address[] calldata acquire, uint256[] calldata startIn, uint256[] calldata endIn,
        uint64 duration
    ) external {
        if (!_mayOpen(vault)) revert NotAllowedToOpen();
        if (release.length != releaseOut.length) revert InvalidAuctionParams();
        if (acquire.length != startIn.length || acquire.length != endIn.length) revert InvalidAuctionParams();
        if (duration == 0) revert InvalidAuctionParams();
        for (uint256 i = 0; i < acquire.length; ++i) {
            if (startIn[i] < endIn[i]) revert InvalidAuctionParams();
        }
        // disjoint-leg guard: a token may not be on BOTH sides (kills the no-op round-trip self-deal that
        // would bleed the keeper escrow); legitimate reweights release overweight, acquire a DIFFERENT name
        for (uint256 i = 0; i < acquire.length; ++i) {
            for (uint256 j = 0; j < release.length; ++j) {
                if (acquire[i] == release[j]) revert InvalidAuctionParams();
            }
        }
        // derive a conservative per-leg minOut = current backing minus what we release (helper keeps
        // `open` off the stack-too-deep cliff without flipping viaIR)
        uint256[] memory minOut = _deriveMinOut(vault, release, releaseOut);
        Auction storage A = _auc[vault];
        A.opener = msg.sender;
        A.start = uint64(block.timestamp);
        A.duration = duration;
        A.active = true;
        A.release = release;
        A.releaseOut = releaseOut;
        A.minOut = minOut;
        A.acquire = acquire;
        A.startIn = startIn;
        A.endIn = endIn;
    }

    /// @dev Conservative per-leg release floor: current backing minus what we release. Extracted from
    ///      `open` purely to relieve stack pressure (viaIR stays false).
    function _deriveMinOut(
        address vault, address[] calldata release, uint256[] calldata releaseOut
    ) internal view returns (uint256[] memory minOut) {
        minOut = new uint256[](release.length);
        for (uint256 i = 0; i < release.length; ++i) {
            uint256 bal = IERC20(release[i]).balanceOf(vault);
            minOut[i] = bal > releaseOut[i] ? bal - releaseOut[i] : 0;
        }
    }

    /// @notice Current (linearly decayed) acquire requirement for each acquire leg.
    function currentAcquireIn(address vault) public view returns (uint256[] memory amounts) {
        Auction storage a = _auc[vault];
        uint256 elapsed = block.timestamp - a.start;
        if (elapsed > a.duration) elapsed = a.duration;
        amounts = new uint256[](a.acquire.length);
        for (uint256 i = 0; i < a.acquire.length; ++i) {
            uint256 drop = ((a.startIn[i] - a.endIn[i]) * elapsed) / a.duration;
            amounts[i] = a.startIn[i] - drop;
        }
    }

    /// @notice Fill the whole delta at the current requirement. Pulls acquire tokens from the bidder,
    ///         approves the vault, calls executeRebalance, then pays the opener a clamped tip.
    function bid(address vault) external nonReentrant {
        Auction storage a = _auc[vault];
        if (!a.active) revert NoActiveAuction();
        if (block.timestamp > uint256(a.start) + a.duration) revert AuctionExpired();
        uint256[] memory acquireIn = currentAcquireIn(vault);
        for (uint256 i = 0; i < a.acquire.length; ++i) {
            IERC20(a.acquire[i]).safeTransferFrom(msg.sender, address(this), acquireIn[i]);
            IERC20(a.acquire[i]).forceApprove(vault, acquireIn[i]);
        }
        IRebVault(vault).executeRebalance(a.acquire, acquireIn, a.release, a.releaseOut, a.minOut, msg.sender);
        address opener = a.opener;
        a.active = false;
        keeperModule.pay(vault, opener, maxTip);
    }
}
