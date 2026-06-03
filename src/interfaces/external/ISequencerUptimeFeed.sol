// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ISequencerUptimeFeed
/// @notice Chainlink L2 Sequencer Uptime Feed (Orbit/Arbitrum). [R7]
/// @dev answer == 0 => sequencer UP; answer == 1 => DOWN. After recovery, enforce a grace period
///      (block.timestamp - startedAt >= GRACE) before trusting oracle-dependent paths.
interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
