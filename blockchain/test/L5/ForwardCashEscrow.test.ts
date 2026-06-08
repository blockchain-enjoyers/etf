import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const HOUR = 3600;

async function deploy() {
  const [owner, user] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const usdc = await Tok.deploy("USDC", "USDC", 6);
  const shares = await Tok.deploy("RB", "RB", 18);
  await shares.mint(user.address, 100n * ONE);

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  const q = await q_deploy(Q, owner, await shares.getAddress(), await usdc.getAddress());

  await usdc.mint(user.address, 1_000n * 10n ** 6n);
  return { owner, user, q, usdc, shares };
}

async function q_deploy(Q: any, owner: any, vault: string, stable: string) {
  const Z = ethers.ZeroAddress;
  return Q.deploy(vault, stable, Z, Z, Z, Z, Z, owner.address);
}

// Fixture with a FRESH zero-supply vault (no mints) to exercise the VaultNotBootstrapped path.
async function deployZeroSupplyVault() {
  const [owner, user] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const usdc = await Tok.deploy("USDC", "USDC", 6);
  const shares = await Tok.deploy("RB", "RB", 18); // no mint -> totalSupply == 0

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  const q = await q_deploy(Q, owner, await shares.getAddress(), await usdc.getAddress());

  await usdc.mint(user.address, 1_000n * 10n ** 6n);
  return { owner, user, q, usdc, shares };
}

describe("ForwardCashQueue — escrow + cancel", () => {
  it("requestCreate escrows the user's USDC and mints a pending ticket", async () => {
    const { q, usdc, user } = await loadFixture(deploy);
    await usdc.connect(user).approve(await q.getAddress(), 500n * 10n ** 6n);
    await q.connect(user).requestCreate(500n * 10n ** 6n);
    expect(await usdc.balanceOf(await q.getAddress())).to.equal(500n * 10n ** 6n);
    const t = await q.tickets(0);
    expect(t.owner).to.equal(user.address);
    expect(t.isCreate).to.equal(true);
    expect(t.amount).to.equal(500n * 10n ** 6n);
    expect(t.status).to.equal(0);
  });

  it("cancel before cutoff returns the exact escrow and closes the ticket", async () => {
    const { q, usdc, user } = await loadFixture(deploy);
    await usdc.connect(user).approve(await q.getAddress(), 500n * 10n ** 6n);
    await q.connect(user).requestCreate(500n * 10n ** 6n);
    const before = await usdc.balanceOf(user.address);
    await q.connect(user).cancel(0);
    expect(await usdc.balanceOf(user.address)).to.equal(before + 500n * 10n ** 6n);
    expect((await q.tickets(0)).status).to.equal(2);
  });

  it("only the owner can cancel their ticket; cancel after cutoff reverts", async () => {
    const { q, usdc, user, owner } = await loadFixture(deploy);
    await usdc.connect(user).approve(await q.getAddress(), 500n * 10n ** 6n);
    await q.connect(user).requestCreate(500n * 10n ** 6n);
    await expect(q.connect(owner).cancel(0)).to.be.revertedWithCustomError(q, "NotTicketOwner");
    await time.increase(HOUR + 10);
    await expect(q.connect(user).cancel(0)).to.be.revertedWithCustomError(q, "PastCutoff");
  });

  it("requestRedeem escrows the user's shares", async () => {
    const { q, shares, user } = await loadFixture(deploy);
    await shares.connect(user).approve(await q.getAddress(), 10n * ONE);
    await q.connect(user).requestRedeem(10n * ONE);
    expect(await shares.balanceOf(await q.getAddress())).to.equal(10n * ONE);
    expect((await q.tickets(0)).isCreate).to.equal(false);
  });

  // A. zero-amount create is rejected.
  it("requestCreate(0) reverts ZeroAmount", async () => {
    const { q, user } = await loadFixture(deploy);
    await expect(q.connect(user).requestCreate(0)).to.be.revertedWithCustomError(q, "ZeroAmount");
  });

  // B. cash-create never bootstraps an empty vault (totalSupply == 0).
  it("requestCreate reverts VaultNotBootstrapped when the vault has no supply", async () => {
    const { q, usdc, user } = await loadFixture(deployZeroSupplyVault);
    await usdc.connect(user).approve(await q.getAddress(), 500n * 10n ** 6n);
    await expect(q.connect(user).requestCreate(500n * 10n ** 6n)).to.be.revertedWithCustomError(
      q,
      "VaultNotBootstrapped",
    );
  });

  // C. a second cancel on an already-cancelled ticket reverts NotPending.
  it("double-cancel reverts NotPending", async () => {
    const { q, usdc, user } = await loadFixture(deploy);
    await usdc.connect(user).approve(await q.getAddress(), 500n * 10n ** 6n);
    await q.connect(user).requestCreate(500n * 10n ** 6n);
    await q.connect(user).cancel(0);
    await expect(q.connect(user).cancel(0)).to.be.revertedWithCustomError(q, "NotPending");
  });

  // D. cancel of a redeem ticket returns the EXACT shares (distinct branch from create-cancel).
  it("cancel of a redeem ticket restores the user's shares exactly", async () => {
    const { q, shares, user } = await loadFixture(deploy);
    await shares.connect(user).approve(await q.getAddress(), 10n * ONE);
    const before = await shares.balanceOf(user.address);
    await q.connect(user).requestRedeem(10n * ONE);
    await q.connect(user).cancel(0);
    expect(await shares.balanceOf(user.address)).to.equal(before);
    expect((await q.tickets(0)).status).to.equal(2);
  });

  // Governance bound on the cutoff delay (availability guard on FUTURE tickets).
  it("setCutoffDelay reverts InvalidCutoffDelay below MIN and above MAX", async () => {
    const { q, owner } = await loadFixture(deploy);
    await expect(q.connect(owner).setCutoffDelay(0)).to.be.revertedWithCustomError(q, "InvalidCutoffDelay");
    await expect(q.connect(owner).setCutoffDelay(7 * 24 * HOUR + 1)).to.be.revertedWithCustomError(
      q,
      "InvalidCutoffDelay",
    );
  });
});
