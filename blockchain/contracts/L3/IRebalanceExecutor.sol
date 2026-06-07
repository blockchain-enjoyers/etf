// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IRebalanceExecutor — the type a rebalanceable vault trusts to drive executeRebalance.
/// @notice The vault checks `isExecutor[caller]`; this interface documents the call the executor makes.
///         In Part 3 the RebalanceAuction implements the auction that decides the legs; here a mock stands in.
interface IRebalanceExecutor {
    function bidSwap(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address bidder
    ) external returns (uint256[] memory acquireOut);
}
