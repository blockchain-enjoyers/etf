// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title OracleTypes — shared L2 oracle vocabulary (Meridian read-price layer)
/// @notice Normalized price types that live BEHIND our own interface so the rest of the L2 stack
///         (OracleRouter, NAVEngine) never touches a Chainlink-specific struct. Swapping the source
///         (Chainlink Data Streams now; a closed-market fair-value adapter at L4 later) is a single
///         adapter change, never a change here. See docs/guides/L2-nav-engine-spec.md.

/// @notice Effective trust state of a single price, ordered by SEVERITY (worst-of wins when summing
///         a basket). It is NOT a 1:1 copy of any vendor field:
///         - Open     — a live, fresh, tradeable price (Data Streams marketStatus 1..4: pre/regular/
///                      post/overnight all count as Open for valuation; the price is live).
///         - Degraded — the price may be fine but the RAIL is compromised: L2 sequencer down or within
///                      its restart grace window. Derived by OracleRouter, never reported by the feed.
///         - Halted   — the venue says Open but the price is STALE past threshold (a real halt or feed
///                      outage shows up here; Data Streams has no explicit halt flag — Chainlink's own
///                      guide says to detect it via staleness). Derived by OracleRouter.
///         - Closed   — the venue is closed (weekend/holiday; Data Streams marketStatus 5, or v8 == 1).
///                      The authoritative signal is the marketStatus FIELD, never the timestamp:
///                      Chainlink repeats the last price and freezes the timestamp on close by design.
///         - Unknown  — marketStatus 0 / no reading; treated as the most severe state.
enum MarketStatus {
    Open,
    Degraded,
    Halted,
    Closed,
    Unknown
}

/// @notice Our normalized, source-agnostic price reading. Price/confidence are carried at a FIXED
///         1e18 scale (PRICE_SCALE) regardless of the vendor's native scale; the adapter normalizes.
/// @param price        mid price, 1e18-scaled (USD per 1 whole unit of the asset). Always > 0 when valid.
/// @param confidence   half-spread band (1e18-scaled): (ask - bid) / 2, or 0 if no book. The NAV band
///                     is built from this; even a market-hours NAV carries a band by design.
/// @param timestamp    seconds (normalized from the vendor's nanosecond lastSeen timestamp).
/// @param marketStatus normalized status (see enum). The adapter only ever emits Open/Closed/Unknown;
///                     Degraded/Halted are layered on by OracleRouter from rail + staleness checks.
/// @param source       provenance tag (see Source). Lets a consumer/audit see which adapter produced it.
struct OracleReading {
    int256 price;
    uint256 confidence;
    uint256 timestamp;
    MarketStatus marketStatus;
    uint8 source;
}

/// @notice Source provenance tags for OracleReading.source.
library Source {
    uint8 internal constant NONE = 0;
    uint8 internal constant CHAINLINK_DATA_STREAMS = 1;
    uint8 internal constant FAIR_VALUE_L4 = 2; // reserved: closed-market fair-value branch (L4)
}

/// @notice The fixed internal price scale. All OracleReading prices/confidence are 1e18-denominated.
library PriceScale {
    uint256 internal constant ONE = 1e18;
}

/// @notice Severity ordering + worst-of combiner for MarketStatus (basket NAV takes the worst leg).
library MarketStatusLib {
    function severity(MarketStatus s) internal pure returns (uint8) {
        return uint8(s); // enum is declared in ascending severity order on purpose
    }

    /// @return the more severe of `a`, `b` (Open < Degraded < Halted < Closed < Unknown).
    function worse(MarketStatus a, MarketStatus b) internal pure returns (MarketStatus) {
        return severity(a) >= severity(b) ? a : b;
    }
}
