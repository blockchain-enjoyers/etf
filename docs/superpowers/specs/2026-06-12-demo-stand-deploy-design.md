# Demo fund — stocks scale-out + L4 price oracle + faucet (keyless) — design spec

> 2026-06-12. The L1-L5 + SP500 + fee stand is **already deployed on chain 46630 by a colleague**
> (addresses in their `testnet.json`: `CloneFactory 0x453B…`, `PriceAggregator 0x77b0…`,
> `FairValueNAV 0xAdec…`, `USDG 0x5F28…`, `RegistryRebalanceVault 0x8937…`, `RegistryIndex 0x3F78…`,
> `ForwardCashQueue 0x29d7…`, `MockAPFiller 0x11B2…`, `BasketNavObserver 0xe4f4…`, `MockVerifierProxy 0x7703…`,
> `ChainlinkStreamsSource 0x9b57…`, `UniversalSignedSource 0x41BE…` + `…Weekend 0x3220…`, and 3 mock stocks
> `MSTRx 0x89eC…` / `TSLAx 0xB1EB…` / `NVDAx 0x1d2D…` with a single shared source `0xDb82…`).
> **From us:** make the USDG-entry demo fund respectable (scale to 100+ constituents) and correctly valued
> 24/7 (`safe=true`) **without the Chainlink Data Streams key**, add a judge faucet, and wire the price layer.
> **We hold the deployer/owner key** (the `PRIVATE_KEY` in `blockchain/.env` — the same EOA the colleague
> deployed with, so it is owner of `PriceAggregator`/`CloneFactory`), so all owner-gated wiring
> (`addSource` / `setConstituentAllowed` / grant `MINTER_ROLE` to the faucet / bootstrap) we run ourselves;
> no colleague handoff. **Key hygiene (non-negotiable):** read it only via `process.env.PRIVATE_KEY`, never
> hardcode it in any script/spec, keep `.env` gitignored, treat it as a burner and ROTATE it after the
> buildathon (the L3 deploy spec already flags it as exposed). The only remaining external ask is the optional
> Chainlink Streams API key (a drop-in REAL source). Pairs with the scene-runner (finalization P1-3) and the
> judge-frontend spec (separate).

## Goal / context

The demo fund is entered by judges with **USDG in one `requestCreate`** through the L5 `ForwardCashQueue`
(the AP `MockAPFiller` sources the basket at the next gated open NAV) — judges never assemble 100 names
in-kind. To make that fund (a) respectable at S&P-style scale and (b) honestly valued 24/7 with a `safe`
flag, every constituent needs ≥2 fresh price sources in L4. Today each demo stock has ONE shared source →
`safe=false` (the known "≥2 sources or settle reverts NotSafe" constraint). We don't have the Chainlink
Streams API key, so real DON reports are out — everything here is keyless and sandbox-labeled.

## Two stock sets (distinct, different roles)

| Set | Addresses | Control | Role |
|---|---|---|---|
| **Our mock stocks** | `MSTRx 0x89eC…`, `TSLAx 0xB1EB…`, `NVDAx 0x1d2D…` + the new scale-out (this spec) | us (MINTER_ROLE) | the demo fund; controlled scenes (weekend/split/manip) target the MSTRx/TSLAx/NVDAx subset (V0-edge names) |
| **Real Robinhood testnet** | `TSLA 0xC9f9…`, `AMZN 0x5884…`, `PLTR 0x1FBE…`, `NFLX 0x3b82…`, `AMD 0x7117…` (Q7) | issuer | the authentic "create a fund from real Robinhood stocks" path; judges mint from the **official Chainlink faucet** |

Note: of the 5 real tokens only TSLA overlaps a V0-edge name (MSTR/NVDA are not in the real set), so the
crisis/weekend scene MUST run on the mocks; the real tokens are for the authentic-create path, not the scene.

## Decisions (locked — user-confirmed 2026-06-12)

