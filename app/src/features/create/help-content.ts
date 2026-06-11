export interface FieldHelp {
  brief: string;
  extended?: string;
  example?: string;
}

export const CREATE_HELP: Record<string, FieldHelp> = {
  name: { brief: "The human-readable name of your index.", extended: "Shown across the app and stored on-chain at deploy. It does not affect mechanics.", example: '"US Tech 5"' },
  symbol: { brief: "The ticker for the basket token (max 8 chars).", extended: "Becomes the ERC-20 symbol of the index token holders receive.", example: '"TECH5"' },
  token: { brief: "The address of a tokenized stock the index holds.", extended: "Must be an ERC-20 on this chain. Rebalanced vaults also require it to be whitelisted as a constituent.", example: "0x… (PLTR)" },
  qtyPerUnit: { brief: "How many of this token sit in one creation unit.", extended: "Static/Managed/Committed baskets are defined by exact quantities — no price needed. Minting 1 unit deposits these amounts in-kind.", example: "50 PLTR + 12 NFLX per unit" },
  targetPct: { brief: "The share of the index this token should hold by value.", extended: "Rebalanced vaults hold target weights. The backend converts weights to starting quantities using live prices; a keeper trades back to target when drift exceeds the band.", example: "40% PLTR in a $1,000 unit = $400 of PLTR" },
  valuePerUnit: { brief: "The starting USD value of one creation unit.", extended: "Combined with the target weights and live prices, this fixes the initial token amounts seeded into the vault.", example: "$1,000/unit, 40% PLTR @ $132 → 3.03 PLTR" },
  creationUnit: { brief: "The smallest mintable/redeemable block of index shares.", extended: "Mint and redeem operate in whole creation units. Larger units mean fewer, chunkier transactions.", example: "1,000 shares per unit" },
  managerFee: { brief: "Annual streaming fee paid to the manager, in bps (max 200 = 2%/yr).", extended: "Accrued continuously from NAV. Independent of any protocol cut (Meridian takes 0%).", example: "50 bps on a $100k index ≈ $500/yr" },
  keeperCut: { brief: "Share OF the manager fee that funds the keeper budget, in bps (max 2000 = 20%).", extended: "Keepers are paid fixed tips per action from this budget — never a percentage of volume.", example: "1,000 bps = 10% of the manager fee" },
  keeperEscrow: { brief: "Anti-spam bond a keeper posts before recording prices or settling tickets.", extended: "Slashed for misbehavior, refunded otherwise. Leave blank to default to the shared KeeperModule.", example: "defaults to the KeeperModule" },
  "kind.basket": { brief: "Fixed token quantities, no rebalancing, zero fee.", extended: "Weights drift naturally with price. The simplest, cheapest, fully in-kind vault.", example: "Buy-and-hold 5 stocks forever" },
  "kind.managed": { brief: "Like Static, plus a capped, timelocked manager fee.", extended: "Same fixed holdings; the manager earns a streaming fee but has no composition power.", example: "A curated buy-and-hold with a 0.5%/yr fee" },
  "kind.committed": { brief: "Static holdings with the recipe committed by hash, passed at mint.", extended: "For very large baskets where storing the full recipe on-chain is costly. In-kind, zero fee.", example: "A 100-name index" },
  "kind.rebalance": { brief: "Holds target weights; a keeper rebalances via auctions.", extended: "You set target weights and a drift band; the keeper trades back to target when drift exceeds it. Adds manager + keeper economics.", example: "An equal-weight tech index held at 20% each" },
};
