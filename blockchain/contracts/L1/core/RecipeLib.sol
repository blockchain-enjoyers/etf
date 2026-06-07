// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title RecipeLib — canonical basket-recipe commitment
/// @notice The single definition of the recipe fingerprint, shared by the L1 vaults and the L2
///         valuation layer (CommitmentNAV uses the identical formula) so a vault's commitment and the
///         valuation layer's validation always agree.
library RecipeLib {
    /// @return keccak256(abi.encode(tokens, unitQty, unitSize)).
    function commitment(address[] memory tokens, uint256[] memory unitQty, uint256 unitSize)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(tokens, unitQty, unitSize));
    }
}
