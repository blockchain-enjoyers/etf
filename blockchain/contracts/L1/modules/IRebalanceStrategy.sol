// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IRebalanceStrategy — PROVISION for Phase 2/3 (not yet wired)
/// @notice Compute->execute contract: a rebalance module returns the target trades (in-kind deltas per
///         constituent); the immutable vault core executes them and enforces the safety envelope
///         (exposure caps, in-kind only, no settlement on an estimate). A price-driven strategy (Phase 3)
///         may READ the external NAV layer to plan USD-proportion targets — the estimate feeds the
///         decision, never the settlement. The module never moves funds itself.
interface IRebalanceStrategy {
    /// @return tokens  constituents to adjust
    /// @return deltas  signed per-constituent target deltas (+ acquire / - release), in-kind
    function planRebalance(bytes calldata context)
        external
        view
        returns (address[] memory tokens, int256[] memory deltas);
}
