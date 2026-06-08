// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

interface IGmxReaderLike {
    function markPrice() external view returns (uint256);
    function longOI() external view returns (uint256);
    function shortOI() external view returns (uint256);
}

/// @title GmxV2Source — GMX v2 perp mark + OI-based cost-to-move depth (R13 §1/§2)
/// @notice read(): price = mark (1e18); depth approximated as the smaller OI side scaled by δ (the notional
///         that shifts the OI imbalance enough for a δ price impact; a full factor/exponent impact model is
///         future work). kind=PERP, weekendAware=false (GMX markets are crypto-collateralized).
contract GmxV2Source is IPriceSource {
    IGmxReaderLike public immutable reader;
    uint256 public immutable deltaBps;

    constructor(address reader_, uint256 deltaBps_) {
        reader = IGmxReaderLike(reader_);
        deltaBps = deltaBps_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        uint256 mark = reader.markPrice();
        uint256 lOI = reader.longOI();
        uint256 sOI = reader.shortOI();
        uint256 minOI = lOI < sOI ? lOI : sOI;
        r.price = mark;
        r.depth = (minOI * deltaBps) / 10000;
        r.confidence = 0;
        r.lastUpdate = uint64(block.timestamp);
        r.kind = SourceKind.PERP;
        r.weekendAware = false;
        r.healthy = mark > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("gmx-v2", address(reader));
    }
}
