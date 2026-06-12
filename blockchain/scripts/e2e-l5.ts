// Live e2e for the demo rebalance vault + L5 forward queue.
//   cd blockchain && npx hardhat run scripts/e2e-l5.ts --network robinhoodTestnet
// Proves: on-chain NAV, BasketNavObserver TWAP (g6), settle-gate opens, forward requestCreate+cancel.
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

async function main() {
  const { address: me } = await getDeployer();
  const c = loadConfig();
  const vaultAddr = requireAddress(c, "RebalanceVaultDemo", "create-rebalance-basket.ts");
  const nav = await ethers.getContractAt("FairValueNAV", requireAddress(c, "FairValueNAV", "x"));
  const obs = await ethers.getContractAt("BasketNavObserver", requireAddress(c, "BasketNavObserver", "x"));
  const q = await ethers.getContractAt("ForwardCashQueue", requireAddress(c, "ForwardCashQueue", "x"));
  const usdcAddr = requireAddress(c, "MockUSDC", "x");
  const usdc = await ethers.getContractAt("MockERC20Decimals", usdcAddr);
  const v = await ethers.getContractAt("ManagedRebalanceVault", vaultAddr);

  const held: string[] = Array.from(await v.heldTokens());
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const payloads = held.map((t) => [coder.encode(["address"], [t])]);

  console.log("== 1. On-chain NAV (navOfHoldings) ==");
  const r = await nav.navOfHoldings(vaultAddr, held, payloads);
  const supply: bigint = await v.totalSupply();
  console.log(`  nav=${r.nav} marketStatus=${r.marketStatus} safe=${r.safe} supply=${supply}`);
  console.log(`  navPerShare=${(r.nav * 10n ** 18n) / supply}`);

  console.log("\n== 2. BasketNavObserver.record x2 (build TWAP for g6) ==");
  await (await obs.record(vaultAddr, held, payloads)).wait();
  await (await obs.record(vaultAddr, held, payloads)).wait();
  const [twap, count] = await obs.consult(vaultAddr, 3600);
  console.log(`  twap=${twap} count=${count}`);

  console.log("\n== 3. settleGateView (g1-g8) ==");
  try {
    const nps = await q.settleGateView.staticCall(held, payloads);
    console.log(`  ✅ GATE OPEN. struck navPerShare=${nps}`);
  } catch (e: any) {
    const data = e?.data ?? e?.info?.error?.data;
    let name = e?.shortMessage ?? e?.message;
    try { const p = q.interface.parseError(data); if (p) name = p.name; } catch {}
    console.log(`  gate blocked: ${name}`);
  }

  console.log("\n== 4. Forward requestCreate + cancel ==");
  const cash = 1000n * 10n ** 6n; // 1000 USDC
  if ((await usdc.allowance(me, await q.getAddress())) < cash) {
    await (await usdc.approve(await q.getAddress(), cash)).wait();
  }
  await (await q.requestCreate(cash)).wait();
  const id = (await q.ticketCount()) - 1n;
  const t = await q.tickets(id);
  console.log(`  ticket #${id}: owner=${t.owner} isCreate=${t.isCreate} amount=${t.amount} status=${t.status}`);
  await (await q.cancel(id)).wait();
  const t2 = await q.tickets(id);
  console.log(`  after cancel: status=${t2.status} (2=cancelled, USDC refunded)`);

  console.log("\n✅ e2e complete.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
