# L6 — 24/7 binding action via a buffered trigger — design spec

> 2026-06-13. The second half of the wedge: making a BINDING action (forced rebalance / forced redemption)
> safe to take 24/7, including the weekend, by treating the NAV as a trigger BAND with a buffer that absorbs
> its imprecision, not as a settlement price. v2 / roadmap (gated on the V0 GO — currently CONDITIONAL GO);
> NOT a buildathon ship, this is the contract design for the next layer. Synthesized from the already-locked
> design: `docs/guides/L6-24-7-binding.md`, `research/results/R7.md` (the incentive/manipulation economics +
> the e_max bound), the synthesis §4.4 (the buffered-trigger incentive layer), and the shipped L3/L4/L5
> architecture it reuses. The pre-pivot intent-validation engine (deterministic envelope: exposure cap,
> oracle-band, sustained-deviation) becomes this safety layer.

## Goal / context

L1-L5 are non-custodial and never act on an estimate: in-kind create/redeem are price-free; L5 cash settles
forward at the next authoritative open. The one thing they cannot do is take a BINDING action while the US
market is closed (force a fund back to its target, or force-redeem an exposure-capped position that opted into
forced exit and has drifted past its band) — because that would require trusting the weekend estimate. L6
makes that safe **not by making the
weekend NAV exact, but by acting only on a SUSTAINED band breach through a buffer that provably absorbs the
NAV error**, settling the action at the real auction clearing price (never the estimate). This is the
register TradFi has no analog for (the market is closed), and the highest-risk one, so every action is gated.

## Hard constraints (locked — inherited)

1. **Iron rule (extended):** the L4 NAV is used ONLY to DECIDE whether/when to act (the trigger). The forced
   action SETTLES at the realized Dutch-auction clearing price within `maxSlippageBps`, never at the
   estimate. The L5 cash-forward path is UNCHANGED (cash still waits for the next open; L6 never cash-settles
   on the weekend).
2. **Red line #1 (non-custody):** a forced action is an atomic Dutch auction against the vault (the L3
   `executeRebalance` pattern), no escrow-in-vault, no two-phase, no team key. The buffered guard may PAUSE
   action (sequencer down, band wider than the buffer) but can NEVER move user funds. In-kind redeem stays
   always-open.
3. **Red line #2 (consent / within the user's own permissions):** a forced exit applies ONLY to a position
   whose holder granted the forced-exit permission AT ENTRY (the on-chain terms of an exposure-capped product,
   the way taking a loan grants the lender a liquidation right). The protocol never force-redeems a position
   that did not opt into a cap; a plain in-kind basket holder is never force-redeemed (there is nothing to
   liquidate), and the voluntary in-kind redeem stays always-open.
4. **Red line #3:** the keeper/liquidator reward comes from the auction spread (funded by the unwound
   position, received by the arbitrageur who fills) + a bounded tip from the management-fee escrow
   (`KeeperModule`), never a Meridian cut of flow.
5. **compute -> execute:** the `BufferedTriggerGuard` COMPUTES the is-due predicate (sustained breach); the
   immutable vault + auction EXECUTE and GATE the invariants (value-preserving, slippage, listing, sequencer).

## The buffered-trigger principle (why a less-precise weekend NAV is safe)

Treat the L4 NAV as a trigger band `[NAV(1-h), NAV(1+h)]`, not a settlement value. A binding action fires only
on a **sustained** (TWAP) deviation beyond the HARD band, so a single bad print cannot trigger it. The
absorbable NAV error is the closed-form bound from R7:

```
e_max = 1 / [ L * (1 + b) ] - 1
```

where `L` = exposure cap / max-LTV the action gates, `b` = the redemption/liquidation bonus. Battle-tested
values: `L=0.80, b=0.05` -> e_max ≈ **+19%**; `L=0.70, b=0.08` -> ≈ **+32%**. So the weekend NAV can be wrong
by +19% to +32% in the dangerous (over-report) direction and the system stays solvent, PROVIDED the action
fires at the trigger and real liquidity clears at the true price. This is the quantitative reason L6 does not
need an exact weekend price.

**The band must fit the buffer (the load-bearing gate).** e_max is a BUDGET, and the buffer absorbs the NAV
error only if the live confidence band fits inside it. So a binding action fires only when the current
`navOfHoldings` band half-width is within that budget: `bandBps <= e_max_bps` (conservatively, a governance
fraction of e_max). A wide band (few or disagreeing sources) blocks the action not because it is "unsafe" in
the L5 sense, but because the buffer can no longer PROVE solvency. This is the precise meaning of "safe enough
for the buffer" versus the L5 settlement `safe=true`: the firing condition is band-fits-the-budget, and it is
a HARD gate, not a heuristic.

