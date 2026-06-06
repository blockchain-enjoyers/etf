// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IBasketVault — the slice of the L1 vault NAVEngine reads
/// @notice NAVEngine values the vault's ACTUAL on-chain holdings (IERC20.balanceOf(vault) per
///         constituent), not the recipe, since supply changes with create/redeem. It only needs the
///         constituent list; balances/decimals come from the tokens themselves.
interface IBasketVault {
    /// @return tokens  basket constituents (strictly ascending by address)
    /// @return unitQty recipe per creation-unit (unused by NAV; returned by the L1 ABI)
    function getConstituents() external view returns (address[] memory tokens, uint256[] memory unitQty);
}
