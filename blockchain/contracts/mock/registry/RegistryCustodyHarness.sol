// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {RegistryCustody} from "../../L1/recipe/RegistryCustody.sol";

/// @title RegistryCustodyHarness — concrete RegistryCustody for tests; exposes the internal port.
contract RegistryCustodyHarness is RegistryCustody {
    function initialize() external initializer {
        __RegistryCustody_init();
    }

    function custodyBalance(address token) external view returns (uint256) {
        return _custodyBalance(token);
    }

    function custodyIn(address from, address token, uint256 amount) external {
        _custodyIn(from, token, amount);
    }

    function custodyOut(address to, address token, uint256 amount) external {
        _custodyOut(to, token, amount);
    }
}
