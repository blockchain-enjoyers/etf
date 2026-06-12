// READ-ONLY discovery for live L5 / rebalance-basket setup. No state changes.
//   cd blockchain && npx hardhat run scripts/check-l5-state.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

const TOKENS: { symbol: string; address: string }[] = [
  { symbol: "TSLA", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" },
  { symbol: "AMZN", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02" },
  { symbol: "PLTR", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" },
  { symbol: "NFLX", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93" },
  { symbol: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d" },
];

const ERC20 = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();
  const cfAddr = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const cf = await ethers.getContractAt("CloneFactory", cfAddr);

  console.log("\n== CloneFactory ==", cfAddr);
  const rebImpl = await cf.rebalanceImpl();
  console.log("  rebalanceImpl:", rebImpl, rebImpl === ethers.ZeroAddress ? "(UNSET — must setRebalanceImpl)" : "(set)");

  console.log("\n== Constituent tokens ==");
  const prov = ethers.provider;
  for (const t of TOKENS) {
    const code = await prov.getCode(t.address);
    if (code === "0x") { console.log(`  ${t.symbol}: NO CODE at ${t.address}`); continue; }
    const c = new ethers.Contract(t.address, ERC20, prov);
    let sym = "?", dec = "?", bal = "?", sup = "?";
    try { sym = await c.symbol(); } catch {}
    try { dec = String(await c.decimals()); } catch {}
    try { bal = (await c.balanceOf(me)).toString(); } catch {}
    try { sup = (await c.totalSupply()).toString(); } catch {}
    const allowed = await cf.constituentAllowed(t.address);
    console.log(`  ${t.symbol.padEnd(5)} sym=${sym} dec=${dec} bal(deployer)=${bal} supply=${sup} whitelisted=${allowed}`);
  }

  console.log("\n== L5 deps (expected ABSENT — to deploy) ==");
  for (const name of ["ForwardCashQueue", "BasketNavObserver", "MockPegFeed", "MockUSDC", "Stable"]) {
    const a = config.deployments?.[name]?.address;
    console.log(`  ${name}: ${a ?? "(not in testnet.json)"}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
