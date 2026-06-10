// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @title VaultCore — shared clone-based spine for every Meridian in-kind vault
/// @notice Deployed once per vault TYPE as an immutable implementation; per-vault instances are EIP-1167
///         clones. `unitSize` and `recipeCommitment` live in the clone's immutable-args (read via
///         Clones.fetchCloneArgs — no SSTORE, fixed for the clone's life). name/symbol + per-type storage
///         are set in `initialize`. A minimal proxy forwards to a FIXED implementation (no admin, no
///         upgrade), so behavior is immutable and funds can't be drained — same moat as the old ctor model.
// @dev Base order: ReentrancyGuardTransient BEFORE ERC20Upgradeable so the C3 linearization is compatible
//      with RegistryCustody (`Initializable, ReentrancyGuardTransient, ERC6909Upgradeable`), letting the
//      dual-token RegistryRebalanceVault inherit both branches. Storage-safe: all three bases use
//      namespaced (ERC-7201) / transient storage, no sequential slots — reordering changes no layout and
//      no behavior (the fee+rebalance green gate is the regression net).
abstract contract VaultCore is Initializable, ReentrancyGuardTransient, ERC20Upgradeable {
    event Created(address indexed creator, uint256 nUnits, uint256 minted);
    event Redeemed(address indexed redeemer, uint256 amount);

    error LengthMismatch();
    error EmptyBasket();
    error ZeroUnitSize();
    error ZeroUnits();
    error ZeroAmount();
    error NoSupply();
    error UnsortedOrDuplicateTokens();
    error ZeroQty();
    error CommitmentMismatch();

    /// @dev Implementations disable initializers so the implementation itself can never be initialized.
    constructor() {
        _disableInitializers();
    }

    /// @dev Decode the clone's immutable-args: (unitSize, recipeCommitment).
    function _cloneArgs() private view returns (uint256 unitSize_, bytes32 commitment_) {
        (unitSize_, commitment_) = abi.decode(Clones.fetchCloneArgs(address(this)), (uint256, bytes32));
    }

    /// @notice Basket tokens minted per 1 creation-unit (from clone immutable-args).
    function unitSize() public view returns (uint256 u) {
        (u, ) = _cloneArgs();
    }

    /// @notice keccak256(abi.encode(tokens, unitQty, unitSize)) — anchor for the L2 valuation layer.
    function recipeCommitment() public view returns (bytes32 c) {
        (, c) = _cloneArgs();
    }

    /// @dev Init the shared spine. Call from each leaf's `initialize`. ReentrancyGuardTransient needs no init.
    ///      `unitSize` comes from clone-args; reject a 0 (a unitSize-0 vault mints 0 forever) — the same
    ///      invariant the old constructor enforced, re-asserted at init so it holds on every deploy path.
    function __VaultCore_init(string memory name_, string memory symbol_) internal onlyInitializing {
        if (unitSize() == 0) revert ZeroUnitSize();
        __ERC20_init(name_, symbol_);
    }

    /// @dev Seam: managed flavor settles fees here before any supply change. No-op default.
    function _accrue() internal virtual {}

    /// @dev Seam: managed flavor charges a FLAT per-create processing fee here (a fixed USDG amount, NOT a %
    ///      of notional — red line #3 stays clean). No-op default ⇒ free vaults are unaffected. Called in the
    ///      create paths AFTER _accrue. There is deliberately NO redeem-side seam: in-kind redeem must stay
    ///      free and unconditional (redeem never pauses); the cash-path redeem fee is handled in L5.
    function _chargeFlatCreateFee() internal virtual {}

    /// @dev Recipe invariant: strictly-ascending tokens (=> unique + non-zero), each unitQty > 0,
    ///      equal non-zero lengths.
    function _assertValidRecipe(address[] memory tokens, uint256[] memory unitQty) internal pure {
        uint256 len = tokens.length;
        if (len != unitQty.length) revert LengthMismatch();
        if (len == 0) revert EmptyBasket();
        address prev = address(0);
        for (uint256 i = 0; i < len; ++i) {
            address t = tokens[i];
            if (t <= prev) revert UnsortedOrDuplicateTokens();
            if (unitQty[i] == 0) revert ZeroQty();
            prev = t;
        }
    }
}
