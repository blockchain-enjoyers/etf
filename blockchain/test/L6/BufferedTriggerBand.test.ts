import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const NO_PAYLOADS: string[][] = [];
const NO_TOKENS: string[] = [];

// Build a guard whose only non-trivial gate is the band gate: market Closed, sequencer up (disabled),
// no held tokens (listing gate trivially passes), drift always due (trigger band 0, cardinality high).
async function deploy() {
  const [owner] = await ethers.getSigners();

  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setStatusSafe(3, true); // Closed
  await nav.setNav(100n * ONE);

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  // RebalanceModule: trigger 0 so any drift > 0 is "due"; reset 0 impossible (needs trigger>reset),
  // so use trigger=1, reset=0, cooldown=0, minCardinality=1.
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(owner.address, 1, 0, 0, 1);

  // Sequencer disabled (required=false, zero feed) -> isUp always true.
  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false);

  // No real auction needed for checkTrigger; pass a dummy address.
  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    ethers.ZeroAddress
  );

  const vault = ethers.Wallet.createRandom().address;
  // eMaxBps = 1900 (19%), weekend247=false, minDepth=0, grace=0.
  await guard.setVaultCfg(vault, false, 1900, 0, 0);
  return { guard, nav, vault };
}

describe("BufferedTriggerGuard — band fits the buffer", () => {
  it("fires when the band is within the e_max budget", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    // band = (confUpper-confLower)/2 = (102-98)/2 = 2 on a nav of 100 -> 200 bps <= 1900 bps.
    await nav.setBand(98n * ONE, 102n * ONE);
    expect(await guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)).to.equal(true);
  });

  it("blocks when the band is wider than the e_max budget", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    // band = (130-70)/2 = 30 on nav 100 -> 3000 bps > 1900 bps -> BandTooWide.
    await nav.setBand(70n * ONE, 130n * ONE);
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)
    ).to.be.revertedWithCustomError(guard, "BandTooWide");
  });

  it("reverts NotEnabled for an unconfigured vault", async () => {
    const { guard, nav } = await loadFixture(deploy);
    await nav.setBand(98n * ONE, 102n * ONE);
    const other = ethers.Wallet.createRandom().address;
    await expect(
      guard.checkTrigger.staticCall(other, NO_TOKENS, NO_PAYLOADS, 5, 3)
    ).to.be.revertedWithCustomError(guard, "NotEnabled");
  });
});
