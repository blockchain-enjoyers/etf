import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE } from "../helpers";
import { deployCloneFactory } from "./helpers";

describe("CloneFactory — committed basket", () => {
  it("deploys a CommittedVault at the predicted address", async () => {
    const [issuer] = await ethers.getSigners();
    const T = await ethers.getContractFactory("PlainERC20");
    const a = await T.deploy("A", "A"); const b = await T.deploy("B", "B");
    const tokens = [await a.getAddress(), await b.getAddress()].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    const unitQty = [ONE, ONE];

    const factory = await deployCloneFactory();
    const userSalt = ethers.id("salt-1");

    const predicted = await factory.predictCommittedVaultAddress(issuer.address, tokens, unitQty, ONE, "C", "C", userSalt);
    await expect(factory.createCommittedBasket(tokens, unitQty, ONE, "C", "C", userSalt))
      .to.emit(factory, "CommittedBasketCreated");
    const vault = await ethers.getContractAt("CommittedVault", predicted);
    expect(await vault.recipeCommitment()).to.equal(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]","uint256[]","uint256"],[tokens,unitQty,ONE]))
    );
    // verify vault is registered
    expect(await factory.vaultCount()).to.equal(1);
    expect(await factory.allVaults(0)).to.equal(predicted);
  });
});
