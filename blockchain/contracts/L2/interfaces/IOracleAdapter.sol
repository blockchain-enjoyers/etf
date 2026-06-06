// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {OracleReading} from "../OracleTypes.sol";

/// @title IOracleAdapter — source-agnostic price adapter seam
/// @notice One adapter per price source. It verifies/reads a source-specific report and normalizes it
///         into an OracleReading. The L2 stack depends only on this interface, never on a vendor type,
///         so the closed-market fair-value branch (L4) plugs in as a second adapter behind the SAME
///         interface and NAVEngine/OracleRouter do not change.
interface IOracleAdapter {
    /// @notice Verify a signed report and return the normalized reading.
    /// @dev NON-view: for Data Streams this calls VerifierProxy.verify (a state-changing, payable
    ///      call), so it cannot be used inside a `view`. Two consumption patterns follow from this:
    ///      (a) a keeper calls this via OracleRouter.ingest to cache the reading for view-NAV reads;
    ///      (b) a dangerous action (credit/liquidation/cash-settle) calls it inline in the same tx for
    ///      settlement-grade freshness. L2 is read-only and uses (a).
    /// @param signedReport    the source-specific signed report payload.
    /// @param expectedFeedId  the feed/stream id this asset must resolve to; mismatch MUST revert.
    function verifyAndNormalize(bytes calldata signedReport, bytes32 expectedFeedId)
        external
        returns (OracleReading memory reading);

    /// @notice Provenance tag this adapter stamps onto readings (see OracleTypes.Source).
    function source() external view returns (uint8);
}
