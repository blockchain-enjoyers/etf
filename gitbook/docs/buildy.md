# Engineering highlights

A handful of "hard problem to elegant solution" stories. Each is short; the depth is linked to the repo and the contracts reference, not retold here.

## The manipulation moat

A naive on-chain NAV is trivially manipulable: push one thin source and you move the basket value. Our L4 aggregator computes a **depth-weighted median** across multiple independent sources, with a hard **cap (40%) on how much any single source can move the result**, so a thin or hostile feed cannot drag the NAV. Thirteen source adapters sit behind one interface (DEX TWAPs, perps, signed committees, push and pull oracles), so the median always has independent ground to stand on. We mapped each known oracle exploit to its corresponding defense and measured the cost to move the median, turning manipulation resistance into a number rather than a claim. (Foundry invariant: `L4MedianCap`.)

Each of these is a passing test named after the real exploit it defends against:

| Exploit | The attack | The defense that holds |
| --- | --- | --- |
| Mango | thin perp pumped on funding and open interest | source dropped by depth and divergence; price unmoved |
| bZx | single-transaction spot manipulation | the engine never binds to spot |
| Harvest | balance-derived spot skew | outlier-rejected against the median |
| Inverse | a too-short TWAP window | rejected by the cardinality and staleness rules |
| Cream / Venus | one manipulable feed | requires three or more deep sources, or `safe` goes false |

The deeper point is that manipulation cost is measured **over a window, not at a point.** A one-block price push is cheap and self-reversing; what costs real money is *sustaining* a move across a TWAP window, because an arbitrageur trades the mispricing back every block and the manipulator pays that profit each time. On deep pools that integral is enormous: Euler's simulator priced a roughly 21% move of the UNI/WETH TWAP at over $470M, and the academic scaling law (Mackinga et al.) puts a Uniswap V2 TWAP-to-100x move at about $113M of standing capital. We turn that into an invariant we can size per constituent: `cost-to-sustain(delta, depth, window) > exposure_cap * weight * delta`.

The honest flip side, which is why the listing gate exists: those numbers hold only for *deep* pools. A thin pool has near-zero manipulation cost because there is no arbitrage liquidity to fight back, so the gate excludes any constituent too thin to defend at its weekend-trough depth. And the median resists a single manipulated source, not a colluding plurality of deep ones; the protection scales with how independent the sources genuinely are, which is why we name it as an assumption in [Honesty and limitations](honesty.md), not a guarantee. (External figures are cited as orders of magnitude, not measurements of our own testnet stand.)

## Cloning a fund family past the 24KB wall

A factory that deploys full fund logic per fund blows through the 24KB contract-size limit fast (ours hit 28.5KB with three vault types). We use **EIP-1167 clone-with-immutable-args** so each deployed basket is a tiny proxy to shared logic and the factory stays thin; the matrix grows by adding implementation addresses, not factory bytecode.

A 500-name index then hits two *different* walls, and they need two different fixes. The **gas wall** (moving 500 real balances every create) is solved with an **ERC-6909 internal ledger** (wrap once, then reassign claims internally) plus a **mutable Merkle root** that commits the whole recipe to 32 bytes, so a chunked create proves only the names it touches, and a **nested tree** of sub-baskets where a flat vault would not fit a block. The **approval wall** (500 separate token approvals) is orthogonal and is solved with a **Permit2 batch**, one signature. Conflating the two is the usual mistake; they are independent.

## The wrap-once basket: transferFrom that stops scaling with N

A 500-name in-kind create is, naively, 500 `transferFrom` calls *every time someone mints* — each an external call into a different ERC-20, roughly 60K gas a leg, so a single create blows past the 30M block limit before it ever finishes. We move that cost to a one-time boundary. The registry vault custodies constituents as an **ERC-6909 internal ledger** (`RegistryCustody`): an AP calls `wrap` / `batchWrap` once to turn real ERC-20 balances into internal claims, and even that boundary is chunked (`batchWrap` does up to `chunkSize` legs per tx, default 200, so building a 500-name inventory is a couple of transactions, never a block-overflowing one). After the wrap, every create and redeem moves claims by **internal `_transfer`** with no external token call per leg, so minting or burning the whole basket costs about what a single token move costs, independent of N. The expensive external transfers happen at most once per token, at `wrap`/`unwrap`, not on every mint. (Contract: `L1/recipe/RegistryCustody.sol`.)

## Deploying 300 names without guessing the gas

