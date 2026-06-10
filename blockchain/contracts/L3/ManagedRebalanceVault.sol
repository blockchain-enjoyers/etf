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
///         rewards self-fund from block 1 (R14). Rebalance execution is added in Part 2. The platform
///         fee is Meridian's OWN independent annual AUM leg (-> treasury, not split); the keeper slice
///         is carved from the MANAGER leg (Reserve/R11 floor: keeper rounded UP, manager takes the
///         remainder; KEEPER_MAX < BPS so the manager leg never underflows).
/// @dev    Init goes through `initializeRebalance` (a distinctly-named entrypoint, NOT a second
///         `initialize` overload) so the bare `initialize` is never ambiguous on the subclass ABI. The
///         Part-3 rebalance factory creates the clone and calls `initializeRebalance` atomically.
contract ManagedRebalanceVault is ManagedVault {
    using SafeERC20 for IERC20;

    uint16 public constant KEEPER_MAX = 2000; // 20% of the MANAGER fee; KEEPER_MAX < BPS so the manager leg never underflows

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
        uint16 platformFeeBps;
        uint16 keeperBps;
        address keeperEscrow;
        address feeToken;
        uint256 flatCreateFee;
        uint256 flatRedeemFee;
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
            managerFeeBps: p.managerFeeBps, platformFeeBps: p.platformFeeBps,
            feeToken: p.feeToken, flatCreateFee: p.flatCreateFee, flatRedeemFee: p.flatRedeemFee
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

    // ---- registered executors (the Part-3 auction). meridian (platform) governs the set. ----
    mapping(address => bool) public isExecutor;
    event ExecutorSet(address indexed executor, bool allowed);
    event Rebalanced(address indexed executor, address indexed recipient, address[] acquire, uint256[] acquireIn, address[] release, uint256[] releaseOut);
    error NotExecutor();
    error MinOutNotMet(address token);
    error RebalanceLengthMismatch();
    error OverlappingLeg(address token);
    error InvalidRecipient();

    function setExecutor(address e, bool allowed) external onlyMeridian {
        isExecutor[e] = allowed;
        emit ExecutorSet(e, allowed);
    }

    /// @notice Atomic value-conserving swap-against-vault. The executor has already approved `acquireIn`
    ///         of each acquire token to this vault. In ONE call: pull all acquire legs IN, send all
    ///         release legs OUT, enforce each remaining release-leg balance >= minOut (value-conservation
    ///         floor), update the custody set. All-or-nothing; no price read (settlement = delivered
    ///         ratio); no escrow. Only a registered executor.
    /// @dev    TRUST BOUNDARY: per-leg `minOut` and `releaseOut` are ASSERTED BY THE REGISTERED EXECUTOR
    ///         (the Part-3 auction), not independently verified here. This core enforces only atomicity +
    ///         the per-leg floor + executor-gating + custody-set update, and is oracle-free by design (the
    ///         iron rule: an estimate must never gate a value-moving settlement). The value-conservation
    ///         trust root is therefore (a) `setExecutor` being meridian-gated — treat it as a high-privilege
    ///         op (multisig/timelock on meridian) — and (b) the auction deriving `minOut` from the vault's
    ///         pre-swap holdings and the winning bid, never echoing a caller-supplied value.
    /// @dev    DEFENSE-IN-DEPTH (core hardening): the disjoint-leg guard (`_assertDisjoint`) and the
    ///         recipient!=self guard are belt-and-suspenders so a future (L5/L6) executor cannot bypass
    ///         the per-leg `minOut` floor by listing the SAME token on both sides — an overlap leg would
    ///         otherwise let `releaseOut > acquireIn` net-drain a token while `post + minOut` still reads
    ///         as satisfied. These guards do NOT close the cross-leg value floor (a swap that under-pays
    ///         across DIFFERENT tokens); that remains the deferred L4 navOfHoldings check. The per-leg
    ///         `minOut` check + `_pruneIfEmpty` below are KEPT intact and made un-maskable by disjointness.
    function executeRebalance(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address recipient
    ) external nonReentrant {
        if (!isExecutor[msg.sender]) revert NotExecutor();
        if (recipient == address(this)) revert InvalidRecipient();
        if (acquire.length != acquireIn.length) revert RebalanceLengthMismatch();
        if (release.length != releaseOut.length || release.length != minOut.length) revert RebalanceLengthMismatch();
        _assertDisjoint(acquire, release);

        // pull acquire legs IN (from the executor, which holds the bidder's tokens)
        for (uint256 i = 0; i < acquire.length; ++i) {
            IERC20(acquire[i]).safeTransferFrom(msg.sender, address(this), acquireIn[i]);
            _addHeld(acquire[i]);
        }
        // send release legs OUT, enforce per-leg backing floor
        for (uint256 i = 0; i < release.length; ++i) {
            IERC20(release[i]).safeTransfer(recipient, releaseOut[i]);
            if (IERC20(release[i]).balanceOf(address(this)) < minOut[i]) revert MinOutNotMet(release[i]);
            _pruneIfEmpty(release[i]);
        }
        emit Rebalanced(msg.sender, recipient, acquire, acquireIn, release, releaseOut);
    }

    /// @dev Reject any token that appears on BOTH the acquire and release legs. Reverts BEFORE any
    ///      transfer, so an overlap can never net-drain a token past its per-leg `minOut` floor. Pure;
    ///      extracted (not inlined) to keep `executeRebalance` off the viaIR=false stack cliff.
    function _assertDisjoint(address[] calldata acquire, address[] calldata release) private pure {
        for (uint256 i = 0; i < acquire.length; ++i) {
            for (uint256 j = 0; j < release.length; ++j) {
                if (acquire[i] == release[j]) revert OverlappingLeg(acquire[i]);
            }
        }
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
        _chargeFlatCreateFee();
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

    // ---- holdings-based previews (IMP-8: mirror create/redeem exactly for wei-exactness) ----

    /// @notice Quote how much of each token `create(nShares)` will pull.
    ///         Bootstrap (supply==0): returns the target-recipe quantities scaled to nShares/unitSize —
    ///         exact mirror of `_bootstrap`. Post-bootstrap: pro-rata over current holdings, rounded UP
    ///         (Math.mulDiv Ceil) — exact mirror of the post-bootstrap `create` path.
    /// @dev    Uses `_held` (not `_tokens`) post-bootstrap so the returned token set matches what
    ///         `create` actually iterates. At supply==0 uses `_tokens`/`_unitQty` (the target recipe)
    ///         because `_held` is empty before the first deposit.
    /// @dev    WEI-EXACTNESS: `create` calls `_accrue()` FIRST (which mints fee shares and raises
    ///         totalSupply) and only THEN divides by the post-accrue supply. This view cannot mutate
    ///         state, so it quotes against the EFFECTIVE post-accrue supply `totalSupply() +
    ///         pendingMintShares()`. The 3-way `pendingMintShares()` override returns EXACTLY the share
    ///         count `_accrue` mints in the same block (per-leg ceilDiv + floor mints, summed identically),
    ///         so the denominator here is wei-identical to the one `create` uses. The supply==0 branch
    ///         is keyed on the cached pre-accrue supply: at true supply 0, `_accrue` early-returns and
    ///         pendingMintShares()==0, so bootstrap is unaffected.
    function previewCreate(uint256 nShares)
        external
        view
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) {
            uint256 us = unitSize();
            if (nShares % us != 0) revert NonMultipleOfUnitSize();
            uint256 units = nShares / us;
            uint256 n = _tokens.length;
            tokens = _tokens;
            amounts = new uint256[](n);
            for (uint256 i = 0; i < n; ++i) amounts[i] = _unitQty[i] * units;
            return (tokens, amounts);
        }
        uint256 effSupply = supply + pendingMintShares();
        uint256 m = _held.length;
        tokens = _held;
        amounts = new uint256[](m);
        for (uint256 i = 0; i < m; ++i) {
            amounts[i] = Math.mulDiv(IERC20(_held[i]).balanceOf(address(this)), nShares, effSupply, Math.Rounding.Ceil);
        }
    }

    /// @notice Quote how much of each token `redeem(nShares)` will pay out.
    ///         Reverts NoSupply at supply==0 (nothing to redeem). Pro-rata over current holdings,
    ///         rounded DOWN (Math.mulDiv default) — exact mirror of `redeem`.
    /// @dev    WEI-EXACTNESS: `redeem` calls `_accrue()` FIRST, then snapshots the POST-accrue supply
    ///         as its denominator. So this view MUST add `pendingMintShares()` to match — quoting
    ///         against the stale pre-accrue totalSupply() would over-quote the payout whenever a fee is
    ///         pending. The 3-way `pendingMintShares()` override is wei-identical to what `_accrue`
    ///         mints in the same block, so `totalSupply() + pendingMintShares()` == the exact supply
    ///         `redeem` divides by. (Mirrors the base ManagedVault.previewRedeem, which adds the same.)
    function previewRedeem(uint256 nShares)
        public
        view
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 effSupply = supply + pendingMintShares();
        uint256 m = _held.length;
        tokens = _held;
        amounts = new uint256[](m);
        for (uint256 i = 0; i < m; ++i) {
            amounts[i] = Math.mulDiv(IERC20(_held[i]).balanceOf(address(this)), nShares, effSupply);
        }
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