- **Scale our mock stocks to 100+** under **`registry.json` top-N tickers** (1995 real Robinhood tickers with
  sector + market cap + `usd_stock_price` → the fund looks real and the keeper has reference prices). Exact N
  is **gas-budget-driven** (run protocol below); the ticker list is a runtime parameter, not hardcoded.
- **The respectable fund = a RegistryIndex bootstrapped with the 100+ mocks; judges ENTER it via USDG cash-in**
  (`ForwardCashQueue.requestCreate`, one tx). Controlled scenes target the MSTRx/TSLAx/NVDAx subset within it.
  (Re-use the existing `RegistryIndex 0x3F78…` if it can be (re)bootstrapped, else create a fresh one via
  `createRegistryIndex` + `bootstrap`; bootstrap wraps the 100+ chunked, deployer mints itself via MINTER_ROLE.)
- **Price oracle = 2 MULTI-ASSET signed sources per constituent, NOT a mock per stock.** Reuse the deployed
  `UniversalSignedSource 0x41BE…` (+ `…Weekend 0x3220…`) and a second signed path
  (`ChainlinkStreamsSource 0x9b57… → MockVerifierProxy 0x7703…`). **One source contract serves ALL constituents**
  because the payload carries the per-asset `feedId + price + depth + lastUpdate + sigs`. So we register the
  SAME 2 source contracts per asset (`addSource` ×2 per constituent, owner-gated, batched) — 2 contracts, not
  200. The MockSource path (`Source_Shared 0xDb82…`) stays only as the **thin source for the manipulation
  scene** (scene-runner pumps it x25 → median rejects).
- **Price keeper = an off-chain signing service (transport, not price origin).** Per L4-guide §5.2: signed
  sources verify the report at READ time in the payload, not via on-chain push. The keeper exposes
  `GET /reports?assets=…` → fresh committee-signed reports (price from `registry.json.usd_stock_price` / a free
  ticker API; real tickers for the 5 RH tokens). The frontend/SDK passes those payloads into `navOf(...)`; the
  settler bot passes them into `settle(...)`. No 100× on-chain `setPrice` per tick. Honest label: committee-
  signed (prod: independent signers like RedStone/Chronicle behind the same adapter; demo: our committee keys).
- **The 5 real Robinhood tokens are sourced the same way** (register the 2 signed sources for their addresses,
  keeper signs their real-ticker prices) so a fund built from them values correctly; judges mint them from the
  **official Chainlink faucet** (`faucets.chain.link/robinhood-testnet`) — we link it, we don't faucet them.
- **Faucet for the mock stocks** = a standalone `Faucet` contract holding `MINTER_ROLE` on each mock (no stock
  redeploy): `Faucet.claim(stock)` mints a fixed `100e18`, per-address cap `1_000_000e18` (the
  `mint(uint256.max)` vector cannot exist — no amount arg; the cap keeps NAV below the ~`1e40` L4 band-overflow
  ceiling). For judges who DO create a small in-kind fund live (3-10 names) this is a few `claim`s; for the big
  fund they use USDG, so no mass claiming.
- **Flat create fee = 0** (confirm the stand setting); **USDG from the Paxos faucet** (not ours).
- **Chainlink key NOT required.** All sources are keyless (MockVerifierProxy + signed committee). If the key
  arrives, `ChainlinkStreamsSource` against the **real** `VerifierProxy 0x7279…` is a drop-in additional REAL
  source — strictly better, optional. Ask the colleague for it in parallel (nice-to-have), do not block.

## Components (ours)

1. **`contracts/mock/Faucet.sol`** — `claim(address stock)` mints `100e18` (cap `1_000_000e18`); requires
   `MINTER_ROLE` on each registered mock stock; an admin `setStock(stock, allowed)` allowlist of faucetable
   mocks. No power beyond minting capped demo tokens.
2. **`scripts/deploy/deploy-demo-stocks.ts`** (scale-out) — deploy `Stock` clones under `registry.json` top-N
   tickers, staged per the gas-budget protocol; grant the `Faucet` `MINTER_ROLE`; emit the address map +
   the owner tx list (`setConstituentAllowed` + `addSource`×2 per stock).
