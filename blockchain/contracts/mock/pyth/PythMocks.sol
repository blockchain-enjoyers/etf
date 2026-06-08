// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

// Force Hardhat to compile the Pyth SDK's MockPyth so it is available as an artifact in tests
// (it is not imported by any production contract, only the PythSource test deploys it).
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
