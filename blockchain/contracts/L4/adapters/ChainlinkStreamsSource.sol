// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {IVerifierProxy} from "../../mock/ChainLink/IVerifierProxy.sol";
import {ReportV8, ReportV11} from "../../mock/ChainLink/ChainlinkReports.sol";

/// @title ChainlinkStreamsSource — Data Streams verify-in-tx price source (v8 + v11)
/// @notice read(payload): VerifierProxy.verify(payload, "") -> decode per schemaVersion -> SourceReading.
///         Non-view (verify is state-changing). RHC testnet verify is free (s_feeManager()==0), so
///         parameterPayload is "". Reuses the repurposed ChainlinkAdapter verify+decode + map logic.
contract ChainlinkStreamsSource is IPriceSource {
    IVerifierProxy public immutable verifierProxy;
    uint8 public immutable schemaVersion; // 8 or 11
    uint256 public immutable depthTier;   // governance synthetic depth (oracles have no pool)

    error UnsupportedSchema(uint8 v);

    constructor(IVerifierProxy verifierProxy_, uint8 schemaVersion_, uint256 depthTier_) {
        if (schemaVersion_ != 8 && schemaVersion_ != 11) revert UnsupportedSchema(schemaVersion_);
        verifierProxy = verifierProxy_;
        schemaVersion = schemaVersion_;
        depthTier = depthTier_;
    }

    function read(bytes calldata payload) external returns (SourceReading memory r) {
        bytes memory verified = verifierProxy.verify(payload, bytes(""));
        r.kind = SourceKind.RWA_STREAM;
        r.depth = depthTier;
        r.weekendAware = false;
        if (schemaVersion == 11) {
            ReportV11 memory v = abi.decode(verified, (ReportV11));
            r.price = v.mid > 0 ? uint256(int256(v.mid)) : 0;
            r.confidence = (v.ask > v.bid && v.bid > 0) ? uint256(int256(v.ask) - int256(v.bid)) / 2 : 0;
            r.lastUpdate = uint64(uint256(v.lastSeenTimestampNs) / 1e9);
            r.healthy = r.price > 0 && _open11(v.marketStatus);
        } else {
            ReportV8 memory v = abi.decode(verified, (ReportV8));
            r.price = v.midPrice > 0 ? uint256(int256(v.midPrice)) : 0;
            r.confidence = 0;
            r.lastUpdate = uint64(uint256(v.lastUpdateTimestamp) / 1e9);
            r.healthy = r.price > 0 && v.marketStatus == 2; // v8: 2 == Open
        }
    }

    function describe() external view returns (string memory, address) {
        return ("chainlink-data-streams", address(verifierProxy));
    }

    function _open11(uint32 s) private pure returns (bool) { return s >= 1 && s <= 4; } // Pre/Regular/Post/Overnight
}
