import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ENC = ["address", "uint256", "uint256"]; // token, unitQty, unitSize
const UNIT = 10n ** 18n;

function buildTree(legs: { token: string; qty: bigint }[]) {
  const values = legs.map((l) => [l.token, l.qty.toString(), UNIT.toString()]);
  return StandardMerkleTree.of(values, ENC);
}

describe("MerkleRecipeLib", () => {
  it("verifies a valid single-leaf proof and rejects a tampered one", async () => {
    const H = await (await ethers.getContractFactory("MerkleRecipeLibHarness")).deploy();
    const legs = [
      { token: "0x0000000000000000000000000000000000000A11", qty: 3n },
      { token: "0x0000000000000000000000000000000000000B22", qty: 6n },
      { token: "0x0000000000000000000000000000000000000C33", qty: 1n },
    ];
    const tree = buildTree(legs);
    const root = tree.root;

    let proof: string[] = [];
    for (const [i] of tree.entries()) if (i === 0) proof = tree.getProof(i);

    expect(await H.verify(root, proof, legs[0].token, legs[0].qty, UNIT)).to.equal(true);
    expect(await H.verify(root, proof, legs[0].token, 999n, UNIT)).to.equal(false);
    // wrong token (right qty) -> reject: proves the token field is bound in the leaf
    expect(await H.verify(root, proof, legs[1].token, legs[0].qty, UNIT)).to.equal(false);
  });

  it("leaf matches the StandardMerkleTree leaf encoding", async () => {
    const H = await (await ethers.getContractFactory("MerkleRecipeLibHarness")).deploy();
    const token = "0x0000000000000000000000000000000000000A11";
    const qty = 3n;
    const expected =
      StandardMerkleTree.of([[token, qty.toString(), UNIT.toString()]], ENC).leafHash([
        token,
        qty.toString(),
        UNIT.toString(),
      ]);
    expect(await H.leaf(token, qty, UNIT)).to.equal(expected);
  });
});
