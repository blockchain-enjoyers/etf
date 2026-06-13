import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE);
  await nav.setStatusSafe(3, true); // Closed

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(owner.address, 1, 0, 0, 1);
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
  // minDepth = 1000e18.
  await guard.setVaultCfg(vault, false, 1900, 1000n * ONE, 0);

  const tokenDeep = ethers.Wallet.createRandom().address;
  const tokenThin = ethers.Wallet.createRandom().address;
  await agg.setDepth(tokenDeep, 5000n * ONE); // above min
  await agg.setDepth(tokenThin, 10n * ONE); // below min
  return { guard, agg, vault, tokenDeep, tokenThin };
}

describe("BufferedTriggerGuard — listing gate", () => {
  it("fires when every constituent clears the min depth", async () => {
    const { guard, vault, tokenDeep } = await loadFixture(deploy);
    const held = [tokenDeep];
    const payloads = [[]]; // one empty payload array per token
    expect(await guard.checkTrigger.staticCall(vault, held, payloads, 5, 3)).to.equal(true);
  });

  it("blocks (ThinConstituent) when any constituent is below the min depth", async () => {
    const { guard, vault, tokenDeep, tokenThin } = await loadFixture(deploy);
    const held = [tokenDeep, tokenThin];
    const payloads = [[], []];
    await expect(
      guard.checkTrigger.staticCall(vault, held, payloads, 5, 3)
    )
      .to.be.revertedWithCustomError(guard, "ThinConstituent")
      .withArgs(tokenThin);
  });
});
