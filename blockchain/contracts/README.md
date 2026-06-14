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

---

## Deployed on Robinhood Chain testnet (chain 46630)

Explorer base: `https://explorer.testnet.chain.robinhood.com/address/<addr>`. Every address was confirmed as a deployed contract on Blockscout (creation tx listed); source verification is a pre-submission to-do.

### Core engine

| Contract | Address | Creation tx |
|---|---|---|
| CloneFactory | `0x453B28529273E240120D6475F2369e002deb13F5` | `0x1ced7645011f200553dd45b6f0b4cbc332e7ed8252701e05359979ba0ab46acd` |
| PriceAggregator | `0x77b009D07BDdC08a6b83c9859fEF77C714f37f00` | `0x95ca92989a9fcfba6353cf2b3ee6b199c42800c690b60926152bcf5f6edd2ae7` |
| FairValueNAV | `0xAdec095EBB432239C19ba915aC167B9A3b3E0DD5` | `0xe3091be186af456f0d05b74cb11d73f202375249b0a27f1c3bf5c06e83b57ff1` |
| USDG (USD Global) | `0x5F28D5E0939FDb94943d5C65241cBf850c3d98d1` | `0x739521a19edeec25ffb25de51483c5b8ec5f9df6f1a47b602c401f9921c75986` |

### Vaults + lifecycle (L3-L5)

| Contract | Address | Creation tx |
|---|---|---|
| RegistryRebalanceVault | `0x8937A6EE95097B5a794994Dce7c90C1168Af7205` | `0x407482875a9faf806a83d195cde8f09d7a4b339ddb2ae4a601f5c34b80a91817` |
| RegistryIndex (demo fund: Volatile Tech Basket) | `0x3F78db0F384e4bf325809F0f417ef4Afa76B2E4F` | `0xe98895400b0c52aa4a9539ffbe75a10e2b532902e7934230455660c0aabe290f` |
| ForwardCashQueue | `0x29d7dF7bC257180d56d9340C85Af67fA96fF88a2` | `0x4d03d8a461f065c4f21ef291b5ba1eec39e329f9f70b02388a4b49d0e88dae4e` |
| BasketNavObserver | `0xe4f4ABefe290af163142A09dC9C41852DDe09Ca5` | `0xd5188fecf2c4cb58422c05cdc3d69150f9ea6f4d1ee307b7b23d3b2d61ab9ed7` |
| KeeperModule | `0x746db09AC8c7DE315dCd5A19732033fb0F14f877` | `0x68d7178532373cc29743fed7c98af05e9d4f201471846e6eace0c5088ec7833a` |
| RebalanceAuction | `0xD39AA1Cab5E24150257e5FEd43A4d79c53e47CCc` | `0x8576dc17d834c57a6bbdab46b61964d2f41dd0a7a3ff489f149d1b00d68af7a4` |
| ManagedRebalanceVault | `0x2E578Bd5e288ae6f62708D1BFd5f806b2F092e61` | `0x45d55cbed7e8076bda3d6db95b513a6e7b06b232b8ec3c5b799802c01efef1ef` |

### L4 price sources (keyless multi-oracle committee)

| Contract | Address | Creation tx |
|---|---|---|
| UniversalSignedSource | `0x41BE2284c8bBc5C89B5e2Bd4784a10B2646691aA` | `0x5559d39f07b55f4cd75d474f91bac168577b27f52120bf2e8734ce132a1e06a0` |
| UniversalSignedSourceWeekend | `0x32207892289a101d8546A430AbBdf62DD2049fFd` | `0x0950e29902ff0c06f221973080cf7a6528977aa04d93ee176220432c938e1a92` |
| ChainlinkStreamsSource | `0x9b5747f8A46EbEb70Ab4E111dBD873cf7620C2Bb` | `0x3636af99fd3524db640e82c7203a3c0a260a25c7c7100625f1392fbca7c61bb6` |
| MockVerifierProxy | `0x7703a06F6E43752B989a4aa6cA5e969d3e5af6CB` | `0x1bb7ebc6e927cb22a134180ff0d9cad51c7b86c6a519b226257b62d156e9c883` |

### Demo constituents (our ERC-8056 mocks)

| Token | Address | Creation tx |
|---|---|---|
| MSTRx | `0x89eC78b779E00bc99044656b04a8DB059c9b7270` | `0xb98576442a713a58ce3d8c1cfa9ad70783c84fa9308247b5899e2a361d6b933f` |
| TSLAx | `0xB1EB0688FEA9011F38275a77b1BE7f2dCFb290C3` | `0x1a3a5237e12295a849127d0a8e1a9aa543f6879ebc4f2bcc4cf0ab377ae199e6` |
| NVDAx | `0x1d2DC78A673E3040E188b2551DA2ec4785fB49a1` | `0x465d05977dae9562e41692e8a11136c7e4d644441a0c20435e84706085cd72aa` |

The live registry demo runs a 3-name subset (MSTRx, TSLAx, NVDAx). The protocol also wires the official Robinhood testnet stocks (TSLA, AMZN, PLTR, NFLX, AMD) for the authentic in-kind create path.
