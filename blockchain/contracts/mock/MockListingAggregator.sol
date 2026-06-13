// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Settable stand-in for PriceAggregator.acceptedDepthOf (the listing-gate depth per asset).
///         Non-view to mirror the real aggregator (its read() seam is non-view).
contract MockListingAggregator {
    mapping(address => uint256) public depth;

    function setDepth(address asset, uint256 d) external { depth[asset] = d; }

    function acceptedDepthOf(address asset, bytes[] calldata) external returns (uint256) {
        return depth[asset];
    }
}
