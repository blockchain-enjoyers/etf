# Meridian L1-L5 — Finalization Design (review + plan)

> Created 2026-06-11. Source: multi-agent global review (`meridian-finalization-review` workflow, run wf_1ea7874d-8e6: 26 agents, 83 raw findings, 13 high adversarially verified).
> Inputs: `contracts/**` (L1-L5), `test/**`, `docs/IMPROVEMENTS.md`, `docs/guides/{demo,pitch-video}.md`, research R3/R8 + synthesis D1-D8.
> Baseline: build OK, **All 307 tests pass across L1/L3/L4/L5. Build succeeded. No failures.** (L1 122 / L3 63 / L4 59 / L5 63).
> Decisions locked with the user: bar = close L5 blockers now → drive to audit-grade (foundry fuzz) ; demo surface = FULL incl. live 500-name RegistryRebalanceVault ; deploy target = RHC testnet (chain 46630) ; user deploys stock tokens, we deploy mock adapters/puppets + all protocol contracts + L5.

# Meridian L1-L5 — Finalization Plan (Buildathon, submit 14 Jun 2026; today 11 Jun)

## 1. Executive verdict

The "L1-L5 built" claim is true at the **contract + unit-test layer only**: 307/307 hardhat/TS tests pass green across L1/L3/L4/L5, and the two hardest prerequisites are closed in code (IMP-8 holdings-based `previewCreate`/`previewRedeem` is fully implemented and tested; the L5 settle path does not revert on registry/rebalanced vaults). It is **not deployable as-is and the flagship demo cannot be stood up**: there is no `deploy-l5.ts`, no `deploy:l5` npm script, no foundry suite at all, and the live testnet (`config/testnet.json`) records **stale L1 factory bytecode** that predates both the fee model and `createRegistryIndex`, plus it is missing USDG, the RegistryRebalanceVault impl, the registry vault instance, BasketNavObserver, ForwardCashQueue, MockFeedRouter, and the demo Stock tokens. Security-wise the three constitutional red lines hold and no value-loss/custody break was confirmed; the high findings are a permissionless-`bootstrap` griefing/footgun, an auction balance-domain mismatch that is **latent (not script-wired)**, an empty-acquire manager-only footgun, and a committee `threshold==0` fail-open footgun — all gated behind privileged/manual actions, none demo-blocking, all worth hardening toward audit-grade. Net: the engine is sound and the science is done; **the entire L5/registry deploy-and-wire layer is the real gap**, and it is the critical path to a live 500-name forward-cash demo on RHC chain 46630.

---

## 2. P0 — L5 blockers + demo-breaking (close NOW)

These hard-block the live 500-name registry forward-cash settle path. Ordered as the deploy script must execute them.

### P0-1 — Redeploy L1 with current bytecode + register registry impl + fee globals
- **What:** Live `CloneFactory 0x88d606...` predates Fee P1/P2 and `createRegistryIndex`. Run `REDEPLOY=1`; extend `deploy-l1.ts` to: deploy `RegistryRebalanceVault` impl (`new RegistryRebalanceVault()`, no ctor args), `factory.setRegistryRebalanceImpl(impl)` (read-before-write guard), deploy USDG, `factory.setFeeToken(usdg)`, `factory.setDefaultFlatFees(1e18,1e18)`.
- **Why:** `createRegistryIndex` reverts `ZeroAddress` while `registryRebalanceImpl==address(0)` (`CloneFactory.sol:205`); the forward-cash ctor enforces `vault.feeToken()==stable`.
- **Files:** `scripts/deploy/deploy-l1.ts`, `config/testnet.json`, `contracts/L1/CloneFactory.sol:84,205`, `contracts/L3/RegistryRebalanceVault.sol`.
- **Acceptance:** `factory.registryRebalanceImpl() != 0` && `factory.feeToken() == USDG` && `factory.defaultFlatCreateFee()==1e18`, all read back on chain 46630. New factory address recorded in `testnet.json`.
- **Demo scene:** prerequisite for **all scenes** (no fund otherwise).

### P0-2 — Deploy USDG as 18-dec mock (NOT the bundled 6-dec USDG.sol)
- **What:** `ensure(config,'MockERC20Decimals',['USD Global','USDG',18],deployer,'USDG')`. Do **not** use `contracts/mock/USDG/stablecoins/USDG.sol` (decimals=6).
- **Why:** `FeeCore.sol:29-31` `FLAT_FEE_MAX=100e18` assumes 18-dec USDG (~$100). A 6-dec token makes the flat-fee cap represent ~$1e14, breaking cost-recovery semantics.
- **Files:** `contracts/mock/MockERC20Decimals.sol`, `config/testnet.json`.
- **Acceptance:** `USDG.decimals()==18`; address recorded under key `USDG`; `factory.feeToken()==USDG`.
- **Demo scene:** unblocks the L5 cash-in flow used in **Scene 4** (USD settlement gating).

### P0-3 — Whitelist demo Stock tokens + deploy them
- **What:** `deploy-demo-stocks.ts` (or inline): deploy `AccessControlsRegistry` + `Stock` impl/`StockProxy` for MSTRx/TSLAx/NVDAx, grant MINTER + (for TSLAx) MULTIPLIER_UPDATER to the operator, call `factory.setConstituentAllowed(addr,true)` for each. **User deploys the real stock tokens; we deploy the mock puppets/adapters** — so this script must accept user-supplied addresses if provided, else deploy mock Stocks.
- **Why:** `createRegistryIndex` loops `constituentAllowed[tokens[i]]` and reverts `NotWhitelisted` (`CloneFactory.sol:207`).
- **Files:** `contracts/mock/stock/Stock.sol`, `contracts/L1/CloneFactory.sol:207`, `config/testnet.json`.
- **Acceptance:** `factory.constituentAllowed(each)==true`; multiplier-updater role on TSLAx granted (needed for Scene 2 split).
- **Demo scene:** prerequisite for **Scene 0** (Volatile Tech Basket) and **Scene 2** (TSLAx 3:1 split).

