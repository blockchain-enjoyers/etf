import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const NO_PAYLOADS: string[][] = [];
const NO_TOKENS: string[] = [];

async function deploy() {
  const [owner, stranger] = await ethers.getSigners();
  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE);
  await nav.setStatusSafe(3, true); // Closed

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  // trigger 500 (5%), reset 200 (2%), cooldown 0, minCardinality 2.
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(owner.address, 500, 200, 0, 2);
  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false);

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    ethers.ZeroAddress
  );
  const vault = ethers.Wallet.createRandom().address;
  await guard.setVaultCfg(vault, false, 1900, 0, 0);
  // Register owner as keeper so binding entrypoints can be called in this suite.
  await guard.setKeeper(owner.address, true);
  return { guard, vault, owner, stranger };
}

describe("BufferedTriggerGuard — sustained-drift Schmitt", () => {
  it("fires above the trigger band with enough cardinality", async () => {
    const { guard, vault } = await loadFixture(deploy);
    expect(await guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 600, 3)).to.equal(true);
  });

  it("does NOT fire at or below the trigger band (strict >)", async () => {
    const { guard, vault } = await loadFixture(deploy);
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 500, 3)
    ).to.be.revertedWithCustomError(guard, "NotDue");
  });

  it("does NOT fire below minimum cardinality (an instant spike)", async () => {
    const { guard, vault } = await loadFixture(deploy);
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 600, 1)
    ).to.be.revertedWithCustomError(guard, "NotDue");
  });

  it("clearLatch as a keeper with sub-reset drift is a no-op when not latched; non-keeper reverts NotKeeper", async () => {
    const { guard, vault, stranger } = await loadFixture(deploy);
    // Vault is not latched — clearLatch with drift 100 < reset 200 should call latchCleared(true) but latched is
    // already false, so the mapping stays false and no LatchCleared event fires.
    expect(await guard.latched(vault)).to.equal(false);
    await guard.clearLatch(vault, 100); // keeper call — no revert expected
    expect(await guard.latched(vault)).to.equal(false);

    // A non-keeper attempting clearLatch must revert with NotKeeper.
    await expect(
      guard.connect(stranger).clearLatch(vault, 100)
    ).to.be.revertedWithCustomError(guard, "NotKeeper");
  });
});
