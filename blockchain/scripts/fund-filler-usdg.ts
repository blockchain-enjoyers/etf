// Mint USDG to the MockAPFiller so it can pay out cash-REDEEM tickets (settle's onRedeem pays the redeemer
// in USDG from the filler's own balance). CREATE tickets do NOT need this — there the filler RECEIVES USDG.
// USDG is MockERC20Decimals with an open mint(), so this just tops the filler up to a target.
//
//   cd blockchain && npx hardhat run scripts/fund-filler-usdg.ts --network robinhoodTestnet
//   AMOUNT=1000000   # whole USDG to top the filler up to (default 1,000,000). 18-dec.
//
// Idempotent: mints only the shortfall to the target.
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

async function main() {
  await getDeployer();
  const config = loadConfig();
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const fillerAddr = requireAddress(config, "MockAPFiller", "deploy-ap-filler.ts");
  const target = ethers.parseUnits(process.env.AMOUNT ?? "1000000", 18);

  const token = await ethers.getContractAt("MockERC20Decimals", usdg);
  const bal: bigint = await token.balanceOf(fillerAddr);
  if (bal >= target) {
    console.log(`filler ${fillerAddr} already holds ${ethers.formatUnits(bal, 18)} USDG (>= target)`);
    return;
  }
  await (await token.mint(fillerAddr, target - bal)).wait();
  console.log(`✅ minted ${ethers.formatUnits(target - bal, 18)} USDG to filler ${fillerAddr} (now ${ethers.formatUnits(target, 18)})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
