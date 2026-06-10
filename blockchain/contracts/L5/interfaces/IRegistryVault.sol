// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IRegistryVault — the slice of RegistryRebalanceVault the L5 queue uses
/// @notice A 500-native registry vault is BOTH an ERC-20 (the index SHARE) AND an ERC-6909 (the constituent
///         CLAIMS ledger, id = uint160(token)). The settle is SINGLE-SHOT (Q7: ~500 internal claim moves fit
///         one tx): `settleCreate` pulls the AP's pro-rata claims and mints to the user; cash redeem pays
///         CLAIMS (not ERC-20). `recipeRoot()` exists ONLY on the registry leaf (RootCommitment) — its presence
///         is how the queue distinguishes a registry vault from a small ManagedRebalanceVault (legacy path).
interface IRegistryVault {
    // ---- registry-only marker (impl check) ----
    function recipeRoot() external view returns (bytes32);

    // ---- fee config (FeeCore) ----
    function feeToken() external view returns (address);
    function flatCreateFee() external view returns (uint256);
    function flatRedeemFee() external view returns (uint256);
    function treasury() external view returns (address);

    // ---- L5 create primitive (the Part-3 vault addition) ----
    function settleCreate(address ap, address to, uint256 nShares) external;

    // ---- holdings redeem (RebalanceCore) — pays CLAIMS ----
    function redeem(uint256 amount) external;

    // ---- ERC-6909 claims surface ----
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function transfer(address to, uint256 id, uint256 amount) external returns (bool);
}
