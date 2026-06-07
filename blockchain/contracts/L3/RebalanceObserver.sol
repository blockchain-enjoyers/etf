// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {PriceAggregator} from "../L4/PriceAggregator.sol";

/// @title RebalanceObserver — TWAP accumulator over the ROBUST L4 aggregate price
/// @notice record() samples PriceAggregator.priceOf (depth-weighted median + band + safe), never a raw
///         source — so manipulating an observation first requires defeating L4 (the moat). Cumulative
///         Sigma price*dt; consult() returns the time-weighted average and the observation count over the
///         requested window. Permissionless poke; in production it piggybacks on the L2 keeper ingest
///         (cardinality free).
/// @dev    STORAGE: observations are an UNBOUNDED append-only array per asset, and consult() does a linear
///         scan for the window start. This is the minimal-viable form. A fixed-size ring buffer + binary
///         search (Uniswap-v3 style) to bound storage and make consult O(log n) is a deferred optimization
///         (IMP follow-up); until then, callers should keep `window` modest and prune is not implemented.
contract RebalanceObserver {
    PriceAggregator public immutable aggregator;

    struct Obs { uint64 ts; uint256 cumulative; }
    mapping(address => Obs[]) private _obs;

    error NoObservations();

    constructor(PriceAggregator aggregator_) { aggregator = aggregator_; }

    /// @notice Record one observation of `asset`'s robust L4 price. Permissionless. One obs per block
    ///         (a same-block second call is a no-op). The first observation seeds the accumulator at 0.
    /// @dev    Accumulates the NEWLY-sampled price over the elapsed interval (end-of-interval convention),
    ///         not the Uniswap start-of-interval convention. The bias is bounded by one interval's move and
    ///         only feeds the is-due DECISION, never settlement (iron rule).
    function record(address asset, bytes[] calldata payloads) external {
        uint256 price = aggregator.priceOf(asset, payloads).price;
        Obs[] storage o = _obs[asset];
        if (o.length == 0) {
            o.push(Obs({ts: uint64(block.timestamp), cumulative: 0}));
            return;
        }
        Obs storage last = o[o.length - 1];
        uint256 dt = block.timestamp - last.ts;
        if (dt == 0) return; // one obs per block
        o.push(Obs({ts: uint64(block.timestamp), cumulative: last.cumulative + price * dt}));
    }

    /// @notice TWAP over [now-window, now] using the cumulative accumulator, plus the count of
    ///         observations inside the window (cardinality for the is-due minCardinality check).
    function consult(address asset, uint256 window) external view returns (uint256 twap, uint256 count) {
        Obs[] storage o = _obs[asset];
        uint256 len = o.length;
        if (len < 2) revert NoObservations();
        Obs storage last = o[len - 1];
        uint256 cutoff = block.timestamp > window ? block.timestamp - window : 0;
        // earliest observation at/after cutoff; fall back to the last obs (stale asset -> elapsed==0 -> revert)
        uint256 startIdx = len - 1;
        for (uint256 i = 0; i < len; ++i) {
            if (o[i].ts >= cutoff) { startIdx = i; break; }
        }
        Obs storage start = o[startIdx];
        uint256 elapsed = last.ts - start.ts;
        if (elapsed == 0) revert NoObservations();
        twap = (last.cumulative - start.cumulative) / elapsed;
        count = len - startIdx;
    }
}
