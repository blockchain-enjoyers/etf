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
// Solidity 0.8.35: compatible with the mocks (pragma ^0.8.20) and OpenZeppelin v5.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // viaIR MUST stay false — never enable it. It swaps the codegen pipeline for EVERY contract
      // (changes gas + the audited bytecode surface). If a function hits the legacy stack-slot limit,
      // refactor THAT function (group params into a calldata struct, extract a helper) — do not flip
      // this flag.
      viaIR: false,
      // Osaka EVM target (Hardhat default for 0.8.35; supports the mcopy opcode OZ v5 uses).
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
    // Raised block + per-tx gas so the N=500 BasketVault deploy (~22M, one SSTORE per constituent)
    // fits the on-chain NAV gas benchmark (test/L2/gas, behind GAS_BENCH=1).
    hardhat: { blockGasLimit: 100_000_000 },
    // Robinhood Chain Testnet — see config/testnet.json. Secrets from blockchain/.env.
    robinhoodTestnet: {
      url: ROBINHOOD_TESTNET_RPC,
      chainId: 46630,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
