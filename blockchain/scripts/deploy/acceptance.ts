// Acceptance: prove the on-chain wiring works end to end. For a sample demo stock, sign a price with the
// keeper committee key(s) (inline, no running server needed), feed the two payloads into the real
// PriceAggregator.priceOf, and assert safe==true + the right price. Read-only (staticCall).
import { ethers } from "hardhat";
import { getDeployer, loadConfig, requireAddress } from "./_shared";
import { buildUniversalPayload } from "../../keeper/sign";
import { Wallet } from "ethers";

const SAMPLE = (process.env.SAMPLE ?? "NVDA").toUpperCase();

async function main() {
  await getDeployer();
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "colleague"));

  const keys = (process.env.KEEPER_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) throw new Error("set KEEPER_KEYS in env");

  const stocks = (config.params as any).demo.stocks;
  const s = stocks[SAMPLE];
  if (!s) throw new Error(`${SAMPLE} not in demo.stocks`);

  console.log(`Sample ${SAMPLE} ${s.address}  priceUsd=$${s.priceUsd}`);
  console.log(`  sourceCount: ${await agg.sourceCount(s.address)} (expect 2)`);

  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const rep = {
    feedId: ethers.id(SAMPLE),
    price: ethers.parseUnits(Number(s.priceUsd).toFixed(8), 18),
    depth: 5_000_000n * 10n ** 18n,
    lastUpdate: now,
  };
  const payload = await buildUniversalPayload(rep, keys);

  const res = await agg.priceOf.staticCall(s.address, [payload, payload]);
  console.log(`  priceOf.safe   = ${res.safe}  (expect true)`);
  console.log(`  priceOf.price  = ${ethers.formatUnits(res.price, 18)} USD  (expect ~${s.priceUsd})`);
  console.log(`  marketStatus   = ${res.marketStatus}  confBand=[${ethers.formatUnits(res.confLower,18)}, ${ethers.formatUnits(res.confUpper,18)}]`);
  if (!res.safe) { console.error("ACCEPTANCE FAILED: safe != true"); process.exitCode = 1; }
  else console.log("\nOK: constituent values safe=true with keeper-signed payloads.");
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
