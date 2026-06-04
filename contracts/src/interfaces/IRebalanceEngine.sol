// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title IRebalanceEngine
/// @notice Proposes constituent/weight adjustments; the vault enforces value-preservation. [R1 Tilt pattern]
/// @dev v1 HARD GATE: rebalance executes ONLY when OracleRouter.isFreshRegular(asset) is true (marketStatus
///      Regular + fresh feed + sequencer healthy). Weekend/stale/halt => revert/pause. [R7 Kamino]
///      Curator sets target weights behind a time-lock; keeper triggers when conditions allow. [R1]
interface IRebalanceEngine {
    event WeightsProposed(bytes32 indexed basketId, uint64 eta);
    event WeightsCommitted(bytes32 indexed basketId);
    event RebalanceExecuted(bytes32 indexed basketId, address tokenIn, address tokenOut, uint256 amountIn);

    error MarketNotFreshRegular(bytes32 basketId);
    error WeightTimelockNotElapsed(bytes32 basketId, uint64 eta);
    error NotCurator();
    error WeightsNot10000(uint256 sumBps);

    /// @notice Curator queues new target weights (time-locked). [R1]
    function proposeWeights(bytes32 basketId, MeridianTypes.Constituent[] calldata targets) external;

    /// @notice Commit queued weights after the time-lock.
    function commitWeights(bytes32 basketId) external;

    /// @notice Keeper triggers a rebalance step toward target weights.
    /// @dev Reverts with MarketNotFreshRegular unless the v1 gate passes. Calls vault.executeRebalance. [R7]
    function rebalance(bytes32 basketId, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external;

    function targetWeights(bytes32 basketId) external view returns (MeridianTypes.Constituent[] memory);
}
