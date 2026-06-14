# Meridian: neutral 24/7 NAV + in-kind create/redeem for tokenized-equity baskets

Meridian is neutral, non-custodial 24/7 NAV and create/redeem infrastructure for tokenized-equity baskets (on-chain ETFs), so competing platforms can trust the same price. We do not pick constituents, we do not issue funds, and we never custody assets. A mint button is cloned in a weekend; a safe 24/7 engine is not.

---

## Judges start here

- **Everything in one place:** the landing page at **[meridian-landing.up.railway.app](https://meridian-landing.up.railway.app/)** routes to the deck, demo, paper, playground, code, and docs.
- **Break the oracle yourself (60 seconds, no wallet):** [meridian-playground.up.railway.app](https://meridian-playground.up.railway.app). Open the **"Tamper a source"** preset: corrupt Uniswap to +40% and watch the basket NAV barely move. Then "Replay Oct 2025" to watch the band stay honest through the crash weekend.
- **Deployed on Robinhood Chain testnet (chain 46630):** the full L1-L5 stack is live (the binary deployment gate); Blockscout source-verification is in progress, bytecode is live and reproducible from this repo. Full address table: [`blockchain/contracts/README.md`](blockchain/contracts/README.md).
- **Watch:** the [pitch video](https://youtu.be/0s6ZKJ-T6C8) (~2:30); a ~2:00 live product demo accompanies the submission.

> All on-chain prices in the demo are synthetic / sandbox feeds (a keyless signed-committee oracle runs the stand without a live Chainlink Streams key). The backtest is descriptive, testnet-only. No live-source or precision claim.

### Claims -> evidence

| # | Claim | Proof (one click) |
|---|---|---|
| 1 | It stays honest when a price source is corrupted | playground **"Tamper a source"** preset · demo video climax |
| 2 | Calibrated on the largest liquidation event in crypto history (10-12 Oct 2025) | backtest over 186 real windows (method in the paper) |
| 3 | A real 500-name index fits on-chain: `navOf(500)` 13.6M -> 721K gas | commitment-plus-calldata design · paper (gas section) |
| 4 | The vault is never under-collateralized; one source can't move the median | Foundry invariants `L1Conservation`, `L4MedianCap` |
| 5 | We caught our own broken-NAV wiring before shipping | multi-agent freeze-review (self-audit), gating paths hardened |
| 6 | Full non-custodial lifecycle is deployed, not planned | L1-L5 [address table](blockchain/contracts/README.md) on chain 46630 |

---

## Where things are

| Path | What |
|---|---|
| [`landing/`](landing/) | The judge hub: one page that links to everything below. |
| [`pitch/presentation.html`](pitch/presentation.html) · [`pitch-deck/`](pitch-deck/) | The slide deck (self-contained HTML). |
| [`gitbook/docs/`](gitbook/docs/) | Full protocol docs in Markdown (browse on GitHub). Start at [`index.md`](gitbook/docs/index.md); deep dives in [`layers.md`](gitbook/docs/layers.md) (the L1-L7 ladder), [`architecture.md`](gitbook/docs/architecture.md), [`evidence.md`](gitbook/docs/evidence.md), [`engineering.md`](gitbook/docs/engineering.md) (the build hacks), [`honesty.md`](gitbook/docs/honesty.md). |
| [`pitch/paper/main.pdf`](pitch/paper/main.pdf) · [`brief.pdf`](pitch/paper/brief.pdf) | The scientific paper (calibration + method) and a one-page brief. |
| [`blockchain/`](blockchain/) | Solidity contracts (L1-L6) + ~307 tests. Deployed addresses: [`blockchain/contracts/README.md`](blockchain/contracts/README.md). |
| [`research/v0/`](research/v0/) | The V0 validation backtest: pipeline, data, and figures. |

---

## Architecture: red lines + quality

This is **one product**: a price-safety engine that makes a 24/7 fund safe, not a separate oracle. The iron rule: an estimated / fair-value price is never a settlement price. Estimation feeds information and risk; forward pricing feeds honest backing.

Three architectural red lines, enforced in code:

1. **Never custody funds** - vaults are immutable clones with no admin key.
2. **Never sign value-moving tx** outside the user's own on-chain permissions.
3. **Never take a rate on flow** - `FLOW_FEE_BPS = 0` is a constant with no setter.

Quality: ~307 unit tests plus Foundry invariants - `L1Conservation` (never under-collateralized), `L3ClaimConservation` (rebalance conserves value), `L4MedianCap` (one source cannot move the median past the cap). Layered L1-L5, clone-based vault families, modular oracle sources, fail-closed gating (a self-audit freeze-review hardened the gating paths). How it all composes: [`gitbook/docs/layers.md`](gitbook/docs/layers.md).

## Honesty

The backtest is thin (~45 weekends, 8 names) and descriptive: no significance test, no precision claim, and the edge concentrates in volatile single names (broad-index wrappers show almost none). The testnet stand uses synthetic / mock price feeds. The deliverable is price-safety (knowing when not to trust the price) plus honest in-kind backing, not edge-pricing and not "we solved fair value." Full limitations: [`gitbook/docs/honesty.md`](gitbook/docs/honesty.md).

---

Meridian is neutral, non-custodial infrastructure to create tokenized-basket funds that work 24/7, with honest price-safety even when the market is closed.
