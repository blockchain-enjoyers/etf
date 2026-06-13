# Meridian contracts

Neutral, non-custodial infrastructure for tokenized-equity baskets: 24/7 NAV with honest price-safety, plus
in-kind and forward-priced create/redeem. The contracts are organized as a **ladder of layers (L1 to L7)** -
each folder is one rung that adds one capability by composing the rungs below it, not by rewriting them.

**Three red lines (enforced in code):** (1) never custody - vaults are immutable clones with no admin key;
(2) never sign value-moving tx outside the user's own on-chain permissions; (3) never take a flow fee -
`FLOW_FEE_BPS = 0` is a constant with no setter. **Iron rule:** an estimate is never a settlement price.

**Build / dependency order:** L1 -> L4 -> L3 -> L5 -> L6. L4 (read-only) is built before L3 (acts on value) on
purpose. There is no `L2/` (the old market-hours cache was folded into L4 and deleted). L7 (leverage) is
horizon, not yet in this tree.

| Folder | Rung | What it lets you do | Why (design reason) |
| --- | --- | --- | --- |
| `L1/` | L1 | Deploy a tokenized basket/index and create/redeem it **in-kind, 24/7, oracle-free** | No price read => can't be drained by a wrong NAV; redeem never pauses; immutable clones keep non-custody and beat the 24KB wall |
| `L3/` | L3 | **Rebalance/reconstitute** an index (names in/out, reweight) without diluting holders or taking custody | Keeper paid from a slice of the fee escrow (not flow, not fresh mint); Dutch auction discovers price and is anti-MEV without commit-reveal |
| `L4/` | L4 | Publish a **trustworthy 24/7 NAV** (incl. the weekend) with a confidence band and a `safe` flag | Depth-weighted median + 40% cap + divergence filter = manipulation resistance; the product is price-safety, not a guess; neutral referee (reads sources, never overrides) |
| `L5/` | L5 | Enter/exit a basket with **cash (USDG)** instead of every constituent | Settles at the next market open (Rule 22c-1), never on the estimate; nine gates fail closed; escrow is cancelable before cutoff (non-custodial) |
| `L6/` | L6 | Take a **binding action 24/7** (weekend rebalance now; forced-redeem of capped positions later) through a buffer | The band-fits-the-buffer gate makes an imprecise weekend NAV safe; the estimate only triggers, the L3 auction settles at the clearing price |
| `mock/` | - | Run the whole stack in Hardhat **without a network or API keys** | Reproducible sandbox; the production adapters are drop-in replacements; never deployed to mainnet |

---

## `L1/` - in-kind baskets + the clone factory

The foundation: a non-custodial vault that mints basket tokens against a fixed recipe and redeems them
pro-rata, reading no price ever.

- `core/` - `VaultCore` (the spine: clone-args, `holdingsOf`, the fee/recipe seams), `RecipeLib`
  (`commitment = keccak256(tokens, unitQty, unitSize)` - the only coupling to L4), `MerkleRecipeLib` (leaf +
  proof for large baskets).
- `recipe/` - `StorageVaultBase` (recipe on-chain), `CommittedVaultBase` (recipe off-chain, 32-byte
  commitment), `RootCommitment` (mutable Merkle root + 7-day timelock, for 500-name indices),
  `RegistryCustody` (ERC-6909 internal ledger: wrap once, then move claims internally).
- `fee/` - `FeeCore` (AUM management fee charged by dilution; `FLOW_FEE_BPS = 0`).
- `modules/` - `IFeePolicy`, `IRebalanceStrategy` (provisioned seams, not yet wired).
- leaves: `BasketVault` (static, UIT analog), `ManagedVault` (+ streaming fee, index-fund analog),
  `CommittedVault` (off-chain recipe), `CloneFactory` (EIP-1167 clones; one impl per type).

**Use cases:** issue an ETF-style basket; in-kind create/redeem 24/7; a 500-name index without storing every
name on-chain; a cheap fund family. **Why:** non-custody + 24/7 redeemability are what keep a basket tracking
its underlying rather than drifting like a closed-end fund.

## `L3/` - rebalance + keeper engine

Lets an index change over time without custody or holder dilution.

- `rebalance/` - `RebalanceCore` (custody-agnostic holdings + `executeRebalance`), `RebalanceFeeCore` (the
  3-way fee split incl. the keeper leg).
- leaves: `ManagedRebalanceVault` (ERC-20 custody), `RegistryRebalanceVault` (ERC-6909 + Merkle, the 500-name
  path).
