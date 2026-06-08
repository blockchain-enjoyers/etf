// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test stand-in exposing only totalSupply() + heldTokens().
contract MockSupplyVault {
    uint256 private _supply;
    constructor(uint256 supply_) { _supply = supply_; }
    function totalSupply() external view returns (uint256) { return _supply; }
    function heldTokens() external pure returns (address[] memory) { return new address[](0); }
}
