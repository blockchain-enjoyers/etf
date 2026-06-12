import { describe, expect, it } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { buildBootstrapProofs, buildGenesisRoot } from "./registry-recipe.js";

const TOKEN_A = "0x000000000000000000000000000000000000aaaa" as const;
const TOKEN_B = "0x000000000000000000000000000000000000bbbb" as const;
const TOKEN_C = "0x000000000000000000000000000000000000cccc" as const;
const ENC = ["address", "uint256", "uint256"];
const UNIT_SIZE = 10n ** 18n;

describe("buildBootstrapProofs", () => {
  it("returns the SAME root + sorted arrays as buildGenesisRoot (proofs are the only addition)", () => {
    const tokens = [TOKEN_B, TOKEN_A, TOKEN_C];
    const unitQty = [3n * UNIT_SIZE, 2n * UNIT_SIZE, 1n * UNIT_SIZE];

    const genesis = buildGenesisRoot(tokens, unitQty, UNIT_SIZE);
    const boot = buildBootstrapProofs(tokens, unitQty, UNIT_SIZE);

    expect(boot.genesisRoot).toBe(genesis.genesisRoot);
    expect(boot.sortedTokens).toEqual(genesis.sortedTokens);
    expect(boot.sortedUnitQty).toEqual(genesis.sortedUnitQty);
    // Ascending order + qty re-aligned: A(2), B(3), C(1).
    expect(boot.sortedTokens).toEqual([TOKEN_A, TOKEN_B, TOKEN_C]);
    expect(boot.sortedUnitQty).toEqual([2n * UNIT_SIZE, 3n * UNIT_SIZE, 1n * UNIT_SIZE]);
  });

  it("emits one proof per token, aligned to sortedTokens, each verifying against the genesis root", () => {
    const tokens = [TOKEN_C, TOKEN_A, TOKEN_B];
    const unitQty = [1n * UNIT_SIZE, 2n * UNIT_SIZE, 3n * UNIT_SIZE];

    const { genesisRoot, sortedTokens, sortedUnitQty, proofs } = buildBootstrapProofs(tokens, unitQty, UNIT_SIZE);
    expect(proofs).toHaveLength(sortedTokens.length);

    // Recompute the tree independently and assert each proof verifies the aligned leaf against the root.
    const values = sortedTokens.map((t, i) => [t, sortedUnitQty[i]!.toString(), UNIT_SIZE.toString()]);
    const tree = StandardMerkleTree.of(values, ENC);
    expect(tree.root).toBe(genesisRoot);
    sortedTokens.forEach((t, i) => {
      const leaf = [t, sortedUnitQty[i]!.toString(), UNIT_SIZE.toString()];
      expect(StandardMerkleTree.verify(genesisRoot, ENC, leaf, proofs[i]!)).toBe(true);
    });
  });

  it("aligns the proof to its sorted-token index (a proof verifies only its own leaf)", () => {
    const { genesisRoot, sortedTokens, sortedUnitQty, proofs } = buildBootstrapProofs(
      [TOKEN_A, TOKEN_B],
      [2n * UNIT_SIZE, 3n * UNIT_SIZE],
      UNIT_SIZE,
    );
    // proofs[0] is A's proof — it must NOT verify B's leaf.
    const bLeaf = [sortedTokens[1]!, sortedUnitQty[1]!.toString(), UNIT_SIZE.toString()];
    expect(StandardMerkleTree.verify(genesisRoot, ENC, bLeaf, proofs[0]!)).toBe(false);
  });
});
