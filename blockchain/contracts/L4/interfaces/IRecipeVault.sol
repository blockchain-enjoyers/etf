// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IRecipeVault — the only L1<->L4 seam: the vault's recipe commitment.
interface IRecipeVault {
    function recipeCommitment() external view returns (bytes32);
}