### P0-4 — Write `deploy-l5.ts` — registry index + bootstrap + ForwardCashQueue + full wiring
- **What:** New script doing, in order: (a) build genesis Merkle root **off-chain** with `@openzeppelin/merkle-tree` `StandardMerkleTree.of(rows, ['address','uint256','uint256'])`, rows = `[token, unitQty.toString(), unitSize.toString()]`; (b) `factory.createRegistryIndex({genesisRoot, tokens, unitSize, name, symbol, manager, managerFeeBps, keeperBps, keeperEscrow}, salt)` — **struct has NO `unitQty[]` field** (the handoff doc is wrong; verified `CloneFactory.sol:192-198`), `unitQty[]` is only an off-chain tree input + a `bootstrap()` arg; (c) bootstrap: mint+wrap the **full** constituent set, then `vault.bootstrap(unitSize, tokens, unitQty, proofs)`; (d) deploy `BasketNavObserver(fairValueNav)` — **not** RebalanceObserver; (e) deploy `MockFeedRouter`, `setFeed(token, id('TOKEN/USD-mock'))` per constituent; (f) deploy `ForwardCashQueue(vault, USDG, fairValueNav, basketNavObserver, keeperModule, mockFeedRouter, pegFeed)`; (g) wire: `vault.setSettler(queue,true)`, `keeperModule.setExecutor(queue,true)`, `q.setG1Refs(aggregator, l2RouterSource)`, `q.setGateParams(...)`, `q.setSpreadBps`, `q.setKeeperTip`; (h) `aggregator.addSource(token, source)` per constituent for the g1 source check. Record all addresses in `testnet.json`.
- **Why:** No L5 deploy automation exists; this is the single largest gap. Each missing wire is an independent settle revert: missing settler → `NotSettler`; missing observer → `NoObservations`; missing g1 router/source → `FeedNotSet`/`L2SourceMissing`.
- **Files:** `scripts/deploy/deploy-l5.ts` (new), `contracts/L5/ForwardCashQueue.sol:103,164,181-182`, `contracts/L5/BasketNavObserver.sol:69`, `contracts/L3/RegistryRebalanceVault.sol:139`, `contracts/mock/MockFeedRouter.sol`.
- **Acceptance (must all read true on chain):** `vault.totalSupply()>0`, `vault.recipeRoot()!=0`, `vault.heldTokens().length == <full constituent count>` (asserts bootstrap completeness), `queue.vault()==vault`, `queue.stable()==USDG`, `vault.isSettler(queue)==true`, `keeperModule.isExecutor(queue)==true`, `router.feedIdOf(token)!=0` per token, `aggregator.isSource(token, l2RouterSource)==true` per token. A scripted `requestCreate → settle` succeeds when market Open+safe.
- **Demo scene:** unblocks **the entire L5 demo** — Scene 0 (live fund), Scene 4 (cash gated), Scene 7 (holder protection).

### P0-5 — `bootstrap()` completeness guard for the live stand (operational + minimal code hardening)
- **What:** `bootstrap()` is permissionless with only a `totalSupply()!=0` guard; a griefer who wrapped one valid constituent can front-run a partial seed and permanently mis-seed `_held` (`RegistryRebalanceVault.sol:78-102`). For the demo: bundle deploy+full-set bootstrap in **one operator tx/script run** (P0-4 already does this), and add a post-bootstrap `heldTokens().length == expected` assertion that aborts the script on mismatch. Minimal code option if time allows: gate `bootstrap` to manager/AP (`onlyManager` or `isBootstrapper` allowlist).
- **Why:** Confirmed high (liveness/footgun, not custody). On a public mempool a watcher could brick the registry vault; an honest operator who drops a constituent silently ships an under-collateralized index.
- **Files:** `contracts/L3/RegistryRebalanceVault.sol:78-102`, `scripts/deploy/deploy-l5.ts`.
- **Acceptance:** script aborts if `heldTokens().length != constituentCount`; (if code path taken) a non-manager `bootstrap` call reverts.
- **Demo scene:** protects **Scene 0** (the live 500-name stand) from being front-run/mis-seeded.

> **IMP-8 status (explicit):** **DONE and tested** — `ManagedRebalanceVault.sol:329-379` and `RebalanceCore.sol:163-197` implement holdings-based preview over `_held` with `effSupply`; `RebalancePreview.test.ts` covers wei-exactness incl. pending fee accrual. This was the hard prerequisite for L5 settle and is **no longer a blocker**. Close the backlog item.

---

## 3. P1 — demo-critical (stand can be built)

### P1-1 — `verify-l5.ts` + wire L5 into `deploy-all.ts` + `deploy:l5` npm script
- **What:** Add `verify-l5.ts` (mirror `verify-l3.ts`) reading back every P0-4 acceptance check; add `import { deployL5 } from './deploy-l5'; await deployL5();` after `deployL3()` in `deploy-all.ts:18`; add `"deploy:l5"` to `package.json` scripts; update the `L1->L4->L3` comment to `L1->L4->L3->L5`.
- **Why:** Without this, even after the script exists, `deploy:all` leaves L5 undeployed and the deployer has no automated post-deploy confidence check.
- **Acceptance:** `npm run deploy:l5` runs standalone; `deploy:all` end-to-end produces a fully-wired stack; `verify-l5` prints all-green.

### P1-2 — Seed 5 demo holders
- **What:** After bootstrap, drive 5 pre-funded EOAs through `requestCreate → settle` (or in-kind `create`) so each holds shares; record the 5 addresses in `testnet.json` for the UI.
- **Why:** Scene 0 shows "5 holders", Scene 7 zooms into them; on-chain there would otherwise be 1 (the bootstrapper).
- **Files:** `contracts/L3/rebalance/RebalanceCore.sol`, `config/testnet.json`.
- **Acceptance:** `balanceOf(each of 5) > 0`; addresses recorded.
- **Demo scene:** **Scene 0, Scene 7.**

### P1-3 — Price-puppet / scene-runner scripts (`scripts/demo/`)
- **What:** `scripts/demo/scene-runner.ts --scene {0,1,2,3,4,5,7}` driving the mock setters and reading `FairValueNAV.navOfHoldings` via `eth_call`, logging band + `safe`. Reuse the existing `verify-l4.ts:60-64` push pattern (`vf.setVerifyResult(encode...)` then read). Each scene per the demo.md script:
  - **Scene 2 (split-safe):** `TSLAx.updateMultiplier(3:1)`; assert NAV unchanged (relies on `ChainlinkTokenizedSource` currentMultiplier scaling).
  - **Scene 3 (manipulation):** register a thin low-depth `MockSource` per constituent; `setPrice(price*25)`; show source dropped (k: 3→2), NAV unmoved, `safe` holds.
  - **Scene 4 (weekend gap):** per constituent wire one `weekendAware=false` source (set stale via `setLastUpdate(old)`) + one `weekendAware=true` wide-band source; assert `marketStatus==Closed`, `safe==false`; then in the **same block** attempt `queue.settle` (expect `NotOpen` revert) and `vault.redeem` small (expect success).
  - **Scene 5 (degradation ladder):** `setDepth(low)` in 2-3 steps on the weekend-aware source; band widens, `safe` flips false.
- **Why:** The aggregator has no clock; `marketStatus`/manipulation/degradation are produced only by deliberate source wiring (`PriceAggregator.sol:141,191`). Without scripts the operator hand-crafts calldata live.
- **Files:** `contracts/L4/mocks/MockSource.sol`, `contracts/L4/PriceAggregator.sol`, `contracts/mock/MockPegFeed.sol`, new `scripts/demo/`.
- **Acceptance:** each scene script produces the target on-chain state read back via `eth_call`.
- **Demo scene:** **Scenes 2, 3, 4, 5, 7.**

### P1-4 — Pre-seed BasketNavObserver before Scene 4
- **What:** In the Scene 0/1 runner call `BasketNavObserver.record()` ≥2 times at distinct timestamps so g6/g7 have a window; alternatively set `setGateParams(minNPrints=0, twapBandBps=0, ...)` as a documented demo relaxation.
- **Why:** Cold-start Scene 4 reverts `NoObservations` (g6) instead of the legible `NotOpen` (g2). g2/g3 must fire first for the narrative.
- **Files:** `contracts/L5/BasketNavObserver.sol:62-82`, `contracts/L5/ForwardCashQueue.sol:164,191-193`.
- **Acceptance:** in Scene 4, `settle` reverts `NotOpen` (not `NoObservations`).
- **Demo scene:** **Scene 4.**

