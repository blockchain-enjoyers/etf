// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {TickMath} from "./lib/TickMath.sol";
import {FullMath} from "./lib/FullMath.sol";

interface IUniV3PoolLike {
    function observe(uint32[] calldata) external view returns (int56[] memory, uint160[] memory);
    function liquidity() external view returns (uint128);
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

/// @title UniswapV3Source — TWAP price + in-range cost-to-move depth (R13 §1/§2)
/// @notice read(): arithmetic-mean tick over `window` -> √P -> price (1e18, decimals-adjusted); depth is
///         the base-token amount to move √P by δ (`deltaBps`), valued in USD. `healthy=false` if the pool's
///         observation cardinality is below the window/blocktime floor (TWAP not reliably available).
contract UniswapV3Source is IPriceSource {
    IUniV3PoolLike public immutable pool;
    uint32 public immutable window; // TWAP seconds
    uint8 public immutable baseDecimals; // token0 (base)
    uint8 public immutable quoteDecimals; // token1 (quote = USD)
    uint256 public immutable deltaBps; // depth reference move (e.g. 100 = 1%)
    uint256 private constant Q96 = 2 ** 96;

    constructor(address pool_, uint32 window_, uint8 baseDec_, uint8 quoteDec_, uint256 deltaBps_) {
        pool = IUniV3PoolLike(pool_);
        window = window_;
        baseDecimals = baseDec_;
        quoteDecimals = quoteDec_;
        deltaBps = deltaBps_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;
        (int56[] memory tc,) = pool.observe(ago);
        int24 tick = int24((tc[1] - tc[0]) / int56(int256(uint256(window))));
        uint160 sqrtP = TickMath.getSqrtRatioAtTick(tick); // √P · 2^96

        // price (quote per 1 base), 1e18-scaled, decimals-adjusted. Two-step mulDiv avoids sqrtP² overflow
        // (sqrtP can be up to ~2^160, so sqrtP*sqrtP would exceed uint256 for large ticks).
        uint256 priceX96 = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96); // P · 2^96
        uint256 priceRaw = FullMath.mulDiv(priceX96, 1e18, Q96); // P · 1e18
        r.price = _adjustDecimals(priceRaw);

        // depth = cost-to-move: Δx0 = L·(2^96/√Pa − 2^96/√Pb) at √Pb = √Pa·√(1+δ), valued in USD.
        uint160 sqrtPb = uint160(FullMath.mulDiv(uint256(sqrtP), _sqrt1e18(1e18 + (1e18 * deltaBps) / 10000), 1e9));
        uint128 L = pool.liquidity();
        uint256 invA = FullMath.mulDiv(Q96, 1e18, uint256(sqrtP));
        uint256 invB = sqrtPb == 0 ? 0 : FullMath.mulDiv(Q96, 1e18, uint256(sqrtPb));
        uint256 dx0 = invA > invB ? (uint256(L) * (invA - invB)) / 1e18 : 0;
        r.depth = (dx0 * r.price) / 1e18; // base amount * USD price

        (,,, uint16 cardinality,,,) = pool.slot0();
        r.kind = SourceKind.AMM_TWAP;
        r.confidence = 0;
        r.weekendAware = false;
        r.lastUpdate = uint64(block.timestamp);
        // cardinality floor: need >= window/blocktime observations (assume ~2s blocks on Orbit).
        r.healthy = r.price > 0 && uint256(cardinality) >= uint256(window) / 2;
    }

    function describe() external view returns (string memory, address) {
        return ("uniswap-v3", address(pool));
    }

    function _adjustDecimals(uint256 priceX) private view returns (uint256) {
        if (baseDecimals == quoteDecimals) return priceX;
        if (baseDecimals > quoteDecimals) return priceX * (10 ** (baseDecimals - quoteDecimals));
        return priceX / (10 ** (quoteDecimals - baseDecimals));
    }

    /// @dev Integer sqrt of a 1e18-scaled number, result ~1e9-scaled (Babylonian).
    function _sqrt1e18(uint256 x) private pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
