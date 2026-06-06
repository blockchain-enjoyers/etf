// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {IBasketVault} from "./interfaces/IBasketVault.sol";
import {OracleReading, MarketStatus, MarketStatusLib, PriceScale} from "./OracleTypes.sol";

/// @title NAVEngine — read-only basket NAV with a confidence band and market status
/// @notice Step 3 of the L2 read-price chain. A pure VIEW engine: it values the vault's actual
///         on-chain holdings as Sigma(balance_i * price_i), decimals-normalized to a 1e18-USD figure,
///         and surfaces a confidence band + an aggregate (worst-of) market status. It NEVER touches the
///         vault, never settles, never mutates state. In v1 the NAV is informational: it feeds risk /
///         secondary pricing / dashboards, not mint/redeem (those stay in-kind and oracle-free at L1).
/// @dev Iron rule: an estimated price is NEVER a settlement price. `estimated` is true whenever the
///      basket is not fully Open (any leg Closed/Halted/Degraded/Unknown), which is exactly the
///      condition under which a consumer must refuse price-based settlement and fall back to in-kind /
///      a forward queue.
///
///      L4 SEAM: the closed-market fair-value branch does NOT live here. It plugs in BELOW, as a second
///      adapter behind IOracleRouter/IOracleAdapter that returns a fair-value OracleReading (a wider
///      confidence band, source = FAIR_VALUE_L4, marketStatus still Closed) when the venue is closed.
///      NAVEngine is unchanged: it keeps summing whatever readings the router hands it. One engine,
///      two branches.
contract NAVEngine {
    using MarketStatusLib for MarketStatus;

    /// @notice The gated read seam (cache + staleness + sequencer).
    IOracleRouter public immutable router;

    error NonPositivePrice(address asset, int256 price);

    /// @dev Running NAV accumulator, passed by memory reference to the per-leg helper. Keeping the
    ///      leg math in `_accumulate` (its own stack frame) is what keeps navOf under the stack limit.
    struct NavAcc {
        uint256 nav;
        uint256 lower;
        uint256 upper;
        MarketStatus status;
        uint256 timestamp;
    }

    constructor(IOracleRouter router_) {
        router = router_;
    }

    /// @notice Value a basket vault's live holdings.
    /// @param vault an L1 BasketVault (anything exposing getConstituents()).
    /// @return nav             Sigma(balance_i * price_i), normalized to 1e18 USD.
    /// @return confidenceLower nav using (price_i - confidence_i) per leg (band floor).
    /// @return confidenceUpper nav using (price_i + confidence_i) per leg (band ceiling).
    /// @return marketStatus    aggregate worst-of status across legs (one closed leg => basket Closed).
    /// @return estimated       true iff the basket is not fully Open (do not settle on this NAV).
    /// @return timestamp       the OLDEST leg timestamp (the freshness floor of the whole basket).
    function navOf(address vault)
        external
        view
        returns (
            uint256 nav,
            uint256 confidenceLower,
            uint256 confidenceUpper,
            MarketStatus marketStatus,
            bool estimated,
            uint256 timestamp
        )
    {
        (address[] memory tokens, ) = IBasketVault(vault).getConstituents();

        NavAcc memory acc;
        acc.status = MarketStatus.Open; // worst-of starts at best; any leg can only worsen it
        acc.timestamp = type(uint256).max;

        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; ++i) {
            _accumulate(acc, tokens[i], vault);
        }

        nav = acc.nav;
        confidenceLower = acc.lower;
        confidenceUpper = acc.upper;
        marketStatus = acc.status;
        estimated = acc.status != MarketStatus.Open;
        timestamp = len == 0 ? 0 : acc.timestamp;
    }

    /// @dev Value one leg and fold it into the accumulator. `acc` is a memory pointer, so the writes
    ///      persist back to the caller; the leg's own locals stay in this frame (stack-depth control).
    function _accumulate(NavAcc memory acc, address asset, address vault) internal view {
        OracleReading memory r = router.getPrice(asset);
        if (r.price <= 0) revert NonPositivePrice(asset, r.price);

        uint256 price = uint256(r.price);
        uint256 unit = 10 ** IERC20Metadata(asset).decimals(); // normalize holdings to whole units
        uint256 bal = IERC20(asset).balanceOf(vault);

        // value_i = balance_i (raw) * price_i (1e18) / 10^decimals_i  => 1e18-USD
        acc.nav += (bal * price) / unit;
        uint256 lowerPrice = price > r.confidence ? price - r.confidence : 0;
        acc.lower += (bal * lowerPrice) / unit;
        acc.upper += (bal * (price + r.confidence)) / unit;

        acc.status = acc.status.worse(r.marketStatus);
        if (r.timestamp < acc.timestamp) acc.timestamp = r.timestamp;
    }

    /// @notice NAV per 1e18 basket tokens (convenience for secondary pricing / dashboards).
    /// @dev Reverts via the vault if supply is 0. Returns only the central NAV-per-share; callers
    ///      needing the band/status should use navOf and divide by totalSupply themselves.
    function navPerShare(address vault, uint256 totalSupply) external view returns (uint256) {
        (uint256 nav,,,,, ) = this.navOf(vault);
        if (totalSupply == 0) return 0;
        return (nav * PriceScale.ONE) / totalSupply;
    }
}
