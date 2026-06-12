// Bridge: blockchain/ (Hardhat) -> packages/contracts/src/{abis.ts,addresses.ts}
// Reads compiled Hardhat artifacts (ABIs) and optional deployment output (addresses per chain),
// emits typed, committed source. Run: `yarn abi:sync` (after `cd blockchain && npx hardhat compile`).
// Deterministic output so CI can drift-check (regenerate; fail if committed output differs).
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, "blockchain", "artifacts");
const DEPLOYMENTS = join(ROOT, "blockchain", "config");
const OUT_DIR = join(ROOT, "packages", "contracts", "src");
const ABIS_OUT = join(OUT_DIR, "abis.ts");
const ADDRESSES_OUT = join(OUT_DIR, "addresses.ts");

// The on-chain surface the backend + app consume. `sol` is the path under blockchain/contracts/.
// BasketFactory.sol was deleted on-chain (replaced by CloneFactory); it is intentionally gone here.
// L2 (NAVEngine/OracleRouter/CommitmentNAV) was deleted on-chain; L4 is the oracle layer.
const EXPOSE = [
  { name: "CloneFactory", sol: "contracts/L1/CloneFactory.sol" },
  { name: "BasketVault", sol: "contracts/L1/BasketVault.sol" },
  { name: "ManagedVault", sol: "contracts/L1/ManagedVault.sol" },
  { name: "CommittedVault", sol: "contracts/L1/CommittedVault.sol" },
  { name: "FairValueNAV", sol: "contracts/L4/FairValueNAV.sol" },
  { name: "PriceAggregator", sol: "contracts/L4/PriceAggregator.sol" },
  { name: "ChainlinkStreamsSource", sol: "contracts/L4/adapters/ChainlinkStreamsSource.sol" },
  { name: "UniversalSignedSource", sol: "contracts/L4/adapters/UniversalSignedSource.sol" },
  { name: "ManagedRebalanceVault", sol: "contracts/L3/ManagedRebalanceVault.sol" },
  { name: "KeeperModule", sol: "contracts/L3/KeeperModule.sol" },
  { name: "RebalanceAuction", sol: "contracts/L3/RebalanceAuction.sol" },
  { name: "RebalanceObserver", sol: "contracts/L3/RebalanceObserver.sol" },
  { name: "RebalanceModule", sol: "contracts/L3/RebalanceModule.sol" },
  { name: "ForwardCashQueue", sol: "contracts/L5/ForwardCashQueue.sol" },
  { name: "BasketNavObserver", sol: "contracts/L5/BasketNavObserver.sol" },
  { name: "MockAPFiller", sol: "contracts/mock/MockAPFiller.sol" },
  { name: "RegistryRebalanceVault", sol: "contracts/L3/RegistryRebalanceVault.sol" },
  { name: "RegistryCustody", sol: "contracts/L1/recipe/RegistryCustody.sol" },
];

// Names that appear in deployment config as distinct keys but share an existing ABI (no artifact loaded).
// These carry only an address entry in addresses.ts — no *Abi export.
// USDG is the fund-creation / flat-fee token: it must land in addresses.ts so the FE tx-guard
// allowlist accepts the approve(USDG → factory/vault) fee step (deploy.ts / mint.ts).
const ADDRESS_ONLY = ["UniversalSignedSourceWeekend", "MockVerifierProxy", "USDG"];

// Locked chain ids (kept in sync with addresses.ts CHAIN_IDS).
const CHAIN_IDS = { robinhoodChainTestnet: 46630, arbitrumSepolia: 421614 };

// Deployment-file basename -> chainId. The contracts author's deploy scripts write blockchain/config/testnet.json.
const NETWORK_TO_CHAIN_ID = {
  "testnet.json": CHAIN_IDS.robinhoodChainTestnet,
  "robinhoodChainTestnet.json": CHAIN_IDS.robinhoodChainTestnet,
  "arbitrumSepolia.json": CHAIN_IDS.arbitrumSepolia,
};

function fail(msg) {
  console.error(`sync-contracts: ${msg}`);
  process.exit(1);
}

