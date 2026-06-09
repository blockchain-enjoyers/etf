import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const GENESIS = ethers.id("genesis-root");
const NEWROOT = ethers.id("new-root");
const UNIT = 10n ** 18n;
const TIMELOCK = 7 * 24 * 3600;

async function deploy() {
  const [curator, stranger] = await ethers.getSigners();
  const H = await (await ethers.getContractFactory("RootCommitmentHarness")).deploy();
  await H.waitForDeployment();
  await H.initialize(GENESIS); // curator = deployer (signer 0)
  return { curator, stranger, H };
}

const RECIPE = {
  tokens: ["0x0000000000000000000000000000000000000A11"],
  qty: [3n],
};

describe("RootCommitment", () => {
  it("initializes recipeRoot to the genesis root", async () => {
    const { H } = await deploy();
    expect(await H.recipeRoot()).to.equal(GENESIS);
  });

  it("a non-curator cannot schedule a root", async () => {
    const { H, stranger } = await deploy();
    await expect(
      H.connect(stranger).scheduleRoot(NEWROOT, RECIPE.tokens, RECIPE.qty, UNIT)
    ).to.be.revertedWithCustomError(H, "NotRootCurator");
  });

  it("scheduleRoot sets pending + timelock and emits the full recipe for DA", async () => {
    const { H } = await deploy();
    await expect(H.scheduleRoot(NEWROOT, RECIPE.tokens, RECIPE.qty, UNIT))
      .to.emit(H, "RootScheduled");
    expect(await H.pendingRoot()).to.equal(NEWROOT);
    expect(await H.rootEffectiveAt()).to.be.greaterThan(0n);
    expect(await H.recipeRoot()).to.equal(GENESIS);
  });

  it("activateRoot reverts before the timelock elapses", async () => {
    const { H } = await deploy();
    await H.scheduleRoot(NEWROOT, RECIPE.tokens, RECIPE.qty, UNIT);
    await expect(H.activateRoot()).to.be.revertedWithCustomError(H, "RootTimelockNotElapsed");
  });

  it("activateRoot with nothing pending reverts", async () => {
    const { H } = await deploy();
    await expect(H.activateRoot()).to.be.revertedWithCustomError(H, "NoPendingRoot");
  });

  it("activateRoot after the timelock flips the live root and clears pending", async () => {
    const { H } = await deploy();
    await H.scheduleRoot(NEWROOT, RECIPE.tokens, RECIPE.qty, UNIT);
    await time.increase(TIMELOCK);
    await expect(H.activateRoot()).to.emit(H, "RootActivated").withArgs(NEWROOT);
    expect(await H.recipeRoot()).to.equal(NEWROOT);
    expect(await H.pendingRoot()).to.equal(ethers.ZeroHash);
    expect(await H.rootEffectiveAt()).to.equal(0n);
  });

  it("re-scheduling overwrites the pending root and resets the timelock", async () => {
    const { H } = await deploy();
    const ROOT_A = ethers.id("root-A");
    const ROOT_B = ethers.id("root-B");
    await H.scheduleRoot(ROOT_A, RECIPE.tokens, RECIPE.qty, UNIT);
    const effA = await H.rootEffectiveAt();
    expect(await H.pendingRoot()).to.equal(ROOT_A);
    await time.increase(TIMELOCK / 2);
    await H.scheduleRoot(ROOT_B, RECIPE.tokens, RECIPE.qty, UNIT);
    expect(await H.pendingRoot()).to.equal(ROOT_B);
    expect(await H.rootEffectiveAt()).to.be.greaterThan(effA);
    expect(await H.recipeRoot()).to.equal(GENESIS);
  });

  it("scheduleRoot rejects the zero root (no ambiguous 'unset' live root)", async () => {
    const { H } = await deploy();
    await expect(
      H.scheduleRoot(ethers.ZeroHash, RECIPE.tokens, RECIPE.qty, UNIT)
    ).to.be.revertedWithCustomError(H, "ZeroRoot");
  });
});
