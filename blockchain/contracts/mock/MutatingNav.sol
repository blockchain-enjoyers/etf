// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice A NAV engine that MUTATES state inside navOfHoldings (mimics FairValueNAV -> aggregator ->
///         ChainlinkStreamsSource.verify, which is state-changing). If the L5 NAV seam is declared `view`,
///         calling this through it lowers to STATICCALL and reverts on the SSTORE. Used to prove F1.
contract MutatingNav {
    uint256 public pokes;
    struct NavResult { uint256 nav; uint256 confLower; uint256 confUpper; uint8 marketStatus; bool safe; uint256 timestamp; }

    function navOfHoldings(address, address[] calldata, bytes[][] calldata) external returns (NavResult memory r) {
        pokes++; // state write -> reverts under STATICCALL
        r.nav = 1000e18;
        r.safe = true;
        r.marketStatus = 0;
        r.timestamp = block.timestamp;
    }
}
