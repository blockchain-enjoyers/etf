// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPyth (subset)
/// @notice Pyth price with confidence interval. [R5]
/// @dev Best practice: quote off the adverse confidence bound. price/conf share `expo`.
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf; //  confidence (1 sigma-ish), same expo as price
        int32 expo; //   base-10 exponent
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
}
