// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

interface IUniV2PairLike {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/// @title UniswapV2Source — constant-product spot price + reserve-based cost-to-move depth (R13 §1/§2)
/// @notice read(): price = reserve1/reserve0 (decimals-adjusted, quote per base); depth = base reserve
///         fraction needed to move the price by δ (≈ reserve0·δ for small δ), valued in USD. (A
///         price0CumulativeLast TWAP path is a future hardening; the spot path suffices over the mock.)
contract UniswapV2Source is IPriceSource {
    IUniV2PairLike public immutable pair;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;
    uint256 public immutable deltaBps;

    constructor(address pair_, uint8 baseDec_, uint8 quoteDec_, uint256 deltaBps_) {
        pair = IUniV2PairLike(pair_);
        baseDecimals = baseDec_;
        quoteDecimals = quoteDec_;
        deltaBps = deltaBps_;
    }

    function read(bytes calldata) external view returns (SourceReading memory r) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 price = r0 == 0 ? 0 : _adjustDecimals((uint256(r1) * 1e18) / uint256(r0));
        r.price = price;
        // Δx ≈ reserve0·δ to move the price by δ on x*y=k; value it in USD at `price`.
        uint256 dx = (uint256(r0) * deltaBps) / 10000;
        r.depth = (dx * price) / 1e18;
        r.confidence = 0;
        r.lastUpdate = uint64(block.timestamp);
        r.kind = SourceKind.AMM_TWAP;
        r.weekendAware = false;
        r.healthy = price > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("uniswap-v2", address(pair));
    }

    function _adjustDecimals(uint256 priceX) private view returns (uint256) {
        if (baseDecimals == quoteDecimals) return priceX;
        if (baseDecimals > quoteDecimals) return priceX * (10 ** (baseDecimals - quoteDecimals));
        return priceX / (10 ** (quoteDecimals - baseDecimals));
    }
}
