// Shared helpers for the Meridian layered deploy scripts (deploy-l1/l2/l4 + deploy-all).
//
// Every layer script is independently runnable AND composable:
//   npx hardhat run scripts/deploy/deploy-l1.ts  --network robinhoodTestnet
//   npx hardhat run scripts/deploy/deploy-all.ts --network robinhoodTestnet
//
// Addresses + tx metadata are recorded into config/testnet.json under `deployments.<Name>`
// so the backend/frontend/scripts read them without parsing logs. Re-running is idempotent:
// an already-recorded contract is REUSED (logged "reused") unless REDEPLOY=1 is set. Config is
// flushed after every deploy, so a half-finished run resumes where it stopped.
//
// Env knobs:
//   REDEPLOY=1         force fresh deploys even if an address is already recorded
//   DEPLOY_CONFIG=...  write to a different json (used for dry-runs against the hardhat network)
import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_PATH =
  process.env.DEPLOY_CONFIG ?? join(__dirname, "..", "..", "config", "testnet.json");
export const EXPLORER = "https://explorer.testnet.chain.robinhood.com/address/";

// Tunables (uint256/uint8 constructor params). Override per-deploy via config.params.
export const DEFAULTS = {
  schemaVersion: 11, // Chainlink Data Streams report schema (v11 equity).
  sequencerGracePeriod: 3600, // sec of "Degraded" after an L2 sequencer restart.
  stalenessThreshold: 3600, // max reading age before Open -> Halted (weekday heartbeat + buffer).
  depthTier: (5_000_000n * 10n ** 18n).toString(), // synthetic depth for the oracle-only L2 source (1e18).
};

export type Deployment = {
  address: string;
  deployer?: string;
  txHash?: string | null;
  block?: number | null;
  deployedAt?: string;
  args?: unknown[];
};
export type Config = {
  networkName?: string;
  chainId?: number;
  params?: Record<string, unknown>;
  deployments?: Record<string, Deployment>;
};

const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function loadConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}
export function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, jsonReplacer, 2) + "\n");
}

/// Resolve the deployer signer, print network/balance, and guard against a 0-balance account.
export async function getDeployer() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer — set PRIVATE_KEY in blockchain/.env");
  const addr = await deployer.getAddress();
  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(addr);
  console.log(`Network:  ${network.name} (chainId ${net.chainId})`);
  console.log(`Deployer: ${addr}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);
  if (balance === 0n) {
    throw new Error(`Deployer ${addr} has 0 balance — fund it from the testnet faucet first.`);
  }
  return { deployer, address: addr };
}

/// Deploy `factoryName` with `args`, OR reuse the recorded address (unless REDEPLOY=1).
/// `key` is the config.deployments key (defaults to the contract name). Returns the address.
export async function ensure(
  config: Config,
  factoryName: string,
  args: unknown[] = [],
  deployerAddr = "",
  key = factoryName,
): Promise<string> {
  const existing = config.deployments?.[key];
  if (existing && !process.env.REDEPLOY) {
    console.log(`  ${key.padEnd(20)} ${existing.address}  (reused)`);
    return existing.address;
  }

  const Factory = await ethers.getContractFactory(factoryName);
  const contract = await Factory.deploy(...(args as never[]));
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = tx ? await tx.wait() : null;
  console.log(`  ${key.padEnd(20)} ${address}  (block ${receipt?.blockNumber ?? "?"})`);

  config.deployments ??= {};
  config.deployments[key] = {
    address,
    deployer: deployerAddr,
    txHash: tx?.hash ?? null,
    block: receipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
    args: args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
  };
  saveConfig(config); // flush incrementally so a partial run is resumable
  return address;
}

/// Read a previously recorded deployment address; throw a helpful error if a prior layer is missing.
export function requireAddress(config: Config, key: string, hint: string): string {
  const addr = config.deployments?.[key]?.address;
  if (!addr) throw new Error(`${key} not deployed — run ${hint} first.`);
  return addr;
}
