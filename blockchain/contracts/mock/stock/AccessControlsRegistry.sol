// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAccessControlsRegistry} from "./interfaces/IAccessControlsRegistry.sol";

/// @title AccessControlsRegistry — minimal registry backing the Stock mock in tests.
/// @notice Implements the role/block/pause surface that Stock reads via AccessControlled. Roles
///         come from OpenZeppelin AccessControl; block-list and global pause are added here.
contract AccessControlsRegistry is AccessControl, IAccessControlsRegistry {
    mapping(address => bool) private _blocked;
    bool private _paused;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function isBlocked(address account) external view returns (bool) {
        return _blocked[account];
    }

    function blockAccounts(address[] calldata accounts) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < accounts.length; ++i) {
            _blocked[accounts[i]] = true;
            emit Blocked(accounts[i]);
        }
    }

    function unblockAccounts(address[] calldata accounts) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < accounts.length; ++i) {
            _blocked[accounts[i]] = false;
            emit Unblocked(accounts[i]);
        }
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _paused = true;
        emit Paused();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _paused = false;
        emit Unpaused();
    }

    function paused() external view returns (bool) {
        return _paused;
    }
}
