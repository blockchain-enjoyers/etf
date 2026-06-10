// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {StorageVaultBase} from "./recipe/StorageVaultBase.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ManagedVault — L1 managed in-kind basket with streaming management + platform fee (Meridian's own AUM line)
/// @notice Static recipe (no rebalance) + a streaming management fee charged by dilution. The
///         manager sets its own fee; Meridian charges its OWN independent annual platform fee
///         (its own line, not a share of the manager fee). The investor pays both legs by dilution.
///         See the L1-managed design spec. Fee accrues into high-precision owed-accumulators; only
///         whole shares are minted and the fractional remainder is carried (no dust loss, platform
///         cannot be starved).
contract ManagedVault is StorageVaultBase {
    using SafeERC20 for IERC20;

    uint16 public constant MANAGER_MAX = 200;        // 2%/yr (manager-set)
    uint16 public constant PLATFORM_FEE_MAX = 50;    // 0.5%/yr — Meridian's OWN line (not a share of the manager fee)
    uint16 public constant FLOW_FEE_BPS = 0;         // red line #3 in code: NO setter exists; no %-of-flow fee can ever be taken
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant SCALE = 1e18; // fixed-point precision of the owed accumulators (NOT tied to token decimals)
    uint256 public constant TIMELOCK = 7 days;

    /// @notice Absolute cap on each flat fee, in `feeToken` units. Cost-recovery ceiling (assumes 18-dec USDG,
    ///         ~$100). Adjust this literal if USDG uses different decimals.
    uint256 public constant FLAT_FEE_MAX = 100e18;

    struct ManagedParams {
        address manager;
        address meridian;
        address treasury;
        uint16 managerFeeBps;
        uint16 platformFeeBps;
        address feeToken;
        uint256 flatCreateFee;
        uint256 flatRedeemFee;
    }

    address public manager;
    address public meridian;
    address public treasury;
    /// @notice Active annual management fee (bps of AUM), manager-set, ≤ MANAGER_MAX.
    uint16 public managerFeeBps;
    /// @notice Active platform fee — Meridian's OWN annual bps of AUM (≤ PLATFORM_FEE_MAX), by dilution.
    uint16 public platformFeeBps;

    /// @notice The asset the flat fees are denominated/charged in (USDG). Set at init, meridian-updatable.
    address public feeToken;
    /// @notice Fixed fee pulled from the creator on `create` (in `feeToken` units, ≤ FLAT_FEE_MAX). 0 = off.
    uint256 public flatCreateFee;
    /// @notice Fixed redeem fee CONFIG (≤ FLAT_FEE_MAX). NOT charged on in-kind redeem; read by the L5 cash path.
    uint256 public flatRedeemFee;

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
    ///         Computed from Meridian's OWN platformFeeBps rate (an independent leg, not a share of manager).
    uint256 public accPlatformOwed;

    // Pending fee changes (increase only; timelocked). effectiveAt == 0 means none scheduled.
    // uint16 + uint64 grouped to share a storage slot — keep adjacent if reordering.
    uint16 public pendingManagerFeeBps;
    uint64 public managerFeeEffectiveAt;
    uint16 public pendingPlatformFeeBps;
    uint64 public platformFeeEffectiveAt;

    address public pendingManager;
    address public pendingMeridian;

    error ZeroAddress();
    error FeeTooHigh();
    error PlatformFeeTooHigh();
    error NotManager();
    error NotMeridian();
    error NothingPending();
    error TimelockNotElapsed();
    error NotPending();
    error FlatFeeTooHigh();
    error FeeTokenUnset();

    /// @dev toTreasury = Meridian's own platform-fee leg (paid to `treasury`); toManager = the manager's leg.
    event FeeAccrued(uint256 feeShares, uint256 toManager, uint256 toTreasury);
    event ManagerFeeSet(uint16 bps);
    event ManagerFeeScheduled(uint16 bps, uint64 effectiveAt);
    event ManagerFeeActivated(uint16 bps);
    event ManagerFeeScheduleCancelled();
    event PlatformFeeSet(uint16 bps);
    event PlatformFeeScheduled(uint16 bps, uint64 effectiveAt);
    event PlatformFeeActivated(uint16 bps);
    event PlatformFeeScheduleCancelled();
    event TreasurySet(address treasury);
    event ManagerTransferStarted(address pending);
    event ManagerTransferred(address manager);
    event MeridianTransferStarted(address pending);
    event MeridianTransferred(address meridian);
    event FeeTokenSet(address feeToken);
    event FlatCreateFeeSet(uint256 fee);
    event FlatRedeemFeeSet(uint256 fee);

    modifier onlyManager() { if (msg.sender != manager) revert NotManager(); _; }
    modifier onlyMeridian() { if (msg.sender != meridian) revert NotMeridian(); _; }

    function initialize(
        address[] memory tokens,
        uint256[] memory unitQty,
        string memory name_,
        string memory symbol_,
        ManagedParams memory p
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __StorageVault_init(tokens, unitQty);
        __Managed_init(p);
    }

    /// @dev Managed-state init, extracted so ManagedRebalanceVault can reuse it then add keeper state.
    /// @param p Managed initialisation params; see {ManagedParams}.
    function __Managed_init(ManagedParams memory p) internal onlyInitializing {
        if (p.manager == address(0) || p.meridian == address(0) || p.treasury == address(0)) revert ZeroAddress();
        if (p.managerFeeBps > MANAGER_MAX) revert FeeTooHigh();
        if (p.platformFeeBps > PLATFORM_FEE_MAX) revert PlatformFeeTooHigh();
        manager = p.manager;
        meridian = p.meridian;
        treasury = p.treasury;
        managerFeeBps = p.managerFeeBps;
        platformFeeBps = p.platformFeeBps;
        if (p.flatCreateFee > FLAT_FEE_MAX || p.flatRedeemFee > FLAT_FEE_MAX) revert FlatFeeTooHigh();
        if ((p.flatCreateFee > 0 || p.flatRedeemFee > 0) && p.feeToken == address(0)) revert FeeTokenUnset();
        feeToken = p.feeToken;
        flatCreateFee = p.flatCreateFee;
        flatRedeemFee = p.flatRedeemFee;
        lastAccrued = block.timestamp;
    }

    // ============================== FLAT FEE =================================

    /// @dev Pull the flat create fee in USDG from the creator to the treasury. Fixed amount, never a % of
    ///      notional (red line #3). CEI: collected before mint; create is already nonReentrant.
    function _chargeFlatCreateFee() internal override {
        uint256 fee = flatCreateFee;
        if (fee > 0) IERC20(feeToken).safeTransferFrom(msg.sender, treasury, fee);
    }

    /// @notice Set the flat-fee asset (USDG). onlyMeridian. Cannot be zeroed while a flat fee is live
    ///         (that would brick create — `_chargeFlatCreateFee` would call IERC20(address(0)).safeTransferFrom).
    function setFeeToken(address t) external onlyMeridian {
        if (t == address(0) && (flatCreateFee > 0 || flatRedeemFee > 0)) revert FeeTokenUnset();
        feeToken = t; emit FeeTokenSet(t);
    }

    /// @notice Set the flat create fee (≤ FLAT_FEE_MAX). onlyMeridian. A non-zero fee requires feeToken set.
    function setFlatCreateFee(uint256 fee) external onlyMeridian {
        if (fee > FLAT_FEE_MAX) revert FlatFeeTooHigh();
        if (fee > 0 && feeToken == address(0)) revert FeeTokenUnset();
        flatCreateFee = fee; emit FlatCreateFeeSet(fee);
    }

    /// @notice Set the flat redeem fee CONFIG (≤ FLAT_FEE_MAX). Charged only on the L5 cash path, never in-kind.
    function setFlatRedeemFee(uint256 fee) external onlyMeridian {
        if (fee > FLAT_FEE_MAX) revert FlatFeeTooHigh();
        if (fee > 0 && feeToken == address(0)) revert FeeTokenUnset();
        flatRedeemFee = fee; emit FlatRedeemFeeSet(fee);
    }

    // ================================ ACCRUAL ================================

    /// @notice Permissionless poke to settle accrued fees.
    function accrueFee() external nonReentrant {
        _accrue();
    }

    /// @dev Whole shares that _accrue would mint right now (for previewRedeem / UX). Mirrors _accrue.
    function pendingMintShares() public view virtual returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || block.timestamp == lastAccrued) return 0;
        uint256 elapsed = block.timestamp - lastAccrued;
        uint256 mintM = (accManagerOwed + _feeAddScaled(supply, elapsed, managerFeeBps)) / SCALE;
        uint256 mintP = (accPlatformOwed + _feeAddScaled(supply, elapsed, platformFeeBps)) / SCALE;
        return mintM + mintP;
    }

    /// @dev Scaled (×SCALE) compound-correct dilution shares for an annual `bps` rate over `elapsed` seconds on
    ///      `supply`. Pure (rate passed in) so the same formula serves the manager leg and the independent
    ///      platform leg. Saturates at supply·SCALE when the period fee would reach/exceed 100%.
    ///      `elapsed`/`supply` are PASSED IN (not re-read) so the dependency on the OLD `lastAccrued` is
    ///      explicit: callers must compute `elapsed` from `lastAccrued` BEFORE advancing it.
    ///      INVARIANT for future fee setters: call `_accrue()` BEFORE changing managerFeeBps /
    ///      platformFeeBps, so an elapsed window is never charged at a newly-set rate.
    function _feeAddScaled(uint256 supply, uint256 elapsed, uint16 bps) internal pure returns (uint256 addScaled) {
        uint256 num = uint256(bps) * elapsed; // BPS·seconds
        uint256 den = BPS * YEAR;
        addScaled = num >= den ? supply * SCALE : Math.mulDiv(supply, num * SCALE, den - num);
    }

    function _accrue() internal override virtual {
        uint256 supply = totalSupply();
        uint256 ts = block.timestamp;
        if (supply == 0 || ts == lastAccrued) { lastAccrued = ts; return; }
        uint256 elapsed = ts - lastAccrued;
        lastAccrued = ts;
        uint256 managerLeg = _feeAddScaled(supply, elapsed, managerFeeBps);   // manager's own rate
        uint256 platformLeg = _feeAddScaled(supply, elapsed, platformFeeBps); // Meridian's own rate (independent)
        uint256 m = accManagerOwed + managerLeg;
        uint256 p = accPlatformOwed + platformLeg;
        uint256 mintM = m / SCALE;
        uint256 mintP = p / SCALE;
        accManagerOwed = m - mintM * SCALE;   // carry sub-SCALE remainder (no dust)
        accPlatformOwed = p - mintP * SCALE;
        if (mintM > 0) _mint(manager, mintM);
        if (mintP > 0) _mint(treasury, mintP);
        if (mintM > 0 || mintP > 0) emit FeeAccrued(mintM + mintP, mintM, mintP);
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

    /// @notice Set Meridian's platform fee (its own annual bps of AUM). <= current applies instantly (cancels a
    ///         pending increase); higher is timelocked via `activatePlatformFee`. `_accrue()` settles at the old
    ///         rate first. onlyMeridian.
    function setPlatformFeeBps(uint16 bps) external onlyMeridian {
        if (bps > PLATFORM_FEE_MAX) revert PlatformFeeTooHigh();
        _accrue();
        if (bps <= platformFeeBps) {
            platformFeeBps = bps;
            if (platformFeeEffectiveAt != 0) emit PlatformFeeScheduleCancelled();
            pendingPlatformFeeBps = 0;
            platformFeeEffectiveAt = 0;
            emit PlatformFeeSet(bps);
        } else {
            pendingPlatformFeeBps = bps;
            platformFeeEffectiveAt = uint64(block.timestamp + TIMELOCK);
            emit PlatformFeeScheduled(bps, platformFeeEffectiveAt);
        }
    }

    /// @notice Apply a previously-scheduled platform-fee increase after its timelock. onlyMeridian.
    function activatePlatformFee() external onlyMeridian {
        uint64 eff = platformFeeEffectiveAt;
        if (eff == 0) revert NothingPending();
        if (block.timestamp < eff) revert TimelockNotElapsed();
        _accrue();
        platformFeeBps = pendingPlatformFeeBps;
        pendingPlatformFeeBps = 0;
        platformFeeEffectiveAt = 0;
        emit PlatformFeeActivated(platformFeeBps);
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
        virtual
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        return _quoteRedeem(amount, supply + pendingMintShares());
    }
}
