// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";

/// @title ModuleRegistry
/// @notice Role -> engine address with time-locked changes and permanent per-slot freeze. [Registry+Engines]
/// @dev FULLY implemented (infrastructure backbone). Governor proposes a change; it commits after `timelock`;
///      `lock` freezes a slot forever (road to immutability, R2). The immutable vault resolves engines here.
contract ModuleRegistry is IModuleRegistry {
    address public governor;
    uint64 public timelock;

    mapping(bytes32 => address) internal _module;
    mapping(bytes32 => bool) internal _locked;
    mapping(bytes32 => address) internal _pending;
    mapping(bytes32 => uint64) internal _eta;

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address _governor, uint64 _timelock) {
        if (_governor == address(0)) revert ZeroAddress();
        governor = _governor;
        timelock = _timelock;
    }

    function get(bytes32 role) external view returns (address) {
        address m = _module[role];
        require(m != address(0), "Registry: unset");
        return m;
    }

    function tryGet(bytes32 role) external view returns (address) {
        return _module[role];
    }

    function isLocked(bytes32 role) external view returns (bool) {
        return _locked[role];
    }

    function propose(bytes32 role, address module) external onlyGovernor {
        if (_locked[role]) revert SlotLocked(role);
        if (module == address(0)) revert ZeroAddress();
        uint64 eta = uint64(block.timestamp) + timelock;
        _pending[role] = module;
        _eta[role] = eta;
        emit ModuleProposed(role, module, eta);
    }

    function commit(bytes32 role) external onlyGovernor {
        if (_locked[role]) revert SlotLocked(role);
        address module = _pending[role];
        if (module == address(0)) revert NoPendingChange(role);
        uint64 eta = _eta[role];
        if (block.timestamp < eta) revert TimelockNotElapsed(role, eta);
        _module[role] = module;
        delete _pending[role];
        delete _eta[role];
        emit ModuleSet(role, module);
    }

    function lock(bytes32 role) external onlyGovernor {
        _locked[role] = true;
        emit ModuleLocked(role);
    }

    /// @notice First-time wiring helper (no timelock) — usable only while a slot has never been set.
    /// @dev Convenience for deployment/tests; reverts once a slot holds a value. Production changes go through propose/commit.
    function initialSet(bytes32 role, address module) external onlyGovernor {
        require(_module[role] == address(0), "Registry: already set");
        if (_locked[role]) revert SlotLocked(role);
        if (module == address(0)) revert ZeroAddress();
        _module[role] = module;
        emit ModuleSet(role, module);
    }

    function setTimelock(uint64 t) external onlyGovernor {
        timelock = t;
        emit TimelockUpdated(t);
    }

    /// @notice Hand governance to a new address (used to transfer from a deployer to the real governor).
    function setGovernor(address newGovernor) external onlyGovernor {
        if (newGovernor == address(0)) revert ZeroAddress();
        governor = newGovernor;
    }
}