**Two actions, two safety arguments (do not conflate).** e_max is a LIQUIDATION-solvency bound, defined by an
exposure cap `L` and a bonus `b`; it governs the forced-exit action (#2). The 24/7 weekend REBALANCE (#1) has
no LTV and no bonus: its safety is the value-preserving atomic swap + `maxSlippageBps` + the sustained
trigger, and there the buffer only means an imprecise NAV shifts the TIMING of a rebalance, never its
solvency. Both still require the band-fits-the-budget gate before firing.

## Architecture — reuse the L3/L4 machinery, add the guard + the forced-redeem path

```
contracts/L6/
  BufferedTriggerGuard.sol   COMPUTE: checkTrigger(vault) -> (fired, side, sustainedDeviationBps); the
                             soft/hard band + sustained-TWAP + cardinality floor + cooldown + sequencer gate
                             + the band-fits-the-buffer gate (`bandBps <= e_max_bps`). Reads the robust L4
                             aggregate via the observer.
  ForcedRedeemAuction.sol    EXECUTE: on a fired trigger, open a Dutch auction (extends RebalanceAuction) for
                             the forced rebalance/redemption; settle at the clearing price within maxSlippage;
                             tip+chip from the redeemer + the KeeperModule escrow.
  SequencerGuard.sol         the Orbit L2 sequencer-uptime read (latestRoundData) + grace period; a thin lib
                             used by the guard (do not act during downtime + grace).
  interfaces/IBufferedTrigger.sol
```

**Reused unchanged (do NOT rebuild):**
- `L4/PriceAggregator` + `FairValueNAV` (the depth-weighted-median band + `safe` + `navOfHoldings`) — the
  trigger reads these.
- `L3/RebalanceObserver` / `L5/BasketNavObserver` (the TWAP over the ROBUST L4 aggregate, never a raw source)
  — the sustained-deviation signal.
- `L3/RebalanceAuction` (the Dutch auction executor) + `L3/KeeperModule` (the bounded-reward escrow). The
  `ForcedRedeemAuction` extends the auction with the forced-redeem leg; the KeeperModule pays the bounded tip.

## The two binding actions L6 enables

1. **24/7 weekend rebalance under the guard.** The L3 reweight/reconstitution, but allowed to execute while
   the US market is closed — gated by the buffered guard (sustained breach + band-fits-the-buffer +
   sequencer up). Its safety is the value-preserving atomic swap + `maxSlippageBps` (no LTV here): an
   imprecise weekend NAV only shifts the TIMING of the rebalance, never its solvency. This extends L3's
   `execMode`: a `WEEKEND_ALLOWED` flag that the guard, not the manager, authorizes per-due.
2. **Forced redeem of an exposure-capped position on a sustained hard-band breach.** This applies ONLY to a
   position in a Meridian-native product that embeds an exposure cap and whose holder opted into forced exit
   at entry. This is the leverage register L6 SHARES with L7: the buffered-trigger machinery is built here,
   and the leveraged/capped positions it guards arrive with L7, so a pure-L6 deployment with no capped
   product ships action (1) only. It does NOT apply to an external lending market's collateral: that is B1
   (the lender runs its own liquidation against our published band; out of scope, see below). When such a
   position sustains a breach of the hard band, `ForcedRedeemAuction` opens a Dutch auction: an arbitrageur
   fills and receives the spread (funded by the unwound position), the position settles at the clearing price
   within `maxSlippageBps`, and the keeper who triggered is paid a bounded `tip` (flat) + `chip` (proportional,
   capped) from that spread + the fee escrow. Close factor 50% -> 100% for dust (Aave pattern). The e_max bound
   above is what keeps this solvent without an exact weekend price.

## Components — the guard predicate (the heart)

`BufferedTriggerGuard.checkTrigger(vault)` returns `(fired, side, sustainedDeviationBps)`. It fires iff ALL:
- `marketStatus` is Closed/weekend (L6 is the closed-market binding layer; L3 handles market-hours) OR the
  fund opted into 24/7 enforcement;
- the L4 `navOfHoldings` is safe ENOUGH FOR THE BUFFER (not for settlement): `k >= minTriggerSources` AND the
  band fits the budget, `bandBps <= e_max_bps` (a governance fraction of e_max). The action does not need
  `safe=true`; it needs the band to fit inside the buffer that absorbs it. A band wider than the buffer blocks
  the action (the buffer can no longer prove solvency), even though L4 itself is read-only;
- the **TWAP** of the robust L4 aggregate over the window (30 min baseline, **1-2 h on weekends**) has
  breached the HARD band `h_hard` (±3-5%), with `observationCount >= minCardinality` (an instant spike does
  not fire);
- `block.timestamp >= lastAction + cooldown` (anti-ping-pong) and the latch is clear (Schmitt-trigger: clears
  only when the TWAP drift falls below the SOFT reset band);
- the L2 **sequencer is up** and past its grace period (`SequencerGuard`);
- the **listing gate** holds for every constituent at weekend-trough depth (`m*C1(Δ,depth) > L*w*Δ*TVL`,
  reusing the L4 `acceptedDepthOf` + a conservative min-depth tracker) — a thin asset is excluded/capped, the
  universal lesson of every oracle exploit.

## Parameters (R7 D3 defaults — governance-set, immutable caps)

| Param | Default | Meaning |
|---|---|---|
| `L` (exposure cap) | 0.80 (sweep 0.70-0.90) | sets e_max with `b` |
| `b` (bonus) | 5% baseline / **8% weekend** | the liquidator/redeemer bonus |
| `h_soft` / `h_hard` | ±1% / ±3-5% | reset band / forced-action band (wider than the Chainlink deviation threshold to avoid false triggers) |
| TWAP window | 30 min / **1-2 h weekend** | sustained-deviation window (longer on weekends so cost-to-sustain dominates thin depth) |
| `minCardinality` | window/blocktime floor | a nominal window with too few observations is not a TWAP (the Inverse Finance lesson) |
| `cooldown` | governance | anti-ping-pong |
| close factor | 50% -> 100% for dust | Aave pattern |
| `maxSlippageBps` | conservative | the iron-rule settlement bound on the auction |
| sequencer grace | governance | restart-grace after L2 sequencer downtime |

## Hard prerequisites (must land before permissionless L6)

- **The L4 `navOfHoldings` post-swap value-floor (IMP-9, currently deferred).** Permissionless forced action
  is unsafe until the auction enforces a post-swap `navOfHoldings >= pre-swap floor` (otherwise a keeper can
  self-open + self-bid to extract). Until IMP-9 lands, L6 ships **manager/allowlist-gated only** (mirrors the
  L3 `PERMISSIONLESS`-disabled posture). This is the same gate the L3 deferred docs flag.
- **The holdings-based NAV path + the TWAP-over-L4-aggregate** (both exist from L3/L5) — L6 consumes them.
- **The sequencer-uptime feed address on Robinhood Chain** — currently not published on the testnet; the
  guard takes it as a constructor param and disables the gate only with an explicit governance acknowledgement
  (never silently).

## Red lines preserved

- Iron rule: the action settles at the auction clearing price; the L4 NAV only triggers; the buffer absorbs
  its error ONLY while the band fits the budget (`bandBps <= e_max_bps`); L5 cash still waits for the open.
- Red line #1: atomic auction against the vault, no escrow, no team key; the guard pauses but never moves funds.
- Red line #2: a forced exit fires only on a position that granted the forced-exit permission at entry (an
  exposure-capped product); a plain basket holder is never force-redeemed.
