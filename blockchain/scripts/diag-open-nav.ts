// Read-only diagnosis of the freshly redeployed oracle: committee status of both signed sources +
// their registration on the new aggregator. A source with threshold==0 reverts (H3 fail-closed),
// which would revert the whole priceOf → NAV 0/unknown.
//   cd blockchain && npx hardhat run scripts/diag-open-nav.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

async function main() {
  const { address: deployer } = await getDeployer();
  const c = loadConfig();
  const aggAddr = requireAddress(c, "PriceAggregator", "");
  const weekday = requireAddress(c, "UniversalSignedSource", "");
  const weekend = requireAddress(c, "UniversalSignedSourceWeekend", "");
  const tokens: string[] = (c.params as any).demo.stocks;
  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);
  console.log("aggregator", aggAddr);

  for (const [name, addr] of [["weekday", weekday], ["weekend", weekend]] as const) {
    const s = await ethers.getContractAt("UniversalSignedSource", addr);
    const out: Record<string, string> = {};
    for (const [k, fn] of [
      ["threshold", () => s.threshold()],
      ["isCommittee(deployer)", () => s.isCommittee(deployer)],
      ["weekendAware", () => s.weekendAware()],
    ] as const) {
      try { out[k] = String(await fn()); } catch (e: any) { out[k] = "ERR:" + (e?.shortMessage || e?.message); }
    }
    console.log(`  ${name.padEnd(8)} ${addr}  threshold=${out.threshold} isCommittee=${out["isCommittee(deployer)"]} weekendAware=${out.weekendAware}`);
  }

  for (const t of tokens) {
    console.log(`  token ${t} sourceCount=${await agg.sourceCount(t)} isSource(weekday)=${await agg.isSource(t, weekday)} isSource(weekend)=${await agg.isSource(t, weekend)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
