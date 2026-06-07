import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE } from "../helpers";
import { deployCloneFactory, deployCommittedVault } from "./helpers";

const coder = ethers.AbiCoder.defaultAbiCoder();

// PlainERC20 (mock/PermitMocks.sol): standard ERC20 with `mint`, no permit.
async function deployTokensSorted(n: number) {
  const T = await ethers.getContractFactory("PlainERC20");
  const toks = [];
  for (let i = 0; i < n; i++) toks.push(await T.deploy(`T${i}`, `T${i}`));
  const withAddr = await Promise.all(toks.map(async (t) => ({ t, addr: await t.getAddress() })));
  withAddr.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
  return withAddr;
}

describe("CommittedVault — calldata recipe validated against commitment", () => {
  it("create + redeem with the matching recipe; commitment & event are set", async () => {
    const [user] = await ethers.getSigners();
    const legs = await deployTokensSorted(2);
    const tokens = legs.map((l) => l.addr);
    const unitQty = [2n * ONE, 3n * ONE];

    // Deploy via CloneFactory (instead of direct constructor deploy).
    const vault = await deployCommittedVault(tokens, unitQty, ONE, "Committed", "CMT");
    const vaultAddr = await vault.getAddress();

    // commitment matches the canonical formula
    expect(await vault.recipeCommitment()).to.equal(
      ethers.keccak256(coder.encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, ONE]))
    );

    // fund + approve, then create 3 units
    for (const l of legs) {
      await l.t.mint(user.address, 1000n * ONE);
      await l.t.approve(vaultAddr, 1000n * ONE);
    }
    await expect(vault.create(3, tokens, unitQty)).to.emit(vault, "Created");
    expect(await vault.balanceOf(user.address)).to.equal(3n * ONE); // 3 * unitSize
    expect(await legs[0].t.balanceOf(vaultAddr)).to.equal(6n * ONE); // 2*3
    expect(await legs[1].t.balanceOf(vaultAddr)).to.equal(9n * ONE); // 3*3

    // redeem 1 unit-worth, pro-rata
    await expect(vault.redeem(ONE, tokens, unitQty)).to.emit(vault, "Redeemed");
    expect(await legs[0].t.balanceOf(vaultAddr)).to.equal(4n * ONE); // 6 - 6*(1/3)
  });

  it("reverts when the supplied recipe does not match the commitment", async () => {
    const legs = await deployTokensSorted(2);
    const tokens = legs.map((l) => l.addr);
    const vault = await deployCommittedVault(tokens, [ONE, ONE], ONE, "Committed", "CMT");
    await expect(vault.create(1, tokens, [2n * ONE, ONE])).to.be.revertedWithCustomError(vault, "RecipeMismatch");
  });

  it("reverts on an unsorted recipe at construction", async () => {
    const legs = await deployTokensSorted(2);
    const reversed = [legs[1].addr, legs[0].addr]; // descending
    const factory = await deployCloneFactory();
    await expect(
      factory.createCommittedBasket(reversed, [ONE, ONE], ONE, "Committed", "CMT", ethers.id("unsortedc"))
    ).to.be.reverted;
  });

  it("emits the full recipe at initialize (recoverable for redeem-liveness)", async () => {
    const legs = await deployTokensSorted(2);
    const tokens = legs.map((l) => l.addr);
    const unitQty = [2n * ONE, 3n * ONE];
    const factory = await deployCloneFactory();
    const [issuer] = await ethers.getSigners();
    const salt = ethers.id("emitevent");
    const addr = await factory.predictCommittedVaultAddress(issuer.address, tokens, unitQty, ONE, "Committed", "CMT", salt);
    // The RecipeCommitted event is emitted during factory.createCommittedBasket -> vault.initialize.
    await expect(factory.createCommittedBasket(tokens, unitQty, ONE, "Committed", "CMT", salt))
      .to.emit(await ethers.getContractAt("CommittedVault", addr), "RecipeCommitted");
  });
});
