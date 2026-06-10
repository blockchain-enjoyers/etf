// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test stand-in vault exposing a settable per-token `holdingsOf` (the polymorphic NAV seam, F2),
///         so FairValueNAV can value a vault by its CLAIM backing while its real ERC20 balance is inflated
///         by staged AP inventory. Also exposes totalSupply()/heldTokens() so BasketNavObserver.record()
///         can sample it in the F1+F2 regression.
contract MockHoldingsVault {
    mapping(address => uint256) private _h;
    uint256 private _supply = 1e18;
    address[] private _held;

    function setHoldings(address token, uint256 amt) external { _h[token] = amt; }
    function holdingsOf(address token) external view returns (uint256) { return _h[token]; }

    function setSupply(uint256 s) external { _supply = s; }
    function totalSupply() external view returns (uint256) { return _supply; }

    function setHeld(address[] calldata h) external { delete _held; for (uint256 i; i < h.length; ++i) _held.push(h[i]); }
    function heldTokens() external view returns (address[] memory) { return _held; }
}
