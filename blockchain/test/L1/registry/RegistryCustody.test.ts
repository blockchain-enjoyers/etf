import { expect } from "chai";
import { ethers } from "hardhat";

const UNIT = 10n ** 18n;

async function deploy() {
  const [deployer, ap, user] = await ethers.getSigners();
  const token = await (
    await ethers.getContractFactory("MockERC20Decimals")
  ).deploy("Nvidia", "NVDAx", 18);
  await token.waitForDeployment();
  const H = await (await ethers.getContractFactory("RegistryCustodyHarness")).deploy();
  await H.waitForDeployment();
  await H.initialize();
  return { deployer, ap, user, token, H };
}

describe("RegistryCustody — wrap/unwrap", () => {
  it("idOf/tokenOf round-trip", async () => {
    const { H, token } = await deploy();
    const addr = await token.getAddress();
    const id = await H.idOf(addr);
    expect(await H.tokenOf(id)).to.equal(addr);
  });

  it("wrap pulls the real token and mints an equal claim id", async () => {
    const { ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 100n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 100n * UNIT);

    await H.connect(ap).wrap(addr, 40n * UNIT);

    expect(await token.balanceOf(await H.getAddress())).to.equal(40n * UNIT);
    expect(await H["balanceOf(address,uint256)"](ap.address, await H.idOf(addr))).to.equal(40n * UNIT);
  });

  it("unwrap burns the claim and returns the real token to `to`", async () => {
    const { ap, user, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 100n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 100n * UNIT);
    await H.connect(ap).wrap(addr, 40n * UNIT);

    await H.connect(ap).unwrap(addr, 25n * UNIT, user.address);

    expect(await token.balanceOf(user.address)).to.equal(25n * UNIT);
    expect(await H["balanceOf(address,uint256)"](ap.address, await H.idOf(addr))).to.equal(15n * UNIT);
  });

  it("unwrap more than the claim balance reverts", async () => {
    const { ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 10n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 10n * UNIT);
    await H.connect(ap).wrap(addr, 10n * UNIT);
    await expect(H.connect(ap).unwrap(addr, 11n * UNIT, ap.address)).to.be.reverted;
  });
});