### P1-5 — Runbook: AP must `setOperator(QUEUE, true)` — not the vault
- **What:** Document (and assert in `verify-l5`) that each AP authorizes the **ForwardCashQueue** as ERC-6909 operator, not the vault. Optional view helper `queue.apOperatorReady(ap)`.
- **Why:** `settleCreate`'s inner `transferFrom` sees `_msgSender()==queue`; authorizing the vault bricks every create settle with a raw revert.
- **Files:** `contracts/L3/RegistryRebalanceVault.sol:150`, `contracts/L5/ForwardCashQueue.sol`.
- **Acceptance:** `vault.isOperator(ap, queue)==true` for each demo AP, checked in `verify-l5`.

### P1-6 — Pitch/demo address substitution
- **What:** Fill `0x…REPLACE` on the `shipped` slide and the demo end-card with the deployed factory/vault/queue addresses on chain 46630; verify the demo link is live (`pitch-video.md:65,70`).
- **Demo scene:** pitch Block 3 `shipped`, demo end-card.

---

## 4. P2 — toward audit-grade

### Security findings worth fixing now (cheap, fail-closed, no demo risk)
- **`SignedCommitteeBase` threshold-zero fail-open** (`SignedCommitteeBase.sol:14,19-24`): add `require(threshold_>0 && threshold_<=members.length)` in `setCommittee` and a read-path `if (threshold==0) revert ThresholdNotMet();`. Regression test: zero-sig payload reverts on a fresh adapter. *(Adjusted medium; aggregator 40% cap + minSafeSources=2 limit blast radius, but trivial to harden.)*
- **Empty-acquire auction footgun** (`RebalanceAuction.sol:95-129`): add `if (acquire.length==0) revert InvalidAuctionParams();` in `open()`. Document `open`/`setExecMode` as un-timelocked privileged ops requiring a manager multisig. *(Adjusted medium; manager-only + needs malicious curator.)*
- **Auction `_deriveMinOut` balance-domain mismatch** (`RebalanceAuction.sol:138` vs `RebalanceCore.sol:79`): make the auction balance-domain-aware for registry vaults (read claim custody / a canonical `backingOf`, not `IERC20.balanceOf`). **Do NOT `setExecutor(auction)` on any registry vault before this lands** — leaving it unwired is the current safe state. Add an `executeRebalance`-via-auction integration test on `RegistryRebalanceVault`.
- **Auction overwrite guard** (`RebalanceAuction.sol:118-128`): reject overwriting a live non-expired auction (matters only in ALLOWLIST mode).
- **`navOfHoldings` unvalidated token set** (`FairValueNAV.sol:100-119`): add a loud comment that callers MUST pin to `vault.heldTokens()`, cross-linking the L5 g-check (`ForwardCashQueue.sol:177-180`).

### Foundry fuzz workstream — set up from scratch (no foundry exists today)
Hardhat/TS stays the unit/integration suite; add foundry **purely for invariant/property fuzzing**. Bootstrap:
1. `foundry.toml` with `[profile.default] src='contracts' test='test/foundry' libs=['node_modules','lib']`, remappings for `@openzeppelin`; `forge-std` via `lib/`. Compile against the same `solc`/optimizer as `hardhat.config.ts`. Add `npm run fuzz` → `forge test`.
2. Invariants per layer (stateful handlers calling create/redeem/wrap/bootstrap/settle):
   - **L1 (BasketVault/CommittedVault/StorageVaultBase):** `sum(holdingsOf) == recipe·totalSupply` after any create/redeem sequence; redeem never returns more than backing (last-redeemer-safe); `totalSupply==0 ⇒ redeem reverts NoSupply` (no div-by-zero); recipe commitment immutable.
   - **L1m fee (FeeCore):** accrued shares are monotone non-decreasing; manager+platform dilution ≤ caps (2% + 0.5%/yr); `previewRedeem` includes pending dilution; no underflow on time jumps.
   - **L3 (RegistryCustody/RebalanceCore):** ERC-6909 claim conservation across wrap/unwrap/settleCreate (no claim minted without backing ERC20 in); `_portBalance == balanceOf(self, idOf)`; create-then-redeem round-trip returns ≤ deposited (no value creation); `_held` membership ⊇ tokens with nonzero claim.
   - **L3 auction (RebalanceAuction):** value-conservation — post-`executeRebalance` `navOfHoldings` ≥ pre-swap floor; per-leg `minOut` respected in the correct balance domain; **fuzz the empty-acquire + domain-mismatch vectors as regression assertions.**
   - **L4 (PriceAggregator):** no single source >40% weight can move the depth-weighted median beyond the divergence band; `safe ⇒ band ≤ maxSafeBandBps && survivors ≥ minSafeSources`; `k==0 ⇒ safe==false && marketStatus==Unknown`; band math doesn't overflow on realistic ranges (document the >~1e40 ceiling); **fuzz the colluding-plurality case and assert the trust-model boundary** (documents, not fixes, the bound).
   - **L5 (ForwardCashQueue):** settle never executes when `!safe || marketStatus!=Open` (g2/g3 hold under fuzzed gate params); minted shares == `previewCreate(N)` exactly (no 1-wei revert); escrow conservation (cash in == fee + cashToAP); cancel-before-cutoff returns full escrow; `_settleGate` `HeldMismatch` holds against fuzzed token subsets.
3. Property tests: `assertEq` round-trip identities for wrap/unwrap and create/redeem at boundary qty (1 wei, max), and a differential test of `previewCreate`/`previewRedeem` vs actual `create`/`redeem` in the same block (locks IMP-8 against regressions).

### Deferred-but-flag-for-mainnet (not buildathon)
- Sequencer-uptime gate (g9) for Orbit L2 (`ForwardCashQueue` / `PriceAggregator`).
- `RebalanceObserver` ring-buffer + O(log n) `consult` (IMP-11) and opportunistic `_held` prune (unbounded-growth risk at 500 names over many reconstitutions).
- ChainlinkTokenizedSource v10 field-order reconciliation before any real Chainlink wiring.

---

## 5. P3 — stays deferred (backlog cleanup)

