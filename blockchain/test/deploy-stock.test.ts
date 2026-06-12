import { expect } from "chai";
import { ethers } from "hardhat";
import { deployStockImpl, deployStockCloneFactory, deployStockClone } from "../scripts/deploy/lib/deploy-stock";

describe("deploy-stock", () => {
  const MINTER_ROLE = ethers.id("MINTER_ROLE");

  it("deploys mint-restricted Stock clones; one global MINTER_ROLE grant covers all", async () => {
    const [admin, minter, user] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("AccessControlsRegistry");
    const reg = await Reg.deploy(admin.address);
    await reg.waitForDeployment();

    const impl = await deployStockImpl(await reg.getAddress());
    const factory = await deployStockCloneFactory();
    const cloneA = await deployStockClone(factory, impl, "Apple", "AAPL");
    const cloneB = await deployStockClone(factory, impl, "Tesla", "TSLA");

    const stockA = await ethers.getContractAt("Stock", cloneA);
    const stockB = await ethers.getContractAt("Stock", cloneB);

    // before grant: minter cannot mint
    await expect(stockA.connect(minter).mint(user.address, 1n)).to.be.reverted;

    // ONE global grant on the shared registry
    await reg.grantRole(MINTER_ROLE, minter.address);

    await stockA.connect(minter).mint(user.address, 100n * 10n ** 18n);
    await stockB.connect(minter).mint(user.address, 5n); // same grant covers cloneB
    expect(await stockA.balanceOf(user.address)).to.equal(100n * 10n ** 18n);
    expect(await stockB.balanceOf(user.address)).to.equal(5n);

    // a non-minter still reverts
    await expect(stockA.connect(user).mint(user.address, 1n)).to.be.reverted;

    // distinct metadata
    expect(await stockA.symbol()).to.equal("AAPL");
    expect(await stockB.symbol()).to.equal("TSLA");
    expect(await stockA.uid()).to.equal(ethers.encodeBytes32String("AAPL"));

    // the clone carries the new impl code: a fresh signer can faucetMint and receives 100e18
    const fresh = (await ethers.getSigners())[3];
    await stockA.connect(fresh).faucetMint();
    expect(await stockA.balanceOf(fresh.address)).to.equal(100n * 10n ** 18n);
  });

  it("rejects a symbol longer than 31 bytes", async () => {
    const [admin] = await ethers.getSigners();
    const Reg = await ethers.getContractFactory("AccessControlsRegistry");
    const reg = await Reg.deploy(admin.address);
    const impl = await deployStockImpl(await reg.getAddress());
    const factory = await deployStockCloneFactory();
    await expect(deployStockClone(factory, impl, "x", "A".repeat(32))).to.be.rejectedWith("symbol too long");
  });
});
