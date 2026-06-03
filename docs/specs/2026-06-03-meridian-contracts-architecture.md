# Meridian — Contracts Architecture Spec

> Date: 2026-06-03
> Status: APPROVED (brainstorm complete; build = compile-green scaffold)
> Scope: modular vault architecture for the 24/7 NAV + in-kind create/redeem infrastructure layer (state.md §4).
> Code lives in the team repo `projects/etf/` (Foundry). This doc is the design source of truth.
> Build target: `forge build` green — full interfaces + fully implemented mocks + module skeletons + this test-scenario matrix. Real module logic and the fair-value model are NOT in scope here (they come from V0/research).

---

## 0. Constraints extracted from research (R#)

Contract-relevant constraints harvested in STEP 0 (R1-R7 + V0 + PROTOCOL_SPEC + synthesis D1-D8). Each drives a design decision below.

### Precedent contracts (R1 Tilt, R2 EqualFi)
- **[R1]** Tilt = registry + engines: `UserVaultFactory` deploys ERC-4626 BeaconProxy vaults, registers in `VaultRegistry`, authorizes on `RebalanceEngine`, prices via `TokenRouter`. Curator sets weights via **time-lock**; only curator triggers `rebalance()`; up to 30 tokens. Stale policy = "use last price, never pause" (this is the **bug** we fix). Mock `TokenRouter` on testnet mints/burns at oracle price with infinite liquidity.
- **[R1]** Tilt fees: 0.1-0.3% entry + 0.5% exit + mgmt/perf via share dilution. **Volume take-rate -> conflicts red line #3.**
- **[R2]** EqualFi = ERC-2535 Diamond monolith, solc **0.8.33**, Foundry. In-kind deposit-bundle -> mint ERC-20 index; burn -> pro-rata underlying + fee-pot share. **No oracle, no USD NAV, no rebalancing** (the gap we fill). "Road to immutability": freeze facets progressively, only fee params adjustable post-freeze with **hard-coded bounds**.
- **[R2]** EqualFi fees: mint **150 bps** + burn **250 bps** = 4% round-trip. **Kills in-kind arbitrage; conflicts red line #3.** Our differentiator = zero protocol fee.
- **[R2]** Position NFT / ERC-6551 encumbrance = capital-efficiency add-on, **not core** to basket NAV/CR. Defer.

### ETF plumbing + fair value (R3, R4, R6)
- **[R3]** PCF (Portfolio Composition File) = on-chain basket definition: `{constituents (ticker, shareQty, weight), cashComponent, creationUnitSize}`. Creation unit ~50k shares fiat; on-chain = parameterized. Rebalance cadence quarterly-annual, **rules-based/deterministic only**.
- **[R3]** In-kind default (tax-efficient); cash mode only for non-eligible/fractional balancing. On-chain in-kind = atomic swap basket<->index token, T+0, 24/7, no settlement intermediary.
- **[R3]** NAV = (assets - liabilities) / sharesOutstanding. Cash component folds into asset value.
- **[R3]** Corporate actions = "genuine difficulty": splits change unit-math (PCF update), dividends accrue cash to holders (reinvest vs payout). **Custom/non-pro-rata baskets (6c-11): defer past v1.**
- **[R4/R6]** Fair value: `NAV_est = lastClose * (1 + beta . signalReturn)`; v1 beta ~= 1 (no per-asset fit), v2 per-asset. Confidence band widens **sub-linearly** (French-Roll: 3-day weekend ~= 1.1x one trading-day variance, NOT sqrt(calendar)). **Betas fit OFF-CHAIN, applied on-chain/oracle-pushed.**
- **[R4]** **IRON RULE: an estimate is NEVER a settlement price.** Read-only fair-value feeds risk/secondary; settlement = in-kind (oracle-free) or forward-priced (next open). Hard separation in contract surface.
- **[R4]** Market-status state machine: open / extended / closed(overnight,weekend,holiday) / halt-degraded. Gates confidence and settlement behavior.
- **[R4]** Forward pricing (Rule 22c-1 port): closed-window cash flows queue, settle at next-open authoritative price.
- **[R4]** Proof-of-Reserve: vault holds exactly the PCF constituents; qty >= supply requirement; mint fails if bundle incomplete, redeem fails if depleted. Rule 2a-5 discipline = publish methodology + on-chain back-test (credibility, not legal requirement).

