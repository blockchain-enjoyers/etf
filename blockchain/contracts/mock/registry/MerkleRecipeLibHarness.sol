// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MerkleRecipeLib} from "../../L1/core/MerkleRecipeLib.sol";

/// @title MerkleRecipeLibHarness — external surface over MerkleRecipeLib for tests.
contract MerkleRecipeLibHarness {
    function leaf(address token, uint256 unitQty, uint256 unitSize) external pure returns (bytes32) {
        return MerkleRecipeLib.leaf(token, unitQty, unitSize);
    }

    function verify(
        bytes32 root,
        bytes32[] calldata proof,
        address token,
        uint256 unitQty,
        uint256 unitSize
    ) external pure returns (bool) {
        return MerkleRecipeLib.verify(root, proof, token, unitQty, unitSize);
    }
}
