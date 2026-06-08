// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable Uniswap v4 truncated-oracle hook: observe() returns tickCumulatives implying a
///         constant mean tick over the window; liquidity settable for the depth proxy.
contract MockV4Hook {
    int24 public meanTick;
    uint128 public liquidity;

    function set(int24 tick_, uint128 liq_) external {
        meanTick = tick_;
        liquidity = liq_;
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives) {
        uint32 window = secondsAgos[0] - secondsAgos[1];
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(int256(meanTick) * int256(uint256(window)));
    }
}
