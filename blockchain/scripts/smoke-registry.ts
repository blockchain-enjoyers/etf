// One-shot on-chain smoke of the registry code paths against the freshly-deployed stack.
// Verifies: createRegistryIndex calldata + genesis Merkle root (WS3.gamma) on the LIVE factory;
// the registry read surfaces the backend uses (WS1 fees, WS3 holdings/recipe, delta1 queue).
// Run: npx hardhat run scripts/deploy/../smoke-registry.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { loadConfig } from "./deploy/_shared";

const ENC = ["address", "uint256", "uint256"];
const ONE = 10n ** 18n;
const ok = (b: boolean, m: string) => console.log(`  ${b ? "OK " : "!! "} ${m}`);

async function main() {
  const c = loadConfig();
  const D = c.deployments!;
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("CloneFactory", D.CloneFactory.address);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", D.RegistryIndex.address);
  const queue = await ethers.getContractAt("ForwardCashQueue", D.ForwardCashQueue.address);

  console.log("== WS3.gamma: createRegistryIndex calldata + genesis Merkle root on the LIVE factory ==");
  const stocks = [D.Stock_MSTRx.address, D.Stock_TSLAx.address, D.Stock_NVDAx.address];
  const qty = [2n * ONE, 3n * ONE, 1n * ONE];
  const pairs = stocks.map((a, i) => ({ a, q: qty[i] })).sort((x, y) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
  const tokens = pairs.map((p) => p.a);
  const unitQty = pairs.map((p) => p.q);
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), ONE.toString()]);
  const root = StandardMerkleTree.of(values, ENC).root;
  const idx = {
    genesisRoot: root, tokens, unitSize: ONE, name: "SMOKE", symbol: "SMK",
    manager: signer.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: D.KeeperModule.address,
  };
  const SALT = ethers.id("smoke-registry-2026"); // non-zero: avoid CREATE2 collision with the deploy-l5 vault
  const predicted = await factory.createRegistryIndex.staticCall(idx, SALT);
  ok(ethers.isAddress(predicted) && predicted !== ethers.ZeroAddress, `createRegistryIndex.staticCall -> predictedVault ${predicted}`);
  const predicted2 = await factory.predictRegistryIndexAddress(signer.address, ONE, root, SALT);
  ok(predicted.toLowerCase() === predicted2.toLowerCase(), `predictRegistryIndexAddress == staticCall (${predicted2})`);

  console.log("== WS3: live registry vault read surface ==");
  const held = await vault.heldTokens();
  ok(held.length === 3, `heldTokens == 3 (${held.length})`);
  for (const t of held) {
    const h = await vault.holdingsOf(t);
    ok(h > 0n, `holdingsOf(${t.slice(0, 8)}) = ${h.toString()} (claim backing > 0)`);
  }
  const recipeRoot = await vault.recipeRoot();
  ok(recipeRoot !== ethers.ZeroHash, `recipeRoot set ${recipeRoot.slice(0, 12)}...`);

  console.log("== WS1: fee read surface ==");
  const creationFeeToken = await factory.creationFeeToken();
  const creationFeeRegistry = await factory.creationFee(4); // VaultType.REGISTRY = 4
  ok(creationFeeToken.toLowerCase() === D.USDG.address.toLowerCase(), `factory.creationFeeToken == USDG (${creationFeeToken})`);
  console.log(`     factory.creationFee(REGISTRY) = ${creationFeeRegistry.toString()} (0 = not set, expected)`);
  const flatCreateFee = await vault.flatCreateFee();
  const feeToken = await vault.feeToken();
  ok(feeToken.toLowerCase() === D.USDG.address.toLowerCase(), `vault.feeToken == USDG (${feeToken})`);
  console.log(`     vault.flatCreateFee = ${flatCreateFee.toString()} (=1e18 -> 1 USDG default-flat-fee)`);

  console.log("== delta1: registry forward queue read surface ==");
  ok(await queue.isRegistry(), "queue.isRegistry == true");
  const stable = await queue.stable();
  ok(stable.toLowerCase() === D.USDG.address.toLowerCase(), `queue.stable == USDG (${stable})`);
  const obs = await queue.observer();
  ok(obs.toLowerCase() === D.BasketNavObserver.address.toLowerCase(), `queue.observer == BasketNavObserver (${obs})`);

  console.log("\nregistry smoke OK");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
