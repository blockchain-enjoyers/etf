// Set a vault's fixed flat create fee (FeeCore.setFlatCreateFee, onlyMeridian). Lowering it below a stuck
// sub-fee ticket's cash lets the keeper finally settle it (fillCash > fee → N > 0, no more ZeroShares).
//   cd blockchain && VAULT=0x.. FEE=0.99 npx hardhat run scripts/set-flat-create-fee.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { getDeployer } from "./deploy/_shared";

const abi = [
  "function setFlatCreateFee(uint256) external",
  "function flatCreateFee() view returns (uint256)",
];

async function main() {
  const vault = process.env.VAULT;
  if (!vault) throw new Error("set VAULT=0x..");
  const fee = ethers.parseUnits(process.env.FEE ?? "0.99", 18);
  await getDeployer();
  const v = await ethers.getContractAt(abi, vault);
  const before: bigint = await v.flatCreateFee();
  await (await v.setFlatCreateFee(fee)).wait();
  const after: bigint = await v.flatCreateFee();
  console.log(`flatCreateFee ${vault}: ${ethers.formatUnits(before, 18)} -> ${ethers.formatUnits(after, 18)} USDG`);
  console.log("Keeper will settle past-cutoff tickets whose cash now exceeds the fee on the next pass.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
