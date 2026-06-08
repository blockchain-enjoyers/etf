// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable Uniswap v3 pool for adapter tests: observe() returns tickCumulatives that
///         imply a constant arithmetic-mean tick over any queried window; liquidity + cardinality settable.
contract MockUniswapV3Pool {
    int24 public meanTick; // the tick the TWAP should resolve to
    uint128 public liquidity; // in-range liquidity
    uint16 public cardinality; // slot0.observationCardinality

    function set(int24 tick_, uint128 liq_, uint16 card_) external {
        meanTick = tick_;
        liquidity = liq_;
        cardinality = card_;
    }

    /// @dev tickCumulatives chosen so (tc[1]-tc[0]) / window == meanTick for the queried [window, 0].
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityX128)
    {
        uint32 window = secondsAgos[0] - secondsAgos[1];
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(int256(meanTick) * int256(uint256(window)));
        secondsPerLiquidityX128 = new uint160[](2);
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16 observationCardinality, uint16, uint8, bool)
    {
        return (0, meanTick, 0, cardinality, 0, 0, true);
    }
}
