// blockchain/test/L2/gas/CommitmentNavGas.bench.ts
import { ethers } from "hardhat";
import { ONE } from "../helpers";

const RUN = process.env.GAS_BENCH ? describe : describe.skip;
const coder = ethers.AbiCoder.defaultAbiCoder();
const NS = [50, 200, 500];

RUN("Commitment NAV gas vs N (B1 trusted-price path)", function () {
  this.timeout(600_000);
  const rows: { N: number; gas: bigint }[] = [];
  for (const N of NS) {
    it(`N=${N}`, async () => {
      const tokens = Array.from({ length: N }, (_, i) =>
        ethers.getAddress("0x" + (BigInt(i) + 1n).toString(16).padStart(40, "0")));
      tokens.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      const unitQty = tokens.map(() => ONE);
      const prices = tokens.map(() => 300n * ONE);
      const C = await ethers.getContractFactory("CommitmentNAV");
      const c = await C.deploy(tokens, unitQty, ONE);
      const gas = await c.navFromCalldata.estimateGas(tokens, unitQty, ONE, prices);
      rows.push({ N, gas });
      console.log(`  N=${String(N).padStart(3)}  navFromCalldata=${gas.toString().padStart(9)} gas  per-leg=${(gas / BigInt(N)).toString().padStart(5)}`);
    });
  }
  after(() => {
    console.log("\n  ==== Commitment NAV (B1) vs Phase-1 baseline ====");
    for (const r of rows) console.log(`  N=${String(r.N).padStart(3)}  commitment=${r.gas.toString().padStart(9)}  (baseline navOf ≈ ${(27095 * r.N + 30544).toLocaleString()})`);
    console.log("  Note: commitment path is stateless -> real N=500 measurable (no vault deploy wall).\n");
  });
});

// B3 (the V path): the SIGNED route — inline ecrecover of k=3 DON sigs per asset (approach a). This is
// the trust-minimized number, and the Solidity baseline that Track A's Stylus V-kernel is compared to.
const K = 3; // signatures per report
RUN("Commitment NAV gas vs N (signed / V path, k=3 ecrecover per leg)", function () {
  this.timeout(600_000);
  const rows: { N: number; gas: bigint }[] = [];
  for (const N of NS) {
    it(`N=${N}`, async () => {
      const tokens = Array.from({ length: N }, (_, i) =>
        ethers.getAddress("0x" + (BigInt(i) + 1n).toString(16).padStart(40, "0")));
      tokens.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      const unitQty = tokens.map(() => ONE);

      // committee of 4, sign with the 3 lowest-address members so recovered signers are ascending.
      const wallets = Array.from({ length: 4 }, () => ethers.Wallet.createRandom())
        .sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
      const committee = wallets.map((w) => w.address);
      const signers = wallets.slice(0, K);

      const C = await ethers.getContractFactory("CommitmentNAV");
      const c = await C.deploy(tokens, unitQty, ONE);
      await c.setCommittee(committee, K);

      const feedIds: string[] = [];
      const mids: bigint[] = [];
      const r: string[][] = [], s: string[][] = [], v: number[][] = [];
      for (let i = 0; i < N; i++) {
        const feedId = ethers.id(`FEED-${i}`);
        const mid = 300n * ONE;
        const h = ethers.keccak256(coder.encode(["bytes32", "int256"], [feedId, mid]));
        const ri: string[] = [], si: string[] = [], vi: number[] = [];
        for (const w of signers) {
          const sig = ethers.Signature.from(w.signingKey.sign(h));
          ri.push(sig.r); si.push(sig.s); vi.push(sig.v);
        }
        feedIds.push(feedId); mids.push(mid); r.push(ri); s.push(si); v.push(vi);
      }

      const gas = await c.navFromSignedReports.estimateGas(tokens, unitQty, ONE, { feedIds, mids, r, s, v });
      rows.push({ N, gas });
      console.log(`  N=${String(N).padStart(3)}  navFromSignedReports=${gas.toString().padStart(9)} gas  per-leg=${(gas / BigInt(N)).toString().padStart(6)}  (~${K} ecrecover/leg)`);
    });
  }
  after(() => {
    console.log("\n  ==== Signed/V path (k=3 ecrecover/leg) vs B1 trusted vs baseline ====");
    for (const r of rows) {
      const ecrecoverFloor = 3000 * K * r.N;
      console.log(`  N=${String(r.N).padStart(3)}  signed=${r.gas.toString().padStart(9)}  (ecrecover floor ${ecrecoverFloor.toLocaleString()} = ${Math.round((100 * ecrecoverFloor) / Number(r.gas))}%)  baseline navOf ≈ ${(27095 * r.N + 30544).toLocaleString()}`);
    }
    console.log("  This signed number is what the Stylus V-kernel (Track A) is benchmarked against; ecrecover is a precompile -> expect ≈parity.\n");
  });
});
