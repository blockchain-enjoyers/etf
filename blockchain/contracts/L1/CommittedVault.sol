// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommittedVaultBase} from "./recipe/CommittedVaultBase.sol";

/// @title CommittedVault — static committed (off-chain-recipe) in-kind basket implementation (clone target)
contract CommittedVault is CommittedVaultBase {
    function initialize(
        address[] memory tokens,
        uint256[] memory unitQty,
        string memory name_,
        string memory symbol_
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __CommittedVault_init(tokens, unitQty);
    }
}
