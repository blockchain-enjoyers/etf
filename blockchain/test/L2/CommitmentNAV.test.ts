// blockchain/test/L2/CommitmentNAV.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE } from "./helpers";

const coder = ethers.AbiCoder.defaultAbiCoder();

async function deploy(tokens: string[], unitQty: bigint[], unitSize: bigint) {
  const C = await ethers.getContractFactory("CommitmentNAV");
  const c = await C.deploy(tokens, unitQty, unitSize);
  await c.waitForDeployment();
  return c;
}

describe("CommitmentNAV — calldata recipe + prices", () => {
  it("computes Σ unitQty·price and matches the commitment", async () => {
    const tokens = ["0x1111111111111111111111111111111111111111",
                    "0x2222222222222222222222222222222222222222"];
    const unitQty = [2n * ONE, 3n * ONE];
    const c = await deploy(tokens, unitQty, ONE);
    // prices: $300 and $1 (1e18)
    const nav = await c.navFromCalldata(tokens, unitQty, ONE, [300n * ONE, 1n * ONE]);
    // 2*300 + 3*1 = 603e18
    expect(nav).to.equal(603n * ONE);
  });

  it("reverts when the recipe does not match the commitment", async () => {
    const tokens = ["0x1111111111111111111111111111111111111111"];
    const c = await deploy(tokens, [ONE], ONE);
    await expect(
      c.navFromCalldata(["0x2222222222222222222222222222222222222222"], [ONE], ONE, [ONE])
    ).to.be.revertedWithCustomError(c, "RecipeMismatch");
  });
});
