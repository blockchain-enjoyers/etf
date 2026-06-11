# Meridian — Possible Improvements (deferred / optional)

Running backlog of upgrades we intentionally parked (not forgotten). Each has a clear **trigger to revisit**. This is the canonical place to record "do it later" decisions so specs/plans stay lean.

Status: `DEFERRED` = decided to skip for now · `OPTIONAL` = nice-to-have, no firm trigger.

---

## IMP-1 — Frequency-invariant (per-second exponential) fee accrual
- **Area:** ManagedVault fee math
- **Status:** OPTIONAL (verified 2026-06-11: the current formula is ALREADY the dilution-exact `S·x/(1−x)`, NOT a linear approximation — a review finding to the contrary was a false-positive. This item is now a purely optional refinement to per-second compounding, not a correctness gap.)
- **Now:** linear `x = managerFeeBps·Δt / YEAR`, then `feeShares = S·x/(1−x)` (mirrors Set / Index Coop / Yearn).
- **Why deferred:** simpler code, well-trodden. Realized fee drifts slightly with accrual frequency — at the 2% cap the manager under-collects up to ~2 bps/yr (continuous limit `1−e^−r`); at ≤0.5% it's <0.13 bps. The drift favors holders, so it is safe.
- **Upgrade:** per-second compounded rate, `feeShares = supply / (1−feePerSecond)^elapsed − supply`; store the per-second rate at 1e27 (RAY) using a vetted `rpow`/`powu` (MakerDAO / Solady / Enzyme); keep owed-share accumulation at 1e18. Mirror Reserve Folio / Enzyme.
- **Revisit when:** `MANAGER_MAX` is raised above ~0.5–1%, OR we want the realized fee to equal the quoted rate exactly and poke-independently (cleaner for a regulated product).
- **Source:** `research/results/R11.md`.

## IMP-2 — Creation fee (flat deploy fee, Meridian-set)
- **Area:** BasketFactory
- **Status:** DONE (2026-06-11 — flat creation/redeem fee shipped in `CloneFactory` + `FeeCore`; default fees wired via `deploy-l1` factory globals).
- **Now:** deploys are free (L1 = free standard-capture).
- **Upgrade:** optional flat fee at `createManagedBasket` → Meridian treasury (R9 "one-time setup fee", red-line clean). Keep 0 on the free L1/static path.
- **Revisit when:** we add a premium/managed tier and want to monetize deploys.
- **Source:** L1-managed spec §10, `research/results/R9.md`.

## IMP-3 — True flat-500 single vault (async)
- **Area:** vault scaling
- **Status:** DEFERRED
- **Now:** large N reached by composition (nested baskets) on the current code, no changes needed.
- **Upgrade:** ERC-7540 request/settle async + cash-in for a single 500-name vault.
- **Revisit when:** a customer needs one 500-name vault with cash-in UX.
- **Source:** `research/results/R10.md`, `docs/guides/L1b-large-basket.md`.

## IMP-4 — AUM-banded direct license (enterprise pricing axis)
- **Area:** monetization
- **Status:** OPTIONAL (borderline; off-chain only, flow-decoupled; not default)
- **Now:** rev-share on the manager's management fee (decision A).
- **Revisit when:** an enterprise deal where rev-share is insufficient.
- **Source:** `research/results/R9.md`.

## IMP-5 — Registry for meridian/treasury (vs factory-injected)
- **Area:** ManagedVault / factory governance
- **Status:** DEFERRED
- **Now:** `meridian`/`treasury`/`platformShareBps` injected at deploy from factory globals (immutable per vault).
- **Upgrade:** a small registry the vault reads, to rotate treasury / platform-cut across many live vaults without redeploying.
- **Revisit when:** many live managed vaults need a global treasury or cut change.
- **Source:** L1-managed spec §10.

