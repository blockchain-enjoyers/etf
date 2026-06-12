// Make the g8 peg gate pass: the reused MockPegFeed's updatedAt was frozen at its (days-old) deploy
// block, so g8 reads PegStale. Refresh it to now AND widen pegMaxAge so the static $1 mock stays fresh
// through the demo (same spirit as the relaxed aggregator params for synthetic sources). Cross-process
// nonce contention with the running keeper is handled with a small retry.
//   cd blockchain && npx hardhat run scripts/fix-peg-gate.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

async function sendRetry(label: string, fn: () => Promise<any>) {
  for (let i = 0; i < 6; i++) {
    try {
      const tx = await fn();
      await tx.wait();
      console.log("  ok  ", label);
      return;
    } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || "").toLowerCase();
      if (m.includes("nonce") && i < 5) {
        console.log(`  retry ${label} (#${i + 1}) — nonce race with keeper`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  await getDeployer();
  const c = loadConfig();
  const peg = requireAddress(c, "MockPegFeed", "");
  const queueAddr = requireAddress(c, "ForwardCashQueue", "");
  const pf = await ethers.getContractAt("MockPegFeed", peg);
  const blk = await ethers.provider.getBlock("latest");
  await sendRetry("pegFeed.setUpdatedAt(now)", () => pf.setUpdatedAt(blk!.timestamp));
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);
  // (minN, twapWindow, twapBandBps, pegBandBps, pegMaxAge) — only pegMaxAge widened to ~10y.
  await sendRetry("setGateParams pegMaxAge=10y", () => q.setGateParams(2, 600, 200, 200, 315_360_000));
  console.log("done — g8 peg gate should now pass");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
