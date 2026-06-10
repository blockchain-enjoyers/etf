// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IHoldingsNav {
    struct NavResult { uint256 nav; uint256 confLower; uint256 confUpper; uint8 marketStatus; bool safe; uint256 timestamp; }
    function navOfHoldings(address vault, address[] calldata tokens, bytes[][] calldata payloads)
        external returns (NavResult memory);
}

interface ISupplyVault {
    function totalSupply() external view returns (uint256);
    function heldTokens() external view returns (address[] memory);
}

/// @title BasketNavObserver — TWAP of basket navPerShare over the robust L4 holdings-NAV (L5 g7)
/// @notice record() samples navPerShare = navOfHoldings(vault).nav * 1e18 / totalSupply into a
///         cumulative accumulator; consult() returns the time-weighted average + the observation count
///         over a window. Sampling the ROBUST L4 aggregate (not a raw source) means an observation can
///         only be moved by first moving L4 (the moat). Permissionless poke.
/// @dev    END-OF-INTERVAL TWAP CONVENTION (mirrors contracts/L3/RebalanceObserver.sol): the seed
///         observation DISCARDS its sampled navPerShare — cumulative starts at 0 — and every later
///         interval [prev, this] is weighted by the navPerShare sampled at its END, not its start
///         (the Uniswap convention). So a 100 -> 110 move over a single interval yields TWAP = 110,
///         NOT a 105 path-average. The resulting bias is bounded by one interval's move. This is
///         acceptable because this observer only feeds a DECISION — the L5 g7 settle sanity band —
///         and NEVER a settlement price (iron rule: an estimated/averaged price is never a settle price).
contract BasketNavObserver {
    uint256 private constant SCALE = 1e18;
    IHoldingsNav public immutable nav;

    struct Obs { uint64 ts; uint256 cumulative; }
    mapping(address => Obs[]) private _obs;

    error NoObservations();
    error NoSupply();

    constructor(IHoldingsNav nav_) { nav = nav_; }

    /// @notice Record one observation of `vault`'s basket navPerShare. Permissionless.
    /// @dev Records ONLY when the L4 reading is Open && safe — so the TWAP the L5 g7 band uses never
    ///      includes Closed/weekend ESTIMATES (iron-rule separation). A non-Open/unsafe poke is a no-op.
    function record(address vault, address[] calldata heldTokens, bytes[][] calldata payloads) external {
        uint256 supply = ISupplyVault(vault).totalSupply();
        if (supply == 0) revert NoSupply();
        IHoldingsNav.NavResult memory r = nav.navOfHoldings(vault, heldTokens, payloads);
        if (r.marketStatus != 0 || !r.safe) return; // 0 == MarketStatus.Open; no-op when not open/safe
        uint256 navPerShare = (r.nav * SCALE) / supply;
        Obs[] storage o = _obs[vault];
        if (o.length == 0) {
            o.push(Obs({ts: uint64(block.timestamp), cumulative: 0}));
            return;
        }
        Obs storage last = o[o.length - 1];
        uint256 dt = block.timestamp - last.ts;
        if (dt == 0) return;
        o.push(Obs({ts: uint64(block.timestamp), cumulative: last.cumulative + navPerShare * dt}));
    }

    /// @notice TWAP of navPerShare over [now-window, now] + the observation count in the window.
    /// @dev SPARSE-WINDOW / FAIL-CLOSED: with fewer than 2 in-window observations, or zero elapsed time
    ///      spanned across the window, consult() REVERTS NoObservations. In the L5 settle gate this revert
    ///      IS the g6 ("min-N-prints") failure mode: it reverts the WHOLE settle so the ticket waits — the
    ///      gate MUST NOT catch-and-proceed on it. The caller should pass a `window` sized to the post-open
    ///      span (now - last_open) so a weekend/closed interval (during which no observations were recorded,
    ///      since record() no-ops when not Open/safe) does not dominate the band. Returns:
    ///      `twap` = end-of-interval time-weighted average of navPerShare over [startIdx, last]; and
    ///      `count = len - startIdx` = the number of in-window observations. Timestamps are strictly
    ///      ascending (one obs per block, dt>0 to append), so every index >= startIdx is >= cutoff.
    function consult(address vault, uint256 window) external view returns (uint256 twap, uint256 count) {
        Obs[] storage o = _obs[vault];
        uint256 len = o.length;
        if (len < 2) revert NoObservations();
        Obs storage last = o[len - 1];
        uint256 cutoff = block.timestamp > window ? block.timestamp - window : 0;
        uint256 startIdx = len - 1; // default to last, break at first in-window (matches RebalanceObserver fixed form)
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