## IMP-6 — Dedicated scaled-UI split-during-accrual test
- **Area:** tests
- **Status:** DONE (2026-06-11 — split-during-accrual test exists: `test/L1/ManagedVault.test.ts:266` "scaled-UI split on a constituent does not affect the fee or raw redeem"; verified in the second-pass review).
- **Now:** constituents in tests are already scaled-UI (`deployStock`→`Stock`); raw-accounting is exercised by existing tests; the fee touches only basket shares.
- **Upgrade:** a test that bumps the constituent's UI multiplier (simulated split) mid-accrual and asserts fee/redeem correctness.
- **Source:** L1-managed plan §9 (#10).

## IMP-7 — Packed recipe storage via a global stock-id registry (address book)
- **Area:** recipe storage / VaultCore / L1b scaling / recipeCommitment seam
- **Status:** OPTIONAL (gas optimization; a third recipe-storage mode)
- **Now:** two recipe modes only — (a) **storage vault** keeps full `address[] _tokens` (20B) + `uint256[] _unitQty` (32B) in SEPARATE slots → ~2 slots/constituent, the SSTORE wall behind the ~50-name deploy ceiling (R10); (b) **committed vault** keeps only the 32-byte keccak `recipeCommitment` → cheap deploy at any N but **no on-chain access** to tokens/ratios (recipe must be supplied in calldata + reconstructed from the `RecipeCommitted` log).
- **Idea (the missing middle):** a global, neutral **stock address book** assigning each stock-token address a small unique **id** (e.g. `uint16`/`uint32`), `id ↔ address`. A vault then stores its recipe as **packed `(id, ratio)` tuples**, many per 256-bit word, instead of full address + full uint256 per constituent. Result: **cheap to store AND cheap to read on-chain** — the best of both modes (committed's deploy cheapness + storage's on-chain readability of tokens + ratios). Directly attacks the L1b deploy SSTORE wall and makes "reconstitution = new clone" (see the L3 wiring decision) far cheaper to redeploy.
- **Tradeoffs to resolve before adopting:**
  - A shared registry is a **new dependency**: id↔address resolution must be trustworthy and append-only (ids never remapped) — it is a neutral lookup, but governance/immutability of the registry matters; an immutable/append-only registry keeps red-line posture clean.
  - **Seam consistency:** `recipeCommitment` (the single L1↔L2/L4 anchor) would commit over `(id, ratio, unitSize)` or `(address, unitQty, unitSize)` — pick one and keep L2/L4 reading it identically; if commit-over-ids, L2/L4 resolve ids→addresses via the same registry.
  - **Precision/packing:** ratio bit-width per packed field caps recipe precision; choose so per-share backing of the smallest leg stays safe (the dust rule still applies).
  - Raw-accounting / split-safety unchanged (ids point at the same scaled-UI tokens).
- **Generalize the cheap-storage mode to ALL flavors (incl. managed + rebalanceable).** The committed
  (hash-only) storage mode is an orthogonal axis from managed/rebalanceable; supporting it everywhere is
  the gas win for any large basket. For **static** flavors the commitment is immutable (clone-arg). For a
  **rebalanceable** flavor the target changes, so the cheap mode needs a **MUTABLE storage-commitment**
  (a hash recomputed each rebalance) + calldata target/set validated against it — plus, since holdings-
  based create/redeem must iterate held tokens, either an on-chain set or a calldata set + set-commitment.
  L3 ships only **storage-rebalanceable** (full on-chain target arrays); committed/cheap rebalanceable for
  large baskets is this deferred item.
- **Revisit when:** we ship large-N baskets cheaply on a single contract (L1b real build), OR a large
  rebalanceable basket needs cheap target storage, OR a customer needs on-chain-readable recipes without
  the storage-vault deploy ceiling.
- **Source:** user idea 2026-06-07 (+ flavor-matrix discussion); relates to `docs/guides/L1b-large-basket.md`
  (R10 SSTORE wall), `contracts/L1/recipe/{StorageVaultBase,CommittedVaultBase}.sol`, and the L3
  storage-rebalanceable decision (`docs/superpowers/specs/2026-06-07-l3-rebalance-keeper-incentive-design.md`).

## IMP-8 — Holdings-based NAV + preview for the rebalanceable flavor
- **Area:** L2 `NAVEngine`, `ManagedVault.previewRedeem`, L4 `FairValueNAV`
- **Status:** DONE (2026-06-11 — holdings-based `previewCreate`/`previewRedeem` implemented + wei-exact tested: `ManagedRebalanceVault — holdings-based previews`. The L5 settle path no longer reverts on registry/rebalanced vaults; verified in the second-pass review. Was the hard L5 prerequisite; now closed.)
- **L5 addition:** L5 needs holdings-based **`previewCreate(N)`** too (not only `previewRedeem`), and both MUST be **ceil (create) / floor (redeem) consistent with the actual create/redeem wei-for-wei** so the AP's delivery matches what `create` pulls (a 1-wei shortfall reverts settle).
- **Now:** `NAVEngine.navOf` iterates `getConstituents()` (the TARGET `_tokens`) and `previewRedeem` quotes over the target too; for a rebalanceable vault the custody set (`_held`) can diverge from the target after a reconstitution (a token still held but dropped from target is silently excluded), so the canonical NAV reader and the redeem preview **undervalue** the vault. `redeem`/`create` themselves are correct (they iterate `_held`), and L4 `navOfHoldings` (added in L3 P3.T1) IS the correct holdings-based path.
- **Why deferred:** strictly view/decide-only — settlement never uses these (iron rule intact, no red-line risk). For a pure reweight (same tokens, new `unitQty`) held == target so there is no divergence; the gap only appears after add/remove reconstitution. Fixing `previewRedeem` also requires making `ManagedVault.previewRedeem` `virtual` (currently non-virtual).
- **Upgrade:** route rebalanceable vaults through `FairValueNAV.navOfHoldings(heldTokens())`; make `ManagedVault.previewRedeem` virtual and override it holdings-based in `ManagedRebalanceVault` (+ add holdings-based `previewCreate`); have `NAVEngine` prefer `heldTokens()` when the vault exposes it.
- **L5 multi-agent resolution (2026-06-08):** the L5 SETTLE path uses **L4 `navOfHoldings` (already exists — nothing new on L4)**; the **L2 `NAVEngine` holdings path is INFORMATIONAL only, NOT the settle path** (annotate it so). The blocking L5 deliverable here is `ManagedRebalanceVault.previewCreate`/`previewRedeem` (ceil/floor wei-consistent; `supply==0` → previewRedeem returns 0, previewCreate returns target-bootstrap `_unitQty[i]·nShares/unitSize`). The NAVEngine single-engine unification is **deferred post-L5**.
- **Revisit when:** any UI/integration quotes NAV or redemption for a rebalanceable vault, OR before mainnet.
- **Source:** L3 whole-feature review 2026-06-07; `contracts/L3/ManagedRebalanceVault.sol`, `contracts/L2/NAVEngine.sol`, `contracts/L4/FairValueNAV.sol`.

## IMP-9 — Post-swap L4 NAV value-floor check in the rebalance auction
- **Area:** `RebalanceAuction` / red-line #1 value-conservation
- **Status:** DEFERRED (L3 build) — **gating dependency for safely enabling PERMISSIONLESS**
- **Now:** value conservation rests on the curator-set `endIn` (the Dutch-decay fair floor) + atomic delivery enforced by `executeRebalance`; the per-leg release `minOut = bal - releaseOut` is a secondary equality floor only. The oracle-free core cannot verify cross-leg value (iron rule).
- **Upgrade:** after the swap, CHECK (never settle) `FairValueNAV.navOfHoldings` did not drop more than a governance `maxSlippageBps` vs pre-swap; gate the keeper tip / revert on a NAV decrease. Decide-only use of L4, iron-rule clean.
- **Revisit when:** before enabling `PERMISSIONLESS` execMode with a funded keeper escrow (without it, a keeper can self-open+self-bid to bleed the bounded keeper escrow — never principal).
- **Source:** L3 P2.T4 + P3.T4 reviews 2026-06-07; `contracts/L3/RebalanceAuction.sol`.

## IMP-10 — RebalanceAuction PERMISSIONLESS anti-griefing
- **Area:** `RebalanceAuction`
- **Status:** DEFERRED (L3 build)
- **Now:** ships secure-by-default (`ExecMode` zero value = `MANAGER_ONLY`); a disjoint-leg guard + auction expiry are in. `open` overwrites an active auction (last-writer-wins), and the tip goes to the last opener — exploitable for decay-clock-reset / tip-stealing griefing only in PERMISSIONLESS.
- **Upgrade:** in PERMISSIONLESS, reject `open` while an auction is active (first-opener-wins until filled/expired), or only allow overwrite after the prior auction's duration elapsed.
- **Revisit when:** enabling PERMISSIONLESS (with IMP-9).
- **Source:** L3 P3.T4 security review 2026-06-07.

## IMP-11 — RebalanceObserver bounded ring buffer + O(log n) consult
- **Area:** `RebalanceObserver`
- **Status:** DEFERRED (L3 build)
- **Now:** unbounded append-only `Obs[]` per asset + linear scan in `consult` (MVP; documented in NatSpec). Storage grows forever; `consult` gas grows O(n).
- **Upgrade:** fixed-size Uniswap-v3-style ring buffer + binary-search `consult` (O(log n)), bounding storage and gas.
- **Revisit when:** the observer is poked at production frequency over long horizons, or `consult` gas becomes material on-chain.
- **Source:** L3 P3.T2 review 2026-06-07; `contracts/L3/RebalanceObserver.sol`.

## IMP-12 — RebalanceModule planRebalance + IRebalanceStrategy integration
- **Area:** `RebalanceModule`
- **Status:** DEFERRED (L3 build)
- **Now:** the module is the minimal is-due predicate only (`evaluate` Schmitt-trigger + `latchCleared`); it does NOT implement the provisioned L1 `IRebalanceStrategy` nor compute the in-kind delta plan. The auction currently takes the leg plan from the curator/opener directly.
- **Upgrade:** add `planRebalance(flavor, context)` returning signed in-kind deltas toward target + price brackets, and implement `IRebalanceStrategy` so the module is the canonical compute side of compute→execute.
- **Revisit when:** automating delta computation (vs curator-supplied legs), or wiring the provisioned strategy seam.
- **Source:** L3 spec "Architecture"; `contracts/L3/RebalanceModule.sol`.

## IMP-13 — Disable the inherited `initialize(ManagedParams)` on the rebalanceable clone
- **Area:** `ManagedRebalanceVault`
- **Status:** DEFERRED (L3 build) — minor footgun
- **Now:** the rebalance flavor uses a distinctly-named `initializeRebalance` (to avoid an ABI selector collision); the inherited 2-way `initialize(ManagedParams)` remains callable. The factory creates+initializes atomically via `initializeRebalance`, so there is no real window, but a manually-deployed clone mis-initialized via the base path would silently have `keeperBps=0`/no escrow.
- **Upgrade:** override `initialize(ManagedParams)` to revert (requires making `ManagedVault.initialize` virtual), so the rebalance clone has a single valid init path.
- **Revisit when:** any deploy path other than the factory's atomic create can reach a clone, or before mainnet.
- **Source:** L3 P1.T3 review 2026-06-07; `contracts/L3/ManagedRebalanceVault.sol`.