- engine: `RebalanceAuction` (Dutch auction executor), `KeeperModule` (bounded reward escrow),
  `RebalanceModule` (Schmitt-trigger is-due predicate), `RebalanceObserver` (TWAP over the robust L4 price),
  `IRebalanceExecutor`.

**Use cases:** scheduled reconstitution (S&P-style), threshold reweight (equal-weight reset), keeper-triggered
swaps. **Why:** value-conserving atomic swap + per-leg floor; keeper funded by the fund's fee, never a cut of
flow; the auction competes MEV into the fund instead of leaking it.

## `L4/` - 24/7 fair-value NAV (the differentiator)

A neutral, manipulation-resistant multi-source price referee. Read-only: a wrong model embarrasses, it does
not move value.

- `PriceAggregator` (per-asset depth-weighted median + confidence band + `safe` + `marketStatus`),
  `FairValueNAV` (basket sum-of-parts over `holdingsOf`), `IPriceSource`, `OracleTypes` (the `MarketStatus`
  enum: `Open < Degraded < Halted < Closed < Unknown`).
- `adapters/` - the source library (DEX TWAPs: Uniswap v2/v3/v4, Curve; perps: GMX; signed committees:
  RedStone/Chronicle/Universal; push/pull: Chainlink Feeds/Streams/Tokenized, Pyth; `BetaProjectionSource`
  for the weekend signal), plus `adapters/lib/` (`FullMath`, `TickMath`).
- `interfaces/` (`IRecipeVault`), `mocks/` (`MockSource`, `MockRecipeVault`).

**Use cases:** a weekend-surviving basket NAV; a `safe` flag any consumer (a lending market, a dashboard, a
risk engine) uses to know when **not** to trust the price. **Why:** depth-weighted median + a 40% per-source
cap + a divergence filter make a single hostile feed unable to move the NAV; the band widens honestly as
sources thin or disagree; the protocol never computes a fair value of its own (even beta is fund-signed).

## `L5/` - forward-priced cash entry/exit

The only path where a price is unavoidable, so it is never the estimate.

- `ForwardCashQueue` (ERC-7540 async queue; the nine-gate settle), `BasketNavObserver` (navPerShare TWAP for
  the sanity gate), `interfaces/` (`IAPFiller`, `IRegistryVault`).

**Use cases:** subscribe/redeem with USDG; a market maker (AP) sources or unwinds the basket. **Why:** the
settle function fails closed unless all nine gates hold (market Open, NAV safe, fresh, cutoff passed, TWAP
band, peg, ...), so a closed-market estimate can never become a settlement price; the queue holds the user's
funds only in a cancelable, code-only escrow.

## `L6/` - 24/7 binding action via a buffered trigger

The newest rung: makes a binding action safe to take while the US market is closed, by treating the NAV as a
trigger (never a settlement value) absorbed by a buffer.

- `BufferedTriggerGuard` (the compute-and-gate predicate: band-fits-the-buffer + market eligibility +
  sequencer + listing + sustained-drift, then opens the L3 auction), `SequencerGuard` (L2 sequencer-uptime +
  restart-grace), `interfaces/` (`IBufferedTrigger`).

**Use cases (shipped):** a 24/7 weekend rebalance under the guard. **Use cases (designed, Phase 2):** forced
redeem of an exposure-capped position; the consumer "enter at 101 / exit at 99" register. **Why:** the
`bandBps <= eMaxBps` gate is the quantitative reason an imprecise weekend NAV is safe - the estimate only
decides whether to act; the existing L3 auction settles at the realized clearing price, so the iron rule
holds. L6 is **additive**: it composes the deployed L3/L4 contracts and changes none of them (no new factory).

## `mock/` - test-only stand-ins (never mainnet)

Everything needed to run the full stack in Hardhat without a live network or provider keys.

- `ChainLink/` (VerifierProxy + report mocks), `USDG/` (the settlement stablecoin), `dex/` (Uniswap/Curve/GMX
  pool mocks), `pyth/`, `registry/` (custody/Merkle harnesses), `stock/` (the demo Stock clones + faucet +
  scaled-UI), plus single mocks (`MockSource`, `MockHoldingsNav`, `MockListingAggregator`,
  `MockSequencerUptimeFeed`, `MockERC20Decimals`, peg/feed/AP mocks).

**Use cases:** the keyless demo (a signed committee + a mock verifier runs the stand without the Chainlink
Streams production key); the reproducible test suite; the demo-stand stocks. **Why:** the L4 adapters are
designed so a mock source and a production source are interchangeable behind `IPriceSource`, so the engine is
exercised end to end before any live feed exists.
