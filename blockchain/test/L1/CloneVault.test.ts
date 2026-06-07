import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE, deployCloneFactory } from "./helpers";

const coder = ethers.AbiCoder.defaultAbiCoder();

describe("Clone vault semantics", () => {
  it("predicted address == deployed address; getters read clone-args", async () => {
    const [issuer] = await ethers.getSigners();
    const T = await ethers.getContractFactory("PlainERC20");
    const a = await T.deploy("A","A"); const b = await T.deploy("B","B");
    const tokens = [await a.getAddress(), await b.getAddress()].sort((x,y)=>BigInt(x)<BigInt(y)?-1:1);
    const unitQty = [ONE, ONE];
    const factory = await deployCloneFactory();
    const salt = ethers.id("s1");
    const predicted = await factory.predictBasketAddress(issuer.address, tokens, unitQty, ONE, "X","X", salt);
    await (await factory.createBasket(tokens, unitQty, ONE, "X","X", salt)).wait();
    const vault = await ethers.getContractAt("BasketVault", predicted);
    expect(await vault.unitSize()).to.equal(ONE);
    expect(await vault.recipeCommitment()).to.equal(
      ethers.keccak256(coder.encode(["address[]","uint256[]","uint256"],[tokens,unitQty,ONE]))
    );
  });

  it("the implementation itself cannot be initialized (disabled)", async () => {
    const impl = await (await ethers.getContractFactory("BasketVault")).deploy();
    await expect(impl.initialize([], [], "X", "X")).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  it("a clone cannot be initialized twice", async () => {
    const [issuer] = await ethers.getSigners();
    const T = await ethers.getContractFactory("PlainERC20");
    const a = await T.deploy("A","A");
    const tokens = [await a.getAddress()]; const unitQty = [ONE];
    const factory = await deployCloneFactory();
    const salt = ethers.id("s2");
    const predicted = await factory.predictBasketAddress(issuer.address, tokens, unitQty, ONE, "X","X", salt);
    await (await factory.createBasket(tokens, unitQty, ONE, "X","X", salt)).wait();
    const vault = await ethers.getContractAt("BasketVault", predicted);
    await expect(vault.initialize(tokens, unitQty, "X","X")).to.be.revertedWithCustomError(vault, "InvalidInitialization");
  });
});
