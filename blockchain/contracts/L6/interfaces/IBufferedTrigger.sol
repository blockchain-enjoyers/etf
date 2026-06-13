// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IBufferedTrigger {
    function checkTrigger(
        address vault,
        address[] calldata heldTokens,
        bytes[][] calldata payloads,
        uint256 driftBps,
        uint256 cardinality
    ) external returns (bool);
}
