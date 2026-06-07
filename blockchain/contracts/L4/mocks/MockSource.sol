// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

/// @notice A fully settable IPriceSource for building + testing the engine before live adapters exist.
///         Each field has a setter so a test can drive every penalty/gate path (thin = setDepth(low);
///         stale = setLastUpdate(old); manipulated = setPrice(offset); unhealthy = setHealthy(false)).
contract MockSource is IPriceSource {
    SourceReading private _r;

    constructor() {
        _r.healthy = true;
        _r.kind = SourceKind.AMM_TWAP;
    }

    function set(
        uint256 price,
        uint256 depth,
        uint64 lastUpdate,
        SourceKind kind,
        uint256 confidence,
        bool weekendAware,
        bool healthy
    ) external {
        _r = SourceReading(price, depth, lastUpdate, kind, confidence, weekendAware, healthy);
    }

    function setPrice(uint256 v) external { _r.price = v; }
    function setDepth(uint256 v) external { _r.depth = v; }
    function setLastUpdate(uint64 v) external { _r.lastUpdate = v; }
    function setKind(SourceKind v) external { _r.kind = v; }
    function setConfidence(uint256 v) external { _r.confidence = v; }
    function setWeekendAware(bool v) external { _r.weekendAware = v; }
    function setHealthy(bool v) external { _r.healthy = v; }

    function readSource(bytes calldata) external view returns (SourceReading memory) { return _r; }
    function describe() external view returns (string memory, address) { return ("mock", address(this)); }
}
