// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {RootCommitment} from "../../L1/recipe/RootCommitment.sol";

/// @title RootCommitmentHarness — concrete RootCommitment whose curator is a fixed owner, for tests.
contract RootCommitmentHarness is RootCommitment {
    address public curator;

    function initialize(bytes32 genesisRoot) external initializer {
        curator = msg.sender;
        __RootCommitment_init(genesisRoot);
    }

    function _requireRootCurator() internal view override {
        if (msg.sender != curator) revert NotRootCurator();
    }
}
