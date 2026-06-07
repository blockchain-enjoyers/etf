// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal vault stub exposing only the L1<->L4 seam: recipeCommitment().
contract MockRecipeVault {
    bytes32 public recipeCommitment;
    constructor(bytes32 commitment) { recipeCommitment = commitment; }
}
