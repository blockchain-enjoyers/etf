// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Settable Chainlink-style L2 sequencer uptime feed. answer 0 == up, 1 == down.
///         The real L2 sequencer mock was removed with the L2 cache stack; this re-adds it for L6.
contract MockSequencerUptimeFeed {
    int256 public answer;     // 0 = up, 1 = down
    uint256 public startedAt; // unix seconds the current status began

    function set(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt_, uint256 updatedAt, uint80 answeredInRound)
    {
        return (0, answer, startedAt, block.timestamp, 0);
    }
}
