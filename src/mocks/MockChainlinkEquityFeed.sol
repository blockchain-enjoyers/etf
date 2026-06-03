// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IChainlinkEquityFeed} from "../interfaces/external/IChainlinkEquityFeed.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title MockChainlinkEquityFeed
/// @notice Fully settable Chainlink Equities Data Stream simulation. [R5]
/// @dev Drives scenarios: market open / pre / post / overnight / weekend-stale / halt. Set price,
///      marketStatus (0-5) and lastSeenTimestampNs independently to mimic the deliberately-stale weekend.
contract MockChainlinkEquityFeed is IChainlinkEquityFeed {
    uint256 public price; //                8-decimal by convention
    MeridianTypes.MarketStatus public status;
    uint256 public lastSeenTimestampNs;
    uint8 private _decimals = 8;

    constructor(uint256 initialPrice8, MeridianTypes.MarketStatus initialStatus) {
        price = initialPrice8;
        status = initialStatus;
        lastSeenTimestampNs = block.timestamp * 1e9;
    }

    // -- scenario setters ----------------------------------------------------

    function setPrice(uint256 newPrice8) external {
        price = newPrice8;
        lastSeenTimestampNs = block.timestamp * 1e9; // a fresh print bumps the timestamp
    }

    function setStatus(MeridianTypes.MarketStatus s) external {
        status = s;
    }

    /// @notice Force a stale timestamp (weekend / outage) without changing price.
    function setLastSeenTimestampNs(uint256 ns) external {
        lastSeenTimestampNs = ns;
    }

    /// @notice Convenience: simulate the weekend gap — Closed status, timestamp frozen `agoSeconds` back.
    function simulateWeekendStale(uint256 agoSeconds) external {
        status = MeridianTypes.MarketStatus.Closed;
        lastSeenTimestampNs = (block.timestamp - agoSeconds) * 1e9;
    }

    function setDecimals(uint8 d) external {
        _decimals = d;
    }

    // -- view ----------------------------------------------------------------

    function latestData()
        external
        view
        returns (uint256, MeridianTypes.MarketStatus, uint256)
    {
        return (price, status, lastSeenTimestampNs);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
