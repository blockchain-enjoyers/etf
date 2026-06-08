// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal PriceAggregator stand-in for the g1 isSource check.
contract MockAggregator {
    mapping(address => mapping(address => bool)) public isSource;
    mapping(address => uint256) public sourceCount;
    function addSource(address asset, address src) external {
        if (!isSource[asset][src]) { isSource[asset][src] = true; sourceCount[asset] += 1; }
    }
}
