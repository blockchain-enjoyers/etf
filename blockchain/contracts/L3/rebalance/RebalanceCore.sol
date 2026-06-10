// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {RebalanceFeeCore} from "./RebalanceFeeCore.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RebalanceCore — custody-agnostic holdings create/redeem + executeRebalance
/// @notice Holdings-based create/redeem + value-conserving executeRebalance + the `_held` membership set,
///         all over an ABSTRACT custody port (the leaf binds it to a concrete substrate). Mirrors the
///         holdings logic of ManagedRebalanceVault, but with NO stored recipe (`_tokens`) — the target is a
///         Merkle root held by the leaf (RootCommitment); bootstrap is a leaf concern. Two distinct ports:
///         a CLAIM-reassignment port (create/redeem) and an ERC-20/keeper-boundary port (executeRebalance).
/// @dev    Under `FeeCore is VaultCore`, NOT StorageVaultBase — so the ops copied from ManagedRebalanceVault
///         (which were `override` of StorageVaultBase virtuals) are declared `virtual` NEW here. Errors/events
///         that live only in StorageVaultBase/ManagedRebalanceVault are redeclared; those in VaultCore
///         (`ZeroUnits`/`ZeroAmount`/`NoSupply`/`Created`/`Redeemed`) are inherited.
abstract contract RebalanceCore is RebalanceFeeCore {
    // ---- abstract custody ports (DISTINCT names from RegistryCustody's non-virtual _custody*) ----

    /// @dev claim-reassignment port — used by create/redeem (registry leaf: ERC-6909 claim _transfer).
    function _portBalance(address token) internal view virtual returns (uint256);
    function _portIn(address from, address token, uint256 amount) internal virtual;
    function _portOut(address to, address token, uint256 amount) internal virtual;

    /// @dev ERC-20 keeper-boundary port — used by executeRebalance ONLY (registry leaf: wrap acquire /
    ///      unwrap release). The auction counterparty deals in REAL ERC-20; create/redeem move claims.
    function _acquireIn(address from, address token, uint256 amount) internal virtual;   // pull real ERC-20 in (+ wrap on registry)
    function _releaseOut(address to, address token, uint256 amount) internal virtual;     // send real ERC-20 out (unwrap on registry)

    // ---- errors/events not present in this lineage (VaultCore/FeeCore/RebalanceFeeCore) ----
    error NonMultipleOfUnitSize();
    error NotBootstrapped();
    error NotExecutor();
    error MinOutNotMet(address token);
    error RebalanceLengthMismatch();
    error OverlappingLeg(address token);
    error InvalidRecipient();

    // ---- registered executors (the Part-3 auction). meridian (platform) governs the set. ----
    mapping(address => bool) public isExecutor;
    event ExecutorSet(address indexed executor, bool allowed);
    event Rebalanced(address indexed executor, address indexed recipient, address[] acquire, uint256[] acquireIn, address[] release, uint256[] releaseOut);

    function setExecutor(address e, bool allowed) external onlyMeridian {
        isExecutor[e] = allowed;
        emit ExecutorSet(e, allowed);
    }

    /// @notice Atomic value-conserving swap-against-vault. The executor has already approved `acquireIn`
    ///         of each acquire token to this vault. In ONE call: pull all acquire legs IN (via the keeper
    ///         boundary port), send all release legs OUT, enforce each remaining release-leg CUSTODY balance
    ///         >= minOut (value-conservation floor), update the custody set. All-or-nothing; no price read
    ///         (settlement = delivered ratio); no escrow. Only a registered executor.
    /// @dev    TRUST BOUNDARY: per-leg `minOut` and `releaseOut` are ASSERTED BY THE REGISTERED EXECUTOR
    ///         (the Part-3 auction), not independently verified here. This core enforces only atomicity +
    ///         the per-leg floor + executor-gating + custody-set update, and is oracle-free by design.
    /// @dev    DEFENSE-IN-DEPTH: the disjoint-leg guard (`_assertDisjoint`) and the recipient!=self guard
    ///         are belt-and-suspenders so an executor cannot mask the per-leg floor by listing the SAME
    ///         token on both sides. The cross-leg value floor remains the deferred L4 navOfHoldings check.
    function executeRebalance(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address recipient
    ) external virtual nonReentrant {
        if (!isExecutor[msg.sender]) revert NotExecutor();
        if (recipient == address(this)) revert InvalidRecipient();
        if (acquire.length != acquireIn.length) revert RebalanceLengthMismatch();
        if (release.length != releaseOut.length || release.length != minOut.length) revert RebalanceLengthMismatch();
        _assertDisjoint(acquire, release);

        // pull acquire legs IN (from the executor, which holds the bidder's tokens) — wraps into claims on the leaf
        for (uint256 i = 0; i < acquire.length; ++i) {
            _acquireIn(msg.sender, acquire[i], acquireIn[i]);
            _addHeld(acquire[i]);
        }
        // send release legs OUT, enforce per-leg backing floor against the CLAIM (custody) balance
        for (uint256 i = 0; i < release.length; ++i) {
            _releaseOut(recipient, release[i], releaseOut[i]);
            if (_portBalance(release[i]) < minOut[i]) revert MinOutNotMet(release[i]);
            _pruneIfEmpty(release[i]);
        }
        emit Rebalanced(msg.sender, recipient, acquire, acquireIn, release, releaseOut);
    }

    /// @dev Reject any token that appears on BOTH the acquire and release legs. Reverts BEFORE any
    ///      transfer. Pure; extracted to keep `executeRebalance` off the viaIR=false stack cliff.
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

    /// @dev Remove `t` from the custody set if its custody balance is now 0 (swap-out). O(n) swap-pop.
    function _pruneIfEmpty(address t) internal {
        if (_portBalance(t) != 0) return;
        if (!_isHeld[t]) return;
        _isHeld[t] = false;
        uint256 n = _held.length;
        for (uint256 i = 0; i < n; ++i) {
            if (_held[i] == t) { _held[i] = _held[n - 1]; _held.pop(); break; }
        }
    }

    // ---- holdings create/redeem (post-bootstrap; bootstrap is a leaf concern) ----

    /// @notice Mint `nShares` basket tokens pro-rata over CURRENT holdings (rounding UP, favors the vault).
    ///         Holdings-only: requires the vault to be bootstrapped (supply > 0); otherwise reverts
    ///         NotBootstrapped (the leaf's `bootstrap` seeds the first mint). Oracle-free.
    function create(uint256 nShares) external virtual nonReentrant {
        _accrue();
        _chargeFlatCreateFee();
        if (nShares == 0) revert ZeroUnits();
        uint256 supply = totalSupply();
        if (supply == 0) revert NotBootstrapped();
        uint256 n = _held.length;
        for (uint256 i = 0; i < n; ++i) {
            address t = _held[i];
            uint256 need = Math.mulDiv(_portBalance(t), nShares, supply, Math.Rounding.Ceil);
            if (need > 0) _portIn(msg.sender, t, need);
        }
        _mint(msg.sender, nShares);
        emit Created(msg.sender, nShares, nShares);
    }

    /// @notice Burn `amount` -> pay pro-rata over CURRENT holdings (rounding DOWN, favors remaining
    ///         holders) as CLAIMS. Never paused by this core; settles nothing on a price. Denominator =
    ///         supply BEFORE burn (after _accrue, so fee dilution counts).
    function redeem(uint256 amount) external virtual nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 n = _held.length;
        uint256[] memory outs = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            outs[i] = Math.mulDiv(_portBalance(_held[i]), amount, supply);
        }
        _burn(msg.sender, amount);
        for (uint256 i = 0; i < n; ++i) {
            if (outs[i] > 0) _portOut(msg.sender, _held[i], outs[i]);
        }
        emit Redeemed(msg.sender, amount);
    }

    // ---- holdings-based previews (mirror create/redeem exactly for wei-exactness) ----

    /// @notice Quote how much of each token `create(nShares)` will pull. Pro-rata over current holdings,
    ///         rounded UP — exact mirror of the post-bootstrap `create` path against the EFFECTIVE
    ///         post-accrue supply `totalSupply() + pendingMintShares()`. Reverts NotBootstrapped at supply==0.
    function previewCreate(uint256 nShares)
        external
        view
        virtual
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NotBootstrapped();
        uint256 effSupply = supply + pendingMintShares();
        uint256 m = _held.length;
        tokens = _held;
        amounts = new uint256[](m);
        for (uint256 i = 0; i < m; ++i) {
            amounts[i] = Math.mulDiv(_portBalance(_held[i]), nShares, effSupply, Math.Rounding.Ceil);
        }
    }

    /// @notice Quote how much of each token `redeem(amount)` will pay out. Pro-rata over current holdings,
    ///         rounded DOWN against the effective post-accrue supply. Reverts NoSupply at supply==0.
    function previewRedeem(uint256 amount)
        public
        view
        virtual
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 effSupply = supply + pendingMintShares();
        uint256 m = _held.length;
        tokens = _held;
        amounts = new uint256[](m);
        for (uint256 i = 0; i < m; ++i) {
            amounts[i] = Math.mulDiv(_portBalance(_held[i]), amount, effSupply);
        }
    }
}
