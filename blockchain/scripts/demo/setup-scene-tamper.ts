// Enable real on-chain tamper on the demo SCENE (MSTRx/TSLAx/NVDAx): register the settable MockSource
// as a 3rd source on each scene token (it is NOT registered on the active aggregator after the redeploy),
// and seed it fresh at the keeper price. Idempotent.
//   cd blockchain && npx hardhat run scripts/demo/setup-scene-tamper.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "../deploy/_shared";

const DEPTH = 5_000_000n * 10n ** 18n;
const E18 = 10n ** 18n;
const AMM_TWAP = 1;

async function main() {
  await getDeployer();
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "deploy-l4.ts"));
  const demo = (config.params as any).demo;
  const scene = demo.scene as { stocks: string[]; sharedSource: string; names: string[] };
  const stocksTable = demo.stocks as Record<string, { address: string; priceUsd: number }>;
  const priceFor = (addr: string): bigint => {
    const hit = Object.values(stocksTable).find((s) => s.address.toLowerCase() === addr.toLowerCase());
    // scene tickers (MSTRx…) may not be in the 300-table; default to a sane demo price.
    return hit ? BigInt(Math.round(hit.priceUsd * 1e8)) * (E18 / 100000000n) : 100n * E18;
  };
  const mock = await ethers.getContractAt("MockSource", scene.sharedSource);
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, string> = {};
  for (const token of scene.stocks) {
    out[token.toLowerCase()] = scene.sharedSource;
    if (!(await agg.isSource(token, scene.sharedSource))) {
      await (await agg.addSource(token, scene.sharedSource)).wait();
    }
    // seed the (shared) mock fresh at this token's price so it counts until deliberately tampered
    await (await mock.set(priceFor(token), DEPTH, now, AMM_TWAP, 0, true, true)).wait();
    console.log(`scene ${token} sourceCount=${await agg.sourceCount(token)}`);
  }
  console.log("\nDEMO_SCENE=" + JSON.stringify(out));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
