// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../../types/MeridianTypes.sol";

/// @title IChainlinkEquityFeed
/// @notice Shape of a Chainlink 24/5 Equities Data Stream (RWA v11). [R5]
/// @dev Real Streams are pull-based with verifiable reports; this is the on-chain consumer view we mock.
///      marketStatus maps to MeridianTypes.MarketStatus (0-5). 24/5 NOT 24/7: weekend = Closed(5), stale by design.
interface IChainlinkEquityFeed {
    /// @return price          8-decimal price (adapter normalizes to 18-dec)
    /// @return marketStatus   enum 0-5 (Unknown..Closed)
    /// @return lastSeenTimestampNs  nanosecond timestamp of last fresh print; staleness = block.timestamp*1e9 - this
    function latestData()
        external
        view
        returns (uint256 price, MeridianTypes.MarketStatus marketStatus, uint256 lastSeenTimestampNs);

    function decimals() external view returns (uint8);
}
