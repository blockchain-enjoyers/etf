// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable Uniswap v2 pair: getReserves() spot path for the adapter.
contract MockUniswapV2Pair {
    uint112 private _r0;
    uint112 private _r1;
    uint32 private _ts;

    function set(uint112 r0, uint112 r1) external {
        _r0 = r0;
        _r1 = r1;
        _ts = uint32(block.timestamp);
    }

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        return (_r0, _r1, _ts);
    }
}
