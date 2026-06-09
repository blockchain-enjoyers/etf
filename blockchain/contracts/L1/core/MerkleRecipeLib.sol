// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title MerkleRecipeLib — Merkle composition commitment for large (approx 500-name) baskets
/// @notice Beside RecipeLib (flat keccak). A basket recipe is committed as a Merkle ROOT over per-constituent
///         leaves; a create/redeem (or assembly chunk) supplies only its touched constituents + proofs instead
///         of the whole recipe in calldata. The leaf uses the OpenZeppelin StandardMerkleTree double-hash
///         convention (keccak256(bytes.concat(keccak256(abi.encode(...))))) so off-chain merkle-tree proofs
///         verify on-chain and the second-preimage attack is avoided.
library MerkleRecipeLib {
    /// @return the StandardMerkleTree leaf for one constituent (token, unitQty, unitSize).
    function leaf(address token, uint256 unitQty, uint256 unitSize) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(token, unitQty, unitSize))));
    }

    /// @return true iff `proof` proves (token, unitQty, unitSize) is a leaf of `root`.
    function verify(
        bytes32 root,
        bytes32[] memory proof,
        address token,
        uint256 unitQty,
        uint256 unitSize
    ) internal pure returns (bool) {
        return MerkleProof.verify(proof, root, leaf(token, unitQty, unitSize));
    }
}
