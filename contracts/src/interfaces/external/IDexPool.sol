// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDexPool
/// @notice Concentrated-liquidity pool surface for TWAP + depth (listing gate). [R7]
/// @dev TWAP is read via cumulative ticks; `observationCardinality` MUST be checked — a nominal
///      window is a false claim without enough stored observations (Inverse/Rari failures). [R7]
///      DEX spot / LP-balance are NEVER used as an authoritative/settlement price. [R7 hard rule]
interface IDexPool {
    /// @notice Uniswap-V3-style observe: cumulative ticks at each `secondsAgos` point.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    /// @return observationIndex      current ring-buffer index
    /// @return observationCardinality number of stored observation slots (the cardinality check)
    function observationState() external view returns (uint16 observationIndex, uint16 observationCardinality);

    /// @notice Worst-case (weekend-trough) one-block cost in quote units to move price by `deltaBps`.
    /// @dev Used by the listing gate invariant m*C1(delta,depth) > L*weight*delta*TVL. Mock returns a settable value.
    function quoteCostToMove(uint256 deltaBps) external view returns (uint256 costQuote);
}
