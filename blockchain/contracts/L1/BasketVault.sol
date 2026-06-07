// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {StorageVaultBase} from "./recipe/StorageVaultBase.sol";

/// @title BasketVault — static in-kind basket implementation (clone target)
contract BasketVault is StorageVaultBase {
    /// @notice One-time init for a clone. `unitSize`/`recipeCommitment` come from clone immutable-args.
    function initialize(
        address[] memory tokens,
        uint256[] memory unitQty,
        string memory name_,
        string memory symbol_
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __StorageVault_init(tokens, unitQty);
    }
}