- Red line #3: the spread is funded by the unwound position and received by the arbitrageur; the keeper tip is
  bounded and from the fee escrow; never a Meridian flow cut.
- In-kind redeem stays always-open and unconditional (L6 adds a FORCED exit path, it does not gate the
  voluntary one).

## Testing (TDD)

- **Trigger predicate:** fires only on a SUSTAINED hard-band TWAP breach with cardinality >= floor; an instant
  spike does NOT fire; the latch clears only below the soft reset band (Schmitt); cooldown blocks ping-pong;
  sequencer-down (or in grace) blocks; a thin constituent fails the listing gate and is excluded.
- **Band-fits-the-buffer gate:** a band wider than the budget (`bandBps > e_max_bps`) does NOT fire even on a
  sustained hard-band breach; firing resumes once enough independent sources tighten the band back inside it.
- **Solvency (e_max):** inject NAV error `e`; assert no bad debt while `e <= 1/[L(1+b)]-1` and the auction
  clears at the true price; assert the bound is breached only beyond e_max (the R7 invariant).
- **Forced redeem (consent-scoped):** an exposure-capped position that opted in sustains a breach -> the Dutch
  auction opens; an arbitrageur fills; the position unwinds at the clearing price within `maxSlippage`; the
  keeper gets the bounded tip+chip (from the spread + escrow), Meridian gets nothing; close factor 50% -> 100%
  for dust. A position that did NOT opt into a cap (a plain basket holder) can never be force-redeemed.
- **Non-custody:** the guard pause moves no funds; in-kind redeem still works during a pause; replay/nonce
  blocks double-action.
- **Anti-gaming:** self-open + self-bid extraction is blocked (value-floor, or manager-gated until IMP-9);
  manipulated drift is rejected by the TWAP + cardinality.

## Out of scope (separate / later)

- L7 (leverage / derivatives / path-dependent) — the next register up.
- The off-chain keeper bot + the sequencer-uptime-feed integration on mainnet.
- Cross-asset collateral (B1) — that is the CONSUMER (a lending market) using our band as its own liquidation
  trigger; out of our contract scope by design (we expose the band + safe; we do not build the lender).
- Re-running the V0 GO/NO-GO gate that authorizes building L6 (it is the v2 gate; CONDITIONAL GO today).
