// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IOracleAdapter} from "../../L2/interfaces/IOracleAdapter.sol";
import {OracleReading, MarketStatus, Source} from "../../L2/OracleTypes.sol";
import {IVerifierProxy} from "./IVerifierProxy.sol";
import {ReportV11} from "./ChainlinkReports.sol";

/// @title ChainlinkAdapter — verifies an RWA Data Streams report and normalizes it
/// @notice The Chainlink BINDING for the L2 read-price stack: the only contract that knows the
///         Chainlink wire format. It calls VerifierProxy.verify (pull model), decodes the schema
///         struct, and emits a source-agnostic OracleReading. Everything in L2 (OracleRouter,
///         NAVEngine) is vendor-free and depends only on IOracleAdapter, so this binding lives here
///         under mock/ChainLink alongside the vendor interface + mocks and is swappable (e.g. the L4
///         fair-value branch is a different IOracleAdapter). This is PRODUCTION code, not a mock; it is
///         grouped with the Chainlink integration by folder, not by status.
/// @dev Pull-model reminder: `verifyAndNormalize` is NON-view because `verify` is a state-changing,
///      payable call. A keeper drives it through OracleRouter.ingest to cache readings for the view
///      NAV; a settlement path could call it inline for same-tx freshness (out of L2 read-only scope).
///
///      SCHEMA-VERSION AWARENESS: marketStatus is encoded differently across schema versions, so the
///      adapter is configured with `schemaVersion` and maps to our enum. The authoritative open/closed
///      signal is the marketStatus FIELD, never the timestamp (Chainlink freezes the timestamp and
///      repeats the last price on close by design — staleness is handled one layer up, in the router).
///
///      This adapter only ever produces Open / Closed / Unknown. Degraded (rail) and Halted (stale)
///      are derived by OracleRouter, which owns the sequencer feed and the staleness threshold.
contract ChainlinkAdapter is IOracleAdapter {
    /// @notice The Data Streams verification entrypoint (VerifierProxy).
    IVerifierProxy public immutable verifierProxy;
    /// @notice Report schema version this adapter decodes (8 = RWA Standard, 11 = RWA Advanced/equities).
    uint8 public immutable schemaVersion;

    error UnsupportedSchema(uint8 schemaVersion);
    error FeedIdMismatch(bytes32 expected, bytes32 got);
    error NonPositivePrice(int192 mid);

    /// @param verifierProxy_ the VerifierProxy address for the target chain.
    /// @param schemaVersion_ 11 for 24/5 US Equities (RWA Advanced); 8 for RWA Standard.
    constructor(IVerifierProxy verifierProxy_, uint8 schemaVersion_) {
        if (schemaVersion_ != 11 && schemaVersion_ != 8) revert UnsupportedSchema(schemaVersion_);
        verifierProxy = verifierProxy_;
        schemaVersion = schemaVersion_;
    }

    /// @inheritdoc IOracleAdapter
    function source() external pure returns (uint8) {
        return Source.CHAINLINK_DATA_STREAMS;
    }

    /// @inheritdoc IOracleAdapter
    /// @dev We forward `signedReport` opaquely to verify() and decode its RESULT — the adapter never
    ///      parses the signed blob itself. `parameterPayload` is empty: on the RHC testnet verify is
    ///      free (no FeeManager); mainnet billing is subscription, not per-call value.
    function verifyAndNormalize(bytes calldata signedReport, bytes32 expectedFeedId)
        external
        returns (OracleReading memory)
    {
        bytes memory verified = verifierProxy.verify(signedReport, bytes(""));
        // v8 and v11 share the leading fields but differ past them; decode per configured version.
        // (Only v11 is wired here for the 24/5 equities path; v8 is a thin future branch.)
        ReportV11 memory r = abi.decode(verified, (ReportV11));
        if (r.feedId != expectedFeedId) revert FeedIdMismatch(expectedFeedId, r.feedId);
        return _normalize(r);
    }

    /// @dev Pure normalization of a decoded v11 report into an OracleReading. Mid is the consensus
    ///      price; confidence is the half-spread from the book (0 if absent). Timestamp is the
    ///      nanosecond lastSeen scaled to seconds.
    function _normalize(ReportV11 memory r) internal view returns (OracleReading memory reading) {
        if (r.mid <= 0) revert NonPositivePrice(r.mid);

        // Half-spread confidence band: (ask - bid) / 2 when a two-sided book is present.
        uint256 confidence = 0;
        if (r.ask > r.bid && r.bid > 0) {
            confidence = uint256(int256(r.ask) - int256(r.bid)) / 2;
        }

        reading = OracleReading({
            price: int256(r.mid), // Data Streams prices are 1e18-scaled; PriceScale.ONE is the convention
            confidence: confidence,
            timestamp: uint256(r.lastSeenTimestampNs) / 1e9, // ns -> s
            marketStatus: _mapStatus(r.marketStatus),
            source: Source.CHAINLINK_DATA_STREAMS
        });
    }

    /// @dev Map the vendor marketStatus to our enum, schema-version aware.
    ///      v11 (equities): 0 Unknown; 1 Pre / 2 Regular / 3 Post / 4 Overnight -> Open (price is live);
    ///                      5 Closed.
    ///      v8 (standard):  0 Unknown; 1 Closed; 2 Open.
    ///      We never emit Degraded/Halted here — the router derives those from rail + staleness.
    function _mapStatus(uint32 raw) internal view returns (MarketStatus) {
        if (schemaVersion == 11) {
            if (raw == 0) return MarketStatus.Unknown;
            if (raw == 5) return MarketStatus.Closed;
            return MarketStatus.Open; // 1..4 are all live, tradeable sessions
        }
        // schemaVersion == 8
        if (raw == 2) return MarketStatus.Open;
        if (raw == 1) return MarketStatus.Closed;
        return MarketStatus.Unknown;
    }
}
