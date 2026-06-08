// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IVerifierProxy} from "./IVerifierProxy.sol";
import {ReportV11} from "./ChainlinkReports.sol";

// Test-only mock reproducing the RWA Data Streams pull/verify interface, so the Streams adapter can be
// exercised in Hardhat WITHOUT a network. Everything is SETTABLE to drive scenarios (market
// open / closed / halt / stale). (The L2 Sequencer Uptime Feed mock was removed with the L2 cache stack.)

/// @title MockVerifierProxy — settable stand-in for Chainlink VerifierProxy (Data Streams pull model)
/// @notice Stores a v11 report per feedId and returns it from verify(). TEST SIMPLIFICATION: the real
///         `payload` is a DON-signed blob whose signature is checked on-chain; here we skip signatures
///         and treat `payload` as abi.encode(bytes32 feedId) — a report selector. The ADAPTER under
///         test is real (it forwards the payload and decodes/validates the returned report), so only
///         the signing/billing is faked. verify is intentionally free (no FeeManager), matching the
///         RHC testnet where s_feeManager() == address(0).
contract MockVerifierProxy is IVerifierProxy {
    mapping(bytes32 => ReportV11) private _reports;
    mapping(bytes32 => bool) private _exists;

    error NoReport(bytes32 feedId);

    /// @notice Store/replace the full report for its feedId.
    function setReport(ReportV11 calldata report) external {
        _reports[report.feedId] = report;
        _exists[report.feedId] = true;
    }

    /// @notice Convenience setter for the common equity case (fills fee/expiry fields with sane stubs).
    /// @param lastSeenTimestampNs mid-price timestamp in NANOSECONDS (staleness source).
    /// @param marketStatus        v11 status: 0 Unknown,1 Pre,2 Regular,3 Post,4 Overnight,5 Closed.
    function setEquityReport(
        bytes32 feedId,
        int192 mid,
        int192 bid,
        int192 ask,
        uint64 lastSeenTimestampNs,
        uint32 marketStatus
    ) external {
        ReportV11 memory r;
        r.feedId = feedId;
        r.validFromTimestamp = uint32(block.timestamp);
        r.observationsTimestamp = uint32(block.timestamp);
        r.expiresAt = uint32(block.timestamp + 1 days);
        r.mid = mid;
        r.bid = bid;
        r.ask = ask;
        r.lastTradedPrice = mid;
        r.lastSeenTimestampNs = lastSeenTimestampNs;
        r.marketStatus = marketStatus;
        _reports[feedId] = r;
        _exists[feedId] = true;
    }

    /// @inheritdoc IVerifierProxy
    function verify(bytes calldata payload, bytes calldata /*parameterPayload*/)
        external
        payable
        returns (bytes memory)
    {
        bytes32 feedId = abi.decode(payload, (bytes32));
        if (!_exists[feedId]) revert NoReport(feedId);
        return abi.encode(_reports[feedId]);
    }
}
