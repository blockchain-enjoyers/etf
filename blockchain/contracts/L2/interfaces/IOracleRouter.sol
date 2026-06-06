// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {OracleReading} from "../OracleTypes.sol";

/// @title IOracleRouter — the read seam NAVEngine depends on
/// @notice NAVEngine sums prices through this interface only, so the router implementation (cache +
///         staleness + sequencer gate) can evolve without touching the NAV math.
interface IOracleRouter {
    /// @notice Gated, view read of the cached price: applies sequencer-uptime + staleness checks and
    ///         downgrades marketStatus accordingly (Open -> Halted if stale; -> Degraded if the
    ///         sequencer is down or within its restart grace). Pure read; verifies nothing on-chain.
    function getPrice(address asset) external view returns (OracleReading memory reading);

    /// @notice The raw cached reading as last ingested, WITHOUT the live gate applied.
    function lastReading(address asset) external view returns (OracleReading memory reading);
}
