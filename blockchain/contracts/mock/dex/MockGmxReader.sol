// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable GMX v2 reader: mark price (1e18) + long/short open interest (USD 1e18).
contract MockGmxReader {
    uint256 public markPrice;
    uint256 public longOI;
    uint256 public shortOI;

    function set(uint256 mark_, uint256 longOI_, uint256 shortOI_) external {
        markPrice = mark_;
        longOI = longOI_;
        shortOI = shortOI_;
    }
}