function loadAbis() {
  const out = [];
  for (const { name, sol } of EXPOSE) {
    const path = join(ARTIFACTS, sol, `${name}.json`);
    if (!existsSync(path)) {
      fail(
        `missing artifact ${path}\n  Did you compile? Run: cd blockchain && npx hardhat compile`
      );
    }
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(artifact.abi)) fail(`artifact ${path} has no .abi array`);
    out.push({ name, abi: artifact.abi });
  }
  return out;
}

// Addresses per chainId. Reads blockchain/deployments/<network>.json ({ "<Name>": "0x.." }).
// Missing dir/files => empty maps (no deployment yet). Only EXPOSE-d names are carried over.
function loadAddresses() {
  const byChain = {};
  for (const id of Object.values(CHAIN_IDS)) byChain[id] = {};
  if (!existsSync(DEPLOYMENTS)) return byChain;

  const exposed = new Set([...EXPOSE.map((e) => e.name), ...ADDRESS_ONLY]);
  for (const file of readdirSync(DEPLOYMENTS)) {
    const chainId = NETWORK_TO_CHAIN_ID[file];
    if (chainId === undefined) continue;
    const raw = JSON.parse(readFileSync(join(DEPLOYMENTS, file), "utf8"));
    // Accept both a flat { Name: "0x.." } map and the deploy-tool's nested
    // { deployments: { Name: { address: "0x.." } } } shape.
    const parsed =
      raw && typeof raw.deployments === "object" && raw.deployments
        ? Object.fromEntries(
            Object.entries(raw.deployments).map(([name, v]) => [
              name,
              v && typeof v === "object" ? v.address : v,
            ]),
          )
        : raw;
    const map = {};
    for (const [name, addr] of Object.entries(parsed)) {
      if (!exposed.has(name)) continue;
      if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        fail(`deployments/${file}: ${name} is not a 0x-address: ${String(addr)}`);
      }
      map[name] = addr.toLowerCase();
    }
    byChain[chainId] = map;
  }
  return byChain;
}

function renderAbis(abis) {
  let body =
    "// AUTO-GENERATED by scripts/sync-contracts.mjs — do not edit by hand.\n" +
    "// Source: blockchain/ Hardhat artifacts. Regenerate with `yarn abi:sync`.\n\n";
  for (const { name, abi } of abis) {
    body += `export const ${name}Abi = ${JSON.stringify(abi)} as const;\n\n`;
  }
  return body;
}

function renderAddresses(byChain) {
  const entry = (chainId) => {
    const map = byChain[chainId] ?? {};
    const keys = Object.keys(map).sort();
    if (keys.length === 0) return "{}";
    const inner = keys.map((k) => `    ${JSON.stringify(k)}: "${map[k]}",`).join("\n");
    return `{\n${inner}\n  }`;
  };
  return (
    "// AUTO-GENERATED by scripts/sync-contracts.mjs — do not edit by hand.\n" +
    "// Address maps are filled from blockchain/deployments/*.json; empty until deploy.\n" +
    "// Regenerate with `yarn abi:sync`.\n\n" +
    "export const CHAIN_IDS = {\n" +
    "  robinhoodChainTestnet: 46630,\n" +
    "  arbitrumSepolia: 421614,\n" +
    "} as const;\n\n" +
    "export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];\n\n" +
    "// role/contract -> address per chain. Empty until deployment.\n" +
    "export const addresses: Record<ChainId, Record<string, `0x${string}`>> = {\n" +
    `  [CHAIN_IDS.robinhoodChainTestnet]: ${entry(CHAIN_IDS.robinhoodChainTestnet)},\n` +
    `  [CHAIN_IDS.arbitrumSepolia]: ${entry(CHAIN_IDS.arbitrumSepolia)},\n` +
    "};\n"
  );
}

const abis = loadAbis();
const byChain = loadAddresses();
writeFileSync(ABIS_OUT, renderAbis(abis));
writeFileSync(ADDRESSES_OUT, renderAddresses(byChain));
console.log(
  `sync-contracts: wrote ${abis.length} ABIs -> ${ABIS_OUT}\n` +
    `sync-contracts: wrote addresses -> ${ADDRESSES_OUT}`
);