### Oracles + security (R5, R7)
- **[R5]** Chainlink Equities Data Streams (RWA v11): fields `price` (8-dec), `bid/ask`, `marketStatus` (uint8 enum **0=Unknown,1=Pre,2=Regular,3=Post,4=Overnight,5=Closed**), `lastSeenTimestampNs` (ns), `lastTradedPrice`. **24/5 NOT 24/7**; weekend = status 5, deliberately stale. Staleness = `block.timestamp*1e9 - lastSeenTimestampNs`.
- **[R5]** Normalized adapter reading = `{price, confidence, timestamp, marketStatus, source}`. Fusion fallback order: Chainlink(if !=5) -> Pyth -> RedStone -> DEX-TWAP -> perp-mark -> last-close. Divergence check vs robust median; widen confidence as sources scatter. **Never single-source settlement.**
- **[R5]** Chainlink Tokenized Asset v10 = corporate-actions stream `{eventType, eventDate, splitRatio, dividendPerShare}`. **No public struct -> mock now.**
- **[R5]** RedStone PoR = signed report `{asset, totalSupply, custodiedBalance, timestamp, signature}`; consumer checks `custodiedBalance >= totalSupply`. Pyth confidence = uint64 interval; quote off adverse bound.
- **[R5]** Kamino auto-pause: when `marketStatus==5` OR staleness > threshold -> pause new positions, halt liquidations, keep existing, auto-resume on fresh.
- **[R7]** Buffered-trigger: `e_max = 1/[L(1+b)] - 1`. L=0.80,b=0.05 -> +19%; L=0.70,b=0.08 -> +32%. Soft band +-1%, hard band +-3-5% (wider than Chainlink deviation 0.05-0.5%). Force-redeem only on **sustained** deviation.
- **[R7]** TWAP: 30min weekday / 1-2h weekend; **cardinality minimum** `obs >= window/blockTime` (Inverse/Rari died from too-few samples). Listing gate `m.C1(delta,depth) > L.weight.delta.TVL` at **weekend-trough depth** = single most important control; else cap weight/exclude.
- **[R7]** Liquidation: close factor 50%->100% for dust; Dutch-auction redemption with `tip` (flat) + `chip` (proportional) keeper incentive.
- **[R7]** Sequencer risk (Orbit-L2 RHC): Chainlink L2 Sequencer Uptime Feed `latestRoundData() -> (,answer,startedAt,,)`, `answer==0` up; grace period 1-2h post-recovery. Maker OSM 1h delay pattern. **NEVER DEX-spot/LP-balance as settlement; TWAP only with cardinality.**

### Spec + synthesis + V0
- **[PROTOCOL_SPEC §5/§6]** Layers: in-kind vault (spine) -> signal adapters -> safety module (status/staleness/deviation gating) -> NAV engine -> creation/redemption (in-kind + forward queue) -> read interface. Vocabulary: "fair value", "signal fusion", "confidence band", "closed-market path".
- **[PROTOCOL_SPEC §7 non-goals]** NOT pool-quoted-at-oracle (drains under manipulation), NOT an oracle replacement, NOT a perp DEX / retail front-end, NOT false precision.
- **[PROTOCOL_SPEC §10]** Buildable now: in-kind vault, market-hours NAV, status gating, read-only fair value, signal adapters. **BLOCKED:** corporate actions (unshipped RH APIs), full manipulation hardening (v2 gate), real mainnet liquidity (RHC testnet synthetic; real xStocks on Solana).
- **[D1-D8]** Product = neutral infra (issuers pick constituents, not us). D2 three-layer port + v2 buffered-trigger. D6 economics = subscription/metering, **no AUM-bps without red-line check**. D7 red lines unchanged. D8 regulatory: confirm non-custodial framing with counsel pre-mainnet.
- **[V0]** Weekend edge is real but **concentrated in volatile single names** (MSTRx +0.98%, TSLAx +0.85%, NVDAx pass; SPYx/QQQx ~none). corr(dislocation, next-open) = 0.91 within-name. Weekend liquidity HIGHER (2.3-3.5x) for core names; thin names (COINx/AAPLx/GOOGLx) catastrophic cost -> excluded by listing gate. **Architecture must be constituent-agnostic; the listing gate is the guard, not a hardcoded basket.**

