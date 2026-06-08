// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal L2-router stand-in exposing feedIdOf for the g1 feed-coverage check.
contract MockFeedRouter {
    mapping(address => bytes32) public feedIdOf;
    function setFeed(address asset, bytes32 id) external { feedIdOf[asset] = id; }
}
