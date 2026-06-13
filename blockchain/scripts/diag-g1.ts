// One-off g1 diagnostic for a vault's forward queue: prints, per held token, whether the queue's
// FeedRouter has a feedId and whether the aggregator has the weekday source registered.
//   cd blockchain && QUEUE=0x.. VAULT=0x.. npx hardhat run scripts/diag-g1.ts --network robinhoodTestnet
import { ethers } from "hardhat";

async function main() {
  const queueAddr = process.env.QUEUE!;
  const vaultAddr = process.env.VAULT!;
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);
  const v = await ethers.getContractAt("ManagedRebalanceVault", vaultAddr);

  const routerAddr: string = await q.router();
  const aggAddr: string = await q.aggregator();
  const l2Src: string = await q.l2RouterSource();
  const router = await ethers.getContractAt("MockFeedRouter", routerAddr);
  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);

  console.log(`queue=${queueAddr}`);
  console.log(`router=${routerAddr} aggregator=${aggAddr} l2RouterSource=${l2Src}\n`);

  const held: string[] = Array.from(await v.heldTokens());
  for (const t of held) {
    const feed: string = await router.feedIdOf(t);
    const hasFeed = feed !== ethers.ZeroHash;
    const isSrc: boolean = await agg.isSource(t, l2Src);
    const sc: bigint = await agg.sourceCount(t);
    console.log(
      `${t}  feedSet=${hasFeed ? "YES" : "NO (g1 FeedNotSet)"}  weekdaySource=${isSrc ? "YES" : "NO (g1 L2SourceMissing)"}  sourceCount=${sc}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