---

## 1. Modularity pattern decision

**Chosen: Registry + Engines around an IMMUTABLE vault (Tilt-style, hardened).** Rejected: ERC-2535 Diamond (R2), all-UUPS.

| Criterion | Registry+Engines (CHOSEN) | Diamond (R2) | All-UUPS |
|---|---|---|---|
| Non-custodial claim (§2/§6 "trust through code") | **Strongest** - vault holding assets is immutable, no admin upgrade path to drain | Weaker - assets share address with upgradeable facets | **Weakest** - vault itself upgradeable |
| Oracle swap | `registry.set(ORACLE_ROUTER, addr)` - no core change | facet cut (storage-fragile) | proxy upgrade |
| v1 -> v2 | register new engines (TriggerGuard, closed-market NAV) | facet cut | upgrade impls |
| Road to immutability | freeze registry slots one by one (`lock()`) | renounce diamondCut | renounce upgrade |
| Storage risk | isolated per contract | shared layout (fragile) | per-proxy |
| Precedent | R1 Tilt | R2 EqualFi | generic |

**Rationale:** the product sells neutrality and non-custody. An immutable vault is the strongest possible expression of "we never custody, you can verify the code can never change to drain you." Upgradeability is confined to the *risky, evolving* engines (oracle, NAV, rebalance, guard) which never hold withdrawal authority beyond bounded, vault-enforced invariants. This also gives the cleanest v1->v2 path: v2 = register new engines, the spine is untouched.

**Trade-off accepted:** the immutable vault cannot be bug-patched. Mitigation = keep the vault minimal (in-kind mint/burn + invariants only; no pricing, no fair-value, no corporate-action math), audit it hardest, and version baskets (a new BasketVault deployment per fix, old one drains via redeem). All complexity lives in swappable engines.

---

## 2. Trust model and the central invariant

**Engines PROPOSE; the immutable vault DISPOSES under its own invariants.**

The vault holds an immutable reference to `ModuleRegistry`. Privileged actions (rebalance, forced redemption) are callable only by `registry.get(ROLE)`, BUT the vault enforces the safety bounds itself, so a compromised/malicious engine cannot exceed them:

- **Rebalance invariant:** swaps only among whitelisted constituents; post-swap basket value preserved within `maxSlippageBps`; weight changes respect a `timelock`; **no path transfers assets to an arbitrary address**. Even a malicious REBALANCER can at worst execute a within-bounds, value-preserving reshuffle.
- **Redemption is always permissionless and pro-rata** - never pausable by any engine (the EqualFi/ETF honesty property). Only *cash-denominated forward-queue* flows can be gated; in-kind redeem is unconditional.
- **ModuleRegistry** is itself time-locked on `set()` and supports `lock(slot)` to permanently freeze a role (road to immutability).

This is the answer to "registry compromise": the blast radius is bounded by vault-side invariants, not by trust in the engine.

---

## 3. Module map

```
                         BasketFactory  (deploys + holds on-chain PCF / basket registry)
                               │ deploys
                               ▼
   AP / arbitrageur ──► BasketVault[i]  ── IMMUTABLE, holds underlying, in-kind mint/burn, invariants
                               │  immutable ref
                               ▼
                        ModuleRegistry   role → engine addr, set() timelocked, lock() freezes
            ┌──────────────┬───────────┴─────┬───────────────┬─────────────────┐
            ▼              ▼                  ▼               ▼                 ▼
      OracleRouter     NAVEngine       RebalanceEngine  CorporateActions   ProofOfReserve
       (proxy)          (proxy)          (proxy)          (proxy)            (proxy)
            │                                                                    
   ┌────────┼─────────┬──────────┬───────────┐        CreationRedemption (proxy)  ── in-kind + forward queue
   ▼        ▼         ▼          ▼           ▼         BufferedTriggerGuard (proxy, v2; v1 = stub)
Chainlink  Pyth    RedStone   DexTwap    PerpMark
 Adapter  Adapter   Adapter    Adapter    Adapter
```

`BasketRegistry` is **merged into `BasketFactory`** (decision (a)): one contract deploys vaults and stores their `BasketDefinition` (the on-chain PCF).

---

## 4. Per-module responsibility + v1/v2 boundary

