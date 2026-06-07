import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const [owner, auction, keeper, other] = await ethers.getSigners();
  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(owner.address);
  // a stand-in "vault share token" (any ERC20) whose balance held by km == escrow
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const share = await Tok.deploy("Basket", "BSKT", 18);
  await share.mint(await km.getAddress(), 100n * ONE); // simulate the vault minting keeper fee-shares
  return { owner, auction, keeper, other, km, share };
}

describe("KeeperModule", () => {
  it("reports escrow as its balance of the vault share token", async () => {
    const { km, share } = await loadFixture(deploy);
    expect(await km.escrowOf(await share.getAddress())).to.equal(100n * ONE);
  });

  it("only the owner can register an executor / set the per-call cap", async () => {
    const { km, other, auction } = await loadFixture(deploy);
    await expect(km.connect(other).setExecutor(auction.address, true))
      .to.be.revertedWithCustomError(km, "OwnableUnauthorizedAccount");
    await expect(km.connect(other).setMaxRewardPerCall(ONE))
      .to.be.revertedWithCustomError(km, "OwnableUnauthorizedAccount");
  });

  it("only a registered executor can pay; payout is CLAMPED to min(amount, escrow, maxRewardPerCall)", async () => {
    const { km, owner, auction, keeper, share } = await loadFixture(deploy);
    await km.connect(owner).setExecutor(auction.address, true);
    await km.connect(owner).setMaxRewardPerCall(50n * ONE);

    // non-executor caller rejected
    await expect(km.connect(keeper).pay(await share.getAddress(), keeper.address, ONE))
      .to.be.revertedWithCustomError(km, "NotExecutor");

    // request 1000 but escrow=100 and cap=50 -> clamp to 50 (no revert)
    const paid = await km.connect(auction).pay.staticCall(await share.getAddress(), keeper.address, 1000n * ONE);
    expect(paid).to.equal(50n * ONE);
    await km.connect(auction).pay(await share.getAddress(), keeper.address, 1000n * ONE);
    expect(await share.balanceOf(keeper.address)).to.equal(50n * ONE);
    expect(await km.escrowOf(await share.getAddress())).to.equal(50n * ONE);

    // a de-registered executor can no longer pay
    await km.connect(owner).setExecutor(auction.address, false);
    await expect(km.connect(auction).pay(await share.getAddress(), keeper.address, ONE))
      .to.be.revertedWithCustomError(km, "NotExecutor");
  });

  it("pays the full requested amount when amount < escrow and below the cap", async () => {
    const { km, owner, auction, keeper, share } = await loadFixture(deploy);
    await km.connect(owner).setExecutor(auction.address, true);
    await km.connect(owner).setMaxRewardPerCall(50n * ONE);

    const paid = await km.connect(auction).pay.staticCall(await share.getAddress(), keeper.address, 30n * ONE);
    expect(paid).to.equal(30n * ONE);
    await km.connect(auction).pay(await share.getAddress(), keeper.address, 30n * ONE);
    expect(await share.balanceOf(keeper.address)).to.equal(30n * ONE);
    expect(await km.escrowOf(await share.getAddress())).to.equal(70n * ONE);
  });

  it("with maxRewardPerCall==0 the cap is unlimited (still clamped by escrow)", async () => {
    const { km, owner, auction, keeper, share } = await loadFixture(deploy);
    await km.connect(owner).setExecutor(auction.address, true);
    // leave cap at 0 (unlimited)

    const paid = await km.connect(auction).pay.staticCall(await share.getAddress(), keeper.address, 1000n * ONE);
    expect(paid).to.equal(100n * ONE);
    await km.connect(auction).pay(await share.getAddress(), keeper.address, 1000n * ONE);
    expect(await share.balanceOf(keeper.address)).to.equal(100n * ONE);
    expect(await km.escrowOf(await share.getAddress())).to.equal(0n);
  });
});
