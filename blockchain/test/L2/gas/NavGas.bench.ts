import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, V11, payloadFor, ns } from "../helpers";

// Phase 1 gas baseline: how much does the CURRENT Solidity NAVEngine.navOf cost on-chain as N grows?
// Measured by estimateGas on the original contract (no probe/wrapper). Gated behind GAS_BENCH=1:
//   GAS_BENCH=1 npx hardhat test test/L2/gas/NavGas.bench.ts
//
// Note: this EVM (EDR) enforces a hard ~16.78M (2^24) PER-TX gas cap, so a flat-500 BasketVault
// (~22M constructor, one SSTORE per leg) cannot even deploy in one tx — a finding in itself (R10:
// flat-500 needs tree composition). We measure the largest N that deploys, confirm the curve is
// linear, and extrapolate navOf/getConstituents to N=500.

const RUN = process.env.GAS_BENCH ? describe : describe.skip;

const NS = [50, 200, 300];
const PRICE = 300n * ONE;

async function buildBasket(N: number) {
  const [deployer] = await ethers.getSigners();

  const verifier = await (await ethers.getContractFactory("MockVerifierProxy")).deploy();
  const sequencer = await (await ethers.getContractFactory("MockSequencerUptimeFeed")).deploy();
  const adapter = await (await ethers.getContractFactory("ChainlinkAdapter")).deploy(await verifier.getAddress(), 11);
  const router = await (await ethers.getContractFactory("OracleRouter")).deploy(
    await adapter.getAddress(), await sequencer.getAddress(), 3600, 3600, deployer.address
  );
  const nav = await (await ethers.getContractFactory("NAVEngine")).deploy(await router.getAddress());

  const Tok = await ethers.getContractFactory("MiniERC20");
  const tokens: string[] = [];
  for (let i = 0; i < N; i++) tokens.push(await (await Tok.deploy(18)).getAddress());
  tokens.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

  const unitQty = tokens.map(() => ONE);
  const vault = await (await ethers.getContractFactory("BasketVault")).deploy(
    tokens, unitQty, ONE, `BSK${N}`, `B${N}`
  );
  const vaultAddr = await vault.getAddress();
  const deployGas = (await vault.deploymentTransaction()!.wait())!.gasUsed;

  const now = await time.latest();
  for (let i = 0; i < N; i++) {
    const token = await ethers.getContractAt("MiniERC20", tokens[i]);
    await token.setBalance(vaultAddr, 10n * ONE);
    const feedId = ethers.id(`FEED-${i}`);
    await verifier.setEquityReport(feedId, PRICE, 0n, 0n, ns(now), V11.Regular);
    await router.setFeed(tokens[i], feedId);
    await router.ingest(tokens[i], payloadFor(feedId));
  }

  return { nav, vault, vaultAddr, deployGas };
}

function fit(rows: { N: number; y: bigint }[]) {
  // least-squares slope/intercept over (N, y)
  const n = rows.length;
  const sx = rows.reduce((a, r) => a + r.N, 0);
  const sy = rows.reduce((a, r) => a + Number(r.y), 0);
  const sxx = rows.reduce((a, r) => a + r.N * r.N, 0);
  const sxy = rows.reduce((a, r) => a + r.N * Number(r.y), 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, at: (N: number) => Math.round(intercept + slope * N) };
}

RUN("NAV gas vs N (Phase 1 — current Solidity, estimateGas on original navOf)", function () {
  this.timeout(600_000);
  const rows: { N: number; deployGas: bigint; navGas: bigint; recipeGas: bigint }[] = [];

  for (const N of NS) {
    it(`N=${N}`, async () => {
      const { nav, vault, vaultAddr, deployGas } = await buildBasket(N);
      const navGas = await nav.navOf.estimateGas(vaultAddr);
      const recipeGas = await vault.getConstituents.estimateGas();
      rows.push({ N, deployGas, navGas, recipeGas });
      console.log(`  N=${String(N).padStart(3)}  deploy=${deployGas.toString().padStart(9)}  navOf=${navGas.toString().padStart(9)}  getConstituents=${recipeGas.toString().padStart(8)}  navOf/leg=${(navGas / BigInt(N)).toString().padStart(6)}`);
    });
  }

  after(() => {
    const navFit = fit(rows.map((r) => ({ N: r.N, y: r.navGas })));
    const recipeFit = fit(rows.map((r) => ({ N: r.N, y: r.recipeGas })));
    const deployFit = fit(rows.map((r) => ({ N: r.N, y: r.deployGas })));
    console.log("\n  ==== Phase 1 NAV gas baseline (current Solidity, estimateGas on original navOf) ====");
    console.log("    N |   deploy |    navOf | getConstituents");
    for (const r of rows) {
      console.log(`  ${String(r.N).padStart(3)} | ${r.deployGas.toString().padStart(8)} | ${r.navGas.toString().padStart(8)} | ${r.recipeGas.toString().padStart(8)}`);
    }
    console.log(`\n  Linear fit: navOf ≈ ${Math.round(navFit.slope)}·N + ${Math.round(navFit.intercept)};  getConstituents ≈ ${Math.round(recipeFit.slope)}·N + ${Math.round(recipeFit.intercept)}`);
    console.log("  Extrapolation:");
    for (const N of [500, 1000]) {
      console.log(`    N=${N}: deploy≈${deployFit.at(N).toLocaleString()}  navOf≈${navFit.at(N).toLocaleString()}  getConstituents≈${recipeFit.at(N).toLocaleString()}  (recipe = ${Math.round((100 * recipeFit.at(N)) / navFit.at(N))}% of navOf)`);
    }
    console.log("  Walls: per-tx cap here 16,777,216 (2^24). flat-500 deploy (~22M) exceeds it → can't deploy in one tx.");
    console.log("  Ethereum block ~30M; Arbitrum per-tx far higher. navOf(500)≈13.6M fits a tx but is heavy.\n");
  });
});