| Module | Responsibility | v1 (market-hours, safe) | v2 (24/7 binding) |
|---|---|---|---|
| **BasketVault** | custody underlying; in-kind mint/burn basket token; holdings ledger; value-preserving + pro-rata invariants. **Oracle-free.** | Full. Spine has no price dependency. | Unchanged. |
| **BasketFactory** (+registry) | deploy + register vaults; store PCF (constituents, weights, creationUnit, cash); update unit-math on split | pro-rata baskets | custom / non-pro-rata (6c-11) |
| **ModuleRegistry** | role->addr; timelocked `set`; `lock(slot)` freeze | Full | same slots, new engine addrs |
| **OracleRouter** | normalized `OracleReading`; multi-source fusion; staleness; sequencer-uptime gate; market-status | Chainlink adapter + staleness + sequencer feed; weekend -> report Closed | + DEX-TWAP / perp-mark adapters; fusion; divergence checks |
| **NAVEngine** | `nav = Σ holdingᵢ·priceᵢ`; emits `nav/confidence/marketStatus` | market-hours weighted sum; weekend -> stale, `estimated=true`, confidence widened | closed-market fair value (reads **off-chain beta attestation**, never computes regression on-chain) |
| **RebalanceEngine** | weight/holding adjustment; curator weights + time-lock | **Fires ONLY when marketStatus==Regular AND feed fresh; else pause** | weekend rebalance behind guard |
| **CorporateActions** | splits (unit-math in Factory PCF); dividends (cash accrual pro-rata) | **Interface + mock only** (real source BLOCKED, §10) | real Chainlink Tokenized Asset v10 |
| **CreationRedemption** | in-kind path (oracle-free) + forward-priced queue | in-kind unconditional; queue enqueue + settle-on-reopen | weekend redeem under buffered-trigger |
| **BufferedTriggerGuard** | trigger-band; sustained-TWAP; listing-gate; keeper tip+chip | **Interface / stub only** | full R7 logic, gated on V0 |
| **ProofOfReserve** | verifiable backing: `custodiedBalance >= supply requirement` | on-chain snapshot of vault composition vs supply | + signed RedStone-style attestation |

**Iron rule everywhere:** `NAVEngine.nav` under closed-market is `estimated=true` and is NEVER a settlement input. Settlement = in-kind (oracle-free) or forward-queue (next-open authoritative).

---

## 5. Data flows

1. **Create (in-kind, oracle-free):** AP deposits exact constituent quantities for N creation-units -> `BasketVault.mint()` checks bundle completeness atomically -> mints basket token. Reverts if incomplete. No price.
2. **Redeem (in-kind, unconditional):** burn basket token -> pro-rata underlying out. Reverts only if vault depleted. No price, never paused.
3. **NAV read (informational):** consumer -> `NAVEngine.latestNAV(vault)` -> `OracleRouter` fuses sources + market-status machine -> `(nav, confidenceLower, confidenceUpper, marketStatus, estimated)`. Weekend/stale -> `marketStatus=Closed`, `estimated=true`, band widened.
4. **Weekend cash-flow (forward-queue):** cash redeem in closed window -> `CreationRedemption.enqueue()` -> waits -> on `marketStatus -> Regular`, keeper calls `settle()` priced at next-open authoritative. Estimate is never the settlement price.

---

## 6. Fee model (red line #3)

**Zero protocol fee on-chain.** `mint/redeem/latestNAV` charge nothing. Keeper incentives (`tip` flat + `chip` proportional, R7) are paid by the redeemer/arbitrageur in the Dutch-auction, never a protocol cut of volume. Monetization is entirely off-chain (open-core subscription / control plane, §8). This is also the moat vs EqualFi's 4% round-trip that kills arbitrage. Hard-coded fee bound = 0 in v1; if a flat per-op fee is ever added it carries a hard upper bound (road to immutability).

---

## 7. Test-scenario matrix

