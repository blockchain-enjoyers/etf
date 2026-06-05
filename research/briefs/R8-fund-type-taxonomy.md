# R8 — Fund-type taxonomy along the valuation/rebalance axis: fiat analogs ↔ on-chain modules

> Part of the tokenized-equity NAV / creation-redemption protocol (see `../PROTOCOL_SPEC.md`, research index §13). Self-contained deep-research agent prompt.
>
> **Shared context (paste at top if the agent has none):** We are building a neutral valuation + creation/redemption layer for tokenized-equity index/basket products on Robinhood Chain (an Arbitrum Orbit L2 for 24/7 tokenized stocks/RWAs). Our wedge is a trustworthy NAV for a basket of tokenized stocks **24/7, including when the US market is closed** (the "weekend gap"), plus in-kind creation/redemption that keeps the token honestly backed and arbitrage-anchored. We are infrastructure: issuers/lenders/funds consume the layer, we never custody, never issue the fund, never settle on an estimate, never take a take-rate on volume.
>
> **Output rules:** prioritise primary sources (issuer prospectuses, fund fact sheets, index methodology PDFs, SEC filings, exchange/issuer documentation, peer-reviewed papers) over aggregators; cite every non-obvious claim with a link; give AUM/turnover figures **with an as-of date**; clearly separate **confirmed fact** from **inference**; flag anything that may be stale; end with a short "implications for our architecture" section.

**Purpose.** We have drafted a ladder of fund "types" ordered by a single axis: **how much the product depends on a price oracle and how binding that price is** (from "no oracle at all" to "continuous, path-dependent, settlement-binding valuation"). Each step is a genuine phase transition that forces a new on-chain module. We believe there are ~7 such registers, not an arbitrary 10. This brief must (a) validate that count, (b) ground each register in real fiat-world products with real numbers, (c) surface any register we merged incorrectly or missed entirely, and (d) recommend a build order by demand-vs-complexity. The goal is to let us design the protocol's module roadmap on evidence, not memory.

**Our draft taxonomy (the hypothesis to test).** Treat this as a hypothesis, not ground truth. Confirm, split, merge, or extend it.

| L | Valuation/rebalance register | Hypothesised new module (phase transition) | Hypothesised fiat analog |
|---|---|---|---|
| 1 | Static in-kind, **no oracle** (fixed quantities, held; value = backing in token units) | In-kind vault + factory (the spine) | UIT / unit investment trust / defined portfolio |
| 2 | **Read-only NAV**, market-hours only (oracle for display/secondary only; weights self-track) | Display NAV oracle: Σ qty·price + staleness + market-status | Cap-weighted index funds (SPY, VOO, VTI) |
| 3 | **Oracle-driven rebalance**, market-hours only (non-pro-rata, value-checked, open-market) | Rebalance engine + sub-modules: reweight-to-target / reconstitution + listing gate / trigger calendar-vs-threshold | S&P 500 & Russell (reconstitution); RSP (equal-weight); active/tactical ETFs (threshold) |
| 4 | **24/7 read-only fair-value NAV** (the weekend gap; informational) | Closed-market fair-value model `lastClose·(1+Σβ·signal)` + confidence band + off-chain beta attestation | International-fund fair-value pricing / ICE FVIS; deprecated iNAV/IIV |
| 5 | **Oracle-as-settlement**: forward-priced cash create/redeem | Forward-priced queue + settle-at-next-open + replay protection | Open-end mutual funds, Rule 22c-1 forward pricing; cash-create ETFs |
| 6 | **24/7 binding** rebalance / forced redemption | Buffered-trigger guard + listing gate + Dutch-auction liquidation + sequencer-risk mitigation | ≈ none (markets closed in TradFi); closest = vol-target funds + lending liquidations |
| 7 | **Leverage / derivatives / structured** (continuous, path-dependent) | Derivative legs + funding accounting + continuous/daily rebalance + risk caps | Leveraged/inverse ETFs (TQQQ/SQQQ); defined-outcome/buffer ETFs; structured notes; managed futures |

