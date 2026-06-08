// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal Chainlink-style 8-dec USD feed for the stablecoin peg gate (g8).
///         `updatedAt` defaults to deploy-time block.timestamp (reads fresh); tests drive the g8
///         freshness branch via setUpdatedAt (old => PegStale; future => underflow revert).
contract MockPegFeed {
    int256 public price; uint8 public constant decimals = 8;
    uint256 public updatedAt;
    constructor(int256 p) { price = p; updatedAt = block.timestamp; }
    function setPrice(int256 p) external { price = p; }
    function setUpdatedAt(uint256 t) external { updatedAt = t; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, price, 0, updatedAt, 0);
    }
}
