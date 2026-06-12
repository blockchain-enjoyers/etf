import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// Genesis-recipe leaf encoding for the registry vault. This MUST match what the contract
// (RegistryRebalanceVault.bootstrap) verifies leaf-for-leaf, or createRegistryIndex/bootstrap
// reverts. Ported verbatim from blockchain/scripts/deploy/deploy-l5.ts:
//   ENC = ["address","uint256","uint256"]; leaf = [token, unitQty, unitSize].
// Tokens MUST be strictly ascending by BigInt(token); unitQty stays aligned to that order.
const ENC = ["address", "uint256", "uint256"] as const;

export interface GenesisRecipe {
  genesisRoot: `0x${string}`;
  sortedTokens: `0x${string}`[];
  sortedUnitQty: bigint[];
}

/** GenesisRecipe + the per-token Merkle proofs aligned 1:1 to sortedTokens (what bootstrap needs). */
export interface BootstrapRecipe extends GenesisRecipe {
  /** proofs[i] is the inclusion proof for sortedTokens[i] under genesisRoot. */
  proofs: `0x${string}`[][];
}

/** Sort (token, qty) pairs ascending by BigInt(token); returns the sorted arrays aligned to that order. */
function sortByToken(
  tokens: `0x${string}`[],
  unitQty: bigint[],
): { sortedTokens: `0x${string}`[]; sortedUnitQty: bigint[] } {
  const order = tokens
    .map((t, i) => ({ t, q: unitQty[i]! }))
    .sort((a, b) => (BigInt(a.t) < BigInt(b.t) ? -1 : 1));
  return { sortedTokens: order.map((o) => o.t), sortedUnitQty: order.map((o) => o.q) };
}

/**
 * Sort (token, qty) pairs ascending by BigInt(token), build the StandardMerkleTree over
 * (token, unitQty, unitSize) leaves, and return the root plus the sorted arrays the
 * createRegistryIndex struct must carry (genesisRoot + tokens, in the same sorted order).
 */
export function buildGenesisRoot(
  tokens: `0x${string}`[],
  unitQty: bigint[],
  unitSize: bigint,
): GenesisRecipe {
  const { sortedTokens, sortedUnitQty } = sortByToken(tokens, unitQty);
  const values = sortedTokens.map((t, i) => [t, sortedUnitQty[i]!.toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC as unknown as string[]);
  return { genesisRoot: tree.root as `0x${string}`, sortedTokens, sortedUnitQty };
}

/**
 * Same genesis tree as buildGenesisRoot, but ALSO return tree.getProof(i) for every leaf, aligned to
 * the sorted tokens. RegistryRebalanceVault.bootstrap(unitSize, tokens, unitQty, proofs) verifies each
 * leaf against recipeRoot with proofs[i], so proofs MUST be aligned to the SAME sorted order the root
 * was built over (deploy-l5.ts builds proofByToken[v[0]] then reindexes by the sorted tokens).
 */
export function buildBootstrapProofs(
  tokens: `0x${string}`[],
  unitQty: bigint[],
  unitSize: bigint,
): BootstrapRecipe {
  const { sortedTokens, sortedUnitQty } = sortByToken(tokens, unitQty);
  const values = sortedTokens.map((t, i) => [t, sortedUnitQty[i]!.toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC as unknown as string[]);

  // Reindex proofs by token (the tree iteration order is not guaranteed to match our sorted order).
  const proofByToken: Record<string, `0x${string}`[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[(v[0] as string).toLowerCase()] = tree.getProof(i) as `0x${string}`[];
  const proofs = sortedTokens.map((t) => proofByToken[t.toLowerCase()]!);

  return { genesisRoot: tree.root as `0x${string}`, sortedTokens, sortedUnitQty, proofs };
}
