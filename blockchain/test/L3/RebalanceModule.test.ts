import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("RebalanceModule — is-due Schmitt latch", () => {
  async function deploy() {
    const [owner] = await ethers.getSigners();
    const M = await ethers.getContractFactory("RebalanceModule");
    // triggerBandBps=500 (5%), resetBandBps=200 (2%), cooldown=0, minCardinality=2
    const m = await M.deploy(owner.address, 500, 200, 0, 2);
    return { m };
  }
  it("fires above trigger, latches, clears only below reset", async () => {
    const { m } = await loadFixture(deploy);
    expect(await m.evaluate(600, 3, false, 9999)).to.equal(true);  // > trigger, not latched -> due
    expect(await m.evaluate(500, 3, false, 9999)).to.equal(false); // exactly at trigger -> NOT due (strict >)
    expect(await m.evaluate(600, 3, true, 9999)).to.equal(false);  // latched -> not due
    expect(await m.evaluate(300, 3, true, 9999)).to.equal(false);  // between reset & trigger, latched -> stays latched
    expect(await m.evaluate(100, 3, true, 9999)).to.equal(false);  // < reset -> latch would clear, but not due this call
    expect(await m.evaluate(600, 1, false, 9999)).to.equal(false); // cardinality < min -> not due
  });
  it("latchCleared tells the caller when drift fell below reset", async () => {
    const { m } = await loadFixture(deploy);
    expect(await m.latchCleared(100)).to.equal(true);   // < resetBandBps
    expect(await m.latchCleared(200)).to.equal(false);  // exactly at reset -> still latched (strict <)
    expect(await m.latchCleared(300)).to.equal(false);  // >= reset
  });
  it("cooldown uses strict <: sinceRebalance == cooldown is allowed", async () => {
    const [owner] = await ethers.getSigners();
    const M = await ethers.getContractFactory("RebalanceModule");
    const m = await M.deploy(owner.address, 500, 200, 100, 2); // cooldown=100
    expect(await m.evaluate(600, 3, false, 100)).to.equal(true);  // == cooldown -> due
    expect(await m.evaluate(600, 3, false, 99)).to.equal(false);  // < cooldown -> not due
  });
  it("rejects reset >= trigger", async () => {
    const [owner] = await ethers.getSigners();
    const M = await ethers.getContractFactory("RebalanceModule");
    await expect(M.deploy(owner.address, 200, 500, 0, 2)).to.be.revertedWithCustomError(M, "InvalidBands");
  });
});
