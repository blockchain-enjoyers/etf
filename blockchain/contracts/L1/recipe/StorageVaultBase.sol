// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultCore} from "../core/VaultCore.sol";
import {RecipeLib} from "../core/RecipeLib.sol";

/// @title StorageVaultBase — in-kind vault whose recipe lives on-chain (the current behavior)
/// @notice Recipe stored in `_tokens`/`_unitQty`; create(nUnits)/redeem read it directly. The static
///         (BasketVault) and managed (ManagedVault) flavors extend this. See the L1 guide.
abstract contract StorageVaultBase is VaultCore {
    using SafeERC20 for IERC20;

    /// @notice Basket constituents: stock-token addresses (cash, if any, is just another token).
    address[] internal _tokens;
    /// @notice Recipe per creation-unit: how much of each token must be deposited.
    uint256[] internal _unitQty;

    /// @notice One EIP-2612 permit signature for a constituent (aligned by index to the recipe).
    /// @dev deadline == 0 means "skip this leg" (constituent lacks permit, or already approved).
    struct PermitInput {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    error PermitsLengthMismatch();
    error PermitFailed(address token);

    /// @dev Store the recipe and bind it to the clone-args commitment. Call from the leaf `initialize`.
    function __StorageVault_init(address[] memory tokens, uint256[] memory unitQty) internal onlyInitializing {
        _assertValidRecipe(tokens, unitQty);
        if (RecipeLib.commitment(tokens, unitQty, unitSize()) != recipeCommitment()) revert CommitmentMismatch();
        _tokens = tokens;
        _unitQty = unitQty;
    }

    /// @dev Replace the stored target recipe in place. Validates the recipe invariant. Used ONLY by the
    ///      rebalanceable subclass under its timelock+role gate; static leaves never call it. Does NOT
    ///      touch the immutable clone-arg recipeCommitment (which is genesis-only for the rebalanceable
    ///      flavor — valuation is holdings-based; see the L3 spec).
    function _setTarget(address[] memory tokens, uint256[] memory unitQty) internal {
        _assertValidRecipe(tokens, unitQty);
        _tokens = tokens;
        _unitQty = unitQty;
    }

    // ================================ CREATE =================================

    /// @notice Deposit `nUnits` creation-units of the recipe -> mint nUnits*unitSize basket tokens.
    /// @dev Classic path: the caller must have approved each constituent first. transferFrom for
    ///      each asset; if any leg is short the whole call reverts (bundle completeness, atomic).
    ///      CEI + nonReentrant. Permissionless.
    function create(uint256 nUnits) external virtual nonReentrant {
        _accrue();
        _pullAndMint(nUnits);
    }

    /// @notice One-tx create: apply EIP-2612 permits, then pull the recipe and mint.
    /// @dev `permits` is aligned by index to the constituents (getConstituents order). A leg with
    ///      deadline == 0 is skipped (constituent lacks permit, or the caller approved it classically);
    ///      correctness is still enforced by the transferFrom in _pullAndMint. CEI + nonReentrant.
    /// @param nUnits  creation-units to mint
    /// @param permits per-constituent permit signatures (same length as the recipe)
    function createWithPermit(uint256 nUnits, PermitInput[] calldata permits) external virtual nonReentrant {
        _accrue();
        uint256 len = _tokens.length;
        if (permits.length != len) revert PermitsLengthMismatch();
        for (uint256 i = 0; i < len; ++i) {
            if (permits[i].deadline != 0) {
                _tryPermit(_tokens[i], permits[i], _unitQty[i] * nUnits);
            }
        }
        _pullAndMint(nUnits);
    }

    /// @dev Shared body for create / createWithPermit: pull the exact recipe and mint shares.
    function _pullAndMint(uint256 nUnits) private {
        if (nUnits == 0) revert ZeroUnits();
        uint256 len = _tokens.length;
        for (uint256 i = 0; i < len; ++i) {
            // need = unitQty * nUnits is always > 0: nUnits checked above, unitQty[i] checked
            // > 0 in the constructor (ZeroQty). No zero-guard required.
            IERC20(_tokens[i]).safeTransferFrom(msg.sender, address(this), _unitQty[i] * nUnits);
        }
        uint256 minted = nUnits * unitSize();
        _mint(msg.sender, minted);
        emit Created(msg.sender, nUnits, minted);
    }

    /// @dev Apply one permit, then require the resulting allowance to cover what this leg will pull.
    ///      The attempt's revert is swallowed (front-run: nonce already consumed; or a non-permit /
    ///      no-op token), but the allowance check runs on BOTH branches, so a failed, under-valued,
    ///      or no-op permit fails fast and uniformly with PermitFailed instead of an opaque,
    ///      token-specific allowance error downstream.
    function _tryPermit(address token, PermitInput calldata p, uint256 need) private {
        try IERC20Permit(token).permit(msg.sender, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
        catch {}
        if (IERC20(token).allowance(msg.sender, address(this)) < need) revert PermitFailed(token);
    }

    // ================================ REDEEM =================================

    /// @notice Burn `amount` basket tokens -> withdraw the pro-rata share of the vault contents.
    /// @dev Denominator is supply BEFORE the burn (snapshotted AFTER `_accrue`, so any fee shares a
    ///      managed flavor mints in `_accrue` are counted and dilute the redeemer). Order is
    ///      accrue -> snapshot -> burn -> transfer (CEI). Not paused/blocked by THIS core's in-kind
    ///      logic; a subclass `_accrue` is on this path, and end-to-end availability still inherits
    ///      each constituent's transfer rules (a paused/blocklisting constituent reverts its leg and,
    ///      since this is one atomic loop, the whole redeem — see the TRUST BOUNDARY note above).
    ///      Managed flavors express fees by MINTING shares in `_accrue` (which moves totalSupply),
    ///      not by overriding this denominator. The static flavors do not override `redeem`; the
    ///      rebalanceable flavor (ManagedRebalanceVault) overrides it for holdings-based pro-rata payout.
    function redeem(uint256 amount) external virtual nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        uint256 supplyBefore = totalSupply();
        if (supplyBefore == 0) revert NoSupply();

        (address[] memory toks, uint256[] memory outs) = _quoteRedeem(amount, supplyBefore);

        _burn(msg.sender, amount);

        for (uint256 i = 0; i < toks.length; ++i) {
            if (outs[i] > 0) {
                IERC20(toks[i]).safeTransfer(msg.sender, outs[i]);
            }
        }
        emit Redeemed(msg.sender, amount);
    }

    /// @dev Pro-rata payout loop parameterized by an explicit denominator (supply snapshot). Used by
    ///      redeem (denominator = supply before burn) and previewRedeem (denominator = totalSupply,
    ///      or an effective post-accrual supply in a managed override). NOTE: the returned `tokens`
    ///      aliases the internal `_tokens` storage array — treat it as read-only.
    function _quoteRedeem(uint256 amount, uint256 supplyDenominator)
        internal
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 len = _tokens.length;
        tokens = _tokens;
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            uint256 bal = IERC20(_tokens[i]).balanceOf(address(this));
            amounts[i] = (bal * amount) / supplyDenominator;
        }
    }

    // ================================= VIEW ==================================

    /// @notice How much of each token must be deposited for `nUnits` units.
    function previewCreate(uint256 nUnits)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 len = _tokens.length;
        tokens = _tokens;
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            amounts[i] = _unitQty[i] * nUnits;
        }
    }

    /// @notice How much of each token a redeemer receives for `amount` basket tokens.
    function previewRedeem(uint256 amount)
        public
        view
        virtual
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        return _quoteRedeem(amount, supply);
    }

    /// @notice The basket recipe (PCF): tokens and quantity per 1 unit.
    function getConstituents()
        external
        view
        returns (address[] memory tokens, uint256[] memory unitQty)
    {
        return (_tokens, _unitQty);
    }

    /// @notice Number of assets in the basket.
    function constituentsCount() external view returns (uint256) {
        return _tokens.length;
    }
}
