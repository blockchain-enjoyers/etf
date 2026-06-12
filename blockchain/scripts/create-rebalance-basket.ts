// Create a DEMO ManagedRebalanceVault on testnet + bootstrap it (so NAV + the L5 forward queue work).
//   cd blockchain && npx hardhat run scripts/create-rebalance-basket.ts --network robinhoodTestnet
// Idempotent: skips whitelist if already set, skips create if a demo vault is already recorded,
// skips bootstrap if the vault already has supply. Records the vault under deployments.RebalanceVaultDemo.
import { ethers } from "hardhat";
import { loadConfig, saveConfig, requireAddress, getDeployer } from "./deploy/_shared";

const ONE = 10n ** 18n;
// Vault requires tokens sorted ascending by address (UnsortedOrDuplicateTokens otherwise).
const TOKENS = [
  "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", // TSLA
  "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", // AMZN
  "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", // PLTR
  "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", // NFLX
  "0x71178BAc73cBeb415514eB542a8995b82669778d", // AMD
].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
const UNIT_QTY = TOKENS.map(() => ONE); // 1 token of each per unit
const UNIT_SIZE = ONE; // 1e18 shares per unit
const SALT = ethers.id("meridian-demo-rebalance-v1");

const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();
  const cfAddr = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const keeperEscrow = requireAddress(config, "KeeperModule", "deploy-l3.ts");
  const cf = await ethers.getContractAt("CloneFactory", cfAddr);

  console.log("== Whitelist constituents ==");
  for (const t of TOKENS) {
    if (await cf.constituentAllowed(t)) { console.log(`  ${t} already whitelisted`); continue; }
    await (await cf.setConstituentAllowed(t, true)).wait();
    console.log(`  ${t} -> whitelisted`);
  }

  let vault = process.env.REDEPLOY ? undefined : config.deployments?.RebalanceVaultDemo?.address;
  if (vault) {
    console.log(`\n== Reuse recorded demo vault ${vault} ==`);
  } else {
    console.log("\n== createRebalanceBasket ==");
    const b = {
      tokens: TOKENS, unitQty: UNIT_QTY, unitSize: UNIT_SIZE,
      name: "Meridian Demo Rebalance", symbol: "mDEMO",
      manager: me, managerFeeBps: 0, keeperBps: 0, keeperEscrow,
    };
    const tx = await cf.createRebalanceBasket(b, SALT);
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => { try { return cf.interface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === "RebalanceBasketCreated");
    vault = ev!.args.vault as string;
    console.log(`  vault = ${vault} (block ${rc!.blockNumber})`);
    config.deployments ??= {};
    config.deployments.RebalanceVaultDemo = {
      address: vault, deployer: me, txHash: tx.hash, block: rc!.blockNumber,
      deployedAt: new Date().toISOString(), args: [],
    };
    saveConfig(config);
  }

  const v = await ethers.getContractAt("ManagedRebalanceVault", vault!);
  const supply: bigint = await v.totalSupply();
  if (supply > 0n) {
    console.log(`\n== Already bootstrapped (supply ${supply}) ==`);
  } else {
    console.log("\n== Bootstrap: approve + create(unitSize) ==");
    for (let i = 0; i < TOKENS.length; ++i) {
      const c = new ethers.Contract(TOKENS[i], ERC20, (await ethers.getSigners())[0]);
      const cur: bigint = await c.allowance(me, vault);
      if (cur < UNIT_QTY[i]) { await (await c.approve(vault, UNIT_QTY[i])).wait(); }
    }
    await (await v.create(UNIT_SIZE)).wait();
    console.log(`  minted ${await v.totalSupply()} shares; vault holds the recipe.`);
  }

  const held: string[] = await v.heldTokens();
  console.log(`\n✅ Demo rebalance vault ${vault}`);
  console.log(`   supply=${await v.totalSupply()} heldTokens=${held.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
