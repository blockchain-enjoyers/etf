# Meridian: neutral 24/7 NAV + in-kind create/redeem for tokenized-equity baskets

Meridian is neutral, non-custodial 24/7 NAV and create/redeem infrastructure for tokenized-equity baskets (on-chain ETFs), so competing platforms can trust the same price. We do not pick constituents, we do not issue funds, and we never custody assets. A mint button is cloned in a weekend; a safe 24/7 engine is not.

---

## Judges start here

**✅ Deployed on Robinhood Chain testnet (chain 46630)**: the full L1-L5 stack is live (the binary deployment gate). Blockscout source-verification is in progress; bytecode is live and reproducible from this repo. Core: [CloneFactory](https://explorer.testnet.chain.robinhood.com/address/0x453B28529273E240120D6475F2369e002deb13F5) · [FairValueNAV](https://explorer.testnet.chain.robinhood.com/address/0xAdec095EBB432239C19ba915aC167B9A3b3E0DD5) · [ForwardCashQueue](https://explorer.testnet.chain.robinhood.com/address/0x29d7dF7bC257180d56d9340C85Af67fA96fF88a2) · [full address table below](#deployed--verifiable-artifacts).

**▶ Break the oracle yourself (60 seconds, no wallet):** [meridian-playground.up.railway.app](https://meridian-playground.up.railway.app): open the **"Tamper a source"** preset: corrupt Uniswap to +40% and watch the basket NAV barely move. Then "Replay Oct 2025" to watch the band stay honest through the crash weekend.

**Watch it run:** a ~2:00 live product demo and a ~2:30 narrative pitch (videos accompany this submission).

**See it:** the slide deck is in this repo ([`pitch/presentation.html`](pitch/presentation.html)). A scientific paper (calibration & method) accompanies the submission.

> All on-chain prices in the demo are synthetic / sandbox feeds (a keyless signed-committee oracle runs the stand without a live Chainlink Streams key). The backtest is descriptive, testnet-only. No live-source or precision claim.

### Claims → evidence

| # | Claim | Proof (one click) |
|---|---|---|
| 1 | It stays honest when a price source is corrupted | playground **"Tamper a source"** preset · demo video climax |
| 2 | Calibrated on the largest liquidation event in crypto history (10-12 Oct 2025) | backtest over 186 real windows (method in the paper) |
| 3 | A real 500-name index fits on-chain: `navOf(500)` 13.6M → 721K gas | commitment-plus-calldata design · paper (gas section) |
| 4 | The vault is never under-collateralized; one source can't move the median | Foundry invariants `L1Conservation`, `L4MedianCap` |
| 5 | We caught our own broken-NAV wiring before shipping | multi-agent freeze-review (self-audit), gating paths hardened |
| 6 | Full non-custodial lifecycle is deployed, not planned | L1-L5 [address table](#deployed--verifiable-artifacts) on chain 46630 |

---

## The problem: the weekend gap

Tokenized stocks trade on-chain 24/7, but equity price oracles freeze at the Friday close and do not update until Monday. The US market is closed roughly 80% of the hours in a week. Every index or basket product inherits an unanswerable question: what is this basket worth at 2am Saturday? There are two bad answers: a stale ghost price (exploitable, under-collateralizes lenders), or no value at all (safe, but it defers the problem one layer down).

This is not hypothetical. Over the weekend of 10-12 Oct 2025, the largest liquidation event in crypto history, on-chain equity oracles sat frozen while real value moved: in our backtest of that window the on-chain price moved NVDAx +3.96%, TSLAx +5.04%, QQQx +2.22%, SPYx +1.74% before Monday's open confirmed the direction. A Friday-close ghost price could see none of it. RedStone has publicly framed this as the on-chain "ghost price" problem; our contribution is to make the price *safe*, not to claim we solved fair value.

## What you can do with it

Create a tokenized fund in one click, non-custodial and honestly backed. Then get in and out around the clock with one token: in-kind anytime (no price needed, never pauses), or cash via a forward-priced queue that settles live when the market is open and at the next authoritative open when it is closed, never on a guess. One engine builds single-name baskets, sector indices, or a full S&P 500 wrapper.

## What we built (L1-L5, deployed)

- **L1 collateral + clone factory:** USDG-denominated accounting and a CloneFactory (EIP-1167 minimal proxies) that stamps out new basket vaults past the 24KB size wall.
- **L2-L3 in-kind vault + rebalance:** deposit the underlying basket to mint, burn for the pro-rata underlying; keeper / Dutch-auction module rebalances the registry index. A 500-name registry uses ERC-6909 internal accounting + a Merkle-committed recipe (the gas/calldata and approval walls solved with a tree + Permit2).
- **L4 price-safety engine:** a keyless multi-oracle committee (signed sources + verifier) feeds a read-only FairValueNAV emitting NAV, a confidence band, and a market-status flag. A depth-weighted median (depth = cost-to-move) with a per-source weight cap and a divergence filter rejects manipulation. The estimate is a trigger band, never a settlement value.
- **L5 forward cash queue:** closed-window cash flows settle at the next market open, never at an estimate. In-kind redeem is price-free and never pauses; only the cash path gates.

The iron rule: an estimated / fair-value price is never a settlement price. Estimation feeds information and risk; forward pricing feeds honest backing. This is **one product**: the price-safety engine is the integrity layer that makes the 24/7 fund safe, not a separate oracle.

## The evidence

A V0 validation backtest on real on-chain data (8 Backed xStocks on Solana, 186 closed windows; study period Sep 2025 to May 2026). The history is thin (~45 weekends), so the result is descriptive: we lead with materiality, not accuracy, and make no precision claim.

- **Materiality:** weekend within-window median absolute move **0.90%** vs **0.67%** weeknight (p90 3.01% vs 2.55%); weekends exceed weeknights on every magnitude measure. The gap concentrates in volatile single names (MSTRx +0.98%, TSLAx +0.85% weekend edge), near-zero on broad indices (SPYx +0.02%).
- **Directional reliability:** correlation between on-chain dislocation and the realized Monday open ≈ **0.91** (271 name-weekend pairs, 8 names, 34 weekends).
- **Band honesty:** the confidence band is calibrated, not assumed: empirical coverage **67% at 1σ, 95% at 2σ** (n=75), near the nominal 68%/95%.
- **Model:** a simple index-beta model cuts reopen error ~35-60% vs naive carry-forward; the on-chain xStock itself 43-68%. Added complexity does not beat the simple model at this sample size, so we did not build it out.

**Verdict: CONDITIONAL GO**, with the NO-GO stated up front: if the measured weekend dislocation had sat inside the AMM spread, or the model had failed out of sample, we would not build the heavy engine. It did not, and the Oct-2025 window (out-of-distribution stress, not in the fit set) confirmed direction.

The backtest is a descriptive study over 186 closed windows (~45 weekends), with no precision claim; full method, figures, and numbers are in the scientific paper that accompanies this submission.

## Smart contract quality

- ~307 unit tests (`cd blockchain && npx hardhat test`) + Foundry invariants (`forge test`): `L1Conservation` (never under-collateralized), `L3ClaimConservation` (rebalance conserves value), `L4MedianCap` (a single source cannot move the median beyond the cap).
- Layered L1-L5, clone-based vault families, modular oracle sources, fail-closed gating (a self-audit freeze-review hardened the gating paths).
- Three architectural red lines, enforced in code: never custody funds; never sign value-moving tx outside the user's own on-chain permissions; never take a rate on transaction / flow volume (`FLOW_FEE_BPS = 0`, no setter).

## Why on Robinhood Chain

The one chain where tokenized equities already live (stocks, ETFs, indices, native). We compose baskets from their own tokens, we do not bootstrap liquidity; we issue nothing, hold nothing, and take nothing from flow. A complement to Robinhood, not a competitor on their chain. (Robinhood Chain is a neutral deployment venue; no partner or customer relationship is claimed.)

## Run it

```bash
# Contracts: ~307 unit tests + foundry invariants
cd blockchain
npx hardhat test          # ~307 green
forge test                # L1Conservation, L3ClaimConservation, L4MedianCap

# Reproduce the V0 backtest (zero network on warm cache)
cd research/v0
python build_panel.py && python h2_analysis.py && python robustness.py && python event_studies.py && python models.py && python figures.py
```

Deploy scripts: [`blockchain/scripts/deploy/`](blockchain/scripts/deploy/). The burner key in `blockchain/.env` is a throwaway, gitignored, rotated after the buildathon.

## Roadmap

L1-L5 shipped and deployed on testnet; mainnet path defined. Next: the SP500 scale-out to 100+ constituents, and the L6/L7 consumer + creator-economy layer (clone-based vault families, a tradeable secondary market, dividend pass-through). Shipped vs designed vs vision is stated honestly throughout.

## Honesty / limitations

- The backtest is thin (~45 weekends, 8 names), descriptive: no significance test, no precision claim. We follow the institutional state of the art (acknowledge the gap, do not paper over it with false precision).
- The edge concentrates in volatile single names; broad-index wrappers show almost no weekend-specific edge. We say so.
- Testnet sandbox: all on-chain demo prices are synthetic / mock feeds, run by a keyless committee without a live Chainlink Streams key.
- The live registry demo is a 3-name subset (MSTRx, TSLAx, NVDAx); the 100+ scale-out is roadmap, not a live 500.
- The deliverable is price-safety (knowing when not to trust the price) plus honest in-kind backing, not edge-pricing and not "we solved fair value."

---

## Deployed / verifiable artifacts

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

---

Meridian is neutral, non-custodial infrastructure to create tokenized-basket funds that work 24/7, with honest price-safety even when the market is closed.
