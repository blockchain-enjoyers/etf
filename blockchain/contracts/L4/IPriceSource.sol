// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice What each source is, for future per-kind penalties (unused by Stage-0 core math).
enum SourceKind { AMM_SPOT, AMM_TWAP, PERP, ORACLE_PUSH, ORACLE_PULL, RWA_STREAM }

/// @notice Normalized reading every adapter returns. price/depth/confidence are 1e18-scaled.
/// @param price        mid price, 1e18 USD per 1 whole unit. Valid only when healthy and price > 0.
/// @param depth        USD notional (1e18) to move this source's price by the reference delta
///                     (cost-to-move, NOT raw TVL). Oracles with no pool get a synthetic depth tier.
/// @param lastUpdate   unix seconds of the underlying observation.
/// @param kind         source classification (metadata).
/// @param confidence   1e18 half-band (e.g. Pyth conf/price; 0 if no book).
/// @param weekendAware true only if the source legitimately moves while US equities are closed.
/// @param healthy      adapter self-validity (not reverting; venue/market status ok; rail ok).
struct SourceReading {
    uint256 price;
    uint256 depth;
    uint64 lastUpdate;
    SourceKind kind;
    uint256 confidence;
    bool weekendAware;
    bool healthy;
}

/// @title IPriceSource — source-agnostic adapter seam for the L4 aggregator
/// @notice One adapter per source. on-chain read-adapters ignore `payload`; signed-report adapters
///         decode `payload` and verify the provider's signature before returning the reading.
interface IPriceSource {
    /// @notice Non-view: signed-report adapters verify inline (state-changing verify); read-adapters read
    ///         state. Semantically a read; purity is not required. A view implementation legally overrides.
    function read(bytes calldata payload) external returns (SourceReading memory);
    function describe() external view returns (string memory venue, address target);
}
