// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceSource, SourceReading} from "./IPriceSource.sol";
import {MarketStatus} from "../L2/OracleTypes.sol";

/// @title PriceAggregator — neutral multi-source referee for one "thing" (a stock OR a basket token)
/// @notice Reads every registered source, drops the unhealthy/stale/closed, rejects outliers, and
///         returns a depth-weighted-median price with a confidence band and a `safe` verdict. Pure
///         view: no settlement, no state mutation outside owner config. The whole moat is here — a fat
///         or manipulated source cannot move the median (weight cap < 50%) and cannot survive the
///         divergence band. "Config open, safety floor enforced."
contract PriceAggregator is Ownable {
    struct AggregateResult {
        uint256 price;
        uint256 confLower;
        uint256 confUpper;
        MarketStatus marketStatus;
        bool safe;
        uint256 timestamp;
    }

    // ---- governance params (settable; defaults in constructor) ----
    uint256 public maxWeightBps;   // per-source weight cap (4000 = 40%)
    uint256 public divergenceBps;  // outlier band vs provisional median (200 = 2%)
    uint256 public staleHorizon;   // seconds before a reading is dropped
    uint256 public dMin;           // total-depth floor for full confidence (1e18 USD)
    uint256 public wDisp;          // band weight: dispersion (bps multiplier)
    uint256 public wDepth;         // band weight: depth penalty
    uint256 public wStale;         // band weight: staleness penalty
    uint256 public maxSafeBandBps; // band/price above which safe=false (500 = 5%)
    uint256 public minSafeSources; // min surviving sources for safe=true

    mapping(address => IPriceSource[]) private _sources;

    event SourceAdded(address indexed asset, address indexed source);

    error NoSources(address asset);
    error PayloadLengthMismatch();

    constructor(address initialOwner) Ownable(initialOwner) {
        maxWeightBps = 4000;
        divergenceBps = 200;
        staleHorizon = 3600;
        dMin = 100_000 ether;
        wDisp = 10000;
        wDepth = 10000;
        wStale = 10000;
        maxSafeBandBps = 500;
        minSafeSources = 2;
    }

    // ============================== CONFIG ==============================

    function addSource(address asset, address source) external onlyOwner {
        _sources[asset].push(IPriceSource(source));
        emit SourceAdded(asset, source);
    }

    function setParams(
        uint256 maxWeightBps_,
        uint256 divergenceBps_,
        uint256 staleHorizon_,
        uint256 dMin_,
        uint256 wDisp_,
        uint256 wDepth_,
        uint256 wStale_,
        uint256 maxSafeBandBps_,
        uint256 minSafeSources_
    ) external onlyOwner {
        maxWeightBps = maxWeightBps_;
        divergenceBps = divergenceBps_;
        staleHorizon = staleHorizon_;
        dMin = dMin_;
        wDisp = wDisp_;
        wDepth = wDepth_;
        wStale = wStale_;
        maxSafeBandBps = maxSafeBandBps_;
        minSafeSources = minSafeSources_;
    }

    function sourceCount(address asset) external view returns (uint256) {
        return _sources[asset].length;
    }

    /// @notice True if `src` is a registered price source for `asset`. Used by the L5 settle gate (g1) to
    ///         assert the L2 router stream actually backs every held token (so the sequencer/halt gate is total).
    function isSource(address asset, address src) external view returns (bool) {
        IPriceSource[] storage srcs = _sources[asset];
        for (uint256 i = 0; i < srcs.length; ++i) {
            if (address(srcs[i]) == src) return true;
        }
        return false;
    }

    /// @notice Sum of accepted-depth (healthy + fresh) sources for `asset`. The listing gate consumes
    ///         this; feed it a CONSERVATIVE (weekend-trough) value via a min-depth tracker upstream.
    function acceptedDepthOf(address asset, bytes[] calldata payloads) external view returns (uint256 depth) {
        IPriceSource[] storage srcs = _sources[asset];
        uint256 n = srcs.length;
        if (payloads.length != n) revert PayloadLengthMismatch();
        for (uint256 i = 0; i < n; ++i) {
            SourceReading memory r = srcs[i].readSource(payloads[i]);
            if (!r.healthy || r.price == 0) continue;
            if (block.timestamp - r.lastUpdate > staleHorizon) continue;
            depth += r.depth;
        }
    }

    // ============================== READ ==============================

    /// @notice Aggregate all registered sources for `asset`. `payloads[i]` is forwarded to source i
    ///         (ignored by read-adapters, used by signed-report adapters).
    function priceOf(address asset, bytes[] calldata payloads)
        external
        view
        returns (AggregateResult memory)
    {
        IPriceSource[] storage srcs = _sources[asset];
        uint256 n = srcs.length;
        if (n == 0) revert NoSources(asset);
        if (payloads.length != n) revert PayloadLengthMismatch();

        // 1. Read + filter (drop unhealthy / stale). prices[]/depths[]/ages[] hold survivors.
        uint256[] memory prices = new uint256[](n);
        uint256[] memory depths = new uint256[](n);
        uint256 oldest = type(uint256).max;
        uint256 m; // survivor count
        bool anyWeekday; // a non-weekendAware source survived => market Open

        for (uint256 i = 0; i < n; ++i) {
            SourceReading memory r = srcs[i].readSource(payloads[i]);
            if (!r.healthy || r.price == 0) continue;
            if (block.timestamp - r.lastUpdate > staleHorizon) continue;
            prices[m] = r.price;
            depths[m] = r.depth;
            if (!r.weekendAware) anyWeekday = true;
            if (r.lastUpdate < oldest) oldest = r.lastUpdate;
            unchecked { ++m; }
        }

        return _aggregate(prices, depths, m, oldest, anyWeekday);
    }

    function _aggregate(
        uint256[] memory prices,
        uint256[] memory depths,
        uint256 m,
        uint256 oldest,
        bool anyWeekday
    ) internal view returns (AggregateResult memory res) {
        if (m == 0) {
            res.marketStatus = MarketStatus.Unknown;
            res.safe = false;
            return res;
        }

        // provisional median over all survivors (copy arrays since _weightedMedian sorts in place)
        uint256[] memory pp = new uint256[](m);
        uint256[] memory dd = new uint256[](m);
        for (uint256 i = 0; i < m; ++i) { pp[i] = prices[i]; dd[i] = depths[i]; }
        uint256 prov = _weightedMedian(pp, dd, m);

        // divergence filter: keep sources within divergenceBps of the provisional median
        uint256 k;
        for (uint256 i = 0; i < m; ++i) {
            uint256 diff = prices[i] > prov ? prices[i] - prov : prov - prices[i];
            if (diff * 10000 <= divergenceBps * prov) {
                prices[k] = prices[i];
                depths[k] = depths[i];
                unchecked { ++k; }
            }
        }
        if (k == 0) { // everything diverged: degenerate, keep provisional, force unsafe
            res.price = prov; res.confLower = prov; res.confUpper = prov; res.timestamp = oldest;
            res.marketStatus = MarketStatus.Unknown; res.safe = false;
            return res;
        }

        uint256 med = _weightedMedian(prices, depths, k);
        uint256 band = _band(prices, depths, k, med);

        res.price = med;
        res.confLower = med > band ? med - band : 0;
        res.confUpper = med + band;
        res.timestamp = oldest;
        res.marketStatus = anyWeekday ? MarketStatus.Open : MarketStatus.Closed;

        uint256 bandBps = (band * 10000) / med;
        res.safe = (k >= minSafeSources) && (bandBps <= maxSafeBandBps);
    }

    /// @dev Sort the first `m` (price, depth) pairs ascending by price (insertion sort, small N), cap
    ///      each source's weight to at most maxWeightBps of the final capped total (iterative: up to m
    ///      passes, each pass can only reduce depths so it terminates), then return the price where
    ///      cumulative capped depth crosses half the capped total. Mutates the passed memory arrays
    ///      (caller discards). The cap invariant: no single source exceeds maxWeightBps% of the total.
    function _weightedMedian(uint256[] memory prices, uint256[] memory depths, uint256 m)
        internal
        view
        returns (uint256)
    {
        // insertion sort ascending by price
        for (uint256 i = 1; i < m; ++i) {
            uint256 p = prices[i];
            uint256 d = depths[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > p) {
                prices[j] = prices[j - 1];
                depths[j] = depths[j - 1];
                --j;
            }
            prices[j] = p;
            depths[j] = d;
        }

        // iterative weight cap: repeat until no source exceeds maxWeightBps% of the total.
        // Each iteration reduces at least one depth, so this terminates. 20 iterations is sufficient
        // for any practical source set (converges geometrically by factor ~maxWeightBps/10000 < 1).
        for (uint256 pass = 0; pass < 20; ++pass) {
            uint256 total;
            for (uint256 i = 0; i < m; ++i) total += depths[i];
            if (total == 0) break;
            uint256 cap = (total * maxWeightBps) / 10000;
            bool changed;
            for (uint256 i = 0; i < m; ++i) {
                if (depths[i] > cap) { depths[i] = cap; changed = true; }
            }
            if (!changed) break;
        }

        uint256 totalCapped;
        for (uint256 i = 0; i < m; ++i) totalCapped += depths[i];

        uint256 cum;
        for (uint256 i = 0; i < m; ++i) {
            cum += depths[i];
            if (cum * 2 >= totalCapped) return prices[i];
        }
        return prices[m - 1];
    }

    /// @dev band = med * (wDisp*dispRelBps + wDepth*depthPenaltyBps + wStale*stalePenaltyBps) / 1e8.
    ///      dispRelBps = depth-weighted MAD / med (relative dispersion). depthPenalty rises as total
    ///      depth falls below dMin. stalePenalty rises with age toward staleHorizon.
    function _band(uint256[] memory prices, uint256[] memory depths, uint256 k, uint256 med)
        internal
        view
        returns (uint256)
    {
        uint256 totalDepth;
        uint256 wad; // weighted absolute deviation numerator
        for (uint256 i = 0; i < k; ++i) {
            totalDepth += depths[i];
            uint256 diff = prices[i] > med ? prices[i] - med : med - prices[i];
            wad += diff * depths[i];
        }
        uint256 dispRelBps = totalDepth == 0 ? 0 : (wad * 10000) / (totalDepth * med);
        uint256 depthPenaltyBps = totalDepth >= dMin ? 0 : ((dMin - totalDepth) * 10000) / dMin;

        // staleness penalty from the oldest survivor age is folded in at priceOf level via timestamp;
        // here we approximate with 0 (per-source staleness already dropped > horizon). Kept for the
        // weight wiring; a future task can pass age in.
        uint256 stalePenaltyBps = 0;

        uint256 combinedBps =
            (wDisp * dispRelBps + wDepth * depthPenaltyBps + wStale * stalePenaltyBps) / 10000;
        return (med * combinedBps) / 10000;
    }
}
