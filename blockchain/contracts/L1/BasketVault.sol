// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BasketVaultBase} from "./BasketVaultBase.sol";

/// @title BasketVault — L1 static in-kind basket (Meridian)
/// @notice The static flavor of the in-kind core: the recipe is fixed forever and there are no
///         fees, so the `_accrue` seam is a no-op. All behavior lives in BasketVaultBase. Name and
///         constructor signature are unchanged so existing tests / deployments / ABI keep working.
contract BasketVault is BasketVaultBase {
    constructor(
        address[] memory tokens,
        uint256[] memory unitQty,
        uint256 unitSize_,
        string memory name_,
        string memory symbol_
    ) BasketVaultBase(tokens, unitQty, unitSize_, name_, symbol_) {}
}
