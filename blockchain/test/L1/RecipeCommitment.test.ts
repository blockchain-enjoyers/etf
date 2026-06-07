import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, Leg } from "../helpers";
import { deployBasketVault } from "./helpers";

const coder = ethers.AbiCoder.defaultAbiCoder();

describe("recipeCommitment", () => {
  it("BasketVault.recipeCommitment() == keccak256(abi.encode(tokens, unitQty, unitSize))", async () => {
    const [deployer] = await ethers.getSigners();
    const registry = await deployRegistry(deployer.address);
    await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();
    const a = await deployStock(registry, "Tesla", "TSLA");
    const b = await deployStock(registry, "Nvidia", "NVDA");
    const legs: Leg[] = sortRecipe([
      { stock: a, addr: await a.getAddress(), qty: 2n * ONE },
      { stock: b, addr: await b.getAddress(), qty: 5n * ONE },
    ]);
    const tokens = legs.map((l) => l.addr);
    const unitQty = legs.map((l) => l.qty);

    // Deploy via CloneFactory.
    const vault = await deployBasketVault(tokens, unitQty, ONE, "Basket", "BSK");

    const expected = ethers.keccak256(
      coder.encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, ONE])
    );
    expect(await vault.recipeCommitment()).to.equal(expected);
  });
});
