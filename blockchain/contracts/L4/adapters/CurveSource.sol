// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

interface ICurvePoolLike {
    function price_oracle() external view returns (uint256);
    function balances(uint256 i) external view returns (uint256);
}

/// @title CurveSource — Curve EMA oracle (`price_oracle`, never `last_price`) + balance-based depth (R13 §1/§2)
/// @notice read(): EMA price (1e18) from `price_oracle()`; depth approximated as the smaller leg's balance
///         scaled by δ (a conservative cost-to-move proxy; a per-pool invariant refinement is future work).
contract CurveSource is IPriceSource {
    ICurvePoolLike public immutable pool;
    uint256 public immutable deltaBps;

    constructor(address pool_, uint256 deltaBps_) {
        pool = ICurvePoolLike(pool_);
        deltaBps = deltaBps_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        uint256 p = pool.price_oracle();
        uint256 b0 = pool.balances(0);
        uint256 b1 = pool.balances(1);
        uint256 minBal = b0 < b1 ? b0 : b1;
        r.price = p;
        r.depth = (minBal * deltaBps) / 10000;
        r.confidence = 0;
        r.lastUpdate = uint64(block.timestamp);
        r.kind = SourceKind.AMM_TWAP;
        r.weekendAware = false;
        r.healthy = p > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("curve", address(pool));
    }
}
