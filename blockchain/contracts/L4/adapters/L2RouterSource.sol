// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {IOracleRouter} from "../../L2/interfaces/IOracleRouter.sol";
import {OracleReading, MarketStatus} from "../../L2/OracleTypes.sol";

/// @title L2RouterSource — wraps the L2 Chainlink-stream router as one L4 source
/// @notice payload = abi.encode(address asset). Reads L2 OracleRouter.getPrice(asset) (already gated +
///         view), and normalizes it into a SourceReading: a governance synthetic depth tier (oracles
///         have no pool), weekendAware = false (the stream goes Closed on weekends), and healthy = true
///         only when L2 status is Open. Anything worse (Degraded/Halted/Closed/Unknown) -> unhealthy,
///         so the aggregator drops it rather than letting a stale weekday feed gate the weekend price.
contract L2RouterSource is IPriceSource {
    IOracleRouter public immutable router;
    uint256 public immutable depthTier;

    constructor(IOracleRouter router_, uint256 depthTier_) {
        router = router_;
        depthTier = depthTier_;
    }

    function readSource(bytes calldata payload) external view returns (SourceReading memory r) {
        address asset = abi.decode(payload, (address));
        OracleReading memory o = router.getPrice(asset);
        r.price = o.price > 0 ? uint256(o.price) : 0;
        r.depth = depthTier;
        r.lastUpdate = uint64(o.timestamp);
        r.kind = SourceKind.RWA_STREAM;
        r.confidence = o.confidence;
        r.weekendAware = false;
        r.healthy = (o.marketStatus == MarketStatus.Open) && r.price > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("L2 Chainlink stream", address(router));
    }
}
