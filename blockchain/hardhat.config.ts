import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";
import * as fs from "fs";
import * as path from "path";

// Minimal .env loader (no dotenv dependency). Reads blockchain/.env if present.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

const ROBINHOOD_TESTNET_RPC = process.env.ROBINHOOD_TESTNET_RPC ?? "";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

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
    // Robinhood Chain Testnet — see config/testnet.json. Secrets from blockchain/.env.
    robinhoodTestnet: {
      url: ROBINHOOD_TESTNET_RPC,
      chainId: 46630,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
