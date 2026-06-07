// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @notice Test helper: deploy an EIP-1167 clone-with-immutable-args without the full factory.
contract CloneWithArgsHelper {
    address public lastClone;
    function clone(address impl, bytes calldata args) external returns (address c) {
        c = Clones.cloneWithImmutableArgs(impl, args);
        lastClone = c;
    }
}
