// Fund (+ optionally approve) the MockAPFiller so ForwardCashQueue.settle (create) can source baskets from it.
// On a create settle the queue PULLS each constituent from the AP via transferFrom, so the filler must
// (a) HOLD the constituents and (b) have approved the queue. The queue approval is now AUTOMATED by the
// backend (LiveForwardSettleWriter.approve self-approves per vault at first settle), so for judge-created
// vaults you only need to fund the filler's inventory — which is what CATALOG mode does up front.
//
//   # Per-vault (funds the vault's held constituents + approves its queue — full manual path):
//   cd blockchain && VAULT=0x.. QUEUE=0x.. npx hardhat run scripts/prepare-ap-filler.ts --network robinhoodTestnet
//
//   # Catalog-wide (funds EVERY catalog token once, so any judge-created vault can be sourced; the backend
//   # auto-approves the queue at settle, no per-vault script needed):
//   cd blockchain && CATALOG=1 npx hardhat run scripts/prepare-ap-filler.ts --network robinhoodTestnet
//   STOCKS=NVDA,AAPL,0x12ab..   # (catalog mode) only these tickers/addresses
//   LIMIT=50                     # (catalog mode) only the first N catalog tokens
//
//   AMOUNT=1000   # whole tokens to top each constituent up to on the filler (default 1000 — generous)
//
// vault->queue lives in the backend (FORWARD_QUEUES env / DB), not this config, so pass both explicitly.
// Idempotent: tops up only the shortfall; per-vault mode re-approves (max) each run.
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

const MINTER_ROLE = ethers.id("MINTER_ROLE");
const heldAbi = ["function heldTokens() view returns (address[])"];

/** Every catalog stock the create-wizard offers (ticker-keyed) + the scene stocks, with optional subset/limit. */
function catalogTokens(config: ReturnType<typeof loadConfig>): { ticker: string; address: string }[] {
  const demo = (config.params?.["demo"] ?? {}) as {
    stocks?: Record<string, { address: string }>;
    scene?: { stocks?: string[] };
  };
  let entries = Object.entries(demo.stocks ?? {}).map(([ticker, v]) => ({ ticker, address: v.address }));
  for (const a of demo.scene?.stocks ?? []) {
    if (!entries.some((e) => e.address.toLowerCase() === a.toLowerCase())) entries.push({ ticker: "scene", address: a });
  }
  if (process.env.STOCKS) {
    const want = new Set(process.env.STOCKS.split(",").map((s) => s.trim().toLowerCase()));
    entries = entries.filter((e) => want.has(e.ticker.toLowerCase()) || want.has(e.address.toLowerCase()));
  }
  if (process.env.LIMIT) entries = entries.slice(0, Number(process.env.LIMIT));
  return entries;
}

async function main() {
  const catalog = process.env.CATALOG === "1" || process.env.CATALOG === "true";
  const vault = process.env.VAULT;
  const queue = process.env.QUEUE;
  if (!catalog && (!vault || !queue)) {
    throw new Error("set VAULT=0x.. and QUEUE=0x.. (per-vault), or CATALOG=1 to fund every catalog token");
  }
  const amount = ethers.parseUnits(process.env.AMOUNT ?? "1000", 18);

  const { address: me } = await getDeployer();
  const config = loadConfig();
  const fillerAddr = requireAddress(config, "MockAPFiller", "deploy-l5.ts");
  const registryAddr = requireAddress(config, "AccessControlsRegistry", "deploy-demo-stocks.ts");
  const filler = await ethers.getContractAt("MockAPFiller", fillerAddr);

  // Token set: catalog mode funds every offered token (queue auto-approved by the backend at settle);
  // per-vault mode funds + approves just this vault's held constituents.
  let tokens: { ticker: string; address: string }[];
  if (catalog) {
    tokens = catalogTokens(config);
    if (tokens.length === 0) throw new Error("no catalog tokens (params.demo.stocks / scene) to fund");
    console.log(`AP filler ${fillerAddr} <- ${tokens.length} CATALOG token(s); queue approval is backend-automated\n`);
  } else {
    const held: string[] = Array.from(await (await ethers.getContractAt(heldAbi, vault!)).heldTokens());
    if (held.length === 0) throw new Error(`vault ${vault} has no held tokens — is it bootstrapped?`);
    tokens = held.map((address) => ({ ticker: "held", address }));
    console.log(`AP filler ${fillerAddr} <- ${held.length} constituent(s) of ${vault}, queue ${queue}\n`);
  }

  // Catalog stocks are role-gated (mint = MINTER_ROLE); ensure the deployer (registry admin) can mint.
  const reg = await ethers.getContractAt("AccessControlsRegistry", registryAddr);
  if (!(await reg.hasRole(MINTER_ROLE, me))) {
    await (await reg.grantRole(MINTER_ROLE, me)).wait();
    console.log(`granted MINTER_ROLE to ${me}`);
  }

  const MAX = ethers.MaxUint256;
  for (const { ticker, address: t } of tokens) {
    const token = await ethers.getContractAt("Stock", t);
    const bal: bigint = await token.balanceOf(fillerAddr);
    if (bal < amount) {
      try {
        await (await token.mint(fillerAddr, amount - bal)).wait();
        console.log(`  ${ticker.padEnd(6)} ${t} funded += ${ethers.formatUnits(amount - bal, 18)}`);
      } catch (e) {
        console.log(`  ${ticker.padEnd(6)} ${t} mint FAILED (${(e as Error).message}) — fund the filler manually`);
      }
    } else {
      console.log(`  ${ticker.padEnd(6)} ${t} already holds >= ${ethers.formatUnits(amount, 18)}`);
    }
    if (!catalog) {
      await (await filler.approveConstituent(t, queue!, MAX)).wait();
      console.log(`  ${ticker.padEnd(6)} ${t} approved queue to pull`);
    }
  }

  console.log(
    catalog
      ? `\n✅ AP filler holds the catalog. Any judge-created vault settles once the backend auto-approves its queue.`
      : `\n✅ AP filler ready for ${vault}. settle can now source the basket (run forward-settle / wait for the cron).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