3. **`scripts/deploy/register-sources.ts`** — for every constituent (mocks + the 5 real RH tokens): emit/run
   `aggregator.addSource(asset, universalSigned)` + `aggregator.addSource(asset, chainlinkStreams)` (owner).
4. **`scripts/deploy/bootstrap-demo-fund.ts`** — (re)bootstrap the 100+ RegistryIndex with the mocks + wire its
   `ForwardCashQueue` (settler/executor/gate params already mostly set by the colleague — reconcile + fill).
5. **price keeper (off-chain, `app/` backend or a small service)** — `GET /reports?assets=…` → committee-signed
   reports from `registry.json.usd_stock_price` / a free API; a `/settle-payloads` helper for the settler bot.
   Holds the committee signing keys (demo).

## Create-multi-oracle-for-a-basket flow (the "нужно продумать" answer)

Listing a constituent into L4 = a curated step (this IS the §4.5 listing-gate philosophy — a constituent must
have ≥2 deep sources before the NAV trusts it): given a basket's constituent addresses (from the constructor /
`suggested_funds`), for each not-yet-sourced asset register the 2 signed sources (owner tx) and have the keeper
start signing its price. For the demo we pre-list: the 100+ mocks + the 5 real RH tokens + any
`suggested_funds` replica constituents. Productization note: arbitrary thin constituents are NOT auto-listed
(that is the exploit surface every R7 case came from).

## Gas-budget protocol

1. Deploy a test batch (e.g. 10 mocks) → read deployer balance delta → `costPerStock`.
2. Read remaining faucet ETH → `maxCount = floor(remaining * margin / costPerStock)`.
3. Deploy `min(targetN≈100+, maxCount)` under registry top-N tickers.
4. If bootstrap of the 100+ index also draws native, measure one chunk first and size the index N to the
   remaining budget (bootstrap wraps chunked, ~200 legs/chunk per Q7).

## Acceptance (read back on chain 46630)

- `Faucet.claim(mock)` from a fresh EOA mints `100e18`; a claim past the cap reverts; `claim` works for every
  registered mock; raw `balanceOf` stable across a simulated split.
- Per constituent (mocks + 5 real): `aggregator.sourceCount(asset) >= 2`; with keeper payloads,
  `FairValueNAV.navOf(...).safe == true` on a calm weekday.
- The demo RegistryIndex has the 100+ (or gas-capped N) held set, `totalSupply > 0`; a judge `requestCreate`
  with USDG settles to shares at the next gated open NAV (`ForwardCashQueue` gates pass with keeper payloads).
- Scene subset (MSTRx/TSLAx/NVDAx): manipulation pump on the thin MockSource is rejected by the median;
  weekend wiring flips `safe=false`; split (`updateMultiplier`) leaves NAV unchanged.

## Red lines / honesty

- Sandbox badge; prices labeled synthetic; "in prod: neutral on-chain validation of independent signed sources,
  not a price from one backend." No real-price / live-Chainlink claim (key absent).
- `Faucet` only mints capped demo tokens; the keeper only signs/relays (never custodies, never moves value).
- `FLOW_FEE_BPS = 0` intact; nothing here touches a red line.

## Out of scope (separate)

- **The stand itself** — deployed by the colleague.
- The scene-runner `scripts/demo/scene-runner.ts` (finalization P1-3) — drives the source manipulation per scene.
- The judge-frontend (`@meridian/app`) wiring + the registry/suggested-funds constructor — separate spec.
- The real Chainlink Streams key (optional drop-in); true 500; deferred contract items.

## Testing

- Unit on `Faucet`: `claim` mints `100e18`; cap reverts at the boundary; only allowlisted mocks; needs MINTER_ROLE.
- Unit on a signed source with a multi-asset payload: two distinct assets priced from two distinct signed
  reports through ONE source contract; below-threshold sigs reject.
- Local-fork smoke: register 2 sources for a constituent + feed keeper-signed payloads → `navOf.safe == true`;
  a USDG `requestCreate → settle` succeeds Open+safe; the manipulation pump is rejected.
