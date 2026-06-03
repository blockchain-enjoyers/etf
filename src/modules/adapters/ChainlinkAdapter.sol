// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOracleAdapter} from "../../interfaces/IOracleAdapter.sol";
import {IChainlinkEquityFeed} from "../../interfaces/external/IChainlinkEquityFeed.sol";
import {MeridianTypes} from "../../types/MeridianTypes.sol";

/// @title ChainlinkAdapter
/// @notice v1 oracle adapter: normalizes a Chainlink Equities Data Stream into an OracleReading. [R5]
/// @dev IMPLEMENTED. One feed per asset (set by owner). Normalizes feed decimals (8) -> 18; converts the
///      nanosecond lastSeen timestamp to seconds; passes marketStatus through. Confidence = 0 (Chainlink
///      exposes no interval; fusion/Pyth add confidence in v2).
contract ChainlinkAdapter is IOracleAdapter {
    address public owner;
    mapping(address => IChainlinkEquityFeed) public feedOf; // asset -> feed

    constructor(address _owner) {
        owner = _owner;
    }

    function setFeed(address asset, address feed) external {
        require(msg.sender == owner, "Adapter: not owner");
        feedOf[asset] = IChainlinkEquityFeed(feed);
    }

    function sourceType() external pure returns (MeridianTypes.OracleSource) {
        return MeridianTypes.OracleSource.Chainlink;
    }

    function isAvailable(address asset) external view returns (bool) {
        return address(feedOf[asset]) != address(0);
    }

    function read(address asset) external view returns (MeridianTypes.OracleReading memory r) {
        IChainlinkEquityFeed feed = feedOf[asset];
        require(address(feed) != address(0), "Adapter: no feed");
        (uint256 price, MeridianTypes.MarketStatus status, uint256 lastSeenNs) = feed.latestData();

        uint8 dec = feed.decimals();
        uint256 price18 = dec == 18 ? price : (dec < 18 ? price * (10 ** (18 - dec)) : price / (10 ** (dec - 18)));

        r = MeridianTypes.OracleReading({
            price: price18,
            confidence: 0,
            timestamp: uint64(lastSeenNs / 1e9),
            marketStatus: status,
            source: MeridianTypes.OracleSource.Chainlink
        });
    }
}
