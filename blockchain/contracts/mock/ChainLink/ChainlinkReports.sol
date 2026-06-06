// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ChainlinkReports — Chainlink Data Streams wire formats (vendor wire struct)
/// @notice The on-the-wire RWA report layout. Vendor-specific, so it lives under mock/ChainLink and is
///         shared only by ChainlinkAdapter (decode) and the mock verifier (encode). The neutral L2
///         stack never sees it — it speaks only OracleReading.

/// @notice RWA "Advanced" (v11) Data Streams report — the 24/5 US Equities schema.
/// @dev MODELED from the Chainlink v11 field table (docs/data-streams report-schema-v11). The docs
///      publish a field table, not a canonical Solidity struct, so the exact FIELD ORDER here is
///      UNCONFIRMED and MUST be reconciled against the canonical reference struct before mainnet —
///      abi.decode is position-sensitive. This is deliberately the ONLY place that knows the layout.
///      marketStatus (v11): 0 Unknown, 1 Pre-market, 2 Regular, 3 Post-market, 4 Overnight, 5 Closed.
struct ReportV11 {
    bytes32 feedId;
    uint32 validFromTimestamp;
    uint32 observationsTimestamp;
    uint192 nativeFee;
    uint192 linkFee;
    uint32 expiresAt;
    int192 mid;
    uint64 lastSeenTimestampNs;
    int192 bid;
    int192 bidVolume;
    int192 ask;
    int192 askVolume;
    int192 lastTradedPrice;
    uint32 marketStatus;
}
