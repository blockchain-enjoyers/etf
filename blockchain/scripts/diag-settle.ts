// One-off: dump the numbers that decide ZeroShares() for a registry create settle.
//   cd blockchain && VAULT=0x.. QUEUE=0x.. ID=0 npx hardhat run scripts/diag-settle.ts --network robinhoodTestnet
import { ethers } from "hardhat";

const qAbi = [
  "function tickets(uint256) view returns (address owner, bool isCreate, uint256 amount, uint64 cutoff, uint8 status)",
  "function spreadBps() view returns (uint16)",
];
const vAbi = [
  "function flatCreateFee() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function heldTokens() view returns (address[])",
  "function holdingsOf(address) view returns (uint256)",
];

async function main() {
  const vault = process.env.VAULT!;
  const queue = process.env.QUEUE!;
  const id = BigInt(process.env.ID ?? "0");
  const q = await ethers.getContractAt(qAbi, queue);
  const v = await ethers.getContractAt(vAbi, vault);

  const t = await q.tickets(id);
  const fee: bigint = await v.flatCreateFee();
  const supply: bigint = await v.totalSupply();
  const spread: bigint = await q.spreadBps();
  const held: string[] = Array.from(await v.heldTokens());

  console.log(`ticket ${id}: owner=${t.owner} isCreate=${t.isCreate} cash=${ethers.formatUnits(t.amount, 18)} status=${t.status}`);
  console.log(`flatCreateFee=${ethers.formatUnits(fee, 18)} USDG  spreadBps=${spread}`);
  console.log(`totalSupply=${ethers.formatUnits(supply, 18)} shares`);
  console.log(`fillCash <= fee ? ${t.amount <= fee}`);
  for (const h of held) {
    const bal: bigint = await v.holdingsOf(h);
    console.log(`  holdings ${h} = ${ethers.formatUnits(bal, 18)}`);
  }
  const cashToAP = t.amount > fee ? t.amount - fee : 0n;
  const netCash = (cashToAP * (10000n - spread)) / 10000n;
  console.log(`cashToAP=${ethers.formatUnits(cashToAP, 18)} netCash=${ethers.formatUnits(netCash, 18)}`);
  console.log(`-> need navPerShare <= netCash*1e18 for N>0; if N==0 the per-share NAV is too high for this cash`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
