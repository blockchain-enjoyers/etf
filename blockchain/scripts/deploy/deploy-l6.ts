import { ethers } from "hardhat";

// Addresses of the already-deployed layers (fill from your testnet manifest / env before running).
const NAV = process.env.FAIR_VALUE_NAV ?? "";          // L4 FairValueNAV
const AGGREGATOR = process.env.PRICE_AGGREGATOR ?? ""; // L4 PriceAggregator
const REB_MODULE = process.env.REBALANCE_MODULE ?? ""; // L3 RebalanceModule
const AUCTION = process.env.REBALANCE_AUCTION ?? "";   // L3 RebalanceAuction
const SEQ_FEED = process.env.SEQUENCER_FEED ?? ethers.ZeroAddress; // 0 => gate disabled (testnet)
const SEQ_REQUIRED = (process.env.SEQUENCER_REQUIRED ?? "false") === "true";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying L6 from", deployer.address);

  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(SEQ_FEED, SEQ_REQUIRED);
  await seq.waitForDeployment();
  console.log("SequencerGuard:", await seq.getAddress());

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(NAV, AGGREGATOR, REB_MODULE, await seq.getAddress(), AUCTION);
  await guard.waitForDeployment();
  console.log("BufferedTriggerGuard:", await guard.getAddress());

  console.log("\nNext (per vault, manual): ");
  console.log("  guard.setVaultCfg(vault, weekend247, eMaxBps, minDepth, grace)");
  console.log("  auction.setExecMode(vault, 1 /*ALLOWLIST*/)  // manager");
  console.log("  auction.setOpenAllow(vault, guard, true)      // manager");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
