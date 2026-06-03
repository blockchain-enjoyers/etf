// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IModuleRegistry
/// @notice Role -> engine address lookup. The immutable BasketVault resolves engines through here,
///         so swapping an oracle/NAV/rebalance engine never touches the vault. [pattern: Registry+Engines]
/// @dev `set` is time-locked; `lock` permanently freezes a slot (road to immutability, R2).
interface IModuleRegistry {
    event ModuleProposed(bytes32 indexed role, address indexed module, uint64 eta);
    event ModuleSet(bytes32 indexed role, address indexed module);
    event ModuleLocked(bytes32 indexed role);
    event TimelockUpdated(uint64 timelock);

    error SlotLocked(bytes32 role);
    error TimelockNotElapsed(bytes32 role, uint64 eta);
    error NoPendingChange(bytes32 role);
    error ZeroAddress();
    error NotGovernor();

    /// @notice Current engine for a role. Reverts if unset.
    function get(bytes32 role) external view returns (address);

    /// @notice Same as get but returns address(0) instead of reverting when unset.
    function tryGet(bytes32 role) external view returns (address);

    function isLocked(bytes32 role) external view returns (bool);

    /// @notice Queue a role change; takes effect after the timelock.
    function propose(bytes32 role, address module) external;

    /// @notice Apply a previously proposed change once its eta has passed.
    function commit(bytes32 role) external;

    /// @notice Permanently freeze a role at its current address. Irreversible.
    function lock(bytes32 role) external;
}
