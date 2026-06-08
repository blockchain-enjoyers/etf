// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {TickMath} from "./lib/TickMath.sol";
import {FullMath} from "./lib/FullMath.sol";

interface IV4HookLike {
    function observe(uint32[] calldata) external view returns (int56[] memory);
    function liquidity() external view returns (uint128);
}

/// @title UniswapV4Source — truncated-oracle hook TWAP price + liquidity-based depth (R13 §1)
/// @notice read(): same arithmetic-mean-tick → √P → price math as v3, reading the v4 truncated-oracle hook
///         accumulator (per-block tick move already capped by the hook). depth is a liquidity-scaled
///         synthetic proxy (a full √P cost-to-move refinement mirrors UniswapV3Source; future work).
contract UniswapV4Source is IPriceSource {
    IV4HookLike public immutable hook;
    uint32 public immutable window;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;
    uint256 public immutable deltaBps;
    uint256 private constant Q96 = 2 ** 96;

    constructor(address hook_, uint32 window_, uint8 baseDec_, uint8 quoteDec_, uint256 deltaBps_) {
        hook = IV4HookLike(hook_);
        window = window_;
        baseDecimals = baseDec_;
        quoteDecimals = quoteDec_;
        deltaBps = deltaBps_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;
        int56[] memory tc = hook.observe(ago);
        int24 tick = int24((tc[1] - tc[0]) / int56(int256(uint256(window))));
        uint160 sqrtP = TickMath.getSqrtRatioAtTick(tick);
        uint256 priceX96 = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        r.price = _adjustDecimals(FullMath.mulDiv(priceX96, 1e18, Q96));
        r.depth = (uint256(hook.liquidity()) * deltaBps) / 10000;
        r.confidence = 0;
        r.lastUpdate = uint64(block.timestamp);
        r.kind = SourceKind.AMM_TWAP;
        r.weekendAware = false;
        r.healthy = r.price > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("uniswap-v4", address(hook));
    }

    function _adjustDecimals(uint256 priceX) private view returns (uint256) {
        if (baseDecimals == quoteDecimals) return priceX;
        if (baseDecimals > quoteDecimals) return priceX * (10 ** (baseDecimals - quoteDecimals));
        return priceX / (10 ** (quoteDecimals - baseDecimals));
    }
}
