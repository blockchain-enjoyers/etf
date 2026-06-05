import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";

// Meridian contracts — Hardhat 2.
// Solidity 0.8.28: compatible with the mocks (pragma ^0.8.20) and OpenZeppelin v5.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OZ v5.1 uses the `mcopy` opcode -> requires the Cancun EVM.
      evmVersion: "osaka",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  abiExporter: {
    path: "./abi",
    runOnCompile: true,
    clear: true,
    flat: false,
    spacing: 2,
  },
  networks: {
    hardhat: {},
  },
};

export default config;
