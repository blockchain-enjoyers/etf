// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {RebalanceCore} from "./rebalance/RebalanceCore.sol";
import {RegistryCustody} from "../L1/recipe/RegistryCustody.sol";
import {RootCommitment} from "../L1/recipe/RootCommitment.sol";
import {MerkleRecipeLib} from "../L1/core/MerkleRecipeLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// NOTE (dual-token): this contract is BOTH ERC-20 (the index share, via VaultCore) AND ERC-6909 (the
// constituent claims, via RegistryCustody). `_mint`/`_burn` resolve by ARITY: `_mint(addr,uint)` = ERC-20 share,
// `_mint(addr,uint,uint)` = ERC-6909 claim. The wrap/unwrap below use the 3-arg ERC-6909 form. Do NOT "simplify"
// the overloads. `using SafeERC20 for IERC20` is declared for the keeper-boundary transfers.

/// @title RegistryRebalanceVault — 500-native rebalanceable index over an ERC-6909 registry + Merkle anchor
/// @notice Holdings-based create/redeem (RebalanceCore) over the per-vault ERC-6909 custody (RegistryCustody),
///         composition anchored by a MUTABLE Merkle root (RootCommitment). Bootstrap validates a calldata
///         recipe against the genesis root and seeds custody from the caller's wrapped claims; thereafter
///         create/redeem are pure internal reassignment. Reconstitution = scheduleRoot/activateRoot +
///         value-conserving executeRebalance. Oracle-free; redeem never paused by this code.
contract RegistryRebalanceVault is RegistryCustody, RebalanceCore, RootCommitment {
    using SafeERC20 for IERC20;

    error AlreadyBootstrapped();
    error ProofLengthMismatch();
    error LeafNotInRoot(address token);

    function initializeRegistry(
        bytes32 genesisRoot,
        string memory name_,
        string memory symbol_,
        RebalanceParams memory p
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __RegistryCustody_init();
        __RootCommitment_init(genesisRoot);
        __Managed_init(ManagedParams({
            manager: p.manager, meridian: p.meridian, treasury: p.treasury,
            managerFeeBps: p.managerFeeBps, platformFeeBps: p.platformFeeBps,
            feeToken: p.feeToken, flatCreateFee: p.flatCreateFee, flatRedeemFee: p.flatRedeemFee
        }));
        __RebalanceFee_init(p.keeperBps, p.keeperEscrow);
    }

    // ---- claim port (create/redeem): forward to RegistryCustody's concrete (non-virtual) _custody* —
    //      distinct names, no override clash ----
    function _portBalance(address token) internal view override returns (uint256) {
        return _custodyBalance(token);   // RegistryCustody (Part 1), non-virtual, called directly
    }
    function _portIn(address from, address token, uint256 amount) internal override {
        _custodyIn(from, token, amount);   // claim _transfer(from -> this) — from == msg.sender at create
    }
    function _portOut(address to, address token, uint256 amount) internal override {
        _custodyOut(to, token, amount);    // claim _transfer(this -> to)
    }

    // ---- keeper-boundary port (executeRebalance): wrap incoming ERC-20 / unwrap outgoing claim ----
    function _acquireIn(address from, address token, uint256 amount) internal override {
        IERC20(token).safeTransferFrom(from, address(this), amount); // pull real ERC-20 from the keeper/auction
        _mint(address(this), idOf(token), amount);                   // wrap: credit the vault's own claim id
    }
    function _releaseOut(address to, address token, uint256 amount) internal override {
        _burn(address(this), idOf(token), amount);                   // unwrap: burn the vault's claim id
        IERC20(token).safeTransfer(to, amount);                      // send real ERC-20 to the keeper/auction
    }

    /// @notice First mint: validate the calldata recipe against the genesis root, pull the caller's claims into
    ///         custody, seed the held set, mint nShares. Caller (AP) must have wrapped the constituents first.
    function bootstrap(
        uint256 nShares,
        address[] calldata tokens,
        uint256[] calldata unitQty,
        bytes32[][] calldata proofs
    ) external nonReentrant {
        if (totalSupply() != 0) revert AlreadyBootstrapped();
        if (nShares == 0) revert ZeroUnits();
        uint256 us = unitSize();
        if (nShares % us != 0) revert NonMultipleOfUnitSize();
        if (tokens.length != unitQty.length || tokens.length != proofs.length) revert ProofLengthMismatch();
        // NOTE: do NOT call `_assertValidRecipe` here — it requires strictly-ASCENDING tokens, but
        // MerkleRecipeLib.verify is ORDER-INDEPENDENT. Per-leaf membership is enforced by the Merkle proof
        // below; only require `unitQty[i] > 0` inline. Bootstrap COMPLETENESS is the caller's responsibility.
        uint256 units = nShares / us;
        bytes32 root = recipeRoot;
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (unitQty[i] == 0) revert ZeroQty(); // ZeroQty is declared in VaultCore
            if (!MerkleRecipeLib.verify(root, proofs[i], tokens[i], unitQty[i], us)) revert LeafNotInRoot(tokens[i]);
            _custodyIn(msg.sender, tokens[i], unitQty[i] * units);
            _addHeld(tokens[i]);
        }
        _mint(msg.sender, nShares);
        emit Created(msg.sender, nShares, nShares);
    }

    /// @dev Curator gate for RootCommitment = the manager (matches scheduleTarget's onlyManager on the storage leaf).
    function _requireRootCurator() internal view override {
        if (msg.sender != manager) revert NotManager();
    }
}