| # | Scenario | Mocks set | Expected v1 | v2 |
|---|---|---|---|---|
| 1 | Market open, create + redeem | `Chainlink(status=Regular, fresh)` | in-kind mint/redeem OK; NAV fresh, `estimated=false` | same |
| 2 | Weekend stale | `Chainlink(status=Closed, old ns)` | in-kind mint/redeem **OK** (oracle-free); NAV `estimated=true`, band wide; **rebalance reverts/paused** | NAV=fair-value, guard binding |
| 3 | Trading halt | `Chainlink(status=Unknown/halt)` | rebalance paused; NAV degraded/estimated | same |
| 4 | Stock split 2:1 | `MockCorporateActions(Split, 2/1)` | PCF unit-math updated; supply/backing invariant holds | real feed |
| 5 | Dividend | `MockCorporateActions(Dividend, dps)` | cash accrued pro-rata to holders (claims ledger) | real feed |
| 6 | Sequencer down | `MockSequencerUptimeFeed(answer=1)` | all oracle-dependent paths gated; grace period enforced | same |
| 7 | Thin pool listing | `MockDEXPool(low depth, low cardinality)` | listing gate **excludes/caps** constituent | same |
| 8 | Forward-queue settle | `Chainlink` 5 -> 2 transition | enqueue in closed window; `settle()` at reopen price; estimate never used | same |
| 9 | Pro-rata redeem never paused | any | redeem succeeds even while rebalance paused | same |
| 10 | Incomplete bundle create | partial constituent transfer | `mint()` reverts (PoR invariant) | same |
| 11 | Decimals mix | `MockStockToken(18)` + `MockUSDC(6)` | NAV + queue normalize correctly | same |
| 12 | Malicious rebalance attempt | engine tries non-value-preserving swap | vault invariant reverts | same |

---

## 8. Open questions / verify

1. **Dividends:** cash accrual mechanism - separate claims-ledger in vault vs pull-pattern distributor? Reinvest vs payout policy. Data source BLOCKED (§10) -> mock now, design interface to accept either.
2. **Decimals:** stock tokens 18, USDC 6 -> normalization owned by OracleRouter (price scale) and CreationRedemption (cash leg). Document the canonical 18-dec internal scale.
3. **RBAC:** curator (sets weights, timelock) vs permissionless keeper (triggers rebalance/settle when conditions met) vs ModuleRegistry governance (set/lock). Freeze plan per slot.
4. **Reentrancy / idempotency:** CEI in mint/burn; nonce-dedup on forward-queue entries (replay protection).
5. **Custom / non-pro-rata baskets (6c-11):** NOT in v1 (R3) - defer.
6. **Deploy targets:** RHC testnet (chain 46630) + Arbitrum Sepolia fork. Prize gate = deploy on an Arbitrum-family chain (RHC counts).
7. **Fee = 0 confirmed** - keeper tip+chip paid by arbitrageur, not protocol (red line #3 clean).
8. **Demo basket:** lead with MSTRx/TSLAx (real weekend gap), never SPYx (~no gap, thesis looks fake) - V0 / state.md §1 line 26. Architecture stays constituent-agnostic; this is a GTM/demo choice.

---

## 9. Repo layout (projects/etf, Foundry)

```
foundry.toml
README.md
src/
  types/MeridianTypes.sol        enums, structs, role ids (shared)
  interfaces/                    full interfaces (sigs, events, errors)
    IBasketVault, IBasketFactory, IModuleRegistry, IOracleRouter, IOracleAdapter,
    INAVEngine, IRebalanceEngine, ICorporateActions, ICreationRedemption,
    IBufferedTriggerGuard, IProofOfReserve
    external/  IERC20, IChainlinkEquityFeed, ISequencerUptimeFeed, IPerpMarkFeed, IDexPool, IPyth
  mocks/                         FULLY implemented (settable, no network)
    MockERC20Stock, MockUSDC, MockChainlinkEquityFeed, MockSequencerUptimeFeed,
    MockPerpMark, MockDexPool, MockCorporateActions, MockRedStonePoR, MockPyth
  modules/                       skeletons (interface + frame; complex paths revert NotImplemented)
    BasketVault, BasketFactory, ModuleRegistry, OracleRouter, NAVEngine,
    RebalanceEngine, CorporateActionsModule, CreationRedemption,
    BufferedTriggerGuard, ProofOfReserve
    adapters/ChainlinkAdapter
```

No external dependencies (self-contained minimal IERC20 / ownable) so `forge build` is green offline. solc `^0.8.20` (R2 used 0.8.33; pragma kept permissive). Tests = this matrix, implemented in a later pass.
