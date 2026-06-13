// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface ISeqFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256 startedAt, uint256, uint80);
}

/// @notice Orbit/Arbitrum L2 sequencer-uptime gate. answer==0 means UP. After the sequencer restarts, a
///         restart-grace window is enforced so consumers do not act on prices that went stale during downtime.
///         A zero feed with required==false disables the gate; this MUST be an explicit governance choice
///         (required==true + zero feed reverts), never a silent default.
contract SequencerGuard {
    ISeqFeed public immutable feed;
    bool public immutable required;

    error SequencerFeedMissing();

    constructor(address feed_, bool required_) {
        if (required_ && feed_ == address(0)) revert SequencerFeedMissing();
        feed = ISeqFeed(feed_);
        required = required_;
    }

    /// @return ok true iff the sequencer is up and past `grace` seconds, or the gate is explicitly disabled.
    function isUp(uint256 grace) external view returns (bool ok) {
        if (address(feed) == address(0)) return true; // disabled by explicit governance (required==false)
        (, int256 answer, uint256 startedAt,,) = feed.latestRoundData();
        if (answer != 0) return false; // 1 == down
        return block.timestamp - startedAt > grace;
    }
}
