import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const Mock = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Mock.deploy();
  const Vault = await ethers.getContractFactory("MockSupplyVault");
  const vault = await Vault.deploy(2n * ONE); // totalSupply = 2e18
  await nav.setNav(200n * ONE); // basket nav $200 -> navPerShare = 100
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());
  return { obs, nav, vault };
}

// Deploy a zero-supply vault to exercise the NoSupply revert.
async function deployZeroSupply() {
  const Mock = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Mock.deploy();
  const Vault = await ethers.getContractFactory("MockSupplyVault");
  const vault = await Vault.deploy(0n); // totalSupply = 0
  await nav.setNav(200n * ONE);
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());
  return { obs, nav, vault };
}

describe("BasketNavObserver", () => {
  it("accumulates navPerShare and returns a TWAP over the window", async () => {
    const { obs, nav, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    // t0: seed (navPerShare = 100; the seed sample is DISCARDED, cumulative starts at 0).
    const t0 = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(t0);
    await obs.record(v, [], []);              // navPerShare = 100
    await nav.setNav(220n * ONE);             // navPerShare = 110 (mined at t0+1, no obs)
    await time.setNextBlockTimestamp(t0 + 100);
    await obs.record(v, [], []);              // interval [t0, t0+100] weighted by 110
    await time.setNextBlockTimestamp(t0 + 200);
    await obs.record(v, [], []);             // interval [t0+100, t0+200] weighted by 110
    const [twap, count] = await obs.consult(v, 250);
    // End-of-interval convention: BOTH post-seed intervals sampled 110, so TWAP == 110 EXACTLY
    // (a path-average refactor would yield 105 and fail here). count == all 3 observations.
    expect(twap).to.equal(110n * ONE);
    expect(count).to.equal(3n);
  });

  it("windows out older observations: a tighter window advances startIdx (exact twap + count)", async () => {
    const { obs, nav, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    const t0 = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(t0);
    await obs.record(v, [], []);              // seed at t0, navPerShare 100 discarded
    await nav.setNav(220n * ONE);             // navPerShare 110
    await time.setNextBlockTimestamp(t0 + 100);
    await obs.record(v, [], []);              // interval [t0, t0+100] weighted by 110
    await nav.setNav(240n * ONE);             // navPerShare 120
    await time.setNextBlockTimestamp(t0 + 200);
    await obs.record(v, [], []);              // interval [t0+100, t0+200] weighted by 120

    // Full window: spans both intervals -> (110*100 + 120*100)/200 = 115, count 3.
    const [fullTwap, fullCount] = await obs.consult(v, 1000);
    expect(fullTwap).to.equal(115n * ONE);
    expect(fullCount).to.equal(3n);

    // Tight window (150s, now=t0+200 -> cutoff t0+50) excludes the t0 seed: startIdx advances to obs[1].
    // Only the [t0+100, t0+200] interval survives -> twap 120, count 2.
    const [winTwap, winCount] = await obs.consult(v, 150);
    expect(winTwap).to.equal(120n * ONE);
    expect(winCount).to.equal(2n);
  });

  it("record() is a NO-OP when the L4 reading is not Open (iron-rule separation)", async () => {
    const { obs, nav, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    // Closed market (status 3) -> record must not add an observation.
    await nav.setStatusSafe(3, true);
    await obs.record(v, [], []);
    await time.increase(100);
    await obs.record(v, [], []);
    // No observations were recorded, so consult fail-closes.
    await expect(obs.consult(v, 1000)).to.be.revertedWithCustomError(obs, "NoObservations");
  });

  it("record() is a NO-OP when the L4 reading is unsafe (iron-rule separation)", async () => {
    const { obs, nav, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    // Open but unsafe -> record must not add an observation.
    await nav.setStatusSafe(0, false);
    await obs.record(v, [], []);
    await time.increase(100);
    await obs.record(v, [], []);
    await expect(obs.consult(v, 1000)).to.be.revertedWithCustomError(obs, "NoObservations");
  });

  it("not-Open/unsafe pokes do not pollute the accumulator; only Open+safe samples count", async () => {
    const { obs, nav, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    // A Closed poke first (no-op), then a real Open+safe seed.
    await nav.setStatusSafe(3, true);
    await obs.record(v, [], []);              // no-op (Closed)
    await nav.setStatusSafe(0, true);         // back Open+safe
    const t0 = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(t0);
    await obs.record(v, [], []);              // seed (navPerShare 100 discarded)
    await nav.setNav(220n * ONE);             // navPerShare 110
    await time.setNextBlockTimestamp(t0 + 100);
    await obs.record(v, [], []);              // interval weighted by 110
    const [twap, count] = await obs.consult(v, 1000);
    expect(twap).to.equal(110n * ONE);        // the Closed poke never entered the accumulator
    expect(count).to.equal(2n);               // exactly the two Open+safe observations
  });

  it("record() reverts NoSupply when totalSupply is 0", async () => {
    const { obs, vault } = await loadFixture(deployZeroSupply);
    const v = await vault.getAddress();
    await expect(obs.record(v, [], [])).to.be.revertedWithCustomError(obs, "NoSupply");
  });

  it("consult() fail-closes with NoObservations below 2 observations", async () => {
    const { obs, vault } = await loadFixture(deploy);
    const v = await vault.getAddress();
    // Zero observations.
    await expect(obs.consult(v, 1000)).to.be.revertedWithCustomError(obs, "NoObservations");
    // One observation (just the seed) is still < 2.
    await obs.record(v, [], []);
    await expect(obs.consult(v, 1000)).to.be.revertedWithCustomError(obs, "NoObservations");
  });
});
