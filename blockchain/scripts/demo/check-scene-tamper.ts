// Verify scene tamper: each scene token sourceCount==3; a >2% mock nudge is dropped while the median holds.
//   cd blockchain && npx hardhat run scripts/demo/check-scene-tamper.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "../deploy/_shared";

async function main() {
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "x"));
  const scene = (config.params as any).demo.scene as { stocks: string[]; sharedSource: string };
  const mock = await ethers.getContractAt("MockSource", scene.sharedSource);
  const KEEPER = process.env.KEEPER_URL ?? "http://localhost:8787";
  for (const token of scene.stocks) {
    const reports = await fetch(`${KEEPER}/reports?assets=${token}`).then((r) => r.json());
    const rep = (reports as any)[token.toLowerCase()] ?? (reports as any)[token];
    const payloads = [rep.weekday, rep.weekend, "0x"]; // weekday, weekend, mock(ignored)
    const before = await agg.priceOf.staticCall(token, payloads);
    console.log(`${token} sourceCount=${await agg.sourceCount(token)} median=${before.price} safe=${before.safe}`);
    const cur = (await mock.read.staticCall("0x")).price as bigint;
    await (await mock.setPrice((cur * 130n) / 100n)).wait(); // +30% tamper
    const after = await agg.priceOf.staticCall(token, payloads);
    console.log(`  after +30% mock: median=${after.price} safe=${after.safe} (expect ~unchanged, safe=true)`);
    await (await mock.setPrice(cur)).wait(); // restore
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
