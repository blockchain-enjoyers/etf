import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE } from "../helpers";
import { deployCloneFactory } from "./helpers";

const QTY = 2n * ONE;
const DEADLINE = 10_000_000_000n;
// A non-zero-deadline permit with throwaway signature fields (the mocks ignore v/r/s).
const dummyPermit = (value: bigint) => ({ value, deadline: DEADLINE, v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash });

async function deploySingleVault(tokenAddr: string) {
  const [issuer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  const salt = ethers.id("permit-mock-" + tokenAddr);
  const addr = await factory.predictBasketAddress(issuer.address, [tokenAddr], [QTY], ONE, "Mock", "MCK", salt);
  await (await factory.createBasket([tokenAddr], [QTY], ONE, "Mock", "MCK", salt)).wait();
  const vault = await ethers.getContractAt("BasketVault", addr);
  return { vault, vaultAddr: addr };
}

describe("createWithPermit — non-standard / adversarial constituents", () => {
  it("constituent lacking permit() -> PermitFailed when no allowance, succeeds with a classic approve", async () => {
    const [, ap] = await ethers.getSigners();
    const Plain = await ethers.getContractFactory("PlainERC20");
    const token = await Plain.deploy("Plain", "PLN");
    await token.waitForDeployment();
    await (await token.mint(ap.address, 1000n * ONE)).wait();
    const { vault, vaultAddr } = await deploySingleVault(await token.getAddress());

    // permit() selector does not exist -> call reverts -> caught -> allowance 0 -> PermitFailed
    await expect(vault.connect(ap).createWithPermit(1n, [dummyPermit(QTY)]))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(await token.getAddress());

    // classic approve covers need -> the caught permit failure is graceful, create proceeds
    await (await token.connect(ap).approve(vaultAddr, QTY)).wait();
    await vault.connect(ap).createWithPermit(1n, [dummyPermit(QTY)]);
    expect(await vault.balanceOf(ap.address)).to.equal(ONE);
  });

  it("token whose permit() succeeds but sets no allowance -> PermitFailed (success-branch check)", async () => {
    const [, ap] = await ethers.getSigners();
    const Noop = await ethers.getContractFactory("NoopPermitERC20");
    const token = await Noop.deploy("Noop", "NOP");
    await token.waitForDeployment();
    await (await token.mint(ap.address, 1000n * ONE)).wait();
    const { vault } = await deploySingleVault(await token.getAddress());

    await expect(vault.connect(ap).createWithPermit(1n, [dummyPermit(QTY)]))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(await token.getAddress());
  });

  it("reentrancy via the permit path is blocked by the guard (no double-mint)", async () => {
    const [, ap] = await ethers.getSigners();
    const Re = await ethers.getContractFactory("ReentrantPermitERC20");
    const token = await Re.deploy("Reenter", "RE");
    await token.waitForDeployment();
    await (await token.mint(ap.address, 1000n * ONE)).wait();
    const { vault, vaultAddr } = await deploySingleVault(await token.getAddress());

    // arm the token: self-balance + max approval so the reentrant create() would SUCCEED but for the guard
    await (await token.arm(vaultAddr, 1000n * ONE)).wait();

    // permit() reenters vault.create(1) (reverts under the guard), then sets ap's allowance so the outer proceeds
    await vault.connect(ap).createWithPermit(1n, [dummyPermit(QTY)]);

    expect(await token.lastReentryOk()).to.equal(false); // guard reverted the reentrant create
    expect(await vault.totalSupply()).to.equal(ONE); // only the outer create minted; no double-mint
  });
});
