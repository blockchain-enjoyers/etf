// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ManagedVault} from "../L1/ManagedVault.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ManagedRebalanceVault — managed vault whose fee funds a keeper escrow (Part 1)
/// @notice is ManagedVault, so all audited in-kind create/redeem + fee timelock paths are reused. The
///         ONLY change here is a 3-way fee split: the management-fee dilution is carved into
///         manager / platform / KEEPER, the keeper slice minted to a KeeperModule escrow so keeper
///         rewards self-fund from block 1 (R14). Rebalance execution is added in Part 2. Floor rule
///         (Reserve/R11): platform and keeper rounded UP, manager takes the remainder; caps guarantee
///         platformShareBps + keeperBps < BPS so the manager leg never underflows.
/// @dev    Init goes through `initializeRebalance` (a distinctly-named entrypoint, NOT a second
///         `initialize` overload) so the bare `initialize` is never ambiguous on the subclass ABI. The
///         Part-3 rebalance factory creates the clone and calls `initializeRebalance` atomically.
contract ManagedRebalanceVault is ManagedVault {
    uint16 public constant KEEPER_MAX = 2000; // 20% of the fee; PLATFORM_SHARE_MAX + KEEPER_MAX < BPS

    /// @notice Keeper cut as a share OF the manager fee (bps). 0 disables the keeper leg.
    uint16 public keeperBps;
    /// @notice Keeper fee owed but not yet minted, SCALED by SCALE (1e18). Sub-SCALE remainder carried.
    uint256 public accKeeperOwed;
    /// @notice The KeeperModule escrow that receives minted keeper shares.
    address public keeperEscrow;

    uint16 public pendingKeeperBps;
    uint64 public keeperBpsEffectiveAt;

    struct RebalanceParams {
        address manager;
        address meridian;
        address treasury;
        uint16 managerFeeBps;
        uint16 platformShareBps;
        uint16 keeperBps;
        address keeperEscrow;
    }

    error KeeperShareTooHigh();
    error ZeroEscrow();

    event KeeperFeeAccrued(uint256 keeperShares);
    event KeeperBpsScheduled(uint16 bps, uint64 effectiveAt);
    event KeeperBpsActivated(uint16 bps);
    event KeeperBpsSet(uint16 bps);

    /// @notice Distinctly-named initializer (NOT an `initialize` overload, so the base selector stays
    ///         unambiguous). Reuses the audited base managed-init, then wires the keeper leg.
    function initializeRebalance(
        address[] memory tokens,
        uint256[] memory unitQty,
        string memory name_,
        string memory symbol_,
        RebalanceParams memory p
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __StorageVault_init(tokens, unitQty);
        __Managed_init(ManagedParams({
            manager: p.manager, meridian: p.meridian, treasury: p.treasury,
            managerFeeBps: p.managerFeeBps, platformShareBps: p.platformShareBps
        }));
        if (p.keeperBps > KEEPER_MAX) revert KeeperShareTooHigh();
        if (p.keeperBps > 0 && p.keeperEscrow == address(0)) revert ZeroEscrow();
        keeperBps = p.keeperBps;
        keeperEscrow = p.keeperEscrow;
    }

    // ---- 3-way accrual (overrides the 2-way base) ----

    function _accrue() internal override {
        uint256 supply = totalSupply();
        uint256 ts = block.timestamp;
        if (supply == 0 || ts == lastAccrued) { lastAccrued = ts; return; }
        uint256 addScaled = _feeAddScaled(supply, ts - lastAccrued);
        lastAccrued = ts;

        uint256 platformAddS = Math.ceilDiv(addScaled * platformShareBps, BPS); // platform UP
        uint256 keeperAddS = Math.ceilDiv(addScaled * keeperBps, BPS);          // keeper UP
        uint256 managerAddS = addScaled - platformAddS - keeperAddS;            // remainder (>=0 by caps)

        uint256 p = accPlatformOwed + platformAddS;
        uint256 k = accKeeperOwed + keeperAddS;
        uint256 m = accManagerOwed + managerAddS;
        uint256 mintP = p / SCALE;
        uint256 mintK = k / SCALE;
        uint256 mintM = m / SCALE;
        accPlatformOwed = p - mintP * SCALE;
        accKeeperOwed = k - mintK * SCALE;
        accManagerOwed = m - mintM * SCALE;

        if (mintP > 0) _mint(treasury, mintP);
        if (mintK > 0) { _mint(keeperEscrow, mintK); emit KeeperFeeAccrued(mintK); }
        if (mintM > 0) _mint(manager, mintM);
        if (mintP > 0 || mintK > 0 || mintM > 0) emit FeeAccrued(mintP + mintK + mintM, mintM, mintP);
    }

    /// @dev 3-way version for preview/UX (mirrors _accrue).
    function pendingMintShares() public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || block.timestamp == lastAccrued) return 0;
        uint256 addScaled = _feeAddScaled(supply, block.timestamp - lastAccrued);
        uint256 platformAddS = Math.ceilDiv(addScaled * platformShareBps, BPS);
        uint256 keeperAddS = Math.ceilDiv(addScaled * keeperBps, BPS);
        uint256 managerAddS = addScaled - platformAddS - keeperAddS;
        uint256 mintP = (accPlatformOwed + platformAddS) / SCALE;
        uint256 mintK = (accKeeperOwed + keeperAddS) / SCALE;
        uint256 mintM = (accManagerOwed + managerAddS) / SCALE;
        return mintP + mintK + mintM;
    }

    // ---- timelocked keeperBps setter (mirrors platform-share semantics) ----

    /// @notice Set the keeper cut. <= current applies instantly (cancels pending); higher is timelocked.
    ///         `_accrue()` settles the elapsed window at the OLD rate first. onlyMeridian (platform-side).
    function setKeeperBps(uint16 bps) external onlyMeridian {
        if (bps > KEEPER_MAX) revert KeeperShareTooHigh();
        if (bps > 0 && keeperEscrow == address(0)) revert ZeroEscrow();
        _accrue();
        if (bps <= keeperBps) {
            keeperBps = bps;
            pendingKeeperBps = 0;
            keeperBpsEffectiveAt = 0;
            emit KeeperBpsSet(bps);
        } else {
            pendingKeeperBps = bps;
            keeperBpsEffectiveAt = uint64(block.timestamp + TIMELOCK);
            emit KeeperBpsScheduled(bps, keeperBpsEffectiveAt);
        }
    }

    function activateKeeperBps() external onlyMeridian {
        uint64 eff = keeperBpsEffectiveAt;
        if (eff == 0) revert NothingPending();
        if (block.timestamp < eff) revert TimelockNotElapsed();
        _accrue();
        keeperBps = pendingKeeperBps;
        pendingKeeperBps = 0;
        keeperBpsEffectiveAt = 0;
        emit KeeperBpsActivated(keeperBps);
    }
}
