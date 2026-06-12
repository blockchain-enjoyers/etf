// Probe the new aggregator's priceOf with committee-signed payloads at different timestamps to confirm
// the staleness-filter hypothesis (NAV 0/unknown = both legs filtered because the backend dated them
// with the snapshot's old market timestamp instead of ~now).
//   cd blockchain && npx hardhat run scripts/probe-priceof.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./deploy/_shared";

const DEPTH = 5_000_000n * 10n ** 18n;
const coder = ethers.AbiCoder.defaultAbiCoder();

function signPayload(wallet: any, feedId: string, price: bigint, lastUpdate: bigint) {
  const digest = ethers.keccak256(
    coder.encode(
      ["string", "bytes32", "uint256", "uint256", "uint64"],
      ["universal", feedId, price, DEPTH, lastUpdate],
    ),
  );
  const sig = wallet.signingKey.sign(digest);
  return coder.encode(
    ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
    [feedId, price, DEPTH, lastUpdate, [sig.r], [sig.s], [sig.v]],
  );
}

async function main() {
  const c = loadConfig();
  const aggAddr = requireAddress(c, "PriceAggregator", "");
  const tokens: string[] = (c.params as any).demo.stocks;
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not in blockchain/.env");
  const wallet = new ethers.Wallet(pk);
  console.log("signer", wallet.address, "agg", aggAddr);
  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);
  const now = Math.floor(Date.now() / 1000);
  const t = tokens[0];
  const feedId = ethers.zeroPadValue(ethers.getAddress(t), 32);
  const price = 200n * 10n ** 18n;
  for (const [label, ts] of [
    ["now", BigInt(now)],
    ["now-120", BigInt(now - 120)],
    ["old(2d)", BigInt(now - 172800)],
  ] as const) {
    const wd = signPayload(wallet, feedId, price, ts);
    const we = signPayload(wallet, feedId, price, ts);
    try {
      const r = await agg.priceOf.staticCall(t, [wd, we]);
      console.log(`  ts=${label.padEnd(8)} price=${r.price} marketStatus=${r.marketStatus} safe=${r.safe}`);
    } catch (e: any) {
      console.log(`  ts=${label.padEnd(8)} REVERT ${e.shortMessage || e.message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
