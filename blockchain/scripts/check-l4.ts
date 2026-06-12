// Smoke: committee-signed payloads through PriceAggregator.priceOf (open + closed scenarios).
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./deploy/_shared";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const coder = ethers.AbiCoder.defaultAbiCoder();
function signPayload(pk: string, feedId: string, price: bigint, depth: bigint, lastUpdate: bigint) {
  const digest = ethers.keccak256(coder.encode(
    ["string", "bytes32", "uint256", "uint256", "uint64"],
    ["universal", feedId, price, depth, lastUpdate]));
  const sig = new ethers.SigningKey(pk).sign(digest);
  return coder.encode(["bytes32","uint256","uint256","uint64","bytes32[]","bytes32[]","uint8[]"],
    [feedId, price, depth, lastUpdate, [sig.r], [sig.s], [sig.v]]);
}
async function main() {
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "x"));
  const pk = process.env.PRIVATE_KEY!;
  const feedId = ethers.zeroPadValue(TSLA, 32);
  const depth = 5_000_000n * 10n ** 18n;
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const open = await agg.priceOf.staticCall(TSLA, [
    signPayload(pk, feedId, 315n * 10n ** 18n, depth, now - 30n),
    signPayload(pk, feedId, 3151n * 10n ** 17n, depth, now)]);
  console.log("OPEN  : price=", ethers.formatUnits(open.price, 18), "status=", open.marketStatus.toString(), "safe=", open.safe);
  const closed = await agg.priceOf.staticCall(TSLA, [
    signPayload(pk, feedId, 315n * 10n ** 18n, depth, now - 100_000n),
    signPayload(pk, feedId, 314n * 10n ** 18n, depth, now)]);
  console.log("CLOSED: price=", ethers.formatUnits(closed.price, 18), "status=", closed.marketStatus.toString(), "safe=", closed.safe);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
