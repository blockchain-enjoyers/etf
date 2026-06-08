// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title OracleTypes — shared L4 oracle vocabulary (Meridian read-price layer)
/// @notice The normalized trust state + scale used by the L4 aggregator and FairValueNAV. Migrated from
///         the (now-deleted) L2 oracle stack; the cache-only types (OracleReading, Source) did NOT move.

/// @notice Effective trust state of a price, ordered by SEVERITY (worst-of wins when summing a basket):
///         Open < Degraded < Halted < Closed < Unknown. The aggregator emits Open/Closed/Unknown;
///         Degraded/Halted are reserved for rail/staleness layers above the source seam.
enum MarketStatus { Open, Degraded, Halted, Closed, Unknown }

/// @notice The fixed internal price scale. All readings are 1e18-denominated.
library PriceScale { uint256 internal constant ONE = 1e18; }

/// @notice Severity ordering + worst-of combiner for MarketStatus (basket NAV takes the worst leg).
library MarketStatusLib {
    function severity(MarketStatus s) internal pure returns (uint8) { return uint8(s); }
    function worse(MarketStatus a, MarketStatus b) internal pure returns (MarketStatus) {
        return severity(a) >= severity(b) ? a : b;
    }
}
