// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPerpMarkFeed} from "../interfaces/external/IPerpMarkFeed.sol";

/// @title MockPerpMark
/// @notice Settable equity/index perp mark + funding (v2 24/7 signal). [R5]
/// @dev Funding lets tests exercise perp-premium de-biasing. NEVER a settlement price.
contract MockPerpMark is IPerpMarkFeed {
    uint256 public mark; //             18-dec
    int256 public fundingRate1e18; //   signed
    uint64 public ts;

    constructor(uint256 initialMark) {
        mark = initialMark;
        ts = uint64(block.timestamp);
    }

    function setMark(uint256 newMark) external {
        mark = newMark;
        ts = uint64(block.timestamp);
    }

    function setFunding(int256 rate1e18) external {
        fundingRate1e18 = rate1e18;
    }

    function latestMark() external view returns (uint256, int256, uint64) {
        return (mark, fundingRate1e18, ts);
    }
}
