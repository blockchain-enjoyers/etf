// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title MiniERC20 — minimal constituent stand-in for large-N gas benchmarks
/// @notice NAVEngine only calls `decimals()` and `balanceOf(address)` on a constituent. This is the
///         smallest token that satisfies that, so deploying 500 of them for an SP500-scale gas bench is
///         cheap and fast. NOT a full ERC20 (no transfers) — the bench sets holdings directly via
///         `setBalance` instead of going through create/redeem.
contract MiniERC20 {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}
