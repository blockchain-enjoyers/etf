// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ChainlinkReports — Chainlink Data Streams wire formats (vendor wire structs)
/// @notice The on-the-wire RWA report layouts. Vendor-specific, so they live under mock/ChainLink and
///         are shared only by ChainlinkStreamsSource (decode) and the mock verifier (encode). The
///         neutral product code never sees them — it speaks only SourceReading.

/// @notice RWA "Standard" v8 — status {0 Unknown, 1 Closed, 2 Open}.
struct ReportV8 {
    bytes32 feedId;
    uint32 validFromTimestamp;
    uint32 observationsTimestamp;
    uint192 nativeFee;
    uint192 linkFee;
    uint32 expiresAt;
    uint64 lastUpdateTimestamp; // nanoseconds
    int192 midPrice;
    uint32 marketStatus;
}

/// @notice RWA "Advanced" v11 (24/5 US Equities) — status {0 Unknown,1 Pre,2 Regular,3 Post,4 Overnight,5 Closed}.
/// @dev Field order per docs/data-streams report-schema-v11. RECONCILE against the canonical reference
///      struct before mainnet — abi.decode is position-sensitive.
struct ReportV11 {
    bytes32 feedId;
    uint32 validFromTimestamp;
    uint32 observationsTimestamp;
    uint192 nativeFee;
    uint192 linkFee;
    uint32 expiresAt;
    int192 mid;
    int192 bid;
    int192 bidVolume;
    int192 ask;
    int192 askVolume;
    int192 lastTradedPrice;
    uint32 marketStatus;
    uint64 lastSeenTimestampNs;
}
