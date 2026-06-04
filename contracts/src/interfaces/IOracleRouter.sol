// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title IOracleRouter
/// @notice Fuses pluggable IOracleAdapter sources into one reading, applies staleness + sequencer gating
///         and resolves market status. The only price surface NAVEngine consumes. [R5/R7]
/// @dev v1: Chainlink anchor + staleness + sequencer-uptime. v2: + DEX-TWAP/perp adapters, divergence checks.
///      HARD RULE: never returns a single-source price as settlement-grade; consumers honor `estimated`. [R7]
interface IOracleRouter {
    event AdapterRegistered(MeridianTypes.OracleSource indexed source, address adapter);
    event AdapterRemoved(MeridianTypes.OracleSource indexed source);
    event SequencerFeedSet(address feed, uint64 gracePeriod);

    error SequencerDown();
    error SequencerGracePeriod(uint64 remaining);
    error NoFreshSource(address asset);
    error StaleReading(address asset, uint64 age);
    error SourceDivergence(address asset);

    /// @notice Fused, normalized reading for one asset (18-dec). Reverts if no source is usable.
    /// @dev Settlement-grade: reverts on stale/sequencer-down. Use this where freshness is required.
    function getPrice(address asset) external view returns (MeridianTypes.OracleReading memory);

    /// @notice Last known reading WITHOUT reverting on staleness. For informational NAV only. [R4]
    /// @dev The reading carries its own marketStatus + timestamp so the consumer marks `estimated` itself.
    ///      NEVER a settlement input. Reverts only if no adapter is registered for the asset.
    function lastReading(address asset) external view returns (MeridianTypes.OracleReading memory);

    /// @notice Coarse market status across the basket's anchor feed (drives gating). [R5]
    function marketStatus(address asset) external view returns (MeridianTypes.MarketStatus);

    /// @notice True only when the anchor feed is Regular AND fresh AND sequencer healthy.
    /// @dev v1 rebalance/settlement gate. [R7 Kamino auto-pause pattern]
    function isFreshRegular(address asset) external view returns (bool);

    /// @notice Reverts if the L2 sequencer is down or inside its post-recovery grace window. [R7]
    function checkSequencer() external view;

    function registerAdapter(MeridianTypes.OracleSource source, address adapter) external;
}
