// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISequencerUptimeFeed} from "../interfaces/external/ISequencerUptimeFeed.sol";

/// @title MockSequencerUptimeFeed
/// @notice Settable L2 sequencer uptime feed. [R7]
/// @dev answer 0 = up, 1 = down. `startedAt` lets tests exercise the post-recovery grace period.
contract MockSequencerUptimeFeed is ISequencerUptimeFeed {
    int256 public answer; //     0 up, 1 down
    uint256 public startedAt; //  when the current status began
    uint80 public roundId = 1;

    constructor() {
        answer = 0; // up
        startedAt = block.timestamp;
    }

    /// @notice Bring the sequencer down (answer=1), stamping startedAt = now.
    function setDown() external {
        answer = 1;
        startedAt = block.timestamp;
        roundId++;
    }

    /// @notice Bring the sequencer up; `recoveredAt` seeds startedAt so the grace window can be tested.
    function setUp(uint256 recoveredAt) external {
        answer = 0;
        startedAt = recoveredAt;
        roundId++;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, startedAt, startedAt, roundId);
    }
}
