// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPerpMarkFeed
/// @notice Equity/index perpetual mark + funding (Hyperliquid HIP-3 / Kraken xStocks Perps). [R5]
/// @dev v2 signal only. Funding is used to de-bias the perp premium. NEVER a settlement price.
interface IPerpMarkFeed {
    /// @return mark            18-dec mark price
    /// @return fundingRate1e18 current funding rate scaled by 1e18 (signed)
    /// @return timestamp       seconds
    function latestMark() external view returns (uint256 mark, int256 fundingRate1e18, uint64 timestamp);
}
