// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable Chainlink AggregatorV3 (classic Data Feeds push model) for adapter tests.
contract MockAggregatorV3 {
    uint8 public decimals;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        _answer = answer_;
        _updatedAt = updatedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