Each stock is itself an EIP-1167 clone: `StockCloneFactory.create` clones-and-initializes a shared `Stock` implementation in one cheap tx, so 300 names is 300 minimal proxies, not 300 full contracts. The deploy script (`scripts/deploy/deploy-demo-stocks.ts`) does not assume how many fit in a budget — it **probes**: deploy a small batch (default 10), measure the real cost per stock *including* its whitelist tx, then extrapolate how many more the remaining budget allows before deploying the rest. The basket that holds them commits its whole recipe as a single 32-byte Merkle root (`createRegistryIndex(genesisRoot, tokens, unitSize)`); the per-name `unitQty` lives off-chain in the tree and is proven at `bootstrap`, so the recipe never touches contract storage and the 301st name costs calldata and a proof, not an SSTORE.

## Settlement-design gas

Valuing a large basket on-chain naively gets expensive fast, and the per-leg cost is almost all storage reads and external calls, not arithmetic. We measured it:

| Constituents | Naive `navOf` | Committed-recipe path |
| --- | --- | --- |
| 50 | 1.39M gas | 93K gas |
| 200 | 5.44M gas | 300K gas |
| 500 | ~13.6M gas | **721K gas** |

By restructuring the settlement around a **trusted commitment path** (store the recipe as a 32-byte commitment, pass tokens and prices in calldata, validate against the commitment) we cut `navOf(500)` from about 13.6M gas to **721K**, roughly 19x. Even the fully-signed variant, which verifies a committee signature per leg, lands at 9.76M, still under the naive cached read. We benchmarked Stylus as a hypothesis and it barely moved the number, because it does not make a storage read or an external call cheaper. The lever is the architecture, not the runtime.

## The nine-gate settle: the keeper does not pick the moment

Forward-priced cash is the one path where a wrong moment could be exploited, so the settle function fails closed unless **nine** conditions all hold at once: the vault is seeded, every held token has a feed, the market is open, the NAV is `safe`, the prints are fresh, the cutoff has passed, there are enough observations, the struck price sits inside a TWAP band, and the stablecoin is on peg. The TWAP-band gate is the sharp one: it means a keeper cannot wait for a convenient tick and settle the whole queue against a price it nudged. There is one strike price per window, and the keeper only earns a tip if at least one ticket actually clears. The estimate can inform; it can never be the settlement price.

## Cash in, cash out, in USDG

In-kind create/redeem is the honest primitive, but no end user wants to source 500 tokens to buy one share, and that is the entire user-facing experience. The `ForwardCashQueue` lets them enter and exit with a single stablecoin (**USDG**): `requestCreate(cash)` escrows the USDG **non-custodially** and cancelable until the cutoff (`cancel`), and at the next US open a keeper's `settle` strikes every queued ticket at the *one* authoritative NAV. An external **AP sources the constituents at settle and keeps only the bid/ask spread, never a cut of the flow** (red line #3). Redeem mirrors it: `requestRedeem(shares)` out to USDG at the struck NAV. The only protocol fee is a **fixed** USDG ticket fee, clamped so it can never become a percentage of value, and the registry path enforces that the escrow asset and the vault's fee asset are the same USDG so the whole settle clears in one currency. So the user sees dollars in and dollars out; the basket machinery and the forward-pricing honesty (the estimate informs, it never settles) sit underneath. (Contract: `L5/ForwardCashQueue.sol`.)

## Anti-MEV without commit-reveal

Robinhood Chain orders transactions first-come-first-served, with no public mempool auction, so a naive rebalance would be sandwichable and there is no mempool to run a commit-reveal scheme against. We get the same protection from the mechanism itself. A rebalance runs as a **Dutch auction** that starts fund-favorable and decays toward fair value, with a per-leg floor: whoever fills, the vault is guaranteed at least the floor, and competition pulls the fill toward the fund-favorable end, so the value a searcher would have extracted is instead competed *into* the fund. The keeper's reward is a **bounded tip drawn from an escrow funded by a slice of the management fee** (the fee is charged by dilution, and the keeper takes a cut of that fee, never a fresh mint on execution and never a cut of flow), so triggering a rebalance can never mint the keeper free value. No commit-reveal, no private mempool needed.

## The short list

The rest of the engineering, in brief, with depth in the [repo](https://github.com/blockchain-enjoyers/etf):

- The **keyless multi-oracle**: a signed committee plus a mock verifier runs the full demo **without** the Chainlink Streams production key, so the stand is reproducible in a sandbox.
- The **Q7 measurements** and the full Foundry invariant suite (`L1Conservation`, `L3ClaimConservation`, `L4MedianCap`).
