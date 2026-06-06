// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ISequencerUptimeFeed — neutral L2 sequencer-liveness read interface
/// @notice OracleRouter's liveness gate depends on THIS, not on any vendor type, so L2 stays
///         vendor-neutral. On a real deployment the address is a Chainlink L2 Sequencer Uptime Feed
///         (a classic Data Feed, structurally compatible: same `latestRoundData` selector/return), but
///         L2 never imports a Chainlink symbol. answer: 0 = sequencer up, 1 = down. `startedAt` is when
///         the current status began (used for the restart grace window).
interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
