// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test stand-in for FairValueNAV.navOfHoldings — settable nav + band + status/safe. Defaults Open+safe.
contract MockHoldingsNav {
    struct NavResult { uint256 nav; uint256 confLower; uint256 confUpper; uint8 marketStatus; bool safe; uint256 timestamp; }
    uint256 public navValue;
    uint256 public confLower;
    uint256 public confUpper;
    uint8 public marketStatus; // 0 == Open (default)
    bool public safe;
    constructor() { safe = true; } // default Open + safe so the observer records
    function setNav(uint256 v) external { navValue = v; }
    function setBand(uint256 lo, uint256 hi) external { confLower = lo; confUpper = hi; }
    function setStatusSafe(uint8 s, bool sf) external { marketStatus = s; safe = sf; }
    function navOfHoldings(address, address[] calldata, bytes[][] calldata) external view returns (NavResult memory r) {
        r.nav = navValue;
        r.confLower = confLower;
        r.confUpper = confUpper;
        r.marketStatus = marketStatus;
        r.safe = safe;
        r.timestamp = block.timestamp;
    }
}
