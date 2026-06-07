// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IFeePolicy — PROVISION for Phase 2 (not yet wired)
/// @notice Compute->execute contract: a fee module returns the dilution PLAN (shares to mint and to whom)
///         for the elapsed period; the immutable vault core executes the `_mint` and enforces the fee
///         caps. The module never mints or moves funds. In Phase 1 the managed fee remains inheritance-
///         based (ManagedVault._accrue); this interface only fixes the shape for the Phase-2 migration.
interface IFeePolicy {
    /// @return managerTo   recipient of the manager fee shares (address(0) if none)
    /// @return managerShares dilution shares owed to the manager this accrual
    /// @return platformTo  recipient of the platform fee shares (address(0) if none)
    /// @return platformShares dilution shares owed to the platform this accrual
    function planAccrual(uint256 totalSupply, uint256 lastAccrued, uint256 nowTs)
        external
        view
        returns (address managerTo, uint256 managerShares, address platformTo, uint256 platformShares);
}
