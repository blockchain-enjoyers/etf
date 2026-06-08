// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

interface IAggregatorV3Like {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ChainlinkFeedSource — classic Chainlink Data Feeds (latestRoundData push/view)
/// @notice read(): reads the pushed `answer`, scales it to 1e18, and gates on staleness. A second
///         independent Chainlink weekday signal (R13 §1). depth = governance synthetic tier (no pool).
contract ChainlinkFeedSource is IPriceSource {
    IAggregatorV3Like public immutable feed;
    uint8 public immutable feedDecimals;
    uint256 public immutable depthTier;
    uint256 public immutable maxAge; // seconds before a reading is treated as stale

    constructor(address feed_, uint8 feedDecimals_, uint256 depthTier_, uint256 maxAge_) {
        feed = IAggregatorV3Like(feed_);
        feedDecimals = feedDecimals_;
        depthTier = depthTier_;
        maxAge = maxAge_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        uint256 price = answer > 0 ? _to1e18(uint256(answer)) : 0;
        r.price = price;
        r.depth = depthTier;
        r.confidence = 0;
        r.lastUpdate = uint64(updatedAt);
        r.kind = SourceKind.ORACLE_PUSH;
        r.weekendAware = false;
        r.healthy = price > 0 && updatedAt > 0 && block.timestamp >= updatedAt && block.timestamp - updatedAt <= maxAge;
    }

    function describe() external view returns (string memory, address) {
        return ("chainlink-data-feed", address(feed));
    }

    function _to1e18(uint256 v) private view returns (uint256) {
        if (feedDecimals == 18) return v;
        if (feedDecimals < 18) return v * (10 ** (18 - feedDecimals));
        return v / (10 ** (feedDecimals - 18));
    }
}
