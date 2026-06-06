// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BasketVault — L1 static in-kind basket (Meridian)
/// @notice Immutable vault. Deposit the exact recipe of stock tokens -> mint the basket token
///         (create). Burn the basket token -> withdraw the pro-rata contents (redeem).
///         No prices, no oracle, no NAV.
/// @dev The recipe (PCF) is fixed in the constructor and NEVER changes: no setters, no proxy,
///      no admin. Draining is impossible by design. See docs/guides/L1-static-in-kind.md.
///
///      SCALING CEILING (see research/results/R10.md): create/redeem are SYNCHRONOUS — one atomic
///      loop of transferFrom/transfer over every constituent. This is the "fast path" and is safe
///      only for SMALL baskets (~50 names; synchronous full-basket mint caps at ~50 ETH / ~100
///      Base per R10). A flat 500-name basket does NOT fit one block (gas/calldata wall) and its
///      constructor (one SSTORE per constituent) may not even deploy. Large N is reached by
///      COMPOSITION, not by widening this contract: a basket token is a plain ERC20, so it can be
///      a constituent of another BasketVault -> nested tree (e.g. 1 top of 10 sub-baskets x 50).
///      True flat-500 with cash-in UX is a separate async (ERC-7540) workstream, out of L1 scope.
///
///      TRUST BOUNDARY (constituents are third-party tokens this vault does not control):
///      "immutable / never-pausable / cannot-drain" is true of THIS contract only. Each payout leg
///      inherits its constituent's own transfer rules. A constituent that is paused, blocklists the
///      vault or the redeemer, or admin-burns the vault's holdings can freeze or shrink that leg;
///      because redeem is one atomic loop, one frozen leg blocks the whole redeem (assets stay
///      backed and become redeemable once unfrozen — liveness, not loss). Backing also assumes
///      RAW-accounting constituents: standard ERC20 and display-only scaled-UI (Robinhood split
///      multiplier) are safe because the vault accounts in raw units; fee-on-transfer and
///      true-rebasing tokens are NOT supported and silently under-back the recipe. The vault
///      accepts ANY ERC20 by design — the off-chain layer MUST raise an Alarm next to any fund
///      whose constituent is paused / blocklisting / non-raw. See the L1 guide "Trust boundary".
contract BasketVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Basket constituents: stock-token addresses (cash, if any, is just another token).
    address[] private _tokens;
    /// @notice Recipe per creation-unit: how much of each token must be deposited.
    uint256[] private _unitQty;
    /// @notice Basket tokens minted per 1 creation-unit.
    uint256 public immutable unitSize;

    /// @notice One EIP-2612 permit signature for a constituent (aligned by index to the recipe).
    /// @dev deadline == 0 means "skip this leg" (constituent lacks permit, or already approved).
    struct PermitInput {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Created(address indexed creator, uint256 nUnits, uint256 minted);
    event Redeemed(address indexed redeemer, uint256 amount);

    error LengthMismatch();
    error EmptyBasket();
    error ZeroUnitSize();
    error ZeroUnits();
    error ZeroAmount();
    error NoSupply();
    error UnsortedOrDuplicateTokens();
    error ZeroQty();
    error PermitsLengthMismatch();
    error PermitFailed(address token);

    /// @param tokens    basket constituents, STRICTLY ASCENDING by address (canonical, unique)
    /// @param unitQty   recipe per 1 unit (same length as tokens, each > 0)
    /// @param unitSize_ basket tokens per 1 unit (e.g. 1e18)
    /// @dev Strictly-ascending tokens is a correctness invariant, not just canonicalization: a
    ///      duplicated constituent would let a redeemer drain that token twice and break backing.
    ///      The check also forbids the zero address (the first token must be > address(0)).
    constructor(
        address[] memory tokens,
        uint256[] memory unitQty,
        uint256 unitSize_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        uint256 len = tokens.length;
        if (len != unitQty.length) revert LengthMismatch();
        if (len == 0) revert EmptyBasket();
        if (unitSize_ == 0) revert ZeroUnitSize();

        address prev = address(0);
        for (uint256 i = 0; i < len; ++i) {
            address t = tokens[i];
            if (t <= prev) revert UnsortedOrDuplicateTokens(); // strictly ascending => unique, non-zero
            if (unitQty[i] == 0) revert ZeroQty();
            prev = t;
        }

        _tokens = tokens;
        _unitQty = unitQty;
        unitSize = unitSize_;
    }

    // ================================ CREATE =================================

    /// @notice Deposit `nUnits` creation-units of the recipe -> mint nUnits*unitSize basket tokens.
    /// @dev Classic path: the caller must have approved each constituent first. transferFrom for
    ///      each asset; if any leg is short the whole call reverts (bundle completeness, atomic).
    ///      CEI + nonReentrant. Permissionless.
    function create(uint256 nUnits) external nonReentrant {
        _pullAndMint(nUnits);
    }

    /// @notice One-tx create: apply EIP-2612 permits, then pull the recipe and mint.
    /// @dev `permits` is aligned by index to the constituents (getConstituents order). A leg with
    ///      deadline == 0 is skipped (constituent lacks permit, or the caller approved it classically);
    ///      correctness is still enforced by the transferFrom in _pullAndMint. CEI + nonReentrant.
    /// @param nUnits  creation-units to mint
    /// @param permits per-constituent permit signatures (same length as the recipe)
    function createWithPermit(uint256 nUnits, PermitInput[] calldata permits) external nonReentrant {
        uint256 len = _tokens.length;
        if (permits.length != len) revert PermitsLengthMismatch();
        for (uint256 i = 0; i < len; ++i) {
            if (permits[i].deadline != 0) {
                _tryPermit(_tokens[i], permits[i], _unitQty[i] * nUnits);
            }
        }
        _pullAndMint(nUnits);
    }

    /// @dev Shared body for create / createWithPermit: pull the exact recipe and mint shares.
    function _pullAndMint(uint256 nUnits) private {
        if (nUnits == 0) revert ZeroUnits();
        uint256 len = _tokens.length;
        for (uint256 i = 0; i < len; ++i) {
            // need = unitQty * nUnits is always > 0: nUnits checked above, unitQty[i] checked
            // > 0 in the constructor (ZeroQty). No zero-guard required.
            IERC20(_tokens[i]).safeTransferFrom(msg.sender, address(this), _unitQty[i] * nUnits);
        }
        uint256 minted = nUnits * unitSize;
        _mint(msg.sender, minted);
        emit Created(msg.sender, nUnits, minted);
    }

    /// @dev Apply one permit, then require the resulting allowance to cover what this leg will pull.
    ///      The attempt's revert is swallowed (front-run: nonce already consumed; or a non-permit /
    ///      no-op token), but the allowance check runs on BOTH branches, so a failed, under-valued,
    ///      or no-op permit fails fast and uniformly with PermitFailed instead of an opaque,
    ///      token-specific allowance error downstream.
    function _tryPermit(address token, PermitInput calldata p, uint256 need) private {
        try IERC20Permit(token).permit(msg.sender, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
        catch {}
        if (IERC20(token).allowance(msg.sender, address(this)) < need) revert PermitFailed(token);
    }

    // ================================ REDEEM =================================

    /// @notice Burn `amount` basket tokens -> withdraw the pro-rata share of the vault contents.
    /// @dev Denominator is supply BEFORE the burn. Order is snapshot -> burn -> transfer (CEI).
    ///      Pro-rata and never paused/blocked BY THE VAULT. End-to-end availability still inherits
    ///      each constituent's transfer rules: a paused/blocklisting constituent reverts its leg and,
    ///      since this is one atomic loop, the whole redeem (see the TRUST BOUNDARY note above).
    function redeem(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 supplyBefore = totalSupply();
        if (supplyBefore == 0) revert NoSupply();

        uint256 len = _tokens.length;
        uint256[] memory outs = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            uint256 bal = IERC20(_tokens[i]).balanceOf(address(this));
            outs[i] = (bal * amount) / supplyBefore;
        }

        _burn(msg.sender, amount);

        for (uint256 i = 0; i < len; ++i) {
            if (outs[i] > 0) {
                IERC20(_tokens[i]).safeTransfer(msg.sender, outs[i]);
            }
        }
        emit Redeemed(msg.sender, amount);
    }

    // ================================= VIEW ==================================

    /// @notice How much of each token must be deposited for `nUnits` units.
    function previewCreate(uint256 nUnits)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 len = _tokens.length;
        tokens = _tokens;
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            amounts[i] = _unitQty[i] * nUnits;
        }
    }

    /// @notice How much of each token a redeemer receives for `amount` basket tokens.
    function previewRedeem(uint256 amount)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 len = _tokens.length;
        tokens = _tokens;
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            uint256 bal = IERC20(_tokens[i]).balanceOf(address(this));
            amounts[i] = (bal * amount) / supply;
        }
    }

    /// @notice The basket recipe (PCF): tokens and quantity per 1 unit.
    function getConstituents()
        external
        view
        returns (address[] memory tokens, uint256[] memory unitQty)
    {
        return (_tokens, _unitQty);
    }

    /// @notice Number of assets in the basket.
    function constituentsCount() external view returns (uint256) {
        return _tokens.length;
    }
}