Mark these in the backlog so they stop re-surfacing:
- **DONE — close now:** IMP-2 (creation/flat deploy fee, `CloneFactory.sol:49-105`), IMP-8 (holdings preview).
- **Genuinely fine to leave deferred (no buildathon action):** IMP-1 (linear vs exponential fee — correct at 0.5%/yr cap), IMP-3 (ERC-7540 async — covered by RegistryRebalanceVault), IMP-4 (AUM-banded license — off-chain), IMP-5 (meridian/treasury registry), IMP-6 (split-during-accrual test), IMP-7 (packed recipe storage), IMP-9/IMP-10 (auction NAV value-floor + PERMISSIONLESS anti-griefing — **PERMISSIONLESS is hard-disabled, keep it off; do not re-enable before IMP-9 lands**), IMP-11 (ring buffer), IMP-12 (`planRebalance`/`IRebalanceStrategy`), IMP-13 (disable inherited `initialize` on ManagedRebalanceVault clone — atomic factory deploy is the only path, safe for demo).
- **Lower-severity correctness, defer with a one-line doc note:** fee-on-transfer/rebasing silent skew (keep documented exclusion; add `constituentAllowed` to basket/committed/managed create paths post-buildathon), `settleCreate` standing-operator trust window (document: APs revoke grant after settlement), `rootCommitment` emitted-recipe unverified (downgrade DA claim to "watcher-verified"), no-whitelist on BASKET/COMMITTED/MANAGED (filter `allVaults` in UI), capacity fee-oversizing (inert at default `maxCreateFlowBps==0`), g7 self-poke (frame as defense-in-depth, not anti-manipulation, in the pitch).

---

## 6. Business-coverage verdict

**Supported and demo-relevant (claim freely):** static in-kind/UIT (BasketVault, CommittedVault), cap-weighted index + streaming AUM fee (ManagedVault — VOO/SPY analog), equal-weight/threshold reweight (ManagedRebalanceVault — RSP analog), scheduled reconstitution (scheduleTarget/scheduleRoot, 7d timelock — S&P quarterly analog), **500-name index (RegistryRebalanceVault — the flagship demo vault)**, forward-priced cash mutual fund (ForwardCashQueue, Rule 22c-1 analog — Scene 4), 24/7 fair-value NAV (L4 — the moat, Scenes 2/3/4/5). L2 (market-hours display) is correctly subsumed into L4.

**Gaps — by design, do NOT claim:** L6 24/7 binding/forced redemption (deferred v2 — pitch must say "forward-priced to next open", never "weekend forced liquidation"; demo.md already honors this), L7 leveraged/inverse/structured, thematic active/discretionary (ARKK), target-date/multi-asset, on-chain dividend/income screening (methodology stays off-chain; RHC has no cash-dividend rail), per-wallet direct indexing.

**Scope to trim from the demo narrative (not the code):** CommittedVault, `IFeePolicy`/`IRebalanceStrategy` interfaces, GmxV2Source (crypto-signal only, not equity perps) — keep as infrastructure, don't foreground them to a technical judge.

**Pitch guardrails to enforce:** don't claim live source connections (all mocks, sandbox badge), don't claim "500 constituents" literally on stage (demo uses a 3-name Volatile Tech Basket on the registry path), don't claim 101/99 edge-pricing as our create/redeem, no statistical-precision claims on the ~45-weekend V0 history, no confidential RHC specifics.

---

## 7. Sequenced 3-day execution order

**Critical path:** P0-1 (L1 redeploy + registry impl + fee globals) → P0-2 (USDG) → P0-3 (whitelist stocks) → P0-4 (`deploy-l5.ts`: index + bootstrap + queue + wiring) → P1-1 (`verify-l5`) → P1-2/P1-3 (holders + scene runner) → record video → submit. Everything else parallelizes around this spine.

