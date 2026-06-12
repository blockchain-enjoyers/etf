// T7 — for every demo stock register the two committee-signed price sources (weekday + weekend
// UniversalSignedSource) on the PriceAggregator, and set the keeper committee on those sources.
// After this, each constituent has sourceCount==2 -> FairValueNAV.navOf can return safe=true when fed
// keeper-signed payloads. Owner-gated; idempotent (skips already-registered sources / committee).
import { ethers } from "hardhat";
import { getDeployer, loadConfig, requireAddress } from "./_shared";
import { Wallet } from "ethers";

function committeeFromEnv(): { addrs: string[]; threshold: number } {
  const keys = (process.env.KEEPER_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error("set KEEPER_KEYS (comma-separated committee privkeys) in blockchain/.env");
  const addrs = keys.map((k) => new Wallet(k).address).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return { addrs, threshold: addrs.length };
}

export async function registerSources() {
  console.log("== T7: register weekday+weekend signed sources for every demo stock ==");
  await getDeployer();
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "colleague"));
  const weekday = requireAddress(config, "UniversalSignedSource", "colleague");
  const weekend = requireAddress(config, "UniversalSignedSourceWeekend", "colleague");

  // 1. Set the keeper committee on both signed sources (we own them). Idempotent: skip if already ours.
  const { addrs, threshold } = committeeFromEnv();
  console.log(`  committee: [${addrs.join(", ")}] threshold=${threshold}`);
  for (const [label, src] of [["weekday", weekday], ["weekend", weekend]] as const) {
    const s = await ethers.getContractAt("UniversalSignedSource", src);
    const already = (await s.threshold()) === BigInt(threshold) && (await s.isCommittee(addrs[0]));
    if (!already) {
      console.log(`  setCommittee on ${label} ${src}`);
      await (await s.setCommittee(addrs, threshold)).wait();
    } else {
      console.log(`  ${label} committee already set (skip)`);
    }
  }

  // 2. addSource(weekday) + addSource(weekend) for every demo stock. Idempotent via isSource.
  const stocks = (config.params as any)?.demo?.stocks ?? {};
  const assets: { ticker: string; address: string }[] = Object.entries(stocks).map(([ticker, v]: any) => ({ ticker, address: v.address }));
  let added = 0;
  for (const { ticker, address } of assets) {
    for (const src of [weekday, weekend]) {
      if (!(await agg.isSource(address, src))) {
        await (await agg.addSource(address, src)).wait();
        added++;
      }
    }
    const n = await agg.sourceCount(address);
    if (added % 20 === 0 || n < 2n) console.log(`  ${ticker} ${address} sourceCount=${n}`);
  }
  console.log(`\nOK: registered sources (${added} addSource txs) for ${assets.length} stocks; each has 2 signed sources.`);
}

if (require.main === module) {
  registerSources().catch((e) => { console.error(e); process.exitCode = 1; });
}
