// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ManagedVault} from "../L1/ManagedVault.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    using SafeERC20 for IERC20;

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
    error UseCreate();
    error NonMultipleOfUnitSize();

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

    // ---- custody set: tokens actually held (what create/redeem iterate) ----
    address[] internal _held;
    mapping(address => bool) internal _isHeld;

    /// @notice The custody set (tokens the vault actually holds). Distinct from the target recipe.
    function heldTokens() external view returns (address[] memory) { return _held; }

    function _addHeld(address t) internal {
        if (!_isHeld[t]) { _isHeld[t] = true; _held.push(t); }
    }

    /// @dev Remove `t` from the custody set if its balance is now 0 (swap-out). O(n) swap-pop.
    function _pruneIfEmpty(address t) internal {
        if (IERC20(t).balanceOf(address(this)) != 0) return;
        if (!_isHeld[t]) return;
        _isHeld[t] = false;
        uint256 n = _held.length;
        for (uint256 i = 0; i < n; ++i) {
            if (_held[i] == t) { _held[i] = _held[n - 1]; _held.pop(); break; }
        }
    }

    /// @notice Mint `nShares` basket tokens. Bootstrap (supply==0) pulls the TARGET recipe; afterwards
    ///         pulls pro-rata over CURRENT holdings (rounding UP, favors the vault). Oracle-free.
    function create(uint256 nShares) external override nonReentrant {
        _accrue();
        if (nShares == 0) revert ZeroUnits();
        uint256 supply = totalSupply();
        if (supply == 0) {
            _bootstrap(nShares);
        } else {
            uint256 n = _held.length;
            for (uint256 i = 0; i < n; ++i) {
                address t = _held[i];
                uint256 need = Math.mulDiv(IERC20(t).balanceOf(address(this)), nShares, supply, Math.Rounding.Ceil);
                if (need > 0) IERC20(t).safeTransferFrom(msg.sender, address(this), need);
            }
            _mint(msg.sender, nShares);
        }
        emit Created(msg.sender, nShares, nShares);
    }

    /// @dev First mint: deposit the target recipe scaled to nShares/unitSize, seed the custody set.
    ///      Requires nShares to be a whole multiple of unitSize (bootstrap granularity). Does NOT read
    ///      balanceOf -> no first-depositor inflation.
    function _bootstrap(uint256 nShares) private {
        uint256 us = unitSize();
        if (nShares % us != 0) revert NonMultipleOfUnitSize();
        uint256 units = nShares / us;
        uint256 n = _tokens.length;
        for (uint256 i = 0; i < n; ++i) {
            address t = _tokens[i];
            IERC20(t).safeTransferFrom(msg.sender, address(this), _unitQty[i] * units);
            _addHeld(t);
        }
        _mint(msg.sender, nShares);
    }

    /// @notice Burn `amount` -> pay pro-rata over CURRENT holdings (rounding DOWN, favors remaining
    ///         holders). Never paused by this core; settles nothing on a price. Denominator = supply
    ///         BEFORE burn (after _accrue, so fee dilution counts).
    function redeem(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 n = _held.length;
        uint256[] memory outs = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            outs[i] = Math.mulDiv(IERC20(_held[i]).balanceOf(address(this)), amount, supply);
        }
        _burn(msg.sender, amount);
        for (uint256 i = 0; i < n; ++i) {
            if (outs[i] > 0) IERC20(_held[i]).safeTransfer(msg.sender, outs[i]);
        }
        emit Redeemed(msg.sender, amount);
    }

    /// @notice createWithPermit (inherited, recipe-based) is NOT valid for this holdings-based flavor.
    function createWithPermit(uint256, PermitInput[] calldata) external override nonReentrant {
        revert UseCreate();
    }

    // ---- governed target change (reconstitution or reweight), curator-timelocked ----
    address[] private _pendingTokens;
    uint256[] private _pendingUnitQty;
    uint64 public targetEffectiveAt;

    event TargetScheduled(address[] tokens, uint256[] unitQty, uint64 effectiveAt);
    event TargetActivated(address[] tokens, uint256[] unitQty);

    /// @notice Schedule a new TARGET (add/remove constituents = reconstitution, or change unitQty =
    ///         reweight). Curator (manager) only; activates after TIMELOCK via activateTarget. Holders
    ///         see it and may exit (redeem never pauses) before it applies.
    function scheduleTarget(address[] calldata tokens, uint256[] calldata unitQty) external onlyManager {
        _assertValidRecipe(tokens, unitQty);
        _pendingTokens = tokens;
        _pendingUnitQty = unitQty;
        targetEffectiveAt = uint64(block.timestamp + TIMELOCK);
        emit TargetScheduled(tokens, unitQty, targetEffectiveAt);
    }

    /// @notice Apply the scheduled target after its timelock. Curator only.
    function activateTarget() external onlyManager {
        uint64 eff = targetEffectiveAt;
        if (eff == 0) revert NothingPending();
        if (block.timestamp < eff) revert TimelockNotElapsed();
        address[] memory tk = _pendingTokens;
        uint256[] memory q = _pendingUnitQty;
        _setTarget(tk, q);
        delete _pendingTokens;
        delete _pendingUnitQty;
        targetEffectiveAt = 0;
        emit TargetActivated(tk, q);
    }
}
