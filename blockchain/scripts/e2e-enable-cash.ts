// Live e2e for the self-serve "Enable cash settlement" feature (Path B).
//   cd blockchain && API_URL=http://localhost:3000 VAULT=0x.. npx hardhat run scripts/e2e-enable-cash.ts --network robinhoodTestnet
//
// Proves the full manager flow against a RUNNING backend + the testnet:
//   1. the deployer (== the demo vault manager) signs an EIP-712 EnableCashSettlement request,
//   2. POST /baskets/:vault/forward/enable  -> { status: "pending" } (backend verifies signer == vault.manager()),
//   3. poll GET .../forward/enable/status until "live" (the meridian-key orchestration deploys + wires a ForwardCashQueue),
//   4. assert the on-chain settle gate is reachable and (optionally) round-trip a small forward requestCreate + cancel.
//
// Prereqs (user-gated — this performs real testnet writes via the platform key inside the backend):
//   - the backend is up and reachable at API_URL with KEEPER_PRIVATE_KEY (the meridian/owner key) configured,
//   - the deployer key in blockchain/.env is the manager of VAULT (true for the demo vaults it created).
import { ethers, network } from "hardhat";
import { loadConfig, getDeployer } from "./deploy/_shared";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

// Canonical 10-field params (defaults — same order/encoding as backend paramsHashOf + SDK paramsHash).
const PARAMS = {
  minPrints: 2,
  twapWindowSec: 600,
  twapBandBps: 200,
  pegBandBps: 200,
  pegMaxAgeSec: 3600,
  cutoffDelaySec: 600,
  spreadBps: 0,
  capacityBps: 0,
  keeperTip: "0", // 18-dec USDG base units
  keeperBps: 0,
};

function paramsHash(): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    coder.encode(Array.from({ length: 10 }, () => "uint256"), [
      BigInt(PARAMS.minPrints),
      BigInt(PARAMS.twapWindowSec),
      BigInt(PARAMS.twapBandBps),
      BigInt(PARAMS.pegBandBps),
      BigInt(PARAMS.pegMaxAgeSec),
      BigInt(PARAMS.cutoffDelaySec),
      BigInt(PARAMS.spreadBps),
      BigInt(PARAMS.capacityBps),
      BigInt(PARAMS.keeperTip),
      BigInt(PARAMS.keeperBps),
    ]),
  );
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function resolveVault(): string {
  if (process.env.VAULT) return process.env.VAULT;
  const c = loadConfig();
  // Prefer an explicit managed/rebalance demo vault key; fall back to the recorded ManagedRebalanceVault.
  const d = c.deployments ?? {};
  const addr =
    d["RebalanceVaultDemo"]?.address ?? d["ManagedRebalanceVault"]?.address ?? "";
  if (!addr) throw new Error("No VAULT env and no RebalanceVaultDemo/ManagedRebalanceVault in config — set VAULT=0x..");
  return addr;
}

async function main() {
  const { deployer, address: me } = await getDeployer();
  const net = await ethers.provider.getNetwork();
  const vault = resolveVault();
  console.log(`Backend:  ${API_URL}`);
  console.log(`Vault:    ${vault}`);

  // Sanity: the signer must be the vault manager, else the backend rejects with 401.
  const v = await ethers.getContractAt("ManagedRebalanceVault", vault);
  const manager: string = await v.manager();
  console.log(`Manager:  ${manager} (signer ${me})`);
  if (manager.toLowerCase() !== me.toLowerCase()) {
    throw new Error(`signer ${me} is not vault.manager() ${manager} — run with the manager key`);
  }

  console.log("\n== 1. Sign EIP-712 EnableCashSettlement ==");
  const nonce = BigInt(Date.now());
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const domain = { name: "Meridian", version: "1", chainId: Number(net.chainId), verifyingContract: vault };
  const types = {
    EnableCashSettlement: [
      { name: "vault", type: "address" },
      { name: "paramsHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const message = { vault, paramsHash: paramsHash(), nonce, expiry };
  const signature = await deployer.signTypedData(domain, types, message);
  console.log(`  paramsHash=${message.paramsHash}`);
  console.log(`  nonce=${nonce} expiry=${expiry}`);

  console.log("\n== 2. POST /forward/enable ==");
  const enableRes = await fetch(`${API_URL}/baskets/${vault}/forward/enable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: PARAMS, nonce: nonce.toString(), expiry, signature }),
  });
  const enableBody = await enableRes.text();
  if (!enableRes.ok) throw new Error(`enable POST -> ${enableRes.status} ${enableBody}`);
  console.log(`  ${enableRes.status} ${enableBody}`);

  console.log("\n== 3. Poll /forward/enable/status until live ==");
  let status = "pending";
  let queueAddress: string | undefined;
  for (let i = 0; i < 60 && status !== "live" && status !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = (await getJson(`${API_URL}/baskets/${vault}/forward/enable/status`)) as {
      status: string;
      step?: string;
      queueAddress?: string;
      error?: string;
    };
    status = s.status;
    queueAddress = s.queueAddress;
    console.log(`  [${i}] status=${s.status}${s.step ? ` step=${s.step}` : ""}${s.error ? ` error=${s.error}` : ""}`);
  }
  if (status !== "live") throw new Error(`enable did not reach live (last status=${status})`);
  console.log(`  ✅ live. queue=${queueAddress}`);

  console.log("\n== 4. On-chain settle gate (post-wiring) ==");
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddress!);
  const held: string[] = Array.from(await v.heldTokens());
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const payloads = held.map((t) => [coder.encode(["address"], [t])]);
  try {
    const nps = await q.settleGateView.staticCall(held, payloads);
    console.log(`  ✅ GATE OPEN. struck navPerShare=${nps}`);
  } catch (e: unknown) {
    const err = e as { shortMessage?: string; message?: string; data?: string };
    let name = err.shortMessage ?? err.message ?? "unknown";
    try {
      const p = q.interface.parseError(err.data ?? "0x");
      if (p) name = p.name;
    } catch {
      /* not a known custom error */
    }
    console.log(`  gate blocked (expected until the keeper seeds fresh prints): ${name}`);
  }

  console.log("\n✅ enable-cash e2e complete.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
