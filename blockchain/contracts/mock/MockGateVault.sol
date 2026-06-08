// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test stand-in vault exposing settable totalSupply + heldTokens for the L5 gate test.
contract MockGateVault {
    uint256 private _supply;
    address[] private _held;
    constructor(uint256 supply_) { _supply = supply_; }
    function setSupply(uint256 s) external { _supply = s; }
    function totalSupply() external view returns (uint256) { return _supply; }
    function setHeld(address[] calldata h) external { delete _held; for (uint256 i; i < h.length; ++i) _held.push(h[i]); }
    function heldTokens() external view returns (address[] memory) { return _held; }
}
