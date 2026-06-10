// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {StorageVaultBase} from "./recipe/StorageVaultBase.sol";
import {FeeCore} from "./fee/FeeCore.sol";
import {VaultCore} from "./core/VaultCore.sol";

/// @title ManagedVault — L1 managed in-kind basket with streaming management + platform fee (Meridian's own AUM line)
/// @notice Static recipe (no rebalance) + a streaming management fee charged by dilution. The fee machinery
///         (manager/platform/flat fees, accrual, role rotation, timelocked setters) lives in {FeeCore}; this
///         leaf binds it to the on-chain recipe storage of {StorageVaultBase}. Resolves the shared
///         VaultCore diamond by listing `StorageVaultBase, FeeCore`; the `_accrue`/`_chargeFlatCreateFee`
///         seams resolve to FeeCore's overrides (StorageVaultBase's create/redeem call them).
contract ManagedVault is StorageVaultBase, FeeCore {
    function initialize(
        address[] memory tokens,
        uint256[] memory unitQty,
        string memory name_,
        string memory symbol_,
        ManagedParams memory p
    ) external initializer {
        __VaultCore_init(name_, symbol_);
        __StorageVault_init(tokens, unitQty);
        __Managed_init(p);
    }

    // ---- diamond resolution: both StorageVaultBase and FeeCore expose VaultCore's seams; the most-derived
    //      leaf must explicitly resolve. Delegate to FeeCore's implementations (the fee bodies). Kept
    //      `virtual` so ManagedRebalanceVault can still override `_accrue` with its 3-way form. ----
    function _accrue() internal virtual override(VaultCore, FeeCore) { FeeCore._accrue(); }
    function _chargeFlatCreateFee() internal override(VaultCore, FeeCore) { FeeCore._chargeFlatCreateFee(); }

    // ================================= VIEW ==================================

    /// @notice Pro-rata redeem quote that INCLUDES pending (not-yet-minted) fee dilution: it quotes
    ///         against `totalSupply() + pendingMintShares()`, matching what `redeem` pays after it
    ///         accrues. The real payout may be a hair lower if a block elapses between quote and redeem.
    /// @dev Stays in ManagedVault (not FeeCore): it reads `_quoteRedeem`, which lives in StorageVaultBase.
    function previewRedeem(uint256 amount)
        public
        view
        virtual
        override
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        return _quoteRedeem(amount, supply + pendingMintShares());
    }
}
