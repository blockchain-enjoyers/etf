// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {FeeCore} from "../../L1/fee/FeeCore.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RebalanceFeeCore — keeper 3-way fee over FeeCore (registry-leaf base)
/// @notice Mirrors ManagedRebalanceVault's keeper machinery but composes the extracted {FeeCore} directly
///         (no StorageVaultBase / on-chain recipe). The management-fee dilution is carved into
///         manager / platform / KEEPER, the keeper slice minted to a KeeperModule escrow so keeper rewards
///         self-fund from block 1 (R14). The platform fee is Meridian's OWN independent annual AUM leg
///         (-> treasury, not split); the keeper slice is carved from the MANAGER leg (keeper rounded UP,
///         manager takes the remainder; KEEPER_MAX < BPS so the manager leg never underflows).
/// @dev    This is a SEPARATE base from ManagedRebalanceVault (the accepted, bounded duplication noted in
///         the plan); ManagedRebalanceVault stays untouched on `is ManagedVault`.
abstract contract RebalanceFeeCore is FeeCore {
    uint16 public constant KEEPER_MAX = 2000; // 20% of the MANAGER fee; KEEPER_MAX < BPS so the manager leg never underflows

    /// @notice Keeper cut as a share OF the manager fee (bps). 0 disables the keeper leg.
    uint16 public keeperBps;
    /// @notice Keeper fee owed but not yet minted, SCALED by SCALE (1e18). Sub-SCALE remainder carried.
    uint256 public accKeeperOwed;
    /// @notice The KeeperModule escrow that receives minted keeper shares.
    address public keeperEscrow;

    uint16 public pendingKeeperBps;
    uint64 public keeperBpsEffectiveAt;

    /// @notice Init params for a rebalanceable registry vault. Mirrors ManagedRebalanceVault.RebalanceParams
    ///         (declared HERE so the registry leaf + factory import it from this base, NOT the untouched L3
    ///         vault — avoids coupling/import-cycle).
    struct RebalanceParams {
        address manager;
        address meridian;
        address treasury;
        uint16 managerFeeBps;
        uint16 platformFeeBps;
        uint16 keeperBps;
        address keeperEscrow;
        address feeToken;
        uint256 flatCreateFee;
        uint256 flatRedeemFee;
    }

    error KeeperShareTooHigh();
    error ZeroEscrow();

    event KeeperFeeAccrued(uint256 keeperShares);
    event KeeperBpsScheduled(uint16 bps, uint64 effectiveAt);
    event KeeperBpsActivated(uint16 bps);
    event KeeperBpsSet(uint16 bps);

    /// @dev Wire the keeper leg. Manager/platform/flat params are set via FeeCore.__Managed_init.
    function __RebalanceFee_init(uint16 keeperBps_, address keeperEscrow_) internal onlyInitializing {
        if (keeperBps_ > KEEPER_MAX) revert KeeperShareTooHigh();
        if (keeperBps_ > 0 && keeperEscrow_ == address(0)) revert ZeroEscrow();
        keeperBps = keeperBps_;
        keeperEscrow = keeperEscrow_;
    }

    // ---- 3-way accrual (overrides the 2-way base) ----

    function _accrue() internal override virtual {
        uint256 supply = totalSupply();
        uint256 ts = block.timestamp;
        if (supply == 0 || ts == lastAccrued) { lastAccrued = ts; return; }
        uint256 elapsed = ts - lastAccrued;
        lastAccrued = ts;

        // MANAGER leg (manager's own rate) is split into manager + keeper (R14, A-a).
        uint256 managerLeg = _feeAddScaled(supply, elapsed, managerFeeBps);
        uint256 keeperAddS = Math.ceilDiv(managerLeg * keeperBps, BPS); // keeper UP, carved from the manager leg
        uint256 managerAddS = managerLeg - keeperAddS;                  // >= 0 since keeperBps <= KEEPER_MAX < BPS
        // PLATFORM leg is Meridian's OWN independent rate -> treasury (NOT split).
        uint256 platformAddS = _feeAddScaled(supply, elapsed, platformFeeBps);

        uint256 m = accManagerOwed + managerAddS;
        uint256 k = accKeeperOwed + keeperAddS;
        uint256 p = accPlatformOwed + platformAddS;
        uint256 mintM = m / SCALE;
        uint256 mintK = k / SCALE;
        uint256 mintP = p / SCALE;
        accManagerOwed = m - mintM * SCALE;
        accKeeperOwed = k - mintK * SCALE;
        accPlatformOwed = p - mintP * SCALE;

        if (mintP > 0) _mint(treasury, mintP);
        if (mintK > 0) { _mint(keeperEscrow, mintK); emit KeeperFeeAccrued(mintK); }
        if (mintM > 0) _mint(manager, mintM);
        if (mintP > 0 || mintK > 0 || mintM > 0) emit FeeAccrued(mintP + mintK + mintM, mintM, mintP);
    }

    /// @dev 3-way version for preview/UX (mirrors _accrue).
    function pendingMintShares() public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || block.timestamp == lastAccrued) return 0;
        uint256 elapsed = block.timestamp - lastAccrued;
        uint256 managerLeg = _feeAddScaled(supply, elapsed, managerFeeBps);
        uint256 keeperAddS = Math.ceilDiv(managerLeg * keeperBps, BPS);
        uint256 managerAddS = managerLeg - keeperAddS;
        uint256 platformAddS = _feeAddScaled(supply, elapsed, platformFeeBps);
        uint256 mintM = (accManagerOwed + managerAddS) / SCALE;
        uint256 mintK = (accKeeperOwed + keeperAddS) / SCALE;
        uint256 mintP = (accPlatformOwed + platformAddS) / SCALE;
        return mintM + mintK + mintP;
    }

    // ---- timelocked keeperBps setter (mirrors platform-fee semantics) ----

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
