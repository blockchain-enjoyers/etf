// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDexPool} from "../interfaces/external/IDexPool.sol";

/// @title MockDexPool
/// @notice Settable CL-pool for TWAP + cardinality + listing-gate depth scenarios. [R7]
/// @dev Lets tests simulate a thin weekend pool: low cardinality (TWAP unsafe) and low cost-to-move
///      (listing gate excludes/caps the constituent). DEX spot is never used as settlement. [R7 hard rule]
contract MockDexPool is IDexPool {
    uint16 public cardinality = 1;
    uint16 public index;
    int56 public tickCumulativePerSecond; // simple linear accumulator for deterministic TWAP
    uint256 public costToMovePerBps; //      cost (quote units) to move 1 bps; scales with depth

    constructor(uint16 initialCardinality, uint256 costPerBps) {
        cardinality = initialCardinality;
        costToMovePerBps = costPerBps;
    }

    // -- scenario setters ----------------------------------------------------

    function setCardinality(uint16 c) external {
        cardinality = c;
    }

    /// @notice Set the per-bps cost-to-move (proxy for weekend-trough depth). Lower => thinner pool.
    function setCostToMovePerBps(uint256 c) external {
        costToMovePerBps = c;
    }

    function setTickCumulativePerSecond(int56 t) external {
        tickCumulativePerSecond = t;
    }

    // -- IDexPool ------------------------------------------------------------

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            // deterministic linear accumulator: tickCumulative = perSecond * (now - secondsAgo)
            tickCumulatives[i] = tickCumulativePerSecond * int56(int256(uint256(block.timestamp - secondsAgos[i])));
            secondsPerLiquidityCumulativeX128s[i] = uint160(block.timestamp - secondsAgos[i]);
        }
    }

    function observationState() external view returns (uint16, uint16) {
        return (index, cardinality);
    }

    function quoteCostToMove(uint256 deltaBps) external view returns (uint256) {
        return costToMovePerBps * deltaBps;
    }
}
