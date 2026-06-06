// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BasketVaultBase} from "./BasketVaultBase.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ManagedVault — L1 managed in-kind basket with a rev-share management fee (Meridian)
/// @notice Static recipe (no rebalance) + a streaming management fee charged by dilution. The
///         manager sets its own fee; Meridian takes a bounded SHARE of that fee (rev-share). The
///         investor pays only the manager fee; Meridian's cut comes out of it. See the L1-managed
///         design spec. Fee accrues into high-precision owed-accumulators; only whole shares are
///         minted and the fractional remainder is carried (no dust loss, platform cannot be starved).
contract ManagedVault is BasketVaultBase {
    uint16 public constant MANAGER_MAX = 200;          // 2%/yr
    uint16 public constant PLATFORM_SHARE_MAX = 2000;  // 20% of the manager fee
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant SCALE = 1e18; // fixed-point precision of the owed accumulators (NOT tied to token decimals)
    uint256 public constant TIMELOCK = 7 days;

    struct ManagedParams {
        address manager;
        address meridian;
        address treasury;
        uint16 managerFeeBps;
        uint16 platformShareBps;
    }

    address public manager;
    address public meridian;
    address public treasury;
    /// @notice Active annual management fee (bps of AUM), manager-set, ≤ MANAGER_MAX.
    uint16 public managerFeeBps;
    /// @notice Active platform cut as a share OF the manager fee (bps), meridian-set, ≤ PLATFORM_SHARE_MAX.
    uint16 public platformShareBps;

    /// @notice Timestamp of the last fee accrual. Full uint256 (not packed): read on every accrual,
    ///         compared against the uint64 *EffectiveAt fields in time math — keep both as plain
    ///         seconds; no truncation since block.timestamp fits uint64 for centuries.
    uint256 public lastAccrued;
    /// @notice Manager fee owed but not yet minted, in basket shares SCALED by SCALE (1e18).
    ///         Each accrual mints `value / SCALE` whole shares to `manager` and carries the
    ///         sub-SCALE remainder here (no dust loss). Always read/write in SCALE units.
    uint256 public accManagerOwed;
    /// @notice Platform (Meridian) fee owed but not yet minted, in basket shares SCALED by SCALE (1e18).
    ///         Minted to `treasury` as `value / SCALE`; sub-SCALE remainder carried. SCALE units.
    uint256 public accPlatformOwed;

    // Pending fee changes (increase only; timelocked). effectiveAt == 0 means none scheduled.
    // uint16 + uint64 grouped to share a storage slot — keep adjacent if reordering.
    uint16 public pendingManagerFeeBps;
    uint64 public managerFeeEffectiveAt;
    uint16 public pendingPlatformShareBps;
    uint64 public platformShareEffectiveAt;

    address public pendingManager;
    address public pendingMeridian;

    error ZeroAddress();
    error FeeTooHigh();
    error ShareTooHigh();
    error NotManager();
    error NotMeridian();
    error NothingPending();
    error TimelockNotElapsed();
    error NotPending();

    /// @dev toTreasury = Meridian's rev-share cut (paid to `treasury`); toManager = the manager's remainder.
    event FeeAccrued(uint256 feeShares, uint256 toManager, uint256 toTreasury);
    event ManagerFeeSet(uint16 bps);
    event ManagerFeeScheduled(uint16 bps, uint64 effectiveAt);
    event ManagerFeeActivated(uint16 bps);
    event ManagerFeeScheduleCancelled();
    event PlatformShareSet(uint16 bps);
    event PlatformShareScheduled(uint16 bps, uint64 effectiveAt);
    event PlatformShareActivated(uint16 bps);
    event PlatformShareScheduleCancelled();
    event TreasurySet(address treasury);
    event ManagerTransferStarted(address pending);
    event ManagerTransferred(address manager);
    event MeridianTransferStarted(address pending);
    event MeridianTransferred(address meridian);

    modifier onlyManager() { if (msg.sender != manager) revert NotManager(); _; }
    modifier onlyMeridian() { if (msg.sender != meridian) revert NotMeridian(); _; }

    constructor(
        address[] memory tokens,
        uint256[] memory unitQty,
        uint256 unitSize_,
        string memory name_,
        string memory symbol_,
        ManagedParams memory p
    ) BasketVaultBase(tokens, unitQty, unitSize_, name_, symbol_) {
        if (p.manager == address(0) || p.meridian == address(0) || p.treasury == address(0)) revert ZeroAddress();
        if (p.managerFeeBps > MANAGER_MAX) revert FeeTooHigh();
        if (p.platformShareBps > PLATFORM_SHARE_MAX) revert ShareTooHigh();
        manager = p.manager;
        meridian = p.meridian;
        treasury = p.treasury;
        managerFeeBps = p.managerFeeBps;
        platformShareBps = p.platformShareBps;
        lastAccrued = block.timestamp;
    }
    // ================================ ACCRUAL ================================

    /// @notice Permissionless poke to settle accrued fees.
    function accrueFee() external nonReentrant {
        _accrue();
    }

    /// @dev Whole shares that _accrue would mint right now (for previewRedeem / UX). Mirrors _accrue.
    function pendingMintShares() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || block.timestamp == lastAccrued) return 0;
        (uint256 platformAdd, uint256 managerAdd) = _owedAdds(supply, block.timestamp - lastAccrued);
        uint256 mintP = (accPlatformOwed + platformAdd) / SCALE;
        uint256 mintM = (accManagerOwed + managerAdd) / SCALE;
        return mintP + mintM;
    }

    /// @dev Scaled (×SCALE) fee additions for `elapsed` seconds on `supply`, split into platform/manager.
    ///      `elapsed`/`supply` are PASSED IN (not re-read) so the dependency on the OLD `lastAccrued` is
    ///      explicit: callers must compute `elapsed` from `lastAccrued` BEFORE advancing it. The platform
    ///      leg is rounded UP (Math.ceilDiv, dust -> platform) — the audited Reserve Folio convention, so
    ///      Meridian's cut is never starved by rounding (on top of the per-leg accumulator carry).
    ///      managerAdd stays >= 0 since platformShareBps <= PLATFORM_SHARE_MAX < BPS.
    ///      INVARIANT for future fee/share setters: call `_accrue()` BEFORE changing managerFeeBps /
    ///      platformShareBps, so an elapsed window is never charged at a newly-set rate.
    function _owedAdds(uint256 supply, uint256 elapsed)
        internal
        view
        returns (uint256 platformAdd, uint256 managerAdd)
    {
        uint256 num = uint256(managerFeeBps) * elapsed; // BPS·seconds
        uint256 den = BPS * YEAR;
        uint256 addScaled = num >= den ? supply * SCALE : Math.mulDiv(supply, num * SCALE, den - num);
        platformAdd = Math.ceilDiv(addScaled * platformShareBps, BPS); // round platform UP (dust -> platform), R11/Reserve
        managerAdd = addScaled - platformAdd;
    }

    function _accrue() internal override {
        uint256 supply = totalSupply();
        uint256 ts = block.timestamp;
        if (supply == 0 || ts == lastAccrued) { lastAccrued = ts; return; }
        (uint256 platformAdd, uint256 managerAdd) = _owedAdds(supply, ts - lastAccrued);
        lastAccrued = ts; // always advance — remainder carried in accumulators
        uint256 p = accPlatformOwed + platformAdd;
        uint256 m = accManagerOwed + managerAdd;
        uint256 mintP = p / SCALE;
        uint256 mintM = m / SCALE;
        accPlatformOwed = p - mintP * SCALE;
        accManagerOwed = m - mintM * SCALE;
        if (mintP > 0) _mint(treasury, mintP);
        if (mintM > 0) _mint(manager, mintM);
        if (mintP > 0 || mintM > 0) emit FeeAccrued(mintP + mintM, mintM, mintP);
    }

    // ============================= FEE SETTERS ===============================

    /// @notice Set the manager fee. A value <= the current rate applies INSTANTLY (and cancels any
    ///         pending increase); a higher value is TIMELOCKED (TIMELOCK) — it is scheduled and must
    ///         be applied later via `activateManagerFee`. `_accrue()` runs first so the elapsed window
    ///         is always settled at the OLD rate (never retroactive). onlyManager.
    function setManagerFeeBps(uint16 bps) external onlyManager {
        if (bps > MANAGER_MAX) revert FeeTooHigh();
        _accrue(); // settle at the old rate first (decrease or increase)
        if (bps <= managerFeeBps) {
            managerFeeBps = bps;
            if (managerFeeEffectiveAt != 0) emit ManagerFeeScheduleCancelled(); // a pending increase is dropped
            pendingManagerFeeBps = 0;
            managerFeeEffectiveAt = 0;
            emit ManagerFeeSet(bps);
        } else {
            pendingManagerFeeBps = bps;
            managerFeeEffectiveAt = uint64(block.timestamp + TIMELOCK);
            emit ManagerFeeScheduled(bps, managerFeeEffectiveAt);
        }
    }

    /// @notice Apply a previously-scheduled manager-fee increase after its timelock elapses.
    ///         Reverts NothingPending if none scheduled, TimelockNotElapsed if too early. Settles the
    ///         elapsed window at the OLD rate via `_accrue` before flipping. onlyManager.
    function activateManagerFee() external onlyManager {
        uint64 eff = managerFeeEffectiveAt;
        if (eff == 0) revert NothingPending();
        if (block.timestamp < eff) revert TimelockNotElapsed();
        _accrue(); // settle up to now at the OLD rate -> boundary coincides with accrual
        managerFeeBps = pendingManagerFeeBps;
        pendingManagerFeeBps = 0;
        managerFeeEffectiveAt = 0;
        emit ManagerFeeActivated(managerFeeBps);
    }

    /// @notice Set the platform share (Meridian's cut of the manager fee). Same semantics as
    ///         `setManagerFeeBps`: <= current applies instantly (cancels any pending increase), higher
    ///         is timelocked via `activatePlatformShare`. `_accrue()` settles at the old rate first.
    ///         onlyMeridian.
    function setPlatformShareBps(uint16 bps) external onlyMeridian {
        if (bps > PLATFORM_SHARE_MAX) revert ShareTooHigh();
        _accrue();
        if (bps <= platformShareBps) {
            platformShareBps = bps;
            if (platformShareEffectiveAt != 0) emit PlatformShareScheduleCancelled();
            pendingPlatformShareBps = 0;
            platformShareEffectiveAt = 0;
            emit PlatformShareSet(bps);
        } else {
            pendingPlatformShareBps = bps;
            platformShareEffectiveAt = uint64(block.timestamp + TIMELOCK);
            emit PlatformShareScheduled(bps, platformShareEffectiveAt);
        }
    }

    /// @notice Apply a previously-scheduled platform-share increase after its timelock. onlyMeridian.
    function activatePlatformShare() external onlyMeridian {
        uint64 eff = platformShareEffectiveAt;
        if (eff == 0) revert NothingPending();
        if (block.timestamp < eff) revert TimelockNotElapsed();
        _accrue();
        platformShareBps = pendingPlatformShareBps;
        pendingPlatformShareBps = 0;
        platformShareEffectiveAt = 0;
        emit PlatformShareActivated(platformShareBps);
    }

    // =============================== ROLES ===================================

    /// @notice Set the fee recipient. Reverts ZeroAddress — a zero treasury would make _accrue's
    ///         _mint(treasury, ...) revert and brick create/redeem (fix C2). onlyMeridian.
    function setTreasury(address t) external onlyMeridian {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    /// @notice Step 1/2 of manager handoff (pull pattern): nominate `a`. The nominee must call
    ///         acceptManager() to take the role. Re-call to fix a typo, or pass address(0) to cancel
    ///         a pending handoff. onlyManager.
    function setPendingManager(address a) external onlyManager {
        pendingManager = a;
        emit ManagerTransferStarted(a);
    }

    /// @notice Step 2/2 of manager handoff: the nominated address accepts and becomes `manager`.
    ///         Reverts NotPending unless the caller is the current pending nominee.
    function acceptManager() external {
        if (msg.sender != pendingManager) revert NotPending();
        manager = msg.sender;
        pendingManager = address(0);
        emit ManagerTransferred(msg.sender);
    }

    /// @notice Step 1/2 of meridian handoff (pull pattern): nominate `a` (address(0) cancels). onlyMeridian.
    function setPendingMeridian(address a) external onlyMeridian {
        pendingMeridian = a;
        emit MeridianTransferStarted(a);
    }

    /// @notice Step 2/2 of meridian handoff: the nominee accepts and becomes `meridian`. Reverts NotPending.
    function acceptMeridian() external {
        if (msg.sender != pendingMeridian) revert NotPending();
        meridian = msg.sender;
        pendingMeridian = address(0);
        emit MeridianTransferred(msg.sender);
    }

    // ================================= VIEW ==================================

    /// @notice Pro-rata redeem quote that INCLUDES pending (not-yet-minted) fee dilution: it quotes
    ///         against `totalSupply() + pendingMintShares()`, matching what `redeem` pays after it
    ///         accrues. The real payout may be a hair lower if a block elapses between quote and redeem.
    function previewRedeem(uint256 amount)
        public
        view
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        return _quoteRedeem(amount, supply + pendingMintShares());
    }
}
