// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultCore} from "../core/VaultCore.sol";
import {RecipeLib} from "../core/RecipeLib.sol";

/// @title CommittedVaultBase — in-kind vault whose recipe lives OFF-CHAIN, anchored by a commitment
/// @notice Stores only `recipeCommitment` (no per-constituent storage -> cheap deploy at any N). The
///         caller supplies the recipe in calldata on every create/redeem; it is validated against the
///         commitment. The full recipe is emitted at initialization (RecipeCommitted) so it is always
///         reconstructable from chain logs even if the operator's backend disappears (the DA tradeoff vs
///         storage vaults: redeem requires supplying the recipe, but it is never unrecoverable).
abstract contract CommittedVaultBase is VaultCore {
    using SafeERC20 for IERC20;

    error RecipeMismatch();

    event RecipeCommitted(address[] tokens, uint256[] unitQty, uint256 unitSize);

    /// @dev Validate the recipe against the clone-args commitment and emit it for off-chain recovery.
    function __CommittedVault_init(address[] memory tokens, uint256[] memory unitQty) internal onlyInitializing {
        _assertValidRecipe(tokens, unitQty);
        if (RecipeLib.commitment(tokens, unitQty, unitSize()) != recipeCommitment()) revert CommitmentMismatch();
        emit RecipeCommitted(tokens, unitQty, unitSize());
    }

    /// @notice Deposit `nUnits` of the (calldata) recipe -> mint nUnits*unitSize. Recipe validated.
    function create(uint256 nUnits, address[] calldata tokens, uint256[] calldata unitQty)
        external
        nonReentrant
    {
        _accrue();
        if (nUnits == 0) revert ZeroUnits();
        _checkRecipe(tokens, unitQty);
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; ++i) {
            IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), unitQty[i] * nUnits);
        }
        uint256 minted = nUnits * unitSize();
        _mint(msg.sender, minted);
        emit Created(msg.sender, nUnits, minted);
    }

    /// @notice Burn `amount` -> withdraw the pro-rata share of the (calldata) recipe's constituents.
    function redeem(uint256 amount, address[] calldata tokens, uint256[] calldata unitQty)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        _checkRecipe(tokens, unitQty);
        uint256 supplyBefore = totalSupply();
        if (supplyBefore == 0) revert NoSupply();

        uint256 len = tokens.length;
        uint256[] memory outs = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            outs[i] = (IERC20(tokens[i]).balanceOf(address(this)) * amount) / supplyBefore;
        }
        _burn(msg.sender, amount);
        for (uint256 i = 0; i < len; ++i) {
            if (outs[i] > 0) IERC20(tokens[i]).safeTransfer(msg.sender, outs[i]);
        }
        emit Redeemed(msg.sender, amount);
    }

    /// @dev keccak over the calldata recipe must equal the stored commitment. Mirrors RecipeLib.commitment
    ///      (inlined to hash calldata directly without a memory copy).
    function _checkRecipe(address[] calldata tokens, uint256[] calldata unitQty) private view {
        if (keccak256(abi.encode(tokens, unitQty, unitSize())) != recipeCommitment()) revert RecipeMismatch();
    }
}
