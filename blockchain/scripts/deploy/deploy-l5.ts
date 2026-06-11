import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ensure, getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];
const FEED_ID = "0x" + "11".repeat(32); // mock router feed id (g1 only checks non-zero)

// unitQty is OFF-CHAIN (tree input + bootstrap arg) ONLY; the createRegistryIndex struct does NOT carry it.
const L5 = {
  unitSize: ONE,
  unitQty: [2n * ONE, 3n * ONE, 1n * ONE], // aligned to demo.stocks order BEFORE sorting; re-aligned below
  name: "Volatile Tech Basket",
  symbol: "VTBx",
};

export async function deployL5() {
  console.log("== L5: registry index + bootstrap + ForwardCashQueue + wiring ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const factory = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const fairValueNav = requireAddress(config, "FairValueNAV", "deploy-l4.ts");
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const keeperModule = requireAddress(config, "KeeperModule", "deploy-l3.ts");
  const demo = (config.params as any)?.demo;
  if (!demo?.stocks?.length) throw new Error("run deploy-demo-stocks.ts first (params.demo.stocks missing)");

  // Sort constituents ascending (recipe requires strictly-ascending tokens) and carry unitQty alongside.
  const order = demo.stocks
    .map((a: string, i: number) => ({ a, q: L5.unitQty[i] }))
    .sort((x: any, y: any) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
  const tokens: string[] = order.map((o: any) => o.a);
  const unitQty: bigint[] = order.map((o: any) => BigInt(o.q));

  // 1. Off-chain genesis Merkle root over (token, unitQty, unitSize) leaves.
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), L5.unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const proofByToken: Record<string, string[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);
  const proofs = tokens.map((t) => proofByToken[t]);

  // 2. Create the registry index (idempotent).
  const f = await ethers.getContractAt("CloneFactory", factory);
  let vaultAddr = config.deployments?.["RegistryIndex"]?.address;
  if (!vaultAddr || process.env.REDEPLOY) {
    const idx = {
      genesisRoot: tree.root, tokens, unitSize: L5.unitSize, name: L5.name, symbol: L5.symbol,
      manager: deployer, managerFeeBps: 0, keeperBps: 0, keeperEscrow: keeperModule,
    };
    vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    await (await f.createRegistryIndex(idx, ethers.ZeroHash)).wait();
    config.deployments!["RegistryIndex"] = { address: vaultAddr };
    saveConfig(config);
    console.log(`  RegistryIndex        ${vaultAddr}`);
  } else {
    console.log(`  RegistryIndex        ${vaultAddr}  (reused)`);
  }
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  // 3. Bootstrap the FULL constituent set atomically (deployer self-APs for the stand).
  if ((await vault.totalSupply()) === 0n) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = await ethers.getContractAt("MockERC20Decimals", tokens[i]);
      await (await tok.mint(deployer, unitQty[i])).wait();
      await (await tok.approve(vaultAddr, unitQty[i])).wait();
      await (await vault.wrap(tokens[i], unitQty[i])).wait();
    }
    await (await vault.bootstrap(L5.unitSize, tokens, unitQty, proofs)).wait();
    console.log("  bootstrap            full set wrapped + minted");
  }
  // Completeness guard (H2): abort if the held set is not the full constituent count.
  const held = await vault.heldTokens();
  if (held.length !== tokens.length) {
    throw new Error(`bootstrap incomplete: heldTokens=${held.length} != constituents=${tokens.length}`);
  }

  // 4. Observer over the REAL FairValueNAV.
  const observer = await ensure(config, "BasketNavObserver", [fairValueNav], deployer);

  // 5. Mock feed router (g1 non-zero feed per token) + peg feed ($1.00, 8-dec).
  const router = await ensure(config, "MockFeedRouter", [], deployer);
  const peg = await ensure(config, "MockPegFeed", [100000000n], deployer);
  const r = await ethers.getContractAt("MockFeedRouter", router);
  for (const t of tokens) if ((await r.feedIdOf(t)) === ethers.ZeroHash) await (await r.setFeed(t, FEED_ID)).wait();

  // 6. ForwardCashQueue: navEngine = REAL FairValueNAV; owner = deployer.
  //    Constructor arg order (8 args): vault, stable, navEngine, observer, keeperModule, router, pegFeed, owner
  let queueAddr = config.deployments?.["ForwardCashQueue"]?.address;
  if (!queueAddr || process.env.REDEPLOY) {
    const Q = await ethers.getContractFactory("ForwardCashQueue");
    const q = await Q.deploy(vaultAddr, usdg, fairValueNav, observer, keeperModule, router, peg, deployer);
    await q.waitForDeployment();
    queueAddr = await q.getAddress();
    config.deployments!["ForwardCashQueue"] = { address: queueAddr };
    saveConfig(config);
    console.log(`  ForwardCashQueue     ${queueAddr}`);
  } else {
    console.log(`  ForwardCashQueue     ${queueAddr}  (reused)`);
  }
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);

  // 7. Wire gate + roles. g1 source ref = the shared MockSource registered for every token.
  await (await q.setGateParams(2, 600, 200, 200, 3600)).wait();
  await (await q.setG1Refs(aggregator, demo.sharedSource)).wait();
  await (await q.setKeeperTip(0)).wait();
  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  if (!(await km.isExecutor(queueAddr))) await (await km.setExecutor(queueAddr, true)).wait();
  if ((await km.maxRewardPerCall()) === 0n) await (await km.setMaxRewardPerCall(ethers.MaxUint256)).wait();
  if (!(await vault.isSettler(queueAddr))) await (await vault.setSettler(queueAddr, true)).wait();

  console.log(`\n✅ L5 ready. Vault: ${EXPLORER}${vaultAddr}  Queue: ${EXPLORER}${queueAddr}`);
  return { vault: vaultAddr, queue: queueAddr, observer, router, peg };
}

if (require.main === module) {
  deployL5().catch((e) => { console.error(e); process.exitCode = 1; });
}
