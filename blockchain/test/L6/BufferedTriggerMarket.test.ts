import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const NO_PAYLOADS: string[][] = [];
const NO_TOKENS: string[] = [];

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE); // 200 bps, fits a 1900 bps budget

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(owner.address, 1, 0, 0, 1);

  const Feed = await ethers.getContractFactory("MockSequencerUptimeFeed");
  const feed = await Feed.deploy();
  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(await feed.getAddress(), true);

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    ethers.ZeroAddress
  );
  const vault = ethers.Wallet.createRandom().address;
  // grace = 100s.
  await guard.setVaultCfg(vault, false, 1900, 0, 100);
  // Sequencer up and well past grace by default.
  await feed.set(0, (await time.latest()) - 5000);
  return { guard, nav, feed, vault };
}

describe("BufferedTriggerGuard — market + sequencer gates", () => {
  it("fires when Closed (default weekend path)", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    await nav.setStatusSafe(3, true); // Closed
    expect(await guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)).to.equal(true);
  });

  it("blocks when Open and the vault did NOT opt into 24/7", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    await nav.setStatusSafe(0, true); // Open
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)
    ).to.be.revertedWithCustomError(guard, "MarketNotEligible");
  });

  it("blocks a degenerate Unknown/Halted reading", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    await nav.setStatusSafe(4, false); // Unknown
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)
    ).to.be.revertedWithCustomError(guard, "UnknownMarket");
  });

  it("blocks while the sequencer is within its restart grace", async () => {
    const { guard, nav, feed, vault } = await loadFixture(deploy);
    await nav.setStatusSafe(3, true); // Closed
    await feed.set(0, (await time.latest()) - 50); // up only 50s, grace is 100s
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)
    ).to.be.revertedWithCustomError(guard, "SequencerDown");
  });

  it("opts into 24/7 -> fires while Open", async () => {
    const { guard, nav, vault } = await loadFixture(deploy);
    await guard.setVaultCfg(vault, true, 1900, 0, 100); // weekend247 = true
    await nav.setStatusSafe(0, true); // Open
    expect(await guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 5, 3)).to.equal(true);
  });
});