### Today (11 Jun) — make the stack deployable and the registry vault exist
1. **P0-1 + P0-2 + P0-3** in `deploy-l1.ts` (+ demo-stocks): `REDEPLOY=1`, register `registryRebalanceImpl`, USDG (18-dec), `setFeeToken`, `setDefaultFlatFees`, whitelist MSTRx/TSLAx/NVDAx. Read-back verify. Record `testnet.json`.
2. **P0-4 start:** write `deploy-l5.ts` through `createRegistryIndex` + full-set `bootstrap` (struct **without** `unitQty[]`; off-chain Merkle root). Add the **P0-5** `heldTokens().length == constituentCount` script assertion.
3. **P2 quick security hardening in parallel** (separate from deploy, low-risk): `threshold>0` require + read-path guard; `acquire.length==0` revert in `open()`. Re-run hardhat suite — must stay 307/307 green (these are the items the buildathon judge may probe and they're one-liners).

### Tomorrow (12 Jun) — wire L5 end-to-end, stand up the demo
4. **P0-4 finish:** BasketNavObserver, MockFeedRouter + `setFeed`, ForwardCashQueue ctor, all wiring (`setSettler`, `setExecutor`, `setG1Refs`, `setGateParams`, per-constituent `addSource`). **P1-5** AP `setOperator(queue)`.
5. **P1-1:** `verify-l5.ts` (all acceptance reads), wire `deployL5()` into `deploy-all.ts`, add `deploy:l5` script. Run full `deploy:all` clean on chain 46630; `verify-l5` all-green.
6. **P1-2 + P1-3 + P1-4:** seed 5 holders; write `scripts/demo/scene-runner.ts` for Scenes 0/1/2/3/4/5/7; pre-seed BasketNavObserver. Dry-run every scene via `eth_call`; confirm Scene 4 reverts `NotOpen` (not `NoObservations`) and in-kind `redeem` succeeds in the same block.
7. **Foundry kickoff (P2, parallel):** `foundry.toml` + `forge-std` + first L1 and L5 invariant files (conservation + g2/g3-hold + `previewCreate==mint`). Goal is a runnable `forge test` with the highest-value invariants, not full coverage.

### Submission day (13 Jun, buffer to 14) — record, fill addresses, submit
8. Record the demo video against the live testnet stand (full 7 scenes; tight-cut 0→2→3→4→6 fallback). Capture the blocked/forward-queued unsafe redemption (plan.md task 11).
9. **P1-6:** substitute real addresses on the `shipped` slide + demo end-card; confirm the demo link is live.
10. Submit per plan.md Phase 4: clean repo (README + tests), demo + pitch videos, deployed addresses, the two V0 charts (error-vs-naive + dislocation, both labeled illustrative), reproducible V0 notebook. Run `npm test` (307 green) + `forge test` + `verify-l5` once more as the final gate.

**If time slips:** cut foundry coverage to the L5 + L1 conservation invariants only; cut Scenes 1/5/7 (tight-cut); never cut P0-1..P0-5 or P1-1..P1-4 — without them there is no live fund and nothing to film.

---

## 8. Test-coverage assessment (good-but-narrow; the 4 high findings hid in coverage holes)

Baseline is 307/307 green and the **unit coverage is genuinely strong, above hackathon bar**: the exploit matrix (Mango/bZx/Harvest/Inverse/Cream/Weekend), two-leg fee accrual with carry-dust + non-retroactive timelock, the full `g0-g8` gate (each gate tested in isolation), permit adversarial cases, scaled-UI split raw-safety, nested baskets, and crucially **IMP-8 holdings-preview wei-exactness** (`ManagedRebalanceVault — holdings-based previews`) are all covered. That is why IMP-8 is closed, not a blocker.

But the suite is **almost entirely example-based, builds every fixture in-memory (bypassing the deploy scripts), and has zero property/invariant/fuzz tests**. The result: 307 green proves per-contract logic but says nothing about (a) invariant-robustness across the input space, (b) cross-layer seams, or (c) deployability. **All four confirmed high findings hid in specific coverage holes** — they are not exotic, the tests simply do not exercise those paths:

| # | Coverage hole | The high finding it hid | What to add |
|---|---|---|---|
| H1 | No `executeRebalance` test on `RegistryRebalanceVault` via the auction (registry tests cover only bootstrap/create/redeem/settleCreate/root; auction tests use `ManagedRebalanceVault` only) | `l3-auction-derivemin-erc20-vs-claim` (auction reads ERC20 `balanceOf` vs the registry's claim-balance floor) | Integration test: open+bid an auction against a `RegistryRebalanceVault`; assert `minOut` is derived in the claim domain |
| H2 | No griefing-bootstrap test (only `bootstrap twice` / `leaf-not-in-root`) | `registry-bootstrap-permissionless-incomplete` (a partial first seed bricks the full basket) | Test: a non-AP wraps one constituent and front-runs a partial `bootstrap`; assert the honest full-set `bootstrap` reverts `AlreadyBootstrapped`; then assert the script-side `heldTokens().length == constituentCount` guard catches it |
| H3 | Committee tests assert "below threshold reverts" but only with `threshold` already set `>0`; the default-0 path is untested | `SignedCommitteeBase threshold==0` fail-open (accepts zero-signature payloads) | Test: a fresh adapter with `threshold==0` reverts on a zero-sig payload (red→green against the guard) |
| H4 | `RebalanceAuction.open` tests cover `duration 0` / `startIn<endIn` / `token-both-sides`, not an empty `acquire[]` | empty-acquire auction principal-drain footgun | Test: `open` with `acquire.length==0` reverts `InvalidAuctionParams` |

Two more systemic gaps (not tied to a single finding, but they are why the deploy state was invisible):

- **No deploy-path / wiring test.** Because fixtures bypass `scripts/deploy/**`, the stale testnet factory, the missing `deploy-l5`, the unregistered registry impl, and the absent USDG are all invisible to `npm test`. **A smoke test that runs `deploy-all` + `deploy-l5` against a local hardhat node and asserts the wired stack IS the test for "deployable"** — add it (P1/P2).
- **No property/invariant fuzzing (foundry absent).** Example tests prove points; invariants prove the space. The single-example "thin source x25 cannot move the median" should become a fuzz over `(prices, depths, source-count)`. This is the P2 foundry workstream in §4, now reframed: **it is not audit polish, it is closing the exact class of holes that let the 4 highs through.** The 500-name claim is likewise validated only at N=2 (the test admits it rests on Q7 internal-gas math) — acceptable for the buildathon, flagged here so it is not mistaken for coverage.

**Plan consequence (folded into §2/§4):** the 4 regression tests above are written **before** their fixes (TDD red→green) and become the acceptance tests for the security-hardening tasks; the deploy smoke test and the per-layer foundry invariants (conservation L1, claim-conservation L3, median-cap L4, `g2/g3`-hold + `previewCreate==mint` L5) are explicit P2 tasks, not "if time." Optional: run `solidity-coverage` once to replace this by-inspection read with line/branch numbers before the foundry pass.

---

## Appendix A — Confirmed / verified high findings (adversarially checked)

| id | layer | dim | sev (raw→adj) | verdict | demo-block | title |
|---|---|---|---|---|---|---|
| registry-bootstrap-permissionless-incomplete | L3 | correctness | high→high | confirmed | no | Permissionless bootstrap with no completeness check lets a griefer permanently fix the held set / brick the 500-name stand |
| l3-auction-derivemin-erc20-vs-claim | L3 | correctness | high→high | confirmed | no | RebalanceAuction._deriveMinOut reads ERC20 balanceOf(vault) but the registry vault enforces minOut against the ERC-6909 claim balance — domain mismatch breaks reconstitution on the 500-name vault |
| l3-empty-acquire-self-bid-drains-principal | L3 | security | high→medium | confirmed | no | Empty-acquire auction in MANAGER_ONLY lets the manager drain release-leg PRINCIPAL to themselves plus collect the keeper tip, with no acquire delivered and no timelock |
| l4-committee-threshold-zero-default | L4 | security | high→medium | confirmed | no | SignedCommitteeBase threshold defaults to 0 and is never required > 0 — a misconfigured signed adapter accepts zero-signature payloads |
| l5-no-deploy-script | deploy | deployability | high→high | confirmed | **YES** | No L5 deploy/verify script — ForwardCashQueue + registry vault are not deployable via the orchestrator |
| registry-vault-not-deployed | deploy | demo-readiness | critical→critical | confirmed | **YES** | RegistryRebalanceVault (500-name) and ForwardCashQueue not deployed on RHC testnet |
| no-demo-puppet-script | deploy | demo-readiness | high→medium | confirmed | no | No operator puppet script to drive scene transitions (price push, stale feed, market close, manipulation) |
| no-registryrebalanceimpl-in-factory | deploy | demo-readiness | high→high | confirmed | **YES** | CloneFactory.registryRebalanceImpl not set on testnet — createRegistryIndex will revert ZeroAddress |
| deploy-l1-stale-bytecode | deploy | deployability | critical→critical | confirmed | **YES** | L1 CloneFactory + impl bytecode is stale — missing fee model and RegistryIndex slot |
| usdg-missing | deploy | deployability | critical→critical | confirmed | **YES** | USDG stablecoin not deployed — no entry in testnet.json, no step in any deploy script |
| registry-rebalance-impl-missing | deploy | deployability | critical→critical | confirmed | **YES** | RegistryRebalanceVault implementation not deployed and not registered in factory |
| deploy-l5-missing | deploy | deployability | critical→critical | confirmed | **YES** | deploy-l5.ts does not exist — no script for demo registry index, mock stocks, or ForwardCashQueue |
| basket-nav-observer-missing | deploy | deployability | high→high | confirmed | **YES** | BasketNavObserver not deployed — required by ForwardCashQueue g7 gate, not present in testnet.json |

## Appendix B — Lower-severity / coverage / improvement / deploy findings (adversarially verified 2026-06-11)

> **Second-pass verification (workflow wf_965ecd1d-2fc, 67 skeptics + synthesis):** all 67 were re-checked, one skeptic per finding. Result: **64 confirmed, 3 false-positive, 0 already-mitigated, 0 uncertain; 1 severity upgrade; 8 demo-blocking — all already covered by P0/P1 tasks in the plan.**
> - **Upgrade:** `forward-cash-queue-settler-wiring` medium→**high** (every cash-in reverts `NotSettler` without `vault.setSettler(queue,true)`) — covered by plan Task 8 (wire) + Task 9 (verify-l5 asserts `isSettler`). The `setSettler` line is load-bearing; do not trim it.
> - **False-positives (drop):** `imp-1-exponential-fee` (the fee formula is already dilution-exact `S·x/(1−x)`, not the linear approx the finding assumed); `imp-6-split-accrual-test` (a split-during-accrual test already exists at `test/L1/ManagedVault.test.ts:266` → IMP-6 is effectively DONE, mark it so); `l5-gate-twap-bootstrap` (the g2/g3 gate fires before `NoObservations`; observer pre-seed is hygiene, not a blocker).
> - **Net: plan stands, no new tasks.** The rows below are the original review evidence; treat the 3 ids above as resolved.

| id | layer | dim | sev | title | recommendation |
|---|---|---|---|---|---|
| fee-on-transfer-rebasing-silent-skew | L1 | correctness | medium | Fee-on-transfer / rebasing constituents silently break in-kind accounting (recorded amount != received) | Either measure actual received balance (balance-before/after delta) and mint/credit on the delta, or keep the documented exclusion but add the constituentAllowe |
| settlecreate-operator-trust-window | L3 | security | medium | settleCreate relies on a standing ERC-6909 operator grant the AP cannot scope per-call; a compromised/buggy settler can drain the AP's wrapped claims | Document that APs must revoke the operator grant after each settlement, or move to per-settlement scoped authorization (e.g. ERC-6909 allowance decremented per  |
| rootcommitment-emitted-recipe-unverified | L3 | correctness | low | scheduleRoot emits a DA recipe that is never verified against the new root (and unitSize unchecked) — DA logs can lie | Either drop the DA-correctness claim to 'best-effort, watcher-verified', or verify a cheap commitment (e.g. require keccak(tokens,unitQty,unitSize) match a seco |
| no-whitelist-basket-committed-managed | deploy | business-coverage | low | BASKET/COMMITTED/MANAGED creation has no constituent whitelist (REBALANCE/REGISTRY do) — Meridian-branded vaults can be spun up over arbitrary/malicious tokens | Either intentionally keep these permissionless (document it) or add an opt-in whitelist/allowlist flag so the public registry the stand reads from can be filter |
| zero-supply-and-empty-held-liveness | L1 | demo-readiness | info | Zero-supply NoSupply revert and post-full-redeem empty _held are intended but worth an explicit demo guardrail | For the stand, avoid driving supply to exactly 0 on stage, or keep a small protocol-owned position so the held set/supply never resets mid-demo. |
| l3-bootstrap-no-completeness | L3 | correctness | medium | RegistryRebalanceVault.bootstrap does not enforce recipe completeness — a partial-backing 500-name index can mint full shares | Either (a) require tokens.length == the root's leaf count (pass and store the expected cardinality at init / in the genesis commitment), or (b) make bootstrap p |
| l3-auction-no-overwrite-guard | L3 | security | medium | open() has no active-auction guard — an opener can overwrite a live auction, resetting the Dutch clock and swapping legs mid-flight (ALLOWLIST griefing) | Reject overwriting a live, non-expired auction: `if (_auc[vault].active && block.timestamp <= _auc[vault].start + _auc[vault].duration) revert ...`, or require  |
| l3-settlecreate-natspec-operator-wrong | L3 | correctness | low | settleCreate NatSpec says the AP authorizes the SETTLER as operator; this is correct only because the inner transferFrom is a self-call — fragile and easy to break | Replace the public transferFrom with a direct internal _custodyIn-style _transfer plus an explicit isOperator(ap, msg.sender) check (or _spendAllowance), making |
| l3-keeper-bps-rounding-manager-leg-zero | L3 | correctness | info | Keeper carve uses ceilDiv on a per-accrual basis — manager leg can be rounded to 0 for tiny accruals (dust favoring keeper), bounded and non-underflowing | Acceptable as-is. If the manager-vs-keeper split must be exact long-run, carry the keeper remainder in a scaled accumulator before the ceilDiv rather than round |
| l3-redeem-no-prune-held-growth | L3 | deployability | low | redeem never prunes zero-balance tokens from _held; reconstitution + full redeem leaves dead entries, growing the create/redeem loop unboundedly over a vault's life | Add an opportunistic prune of zero-balance held tokens inside redeem/create (or a permissioned compactHeld()), and gas-bench create/redeem at 500 held + N stale |
| l3-observer-unbounded-array | L3 | deployability | low | RebalanceObserver observations are an unbounded append-only array with O(n) linear scan in consult() — permissionless record() can be spammed to brick the is-due read | Ship the deferred fixed-size ring buffer + binary search before mainnet, or cap window and add a permissioned prune. For the demo, keep windows short and the ob |
| l4-collusion-plurality-defeats-median | L4 | security | medium | Depth-weighted-median + divergence filter is defeated by a colluding plurality of deep sources (honest minority silently evicted, safe stays true) | Document the trust model explicitly: manipulation resistance is bounded by source INDEPENDENCE, not just depth. Consider (a) computing the divergence band again |
| l4-navofholdings-no-internal-validation | L4 | correctness | low | navOfHoldings (the L5 settle price) performs no recipe/holdings validation — safety lives entirely in the L5 caller | Either document loudly on navOfHoldings that the token set is UNVALIDATED and callers MUST pin it to vault.heldTokens(), or have navOfHoldings itself read vault |
| l4-marketstatus-adapter-dependent-weekend | L4 | correctness | low | Weekend marketStatus=Closed is adapter-trust, not engine-enforced: the aggregator has no clock and flips to Open if any non-weekendAware source stays healthy | Treat the per-adapter staleness/closed gate as a load-bearing security control: enforce conservative maxAge on every weekday adapter at deploy, add an integrati |
| l4-band-overflow-extreme-price | L4 | correctness | info | Confidence-band math overflow-reverts at extreme prices (>~1e40/unit) — fails safe but is a read-DoS ceiling | Document the safe operating range (price*depth and med*combinedBps must stay < 2^256). Optionally use mulDiv in _band to push the ceiling out, or cap inputs. No |
| l4-divergence-degenerate-keeps-provisional | L4 | correctness | info | When all sources diverge from the provisional median (k==0) the engine keeps the provisional price with zero band and marks unsafe — correct fail-mode, worth a regression test | Add a regression test for the all-diverge (k==0) path asserting safe=false and marketStatus=Unknown, to lock the fail-closed contract against future refactors. |
| l4-split-safe-reconcile-flag | L4 | demo-readiness | info | Split-safe NAV is delivered via per-RAW currentMultiplier scaling, but the tokenizedPrice per-raw-vs-per-UI assumption is explicitly unreconciled against the real Chainlink v10 schema | Keep the demo on the mock (clearly labeled synthetic). Before any real Chainlink v10 wiring, reconcile the ReportV10 field order and the tokenizedPrice scale; a |
| l5-registry-capacity-fee-oversizing | L5 | correctness | low | Capacity demand pass-1 ignores flatCreateFee on the registry path — cap binds slightly tighter than real mintable shares | In _sumCreateDemand, branch on isRegistry and subtract flatCreateFee from t.amount before applying spread/navPerShare (clamp at 0), mirroring _settleCreateRegis |
| l5-g7-twap-self-poke-noop | L5 | security | low | g7 TWAP band is a permissionless, same-source self-sample that the settling keeper can pull onto navPerShare, making the band a near-no-op | Treat g7 explicitly as a defense-in-depth sanity band, NOT a manipulation guard (the NatSpec already says 'never a settlement price' — keep that framing). Optio |
| l5-imp8-prereq-satisfied | L5 | correctness | info | IMP-8 hard prerequisite verified SATISFIED — settle does not revert on the rebalanced/registry vaults | No action for the demo. Keep IMP-8's note that NAVEngine's target-based reader remains informational-only and must never become the settle path; close the NAVEn |
| l5-erc6909-operator-must-be-queue-not-vault | L5 | demo-readiness | info | Registry settleCreate operator authorization correctly targets the queue (verified, not a bug) — but it is a brittle integration footgun for the demo runbook | Document in the L5 demo runbook / verify-l5 script that the AP must setOperator(ForwardCashQueue, true) — NOT the vault — before settle. Optionally add a pre-se |
| imp-1-exponential-fee | L1 | improvement | info | IMP-1 — Per-second exponential fee accrual: still linear | No action for the buildathon. Revisit only if MANAGER_MAX is raised above ~1% or a regulated product demands exact realized == quoted rates. |
| imp-2-creation-fee | L1 | improvement | info | IMP-2 — Creation fee (flat deploy fee): ALREADY IMPLEMENTED | Close this backlog item — it is fully implemented. No buildathon work needed. |
| imp-3-erc7540-async | L1 | improvement | info | IMP-3 — True flat-500 single vault with ERC-7540 async: not implemented | Remains deferred. RegistryRebalanceVault provides the 500-name path; IMP-3 is only needed if a single 500-name vault with cash-in UX on a DIFFERENT architecture |
| imp-4-aum-banded-license | cross | improvement | info | IMP-4 — AUM-banded direct license (enterprise pricing): not implemented | No buildathon action. Revisit for enterprise deals when rev-share is insufficient. |
| imp-5-meridian-registry | L1 | improvement | info | IMP-5 — Registry for meridian/treasury vs factory-injected globals: not implemented | Remains deferred. Only required when many live managed vaults need a global treasury/cut change without redeploying. Not needed for the buildathon. |
| imp-6-split-accrual-test | L1 | improvement | info | IMP-6 — Dedicated scaled-UI split-during-accrual test: not implemented | Remains deferred pending a Stock external multiplier-setter API test harness. Not blocking for the buildathon. |
| imp-7-packed-recipe-storage | L1 | improvement | info | IMP-7 — Packed recipe storage via global stock-id registry: not implemented | Remains deferred. The 500-name case is covered by RegistryRebalanceVault; packed recipe storage is only worth building if a single rebalanceable vault with >50  |
| imp-8-holdings-preview | L3 | improvement | info | IMP-8 — Holdings-based previewCreate/previewRedeem: FULLY IMPLEMENTED | Close this backlog item — fully implemented and tested. The L5 demo path is unblocked by this item. |
| imp-9-nav-value-floor | L3 | improvement | medium | IMP-9 — Post-swap NAV value-floor check in RebalanceAuction: not implemented | Keep deferred until PERMISSIONLESS is re-enabled. Current compensating control (PERMISSIONLESS disabled in v1) keeps the attack surface limited to manager-only  |
| imp-10-auction-anti-griefing | L3 | improvement | medium | IMP-10 — RebalanceAuction PERMISSIONLESS anti-griefing: not implemented | Remains deferred. Only required when PERMISSIONLESS is re-enabled, jointly with IMP-9. No buildathon action. |
| imp-11-ring-buffer | L3 | improvement | low | IMP-11 — RebalanceObserver bounded ring buffer + O(log n) consult: not implemented | Remains deferred. MVP behaviour; add ring-buffer + binary-search when observer is poked at production frequency over long horizons. Not needed for the buildatho |
| imp-12-plan-rebalance | L3 | improvement | low | IMP-12 — RebalanceModule planRebalance + IRebalanceStrategy: not implemented | Remains deferred. The curator supplies leg plans directly to the auction opener. Not needed until automated delta computation is required. No buildathon action. |
| imp-13-disable-initialize | L3 | improvement | low | IMP-13 — Disable inherited initialize(ManagedParams) on ManagedRebalanceVault clone: NOT done | Low-priority footgun. Fix before mainnet or any non-factory deployment path: (1) add `virtual` to ManagedVault.initialize, (2) override in ManagedRebalanceVault |
| l1-static-inkind-uit-supported | L1 | business-coverage | info | Static in-kind / UIT archetype: SUPPORTED | No action needed. CommittedVault covers the large-basket UIT case (50+ names) where keeping the full recipe in calldata is cheaper than on-chain storage. Both f |
| l1m-cap-weighted-index-fee-supported | L1 | business-coverage | info | Cap-weighted index fund with management fee (VOO/SPY analog): SUPPORTED | No action needed. L1m is production-ready for any cap-weighted basket that the issuer manages by updating the recipe only at reconstitution events via scheduleT |
| l3b-equal-weight-reweight-supported | L3 | business-coverage | info | Equal-weight rebalance / threshold-reweight (RSP analog): SUPPORTED | The one known gap is that permissionless rebalance mode is unsafe until a post-swap navOfHoldings value-floor check is added (documented in docs/strategy/2026-0 |
| l3a-scheduled-reconstitution-supported | L3 | business-coverage | info | Scheduled reconstitution (S&P 500 quarterly rebalance analog): SUPPORTED | No GAP. Listing-gate whitelist enforcement at factory level is the correct hook. Note: the committee-discretion step (who decides what the new composition is) i |
| l3-500-name-registry-supported | L3 | business-coverage | info | 500-name index (SP500 analog): SUPPORTED via RegistryRebalanceVault | No GAP for the 500-name case. The only deferred item is Permit2 batch approval for the bootstrap/create UX (noted in coverage audit). This is a UX hardening, no |
| l5-forward-priced-cash-mutual-fund-supported | L5 | business-coverage | info | Forward-priced cash mutual fund (Rule 22c-1 analog): SUPPORTED via ForwardCashQueue | The only open item is live AP wiring — the IAPFiller interface is built but a real AP counterparty is not yet integrated (noted in coverage audit). For the demo |
| l1-committed-off-chain-recipe-basket-supported | L1 | business-coverage | info | Committed / off-chain-recipe basket archetype: SUPPORTED | No GAP. Correctly positioned between BasketVault (small, on-chain) and RegistryRebalanceVault (large, 500-name Merkle). |
| l4-24-7-fair-value-nav-wedge-supported | L4 | business-coverage | info | 24/7 fair-value NAV (L4 wedge / ICE FVIS analog): SUPPORTED | One deferred hardening: sequencer-uptime gate dropped from the oracle core (documented in coverage audit). For L2 deployment this matters for binding consumers. |
| l6-24-7-binding-gap | L5 | business-coverage | medium | 24/7 binding forced redemption / L6 archetype: GAP (by design, deferred) | This is a known and correct deferral — not an accidental gap. The v1 demo correctly shows gating (not forced redeem) as the weekend safety mechanism. Do not cla |
| l7-leverage-inverse-gap | L1 | business-coverage | low | Leveraged / inverse / structured ETF (TQQQ/buffer analog): GAP (by design, out-of-scope) | Out of scope by design. Do not position Meridian as supporting leveraged ETFs. If a future issuer wants a leveraged product, they would need an L7 module layere |
| l2-display-nav-market-hours-partial | L3 | business-coverage | low | Read-only market-hours NAV display (L2 / cap-weight display): PARTIAL — folded into L4 | Not a gap — the L4 aggregator subsumes L2. However, if a consumer wants a minimal market-hours NAV without the full 24/7 stack, they still use PriceAggregator w |
| thematic-active-discretionary-gap | L1 | business-coverage | medium | Thematic active / discretionary ETF (ARKK analog): GAP (not claimable, by design) | Do not claim support for fully on-chain active management. The manager-timelock model gives a credible framework for semi-transparent active management, but the |
| dividend-income-screen-partial | L1 | business-coverage | low | Dividend/income screen (SCHD/NOBL analog): PARTIAL — methodology off-chain, basket mechanics on-chain | Positioning is accurate: Meridian supports the settlement mechanics for any rules-based basket, including dividend-screened ones, as long as the constituent lis |
| direct-indexing-per-wallet-gap | L1 | business-coverage | low | Direct indexing / per-wallet custom basket: GAP (not built, but architecturally natural) | Flag as a future product line, not a current capability. The factory architecture supports per-vault customization, but no dedicated direct-indexing UX, portfol |
| sequencer-uptime-gate-gap | L5 | business-coverage | medium | Sequencer-uptime gate: not implemented (hardening gap for L2 deployment) | Add an Arbitrum sequencer uptime check (via the sequencer uptime feed at 0xFdB631F5EE196F0ed6FAa767959853A9F217697D on Arbitrum One) as g9 in ForwardCashQueue.s |
| gmx-v2-source-mismatch | L4 | business-coverage | medium | GmxV2Source adapter: GMX v2 only covers crypto+commodities, not equity perps (scope mismatch) | GmxV2Source is not wrong (GMX v2 prices can still serve as crypto correlation signals in a multi-factor model). However, the adapter library should include a Hy |
| target-date-multiasset-gap | L1 | business-coverage | low | Target-date / multi-asset fund archetype: GAP (not claimable) | Do not claim target-date fund support. The infrastructure is extensible to multi-asset if tokenized bonds become available on the deployment chain, but this is  |
| committedvault-no-fee-trimscope | L1 | business-coverage | low | CommittedVault has no fee module: potential trim for demo scope | CommittedVault is correctly built and adds no complexity. No action needed. However, the demo narrative should focus on BasketVault (small static), ManagedVault |
| module-interfaces-future-scope-trim | L1 | business-coverage | low | IFeePolicy and IRebalanceStrategy module interfaces: built but not connected (future scope) | These can be removed from the buildathon demo scope entirely. They add no functional capability in v1 and could confuse a technical reviewer looking for complet |
| market-status-closed-mechanism | L4 | demo-readiness | medium | Market-closed signalling for scene 4 depends on weekendAware flag on MockSource, not a global on-chain toggle — operator must know the exact wiring | In the fund setup script: for each constituent, add two MockSource instances to PriceAggregator — one with weekendAware=false (simulating the non-tokenized Chai |
| five-holders-not-seeded | deploy | demo-readiness | medium | Scene 0 and 7 require 5 distinct holder accounts — no seeding script exists | In the demo setup script: after bootstrap, have 5 pre-funded EOAs each wrap constituent claims and call vault.create(shares). Alternatively use ForwardCashQueue |
| l5-gate-twap-bootstrap | L5 | demo-readiness | medium | ForwardCashQueue settle gate (g6/g7) needs BasketNavObserver pre-seeded with 2+ observations before scene 4 USD settlement can be shown as GATED | In the demo puppet script for scenes 0 and 1, call BasketNavObserver.record() at least twice (at different block timestamps). This is a permissionless call. Doc |
| manipulation-source-depth-config | L4 | demo-readiness | medium | Scene 3 x25 pump needs a 'thin' MockSource pre-registered with low depth alongside normal sources | For each constituent, addSource(asset, thinMockSource) in the setup script with depth set far below dMin. In scene 3 puppet script: call thinMockSource.setPrice |
| constituent-whitelist-missing | deploy | demo-readiness | medium | Demo stock tokens (MSTRx, TSLAx, NVDAx) must be whitelisted in CloneFactory before createRegistryIndex can proceed | Add a deploy-demo-stocks.ts script that: deploys AccessControlsRegistry; deploys Stock impl + StockProxy for MSTRx, TSLAx, NVDAx; grants MINTER_ROLE to the demo |
| in-kind-redeem-always-open-correctness | L5 | demo-readiness | low | In-kind redeem is correctly never gated by safe/marketStatus — no contract gap here, but the demo wiring must route redeem to vault.redeem, not ForwardCashQueue | In scene 4 puppet script: (1) attempt ForwardCashQueue.settle (expect revert NotOpen); (2) call vault.redeem on a small amount from one holder (expect success). |
| degradation-ladder-scene5 | L4 | demo-readiness | medium | Scene 5 degradation ladder: needs a third (weekend-only) source that can be progressively thinned | Register a weekend-aware MockSource per constituent (weekendAware=true, initial depth=moderate). In scene 5 puppet script: call setDepth(low) in 2-3 steps, each |
| registry-index-struct-mismatch | deploy | deployability | medium | Handoff Part C RegistryIndex struct description includes unitQty[] that does not exist in the actual contract | When writing deploy-l5.ts, construct RegistryIndex WITHOUT a unitQty[] field. The struct is: {genesisRoot, tokens, unitSize, name, symbol, manager, managerFeeBp |
| forward-cash-queue-settler-wiring | deploy | deployability | medium | vault.setSettler(queue, true) call missing from handoff Task 2 wiring steps | Add to deploy-l5.ts wiring section after deploying the ForwardCashQueue: const vault = await ethers.getContractAt('RegistryRebalanceVault', registryIndexAddr);  |
| forward-cash-queue-g1-router-mock | deploy | deployability | medium | ForwardCashQueue g1 gate requires router.feedIdOf and aggregator.isSource — no MockFeedRouter deployed on testnet | In deploy-l5.ts: ensure(config, 'MockFeedRouter', [], deployer). After deploying the queue with router=MockFeedRouter: for each constituent call mockFeedRouter. |
| deploy-all-missing-l5 | deploy | deployability | medium | deploy-all.ts does not call deployL5 — full-stack deploy leaves L5 undeployed | After deploy-l5.ts is written, add: import { deployL5 } from './deploy-l5'; and add await deployL5(); after await deployL3(); in the main() function. Also add ' |
| verify-l5-missing | deploy | deployability | low | No verify-l5.ts script — post-deploy verification for L5 wiring is absent | Create verify-l5.ts as part of the deploy-l5 work. It should read back: factory.registryRebalanceImpl, factory.feeToken, factory.defaultFlatCreateFee, vault.tot |
| env-robinhood-rpc-set | deploy | deployability | info | PRIVATE_KEY and ROBINHOOD_TESTNET_RPC are set in blockchain/.env — deploy preconditions met | No action needed for env setup. Verify deployer has testnet ETH balance before running REDEPLOY=1 deploy-all.ts (getDeployer() reverts on zero balance). The RPC |
| l4-reusable | deploy | deployability | info | L4 (PriceAggregator, FairValueNAV, sources) is reusable without REDEPLOY — oracle contracts are unchanged | Do NOT include L4 in the REDEPLOY=1 sweep unless the compiler shows L4 bytecode changed. Run REDEPLOY=1 selectively on L1 and L3 only, or run deploy-all.ts with |