**Side branches we believe are NOT on the linear axis (confirm this):** B1 cross-asset collateral / using a basket NAV as binding collateral in a lending market (a *consumer* of the L4+ NAV, likely an integration not a level); B2 corporate actions (splits/dividends, orthogonal capability needed from L2–L3 onward); B3 cash component / fractional balancing.

**Investigate and answer — for EACH register L1–L7:**
1. **Fiat analog(s).** 2–3 concrete named products. Exact **AUM with as-of date**, provider, ticker. Pick the most representative, not the most obscure.
2. **Actions and cadence.** What the fund actually *does* operationally — NAV strike, rebalance, reconstitution, roll, corporate-action handling — and **how often** (calendar / threshold / daily / continuous). The exact mechanism (in-kind vs cash creation, Authorized Participants, order cutoff, effective dates). This "what + how often" is the single most useful output: it dictates our module cadence and cost.
3. **How TradFi solves the valuation.** Who computes the NAV/price, from what source, and specifically **what happens when the relevant market is closed** (stale, fair-valued, not valued, batched).
4. **Existing on-chain implementations.** Who already ships this register and how. Prioritise: Tilt, EqualFi/EdenFi, Ondo, Backed Finance, Dinari, Index Coop, Reserve Protocol, dHEDGE/Toros, Enzyme, Symmetry, Alongside, and any tokenized-ETF/structured-product issuer. Note their mechanism and, importantly, **their failures** (de-pegs, exploits, paused redemptions, dead products like Mirror/Synthetix synthetic equities).
5. **The new module/problem for us.** What precisely must be built at this step, and the dominant risk (oracle manipulation, weekend liquidity, sequencer downtime, path-dependence, corporate-action correctness).

**Cross-cutting questions:**
6. **Missed registers.** Is there a genuine phase transition we skipped between L1–L7? Candidates to check explicitly: NAV-strike batching / swing pricing / anti-dilution levies; ADR & FX parity baskets; multi-currency NAV; semi-transparent active ETFs (proxy-basket / ActiveShares); interval funds / gated redemption; commodity/futures-roll funds. For each, decide: new level, sub-module of an existing level, or out of scope.
7. **Wrongly merged.** Did we collapse two genuinely different builds into one (e.g., is "scheduled reconstitution" really the same module as "threshold reweight"? is cap-weighted-hold really build-identical to a frozen bundle, differing only in weight methodology)? Confirm or split.
8. **TradFi boundary.** Where does on-chain genuinely exceed TradFi (24/7, atomic in-kind, permissionless arbitrage) vs where TradFi is still ahead (corporate actions, transfer-agent rails, deep liquidity)?
9. **Build-order recommendation.** Rank the registers by **demand × inverse-complexity**: which deliver the most issuer/lender demand for the least audit-surface/risk. Where is the MVP line, and where is our defensible wedge (we expect the weekend registers L4/L6)?

**Deliverables.**
- A master table: rows L1–L7 × columns {representative fiat product, AUM+date, actions & cadence, TradFi valuation method, closed-market behaviour, on-chain precedents + failures, our new module, dominant risk}.
- A short section "merged / split / missing levels" giving the corrected count with justification.
- A one-paragraph recommended build order with the MVP cut-line and the wedge identified.
- An "implications for our architecture" closing section (which modules to design first, which to defer, which are integrations not builds).

**Sources to prioritise.** Fund fact sheets & prospectuses (SPY/VOO/RSP/TQQQ/defined-outcome issuers), S&P Dow Jones & FTSE Russell methodology PDFs and reconstitution-day analyses, SEC Rule 6c-11 and Rule 22c-1 / Rule 2a-5 texts, ICE FVIS documentation, ICI fact book (AUM/turnover), and primary docs/repos of the on-chain protocols listed above. Avoid marketing blogs except to locate primary sources.
