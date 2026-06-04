// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPyth} from "../interfaces/external/IPyth.sol";

/// @title MockPyth
/// @notice Settable Pyth price with confidence interval (multi-source fusion second source). [R5]
/// @dev Lets tests exercise confidence-band widening and divergence-vs-Chainlink checks.
contract MockPyth is IPyth {
    mapping(bytes32 => Price) internal _prices;

    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo) external {
        _prices[id] = Price({price: price, conf: conf, expo: expo, publishTime: block.timestamp});
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        return _prices[id];
    }
}
