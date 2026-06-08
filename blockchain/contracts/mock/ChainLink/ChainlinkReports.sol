// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ChainlinkReports — Chainlink Data Streams wire formats (vendor wire structs)
/// @notice The on-the-wire RWA report layouts. Vendor-specific, so they live under mock/ChainLink and
///         are shared only by ChainlinkStreamsSource (decode) and the mock verifier (encode). The
///         neutral product code never sees them — it speaks only SourceReading.

/// @notice RWA "Tokenized Asset" v10 — carries BOTH the underlying equity `price` (frozen on weekends)
///         and a `tokenizedPrice` sourced from CEX secondary markets that keeps moving while the equity
///         market is Closed. THE on-chain-readable weekend signal (R13 §5). `currentMultiplier` is 1e18-scaled.
/// @dev Field order modeled per R13 §1; RECONCILE against the canonical reference struct before mainnet —
///      abi.decode is position-sensitive. status {0 Unknown, 1 Pre, 2 Regular, 3 Post, 4 Overnight, 5 Closed}.
struct ReportV10 {
    bytes32 feedId;
    uint32 validFromTimestamp;
    uint32 observationsTimestamp;
    uint192 nativeFee;
    uint192 linkFee;
    uint32 expiresAt;
    int192 price; // underlying equity (frozen on weekends)
    uint64 lastUpdateTimestamp; // nanoseconds
    uint32 marketStatus;
    uint64 currentMultiplier; // 1e18-scaled corporate-action multiplier
    uint64 newMultiplier;
    uint32 activationDateTime;
    int192 tokenizedPrice; // CEX secondary; keeps moving on weekends
}

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
