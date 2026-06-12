// Create one vault of EACH non-registry type (static/committed/managed/rebalance) via the live
// CloneFactory, using the 3 demo stocks. Registry already exists (deploy-l5). Idempotent-ish:
// uses a fixed userSalt per type, so re-running with the same recipe collides (skip on revert).
// Run: npx hardhat run scripts/create-all-vaults.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig } from "./deploy/_shared";

const ONE = 10n ** 18n;

async function main() {
  const c = loadConfig();
  const D = c.deployments!;
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("CloneFactory", D.CloneFactory.address);

  // 3 demo stocks, sorted strictly ascending (recipe requirement); 1 unit = 1 of each.
  const pairs = [D.Stock_MSTRx.address, D.Stock_TSLAx.address, D.Stock_NVDAx.address]
    .map((a) => ({ a, q: ONE }))
    .sort((x, y) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
  const tokens = pairs.map((p) => p.a);
  const unitQty = pairs.map((p) => p.q);
  const mgr = signer.address;
  const keeperEscrow = D.KeeperModule.address;

  const out: Record<string, string> = {};

  async function create(label: string, fn: () => Promise<string>) {
    try {
      const addr = await fn();
      out[label] = addr;
      console.log(`  OK  ${label.padEnd(10)} ${addr}`);
    } catch (e: any) {
      console.log(`  !!  ${label.padEnd(10)} ${(e?.shortMessage || e?.message || e).toString().slice(0, 80)}`);
    }
  }

  // static (BasketVault) — createBasket(tokens, unitQty, unitSize, name, symbol, salt)
  await create("static", async () => {
    const salt = ethers.id("v1-static");
    const a = await factory.createBasket.staticCall(tokens, unitQty, ONE, "Static Tri", "TRIs", salt);
    await (await factory.createBasket(tokens, unitQty, ONE, "Static Tri", "TRIs", salt)).wait();
    return a;
  });

  // committed (CommittedVault)
  await create("committed", async () => {
    const salt = ethers.id("v1-committed");
    const a = await factory.createCommittedBasket.staticCall(tokens, unitQty, ONE, "Committed Tri", "TRIc", salt);
    await (await factory.createCommittedBasket(tokens, unitQty, ONE, "Committed Tri", "TRIc", salt)).wait();
    return a;
  });

  // managed (ManagedVault) — struct {tokens, unitQty, unitSize, name, symbol, manager, managerFeeBps}
  await create("managed", async () => {
    const salt = ethers.id("v1-managed");
    const b = { tokens, unitQty, unitSize: ONE, name: "Managed Tri", symbol: "TRIm", manager: mgr, managerFeeBps: 50 };
    const a = await factory.createManagedBasket.staticCall(b, salt);
    await (await factory.createManagedBasket(b, salt)).wait();
    return a;
  });

  // rebalance (ManagedRebalanceVault) — struct + keeperBps + keeperEscrow
  await create("rebalance", async () => {
    const salt = ethers.id("v1-rebalance");
    const b = {
      tokens, unitQty, unitSize: ONE, name: "Rebalance Tri", symbol: "TRIr",
      manager: mgr, managerFeeBps: 50, keeperBps: 250, keeperEscrow,
    };
    const a = await factory.createRebalanceBasket.staticCall(b, salt);
    await (await factory.createRebalanceBasket(b, salt)).wait();
    return a;
  });

  console.log("\ncreated:", JSON.stringify(out, null, 2));
  console.log("registry (existing):", D.RegistryIndex.address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
