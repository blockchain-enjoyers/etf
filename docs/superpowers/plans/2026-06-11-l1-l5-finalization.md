# Meridian L1-L5 Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Meridian L1-L5 from "307 unit tests green but undeployable" to a live, wired 500-name registry + forward-cash demo stand on Robinhood Chain testnet (chain 46630), with the 4 review-confirmed footguns regression-tested and a foundry invariant pass started.

**Architecture:** The contracts are done and green. The work is (1) close two one-line security footguns with TDD red→green, (2) extend the existing layered deploy scripts (`scripts/deploy/_shared.ts` `ensure`/`requireAddress` pattern) to deploy USDG + the RegistryRebalanceVault impl + the entire missing L5 layer, (3) bring up a live registry vault + ForwardCashQueue wired to the REAL FairValueNAV, (4) add operator scene-runner scripts to drive the demo, (5) start a foundry invariant suite that closes the coverage holes the review found.

**Tech Stack:** Solidity 0.8.35, Hardhat + TypeScript (ethers v6), `@openzeppelin/merkle-tree` (StandardMerkleTree), foundry/forge-std (new, for invariants only). Deploy config is `config/testnet.json` keyed by `deployments.<Name>`.

**Decisions locked (from the spec, override any here):**
- Git: this workspace's `CLAUDE.md` says the user manages git. Commit steps below are written as copy-paste checkpoints — run them only with the user's explicit go.
- `bootstrap` hardening for the demo = the script-side `heldTokens().length == constituentCount` assert (no contract change); the `onlyManager` gate is an OPTIONAL marked task.
- The RebalanceAuction is NOT wired to any registry vault for the demo (registry shows bootstrap/create/redeem/forward-cash; reconstitution is demoed on ManagedRebalanceVault). So the auction↔registry domain-mismatch (H1) is regression-tested + documented, fix deferred.
- The real `FairValueNAV` (already deployed at `0x5Aaae0…`) is wired as the queue/observer nav engine — its `NavResult` shape matches `INav`/`IHoldingsNav` exactly (verified), which is what makes the weekend-gap scene gate live.

**Invariant for every task:** `npm test` stays 307/307 green (new tests add to that count). Run it after any contract change.

---

## File Structure

**Modify (contracts — two one-line guards):**
- `contracts/L4/adapters/SignedCommitteeBase.sol` — reject `threshold == 0` (H3 fail-open).
- `contracts/L3/RebalanceAuction.sol` — reject empty `acquire[]` in `open()` (H4 principal-drain).

**Create (tests — regression for the 4 review findings):**
- `test/L4/adapters/CommitteeThresholdZero.test.ts` (H3)
- `test/L3/AuctionEmptyAcquire.test.ts` (H4)
- `test/L3/registry/RegistryBootstrapGriefing.test.ts` (H2)
- `test/L3/registry/RegistryAuctionDomain.test.ts` (H1, documents the deferred bug)

**Modify (deploy scripts):**
- `scripts/deploy/deploy-l1.ts` — add USDG (18-dec) + factory fee globals.
- `scripts/deploy/deploy-l3.ts` — add RegistryRebalanceVault impl + `setRegistryRebalanceImpl`.
- `scripts/deploy/deploy-all.ts` — call `deployL5()` after `deployL3()`.
- `package.json` — add `deploy:l5` script.

**Create (deploy scripts):**
- `scripts/deploy/deploy-demo-stocks.ts` — constituents (user-provided or mock) + whitelist + per-token MockSource registration in the real aggregator.
- `scripts/deploy/deploy-l5.ts` — registry index + full-set bootstrap + BasketNavObserver + MockFeedRouter + ForwardCashQueue + all wiring + `heldTokens().length` assert.
- `scripts/deploy/verify-l5.ts` — read-back every L5 acceptance check.

**Create (stand + tests):**
- `test/deploy/DeploySmoke.test.ts` — runs the deploy functions against the in-process network, asserts the wired stack (the "deployable" test).
- `scripts/demo/seed-holders.ts` — drive 5 EOAs to holders.
- `scripts/demo/scene-runner.ts` — push mock prices / status to produce each demo scene.

**Create (foundry — invariants only; hardhat stays the unit suite):**
- `foundry.toml`, `test/foundry/L1Conservation.t.sol`, `test/foundry/L5GateInvariant.t.sol`, `test/foundry/L3ClaimConservation.t.sol`, `test/foundry/L4MedianCap.t.sol`.

**Modify (docs):**
- `docs/IMPROVEMENTS.md` — mark IMP-2 and IMP-8 DONE.

---

## Task 1: H3 — SignedCommitteeBase threshold==0 fail-open guard (TDD)

**Files:**
- Test: `test/L4/adapters/CommitteeThresholdZero.test.ts`
- Modify: `contracts/L4/adapters/SignedCommitteeBase.sol:19-24, 29-37`

- [ ] **Step 1: Write the failing test**

`UniversalSignedSource` extends `SignedCommitteeBase`. A freshly deployed source has `threshold == 0` (no `setCommittee` yet). A zero-signature payload must NOT pass.

```ts
// test/L4/adapters/CommitteeThresholdZero.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("SignedCommitteeBase — threshold==0 fail-open (H3)", () => {
  // payload shape UniversalSignedSource.read expects: (feedId, price, depth, lastUpdate, r[], s[], v[])
  function emptySigPayload() {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
      [ethers.ZeroHash, 100n * 10n ** 18n, 1n, 0n, [], [], []],
    );
  }

  it("a fresh adapter (threshold==0) rejects a zero-signature payload", async () => {
    const [deployer] = await ethers.getSigners();
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(deployer.address); // no setCommittee -> threshold 0
    await expect(src.read(emptySigPayload())).to.be.revertedWithCustomError(src, "ThresholdNotMet");
  });

  it("setCommittee rejects threshold 0 and threshold > members", async () => {
    const [deployer, a, b] = await ethers.getSigners();
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(deployer.address);
    await expect(src.setCommittee([a.address, b.address], 0)).to.be.revertedWithCustomError(src, "ThresholdNotMet");
    await expect(src.setCommittee([a.address, b.address], 3)).to.be.revertedWithCustomError(src, "ThresholdNotMet");
    await expect(src.setCommittee([a.address, b.address], 2)).to.not.be.reverted; // valid
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx hardhat test test/L4/adapters/CommitteeThresholdZero.test.ts`
Expected: the first test FAILS (read returns a reading instead of reverting); the setCommittee test FAILS (no guard).

- [ ] **Step 3: Add the guards**

In `contracts/L4/adapters/SignedCommitteeBase.sol`, change `setCommittee` to validate the threshold, and make `_countValidSigners` fail-closed when unconfigured (single choke point for every adapter):

```solidity
function setCommittee(address[] calldata members, uint256 threshold_) external onlyOwner {
    if (threshold_ == 0 || threshold_ > members.length) revert ThresholdNotMet();
    for (uint256 i = 0; i < _committee.length; ++i) isCommittee[_committee[i]] = false;
    _committee = members;
    for (uint256 i = 0; i < members.length; ++i) isCommittee[members[i]] = true;
    threshold = threshold_;
}

function _countValidSigners(bytes32 h, bytes32[] memory r, bytes32[] memory s, uint8[] memory v)
    internal view returns (uint256 valid)
{
    if (threshold == 0) revert ThresholdNotMet(); // fail-closed: unconfigured committee accepts nothing
    address last = address(0);
    for (uint256 j = 0; j < r.length; ++j) {
        address signer = ecrecover(h, v[j], r[j], s[j]);
        if (signer > last && isCommittee[signer]) { last = signer; unchecked { ++valid; } }
    }
}
```

- [ ] **Step 4: Run the test + the full L4 suite, verify green**

Run: `npx hardhat test test/L4/adapters/CommitteeThresholdZero.test.ts test/L4`
Expected: PASS, and no existing L4 test regresses (existing committee tests already call `setCommittee` with `threshold > 0`).

- [ ] **Step 5: Full suite stays green**

Run: `npm test`
Expected: 307 prior + new tests, all green.

- [ ] **Step 6: Checkpoint (user commits)**

```bash
git add contracts/L4/adapters/SignedCommitteeBase.sol test/L4/adapters/CommitteeThresholdZero.test.ts
git commit -m "fix(L4): SignedCommitteeBase fail-closed on threshold==0 (H3)"
```

---

## Task 2: H4 — RebalanceAuction empty-acquire guard (TDD)

**Files:**
- Test: `test/L3/AuctionEmptyAcquire.test.ts`
- Modify: `contracts/L3/RebalanceAuction.sol` (`open`, near line 103)

- [ ] **Step 1: Write the failing test**

Reuse the existing auction fixture pattern (see `test/L3/RebalanceAuction.test.ts` for how a ManagedRebalanceVault + auction are stood up and `setExecMode`/`setExecutor` wired). The new assertion: `open` with an empty `acquire[]` reverts `InvalidAuctionParams`.

```ts
// test/L3/AuctionEmptyAcquire.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
// Mirror the setup helper used in test/L3/RebalanceAuction.test.ts (deploy KeeperModule + ManagedRebalanceVault
// clone via factory + RebalanceAuction, manager setExecMode(MANAGER_ONLY), vault.setExecutor(auction)).
// Import or inline that helper here; name it deployAuctionFixture and return { auction, vault, manager, release, releaseOut }.

describe("RebalanceAuction — empty acquire is rejected (H4)", () => {
  it("open() with acquire.length==0 reverts InvalidAuctionParams", async () => {
    const { auction, vault, manager, release, releaseOut } = await deployAuctionFixture();
    await expect(
      auction.connect(manager).open(await vault.getAddress(), release, releaseOut, [], [], [], 3600),
    ).to.be.revertedWithCustomError(auction, "InvalidAuctionParams");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx hardhat test test/L3/AuctionEmptyAcquire.test.ts`
Expected: FAIL — `open` currently accepts an empty acquire array (the length-equality checks pass for three empty arrays), so it does not revert.

- [ ] **Step 3: Add the guard**

In `contracts/L3/RebalanceAuction.sol`, in `open`, immediately after the existing length checks (around line 103, before the `duration == 0` check), add:

```solidity
if (acquire.length == 0) revert InvalidAuctionParams(); // empty-acquire = pure release-drain, no value in
```

- [ ] **Step 4: Run the test + L3 suite, verify green**

Run: `npx hardhat test test/L3/AuctionEmptyAcquire.test.ts test/L3`
Expected: PASS; no existing L3 auction test regresses (they all pass a non-empty acquire).

- [ ] **Step 5: Checkpoint (user commits)**

```bash
git add contracts/L3/RebalanceAuction.sol test/L3/AuctionEmptyAcquire.test.ts
git commit -m "fix(L3): reject empty-acquire auction open (H4)"
```

---

## Task 3: H2 — registry partial-bootstrap griefing regression test

**Files:**
- Test: `test/L3/registry/RegistryBootstrapGriefing.test.ts`

Documents the confirmed griefing path so the deploy-side guard (Task 8) has a regression anchor. No contract change in this task (the `onlyManager` gate is the OPTIONAL Task 3b).

- [ ] **Step 1: Write the test (passes against CURRENT code, asserting the vulnerable behavior)**

Reuse the registry fixture from `test/L5/ForwardCashRegistry.test.ts` (`deployRegistry`) — it builds the Merkle tree, factory, registry vault, and a `wrapFor` helper.

```ts
// test/L3/registry/RegistryBootstrapGriefing.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

describe("RegistryRebalanceVault — partial-bootstrap griefing (H2)", () => {
  it("a griefer who wraps ONE constituent can front-run a partial seed; the honest full bootstrap then reverts", async () => {
    const [deployer, manager, meridian, treasury, griefer, ap] = await ethers.getSigners();
    const Tok = await ethers.getContractFactory("MockERC20Decimals");
    const a = await Tok.deploy("A", "A", 18); const b = await Tok.deploy("B", "B", 18);
    let [t0, t1] = [await a.getAddress(), await b.getAddress()];
    let [c0, c1] = [a, b];
    if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
    const tokens = [t0, t1]; const unitQty = [2n * ONE, 3n * ONE]; const unitSize = ONE;
    const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
    const tree = StandardMerkleTree.of(values, ENC);
    const proofByToken: Record<string, string[]> = {};
    for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);

    const Bv = await ethers.getContractFactory("BasketVault");
    const Mv = await ethers.getContractFactory("ManagedVault");
    const Cv = await ethers.getContractFactory("CommittedVault");
    const Rrv = await ethers.getContractFactory("RegistryRebalanceVault");
    const F = await ethers.getContractFactory("CloneFactory");
    const f = await F.deploy(await (await Bv.deploy()).getAddress(), await (await Mv.deploy()).getAddress(), await (await Cv.deploy()).getAddress());
    await f.setRegistryRebalanceImpl(await (await Rrv.deploy()).getAddress());
    await f.setConstituentAllowed(t0, true); await f.setConstituentAllowed(t1, true);
    const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);

    const idx = { genesisRoot: tree.root, tokens, unitSize, name: "X", symbol: "X",
      manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress() };
    const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    await f.createRegistryIndex(idx, ethers.ZeroHash);
    const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

    // Griefer wraps ONLY t0 and bootstraps a partial (single-leaf) set.
    await c0.mint(griefer.address, unitQty[0]);
    await c0.connect(griefer).approve(vaultAddr, unitQty[0]);
    await vault.connect(griefer).wrap(t0, unitQty[0]);
    await vault.connect(griefer).bootstrap(unitSize, [t0], [unitQty[0]], [proofByToken[t0]]);

    // The held set is now incomplete (only t0), and the honest full bootstrap reverts.
    expect(await vault.heldTokens()).to.deep.equal([t0]);
    await c0.mint(ap.address, unitQty[0]); await c1.mint(ap.address, unitQty[1]);
    await c0.connect(ap).approve(vaultAddr, unitQty[0]); await c1.connect(ap).approve(vaultAddr, unitQty[1]);
    await vault.connect(ap).wrap(t0, unitQty[0]); await vault.connect(ap).wrap(t1, unitQty[1]);
    await expect(
      vault.connect(ap).bootstrap(unitSize, tokens, unitQty, [proofByToken[t0], proofByToken[t1]]),
    ).to.be.revertedWithCustomError(vault, "AlreadyBootstrapped");
  });
});
```

- [ ] **Step 2: Run, verify it passes (documents the current vulnerability)**

Run: `npx hardhat test test/L3/registry/RegistryBootstrapGriefing.test.ts`
Expected: PASS. This proves the deploy script MUST bootstrap the full set atomically and assert completeness (Task 8 P0-5).

- [ ] **Step 3: Checkpoint (user commits)**

```bash
git add test/L3/registry/RegistryBootstrapGriefing.test.ts
git commit -m "test(L3): document partial-bootstrap griefing (H2); deploy guard in deploy-l5"
```

---

## Task 3b (OPTIONAL): gate `bootstrap` to manager/AP

Only if there is time and the user wants the on-chain hardening (changes the H2 test to assert a non-manager revert). Read `contracts/L3/RegistryRebalanceVault.sol:78-102` and `RebalanceFeeCore`/`FeeCore` for the `onlyManager` modifier source. Add `onlyManager` (or an `isBootstrapper` allowlist set by meridian) to `bootstrap`, then update the H2 test to assert `vault.connect(griefer).bootstrap(...)` reverts `NotManager`. Re-run `npm test` (307 green). Skip for the demo if time-constrained — the script-side guard in Task 8 is sufficient for a controlled stand.

---

## Task 4: H1 — registry-auction balance-domain mismatch regression test (documents deferred fix)

**Files:**
- Test: `test/L3/registry/RegistryAuctionDomain.test.ts`

The auction is NOT wired to registry vaults for the demo, so this is a guard against a future foot-gun, not a critical-path fix.

- [ ] **Step 1: Write the test asserting the mismatch**

```ts
// test/L3/registry/RegistryAuctionDomain.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
// Reuse the bootstrapped registry fixture from test/L5/ForwardCashRegistry.test.ts (import or inline `bootstrapped`).
// After bootstrap + an extra AP wrap (so ERC20 balanceOf(vault) for t0 >> the vault's own claim balance),
// wiring the RebalanceAuction as the registry vault's executor and opening+bidding a release of t0 must revert,
// because _deriveMinOut reads IERC20.balanceOf (inflated by AP staged inventory) while executeRebalance enforces
// the claim balance. This test LOCKS the deferred bug: do not setExecutor(auction) on a registry vault until fixed.

describe("RegistryRebalanceVault — auction balance-domain mismatch (H1, deferred)", () => {
  it("auction minOut derived from ERC20 balanceOf does not match the claim-balance floor", async () => {
    // Build: registry vault bootstrapped; an extra wrap of t0 by a second AP inflates IERC20.balanceOf(vault,t0).
    // Deploy RebalanceAuction(keeperModule, maxTip); vault.connect(meridian).setExecutor(auction,true);
    // manager setExecMode(vault, MANAGER_ONLY); open a release-only-of-t0 auction; bid; expect a revert
    // (MinOutNotMet or the floor computed in the wrong domain). Mark with a comment: FIX = make the auction
    // read the vault's claim custody (holdingsOf/backingOf), not IERC20.balanceOf — see IMPROVEMENTS IMP/H1.
    expect(true).to.equal(true); // replace with the concrete open+bid assertion when implementing
  });
});
```

- [ ] **Step 2: Implement the concrete open+bid assertion**

Read `test/L5/ForwardCashRegistry.test.ts` (the `bootstrapped` helper) and `test/L3/RebalanceAuction.test.ts` (open/bid call shapes). Wire the auction to the registry vault, stage an extra AP `wrap(t0, ...)`, `open` a single-leg release of `t0` with `acquire=[t1]`, `bid`, and `expect(...).to.be.reverted`. Add an inline comment naming the fix (auction must read claim custody, not `IERC20.balanceOf`).

- [ ] **Step 3: Run, verify it passes (locks the deferred bug)**

Run: `npx hardhat test test/L3/registry/RegistryAuctionDomain.test.ts`
Expected: PASS (the revert is asserted). If it does NOT revert, the bug is worse than thought — escalate.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add test/L3/registry/RegistryAuctionDomain.test.ts
git commit -m "test(L3): lock auction<->registry balance-domain mismatch (H1, deferred)"
```

---

## Task 5: deploy-l1 — add USDG (18-dec) + factory fee globals

**Files:**
- Modify: `scripts/deploy/deploy-l1.ts`

- [ ] **Step 1: Extend `deployL1` to deploy USDG and wire fee globals**

Replace the body of `deployL1` (keep the imports; add `ethers`) with:

```ts
import { ensure, getDeployer, loadConfig, EXPLORER } from "./_shared";
import { ethers } from "hardhat";

export async function deployL1() {
  console.log("== L1: vault implementations + CloneFactory + USDG + fee globals ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const basketImpl = await ensure(config, "BasketVault", [], deployer);
  const managedImpl = await ensure(config, "ManagedVault", [], deployer);
  const committedImpl = await ensure(config, "CommittedVault", [], deployer);
  const factory = await ensure(config, "CloneFactory", [basketImpl, managedImpl, committedImpl], deployer);

  // 18-decimal mock USDG: FeeCore.FLAT_FEE_MAX==100e18 assumes 18 decimals (~$100 cap).
  const usdg = await ensure(config, "MockERC20Decimals", ["USD Global", "USDG", 18], deployer, "USDG");

  // Fee globals injected into every managed/registry clone. Flat fees default to 1 USDG each (cost-recovery).
  const f = await ethers.getContractAt("CloneFactory", factory);
  if ((await f.feeToken()) !== usdg) {
    console.log("  wiring: factory.setFeeToken(USDG)");
    await (await f.setFeeToken(usdg)).wait();
  }
  const oneUsdg = 10n ** 18n;
  if ((await f.defaultFlatCreateFee()) !== oneUsdg || (await f.defaultFlatRedeemFee()) !== oneUsdg) {
    console.log("  wiring: factory.setDefaultFlatFees(1 USDG, 1 USDG)");
    await (await f.setDefaultFlatFees(oneUsdg, oneUsdg)).wait();
  }

  console.log(`\n✅ L1 ready. Factory: ${EXPLORER}${factory}  USDG: ${usdg}\n`);
  return { basketImpl, managedImpl, committedImpl, factory, usdg };
}

if (require.main === module) {
  deployL1().catch((err) => { console.error(err); process.exitCode = 1; });
}
```

- [ ] **Step 2: Dry-run against a local node**

Terminal A: `npx hardhat node`
Terminal B:
```bash
echo '{"networkName":"local","chainId":31337,"deployments":{}}' > /tmp/meridian-local.json
DEPLOY_CONFIG=/tmp/meridian-local.json REDEPLOY=1 npx hardhat run scripts/deploy/deploy-l1.ts --network localhost
```
Expected: prints CloneFactory + USDG addresses and the two wiring lines; `/tmp/meridian-local.json` now has `USDG` and `CloneFactory` under `deployments`.

- [ ] **Step 3: Assert the globals on the local node**

```bash
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat console --network localhost
```
In the console:
```js
const c = require('/tmp/meridian-local.json'); const f = await ethers.getContractAt('CloneFactory', c.deployments.CloneFactory.address);
(await f.feeToken()) === c.deployments.USDG.address; // true
(await f.defaultFlatCreateFee()).toString();          // "1000000000000000000"
```

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/deploy/deploy-l1.ts
git commit -m "feat(deploy): L1 deploys USDG (18-dec) + factory fee globals"
```

---

## Task 6: deploy-l3 — add RegistryRebalanceVault impl + register in factory

**Files:**
- Modify: `scripts/deploy/deploy-l3.ts`

- [ ] **Step 1: Deploy the registry impl and register it**

In `deployL3`, after the existing `rebalanceImpl` deploy + `setRebalanceImpl` wiring block, add:

```ts
  const registryImpl = await ensure(config, "RegistryRebalanceVault", [], deployer);
  if ((await f.registryRebalanceImpl()) !== registryImpl) {
    console.log("  wiring: factory.setRegistryRebalanceImpl");
    await (await f.setRegistryRebalanceImpl(registryImpl)).wait();
  }
```

Add `registryImpl` to the returned object: `return { keeperModule, rebalanceImpl, registryImpl, observer, module, auction };`

- [ ] **Step 2: Dry-run (continues the local config from Task 5)**

```bash
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/deploy-l4.ts --network localhost
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/deploy-l3.ts --network localhost
```
Expected: L4 records PriceAggregator + FairValueNAV; L3 records RegistryRebalanceVault + prints `setRegistryRebalanceImpl`.

- [ ] **Step 3: Assert on the local node**

In a hardhat console (as Task 5 Step 3): `(await f.registryRebalanceImpl()) === c.deployments.RegistryRebalanceVault.address` → true.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/deploy/deploy-l3.ts
git commit -m "feat(deploy): L3 deploys + registers RegistryRebalanceVault impl"
```

---

## Task 7: deploy-demo-stocks — constituents + whitelist + per-token MockSource

**Files:**
- Create: `scripts/deploy/deploy-demo-stocks.ts`

The user deploys real stock tokens; this script accepts their addresses via `config.params.demo.stocks`, else deploys 18-dec mock constituents for a self-contained stand. Either way it whitelists each on the factory and registers a settable `MockSource` per token in the REAL PriceAggregator (so the scene-runner can drive prices).

- [ ] **Step 1: Write the script**

```ts
// scripts/deploy/deploy-demo-stocks.ts
import { ethers } from "hardhat";
import { ensure, getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";

const DEMO = { names: ["MSTRx", "TSLAx", "NVDAx"] };

export async function deployDemoStocks() {
  console.log("== DEMO: constituents + whitelist + per-token price source ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();
  const factory = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const f = await ethers.getContractAt("CloneFactory", factory);
  const agg = await ethers.getContractAt("PriceAggregator", aggregator);

  // User-provided addresses win; else deploy 18-dec mock constituents.
  const provided = (config.params as any)?.demo?.stocks as string[] | undefined;
  const stocks: string[] = [];
  for (let i = 0; i < DEMO.names.length; i++) {
    const name = DEMO.names[i];
    const addr = provided?.[i]
      ? provided[i]
      : await ensure(config, "MockERC20Decimals", [name, name, 18], deployer, `Stock_${name}`);
    stocks.push(addr);
  }

  // Whitelist each constituent (createRegistryIndex reverts NotWhitelisted otherwise).
  for (const t of stocks) {
    if (!(await f.constituentAllowed(t))) {
      console.log(`  wiring: factory.setConstituentAllowed(${t})`);
      await (await f.setConstituentAllowed(t, true)).wait();
    }
  }

  // One settable MockSource per token, registered in the real aggregator (drives NAV in the scene-runner).
  const sources: Record<string, string> = {};
  for (let i = 0; i < stocks.length; i++) {
    const src = await ensure(config, "MockSource", [], deployer, `Source_${DEMO.names[i]}`);
    sources[stocks[i]] = src;
    if (!(await agg.isSource(stocks[i], src))) {
      console.log(`  wiring: aggregator.addSource(${DEMO.names[i]}, ${src})`);
      await (await agg.addSource(stocks[i], src)).wait();
    }
  }

  (config.params as any) ??= {};
  (config.params as any).demo = { ...((config.params as any).demo ?? {}), stocks, sources, names: DEMO.names };
  saveConfig(config);
  console.log(`\n✅ Demo constituents ready: ${stocks.map((s, i) => `${DEMO.names[i]}=${s}`).join(", ")}`);
  console.log(`   Sources: ${EXPLORER}${Object.values(sources)[0]} ...`);
  return { stocks, sources };
}

if (require.main === module) {
  deployDemoStocks().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Dry-run on the local node**

```bash
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/deploy-demo-stocks.ts --network localhost
```
Expected: 3 `Stock_*` + 3 `Source_*` recorded; `params.demo.stocks` and `params.demo.sources` populated; 3 `addSource` lines.

- [ ] **Step 3: Checkpoint (user commits)**

```bash
git add scripts/deploy/deploy-demo-stocks.ts
git commit -m "feat(deploy): demo constituents + whitelist + per-token MockSource"
```

> **Scene-2 (scaled-UI split) note:** the split-safe scene needs a scaled-UI `Stock` (raw-accounting) so a multiplier bump rescales the UI without moving backing/NAV. If the operator wants this scene with full control, deploy ONE scaled-UI Stock via the `deployStock(registry, name, symbol)` helper in `test/helpers.ts` (it needs an `AccessControlsRegistry` + `MINTER_ROLE` + `MULTIPLIER_UPDATER_ROLE` granted; read `contracts/mock/stock/AccessControlsRegistry.sol` for the exact grant call) and use it as the TSLAx constituent. With a plain `MockERC20Decimals` constituent, Scene 2 is shown at the UI layer only. This is isolated from the critical path.

---

## Task 8: deploy-l5 — registry index + bootstrap + observer + queue + full wiring

**Files:**
- Create: `scripts/deploy/deploy-l5.ts`

This is the largest gap. It mirrors the verified end-to-end wiring in `test/L5/ForwardCashRegistry.test.ts`, substituting the REAL `FairValueNAV` (deployed in L4) for the test's `MockHoldingsNav`, and the REAL `PriceAggregator` for the test's `MockAggregator` in the g1 refs.

> **Load-bearing (second-pass verified HIGH):** the `vault.setSettler(queueAddr, true)` line in Step 7 is not optional polish — without it `settleCreate` reverts `NotSettler` for 100% of cash-in tickets on the registry path (the exact demo). Never trim it; Task 9 `verify-l5` asserts `isSettler(queue)==true` precisely to catch its omission.

- [ ] **Step 1: Write the script**

```ts
// scripts/deploy/deploy-l5.ts
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ensure, getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];
const FEED_ID = "0x" + "11".repeat(32); // mock router feed id (g1 only checks non-zero)

// Demo registry index params. unitQty is an OFF-CHAIN tree input + a bootstrap() arg ONLY; the
// createRegistryIndex struct does NOT carry unitQty (verified CloneFactory.sol:192-198).
const L5 = {
  unitSize: ONE,
  unitQty: [2n * ONE, 3n * ONE, 1n * ONE], // per-constituent, aligned to params.demo.stocks order (sorted below)
  name: "Volatile Tech Basket",
  symbol: "VTBx",
};

export async function deployL5() {
  console.log("== L5: registry index + bootstrap + ForwardCashQueue + wiring ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const factory = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const fairValueNav = requireAddress(config, "FairValueNAV", "deploy-l4.ts");
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const keeperModule = requireAddress(config, "KeeperModule", "deploy-l3.ts");
  const demo = (config.params as any)?.demo;
  if (!demo?.stocks?.length) throw new Error("run deploy-demo-stocks.ts first (params.demo.stocks missing)");

  // Sort constituents ascending (the recipe invariant requires strictly-ascending tokens).
  const order = demo.stocks.map((a: string, i: number) => ({ a, q: L5.unitQty[i] })).sort((x: any, y: any) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
  const tokens: string[] = order.map((o: any) => o.a);
  const unitQty: bigint[] = order.map((o: any) => BigInt(o.q));

  // 1. Off-chain genesis Merkle root over (token, unitQty, unitSize) leaves.
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), L5.unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const proofByToken: Record<string, string[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);
  const proofs = tokens.map((t) => proofByToken[t]);

  // 2. Create the registry index (idempotent: reuse if already recorded).
  const f = await ethers.getContractAt("CloneFactory", factory);
  let vaultAddr = config.deployments?.["RegistryIndex"]?.address;
  if (!vaultAddr || process.env.REDEPLOY) {
    const idx = {
      genesisRoot: tree.root, tokens, unitSize: L5.unitSize, name: L5.name, symbol: L5.symbol,
      manager: deployer, managerFeeBps: 0, keeperBps: 0, keeperEscrow: keeperModule,
    };
    vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    await (await f.createRegistryIndex(idx, ethers.ZeroHash)).wait();
    config.deployments!["RegistryIndex"] = { address: vaultAddr };
    saveConfig(config);
    console.log(`  RegistryIndex        ${vaultAddr}`);
  } else {
    console.log(`  RegistryIndex        ${vaultAddr}  (reused)`);
  }
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  // 3. Bootstrap the FULL constituent set atomically (deployer acts as the AP for the stand).
  if ((await vault.totalSupply()) === 0n) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = await ethers.getContractAt("MockERC20Decimals", tokens[i]); // mock path; user tokens: pre-fund + approve out-of-band
      await (await tok.mint(deployer, unitQty[i])).wait();
      await (await tok.approve(vaultAddr, unitQty[i])).wait();
      await (await vault.wrap(tokens[i], unitQty[i])).wait();
    }
    await (await vault.bootstrap(L5.unitSize, tokens, unitQty, proofs)).wait();
    console.log("  bootstrap            full set wrapped + minted");
  }
  // P0-5 completeness guard: abort if the held set is not the full constituent count.
  const held = await vault.heldTokens();
  if (held.length !== tokens.length) {
    throw new Error(`bootstrap incomplete: heldTokens=${held.length} != constituents=${tokens.length} (front-run/partial seed)`);
  }

  // 4. Observer over the REAL FairValueNAV (its NavResult shape == IHoldingsNav.NavResult).
  const observer = await ensure(config, "BasketNavObserver", [fairValueNav], deployer);

  // 5. Mock feed router (g1 needs a non-zero feed id per held token) + peg feed ($1.00, 8-dec).
  const router = await ensure(config, "MockFeedRouter", [], deployer);
  const peg = await ensure(config, "MockPegFeed", [100000000n], deployer); // 1.00 * 1e8
  const r = await ethers.getContractAt("MockFeedRouter", router);
  for (const t of tokens) if ((await r.feedIdOf(t)) === ethers.ZeroHash) await (await r.setFeed(t, FEED_ID)).wait();

  // 6. ForwardCashQueue: nav engine = REAL FairValueNAV; owner = deployer.
  let queueAddr = config.deployments?.["ForwardCashQueue"]?.address;
  if (!queueAddr || process.env.REDEPLOY) {
    const Q = await ethers.getContractFactory("ForwardCashQueue");
    const q = await Q.deploy(vaultAddr, usdg, fairValueNav, observer, keeperModule, router, peg, deployer);
    await q.waitForDeployment();
    queueAddr = await q.getAddress();
    config.deployments!["ForwardCashQueue"] = { address: queueAddr };
    saveConfig(config);
    console.log(`  ForwardCashQueue     ${queueAddr}`);
  }
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);

  // 7. Wire the gate + roles. g1 source = the real per-token MockSource registered in deploy-demo-stocks.
  const aSource = (demo.sources as Record<string, string>)[tokens[0]];
  await (await q.setGateParams(2, 600, 200, 200, 3600)).wait(); // minN=2, window=10m, twapBand=2%, pegBand=2%, pegMaxAge=1h
  await (await q.setG1Refs(aggregator, aSource)).wait();
  await (await q.setKeeperTip(0)).wait();
  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  if (!(await km.isExecutor(queueAddr))) await (await km.setExecutor(queueAddr, true)).wait();
  if ((await km.maxRewardPerCall()) === 0n) await (await km.setMaxRewardPerCall(ethers.MaxUint256)).wait();
  if (!(await vault.isSettler(queueAddr))) await (await vault.setSettler(queueAddr, true)).wait(); // deployer == meridian (factory default)

  console.log(`\n✅ L5 ready. Vault: ${EXPLORER}${vaultAddr}  Queue: ${EXPLORER}${queueAddr}`);
  return { vault: vaultAddr, queue: queueAddr, observer, router, peg };
}

if (require.main === module) {
  deployL5().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

> **g1 source caveat:** the queue's g1 check is `isSource(token, l2RouterSource)` for EACH held token. The script passes `aSource` (the first token's source). If your `MockSource` instances differ per token, g1 will fail for tokens 2+. For the stand, either register a SINGLE shared `MockSource` for all tokens in `deploy-demo-stocks` (call `addSource(eachToken, sharedSource)`), or set `l2RouterSource` to that shared source. Adjust `deploy-demo-stocks` Step 1 to deploy one shared `MockSource` and `addSource` it for every token if you want g1 to pass with one ref. (Simplest: one shared source.)

- [ ] **Step 2: Make the per-token source shared (so g1 passes with one ref)**

In `scripts/deploy/deploy-demo-stocks.ts`, change the per-token loop to register ONE shared source:

```ts
  const shared = await ensure(config, "MockSource", [], deployer, "Source_Shared");
  const sources: Record<string, string> = {};
  for (const t of stocks) {
    sources[t] = shared;
    if (!(await agg.isSource(t, shared))) {
      console.log(`  wiring: aggregator.addSource(${t}, shared)`);
      await (await agg.addSource(t, shared)).wait();
    }
  }
```

- [ ] **Step 3: Dry-run the full L5 deploy on the local node**

```bash
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/deploy-l5.ts --network localhost
```
Expected: prints RegistryIndex, bootstrap, ForwardCashQueue addresses and the wiring; no "bootstrap incomplete" throw; `RegistryIndex` + `ForwardCashQueue` + `BasketNavObserver` + `MockFeedRouter` + `MockPegFeed` recorded in the config.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/deploy/deploy-l5.ts scripts/deploy/deploy-demo-stocks.ts
git commit -m "feat(deploy): deploy-l5 — registry index + bootstrap + ForwardCashQueue wiring"
```

---

## Task 9: verify-l5 — read-back every acceptance check

**Files:**
- Create: `scripts/deploy/verify-l5.ts`

- [ ] **Step 1: Write the verifier (mirrors `verify-l3.ts` style)**

```ts
// scripts/deploy/verify-l5.ts
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./_shared";

export async function verifyL5() {
  const config = loadConfig();
  const vaultAddr = requireAddress(config, "RegistryIndex", "deploy-l5.ts");
  const queueAddr = requireAddress(config, "ForwardCashQueue", "deploy-l5.ts");
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const km = requireAddress(config, "KeeperModule", "deploy-l3.ts");
  const router = requireAddress(config, "MockFeedRouter", "deploy-l5.ts");
  const demo = (config.params as any).demo;

  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);
  const keeper = await ethers.getContractAt("KeeperModule", km);
  const r = await ethers.getContractAt("MockFeedRouter", router);

  const checks: [string, boolean][] = [];
  checks.push(["vault bootstrapped (supply>0)", (await vault.totalSupply()) > 0n]);
  checks.push(["recipeRoot set", (await vault.recipeRoot()) !== ethers.ZeroHash]);
  const held = await vault.heldTokens();
  checks.push([`held == constituents (${held.length}/${demo.stocks.length})`, held.length === demo.stocks.length]);
  checks.push(["queue.vault == vault", (await q.vault()) === vaultAddr]);
  checks.push(["queue.stable == USDG", (await q.stable()) === usdg]);
  checks.push(["queue.isRegistry", (await q.isRegistry()) === true]);
  checks.push(["vault.isSettler(queue)", (await vault.isSettler(queueAddr)) === true]);
  checks.push(["keeperModule.isExecutor(queue)", (await keeper.isExecutor(queueAddr)) === true]);
  for (const t of held) checks.push([`router feed set ${t}`, (await r.feedIdOf(t)) !== ethers.ZeroHash]);

  let ok = true;
  for (const [name, pass] of checks) { console.log(`  ${pass ? "✅" : "❌"} ${name}`); ok &&= pass; }
  if (!ok) throw new Error("verify-l5: one or more checks failed");
  console.log("\n✅ L5 verified.");
}

if (require.main === module) {
  verifyL5().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Run against the local node**

```bash
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/verify-l5.ts --network localhost
```
Expected: every line ✅; "L5 verified."

- [ ] **Step 3: Checkpoint (user commits)**

```bash
git add scripts/deploy/verify-l5.ts
git commit -m "feat(deploy): verify-l5 read-back acceptance checks"
```

---

## Task 10: Wire L5 into deploy-all + add the npm script

**Files:**
- Modify: `scripts/deploy/deploy-all.ts`, `package.json`

- [ ] **Step 1: Add the L5 step to the orchestrator**

In `scripts/deploy/deploy-all.ts`, add the imports and calls (note: demo stocks + L5 run after L3):

```ts
import { deployL1 } from "./deploy-l1";
import { deployL3 } from "./deploy-l3";
import { deployL4 } from "./deploy-l4";
import { deployDemoStocks } from "./deploy-demo-stocks";
import { deployL5 } from "./deploy-l5";
import { loadConfig } from "./_shared";

async function main() {
  await deployL1();
  await deployL4();
  await deployL3();
  await deployDemoStocks();
  await deployL5();
  // ... existing summary print ...
}
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, add:

```json
"deploy:l5": "hardhat run scripts/deploy/deploy-l5.ts --network robinhoodTestnet",
"deploy:demo-stocks": "hardhat run scripts/deploy/deploy-demo-stocks.ts --network robinhoodTestnet",
"verify:l5": "hardhat run scripts/deploy/verify-l5.ts --network robinhoodTestnet"
```

- [ ] **Step 3: Full local dry-run of the whole stack from scratch**

```bash
echo '{"networkName":"local","chainId":31337,"deployments":{}}' > /tmp/meridian-local.json
DEPLOY_CONFIG=/tmp/meridian-local.json REDEPLOY=1 npx hardhat run scripts/deploy/deploy-all.ts --network localhost
DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/deploy/verify-l5.ts --network localhost
```
Expected: full stack deploys in order; verify-l5 all ✅.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/deploy/deploy-all.ts package.json
git commit -m "feat(deploy): wire L5 + demo stocks into deploy-all; add deploy:l5/verify:l5 scripts"
```

---

## Task 11: Deploy smoke test (the "deployable" test)

**Files:**
- Create: `test/deploy/DeploySmoke.test.ts`

Runs the deploy functions against the in-process hardhat network and asserts the wired stack — this is the automated coverage for deployability the unit suite lacks.

- [ ] **Step 1: Write the smoke test**

```ts
// test/deploy/DeploySmoke.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe("Deploy smoke — full stack wires end-to-end", () => {
  it("deploy-all + deploy-l5 produce a settler-wired registry queue", async () => {
    const cfgPath = join("/tmp", `meridian-smoke-${Date.now()}.json`);
    writeFileSync(cfgPath, JSON.stringify({ networkName: "hardhat", chainId: 31337, deployments: {} }));
    process.env.DEPLOY_CONFIG = cfgPath;
    process.env.REDEPLOY = "1";

    const { deployL1 } = await import("../../scripts/deploy/deploy-l1");
    const { deployL4 } = await import("../../scripts/deploy/deploy-l4");
    const { deployL3 } = await import("../../scripts/deploy/deploy-l3");
    const { deployDemoStocks } = await import("../../scripts/deploy/deploy-demo-stocks");
    const { deployL5 } = await import("../../scripts/deploy/deploy-l5");
    const { verifyL5 } = await import("../../scripts/deploy/verify-l5");

    await deployL1();
    await deployL4();
    await deployL3();
    await deployDemoStocks();
    const { vault, queue } = await deployL5();

    const v = await ethers.getContractAt("RegistryRebalanceVault", vault);
    expect(await v.totalSupply()).to.be.greaterThan(0n);
    expect(await v.isSettler(queue)).to.equal(true);
    const q = await ethers.getContractAt("ForwardCashQueue", queue);
    expect(await q.isRegistry()).to.equal(true);

    await verifyL5(); // throws if any acceptance check fails

    delete process.env.DEPLOY_CONFIG;
    delete process.env.REDEPLOY;
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx hardhat test test/deploy/DeploySmoke.test.ts`
Expected: PASS (this both validates the scripts and locks them against regressions).

- [ ] **Step 3: Full suite green**

Run: `npm test`
Expected: all green including the new smoke + regression tests.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add test/deploy/DeploySmoke.test.ts
git commit -m "test(deploy): smoke test asserts the full wired stack (deployability coverage)"
```

---

## Task 12: Deploy to RHC testnet + seed 5 holders

**Files:**
- Create: `scripts/demo/seed-holders.ts`

- [ ] **Step 1: Deploy the full stack to testnet**

Ensure `blockchain/.env` has a funded `PRIVATE_KEY` for chain 46630 (faucet first; `getDeployer` aborts on 0 balance). Then:

```bash
REDEPLOY=1 npm run deploy:all   # fresh, consistent bytecode (the recorded testnet factory is stale)
npm run verify:l5
```
Expected: `config/testnet.json` gets `USDG`, `RegistryIndex`, `ForwardCashQueue`, `BasketNavObserver`, `MockFeedRouter`, `MockPegFeed`, `Stock_*`, `Source_Shared`; verify-l5 all ✅.

- [ ] **Step 2: Write the holder-seeding script**

```ts
// scripts/demo/seed-holders.ts
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "../deploy/_shared";

// 5 demo holder addresses (override via config.params.demo.holders).
export async function seedHolders() {
  const config = loadConfig();
  const vaultAddr = requireAddress(config, "RegistryIndex", "deploy-l5.ts");
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  const [deployer] = await ethers.getSigners();
  const holders: string[] = (config.params as any)?.demo?.holders ?? [];
  if (holders.length === 0) throw new Error("set params.demo.holders to 5 addresses");

  // Transfer a slice of the bootstrapper's shares to each holder (in-kind, no cash path needed for seeding).
  const total = await vault.balanceOf(deployer.address);
  const slice = total / BigInt(holders.length + 1);
  for (const h of holders) await (await vault.transfer(h, slice)).wait();
  for (const h of holders) console.log(`  ${h}  ${(await vault.balanceOf(h)).toString()}`);
}

if (require.main === module) seedHolders().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 3: Run on testnet**

Set `config.params.demo.holders` to 5 addresses, then:
```bash
npx hardhat run scripts/demo/seed-holders.ts --network robinhoodTestnet
```
Expected: each of the 5 holders shows a non-zero share balance.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/demo/seed-holders.ts config/testnet.json
git commit -m "feat(demo): seed 5 holders on the registry vault; record testnet addresses"
```

---

## Task 13: Scene-runner — drive the demo scenes

**Files:**
- Create: `scripts/demo/scene-runner.ts`

Pushes settable mock values to produce each demo.md scene, reading `FairValueNAV.navOfHoldings` to show band + safe. Uses the shared `MockSource` (price/depth/staleness/weekendAware) + `MockPegFeed` + `BasketNavObserver`.

- [ ] **Step 1: Write the runner**

```ts
// scripts/demo/scene-runner.ts
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "../deploy/_shared";

// Usage: SCENE=3 npx hardhat run scripts/demo/scene-runner.ts --network <net>
async function main() {
  const scene = Number(process.env.SCENE ?? "0");
  const config = loadConfig();
  const demo = (config.params as any).demo;
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const obsAddr = requireAddress(config, "BasketNavObserver", "deploy-l5.ts");
  const vaultAddr = requireAddress(config, "RegistryIndex", "deploy-l5.ts");
  const fairValueNav = requireAddress(config, "FairValueNAV", "deploy-l4.ts");

  const shared = await ethers.getContractAt("MockSource", demo.sources[demo.stocks[0]]);
  const obs = await ethers.getContractAt("BasketNavObserver", obsAddr);
  const nav = await ethers.getContractAt("FairValueNAV", fairValueNav);
  const tokens: string[] = (await (await ethers.getContractAt("RegistryRebalanceVault", vaultAddr)).heldTokens());
  const now = () => Math.floor(Date.now() / 1000);

  // SourceKind enum: 0 AMM_SPOT,1 AMM_TWAP,2 PERP,3 ORACLE_PUSH,4 ORACLE_PULL,5 RWA_STREAM
  async function setSource(price: bigint, depth: bigint, weekendAware: boolean, healthy = true, lastUpdate = now()) {
    await (await shared.set(price, depth, lastUpdate, 1, 0n, weekendAware, healthy)).wait();
  }

  if (scene === 0 || scene === 1) {
    // Baseline: healthy, deep, fresh, not-weekend -> safe band, market Open.
    await setSource(100n * 10n ** 18n, 5_000_000n * 10n ** 18n, false);
    await (await obs.record(vaultAddr, tokens, tokens.map(() => []))).wait(); // seed observer (>=2 over time)
  } else if (scene === 3) {
    // Manipulation: pump the price x25 but keep depth THIN -> depth-weighted median drops it; NAV unmoved.
    await setSource(2500n * 10n ** 18n, 1n * 10n ** 18n, false);
  } else if (scene === 4) {
    // Weekend gap: stale + weekend-aware only -> marketStatus Closed, band blows out, safe=false.
    await setSource(100n * 10n ** 18n, 5_000_000n * 10n ** 18n, true, true, now() - 7200);
  } else if (scene === 5) {
    // Degradation ladder: drop depth in steps -> band widens further.
    await setSource(100n * 10n ** 18n, 50n * 10n ** 18n, true);
  }

  // Read and print the live NAV verdict (eth_call; navOfHoldings is non-view in iface but read via staticCall).
  const res = await nav.navOfHoldings.staticCall(vaultAddr, tokens, tokens.map(() => []));
  console.log(`SCENE ${scene}: nav=${res.nav} band=[${res.confLower},${res.confUpper}] status=${res.marketStatus} safe=${res.safe}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 2: Dry-run each scene on the local node**

```bash
for s in 0 3 4 5; do SCENE=$s DEPLOY_CONFIG=/tmp/meridian-local.json npx hardhat run scripts/demo/scene-runner.ts --network localhost; done
```
Expected: Scene 0 `safe=true status=0`; Scene 3 `safe=true` and `nav` unchanged vs Scene 0 (median dropped the pump); Scene 4 `safe=false status` non-zero (Closed); Scene 5 `safe=false` with a wider band than Scene 4.

- [ ] **Step 3: Verify Scene 4 gates the cash settle but NOT in-kind redeem**

In a hardhat console against the same config, after running Scene 4: a `q.settleGateView(tokens, payloads)` / `q.settle(...)` reverts `NotSafe` (or `NotOpen`), while `vault.redeem(smallAmount)` succeeds. (Pre-seed the observer in Scene 0/1 so Scene 4 fails on g2/g3, not `NoObservations`.)

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add scripts/demo/scene-runner.ts
git commit -m "feat(demo): scene-runner drives baseline/manipulation/weekend/degradation scenes"
```

---

## Task 14: Foundry kickoff — L1 conservation + L5 gate invariants

**Files:**
- Create: `foundry.toml`, `test/foundry/L1Conservation.t.sol`, `test/foundry/L5GateInvariant.t.sol`

Hardhat stays the unit/integration suite; foundry is added ONLY for invariant/property fuzzing (the coverage hole the review flagged).

- [ ] **Step 1: Install forge-std + write foundry.toml**

```bash
forge install foundry-rs/forge-std --no-commit   # creates lib/forge-std
```

```toml
# foundry.toml
[profile.default]
src = "contracts"
test = "test/foundry"
libs = ["node_modules", "lib"]
solc = "0.8.35"
optimizer = true
optimizer_runs = 200
remappings = [
  "@openzeppelin/=node_modules/@openzeppelin/",
  "forge-std/=lib/forge-std/src/",
]
```

Add to `package.json` scripts: `"fuzz": "forge test"`.

- [ ] **Step 2: L1 conservation invariant (BasketVault)**

```solidity
// test/foundry/L1Conservation.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;
import "forge-std/Test.sol";
import {BasketVault} from "contracts/L1/BasketVault.sol";
// Deploy a BasketVault clone via the factory in setUp (mirror the TS fixture: two MockERC20Decimals tokens,
// unitQty [2e18,3e18], unitSize 1e18). Then fuzz create/redeem sequences and assert:
//   for each token i: balanceOf(vault) == unitQty[i] * (totalSupply / unitSize)   (exact in-kind backing)
contract L1ConservationTest is Test {
    // setUp(): deploy factory + impls + tokens + create the clone; store vault + tokens + unitQty.
    function invariant_backingMatchesSupply() public {
        // for each constituent: assertEq(token.balanceOf(vault), unitQty[i] * vault.totalSupply() / unitSize);
    }
}
```

Implement `setUp` by porting `test/L1/helpers.ts` deploy steps to Solidity (deploy `MockERC20Decimals`, `BasketVault` impl, `CloneFactory`, `createBasket`, mint+approve+create an initial position). Register a handler that calls `create`/`redeem` with bounded fuzzed `nUnits`.

- [ ] **Step 3: L5 gate invariant (settle never runs unsafe)**

```solidity
// test/foundry/L5GateInvariant.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;
import "forge-std/Test.sol";
// Port the ForwardCashRegistry fixture to Solidity using MockHoldingsNav (settable safe/status). Fuzz the
// gate params (minN, twapBand, pegBand) and the nav safe/status flags; assert: if !safe || status != 0 then
// q.settle(...) reverts (NotSafe / NotOpen) and no shares are minted. This is the iron-rule property.
contract L5GateInvariantTest is Test {
    function testFuzz_settleNeverRunsUnsafe(bool safe, uint8 status) public {
        // vm.assume(!safe || status != 0); set the mock nav; expect settle to revert; assert user balance unchanged.
    }
}
```

- [ ] **Step 4: Run forge**

Run: `forge test -vvv`
Expected: both invariants pass. If `invariant_backingMatchesSupply` fails, a real conservation bug exists — escalate.

- [ ] **Step 5: Checkpoint (user commits)**

```bash
git add foundry.toml package.json test/foundry/L1Conservation.t.sol test/foundry/L5GateInvariant.t.sol lib/forge-std
git commit -m "test(foundry): L1 conservation + L5 gate invariants (close coverage holes)"
```

---

## Task 15: Foundry invariants — L3 claim-conservation + L4 median-cap

**Files:**
- Create: `test/foundry/L3ClaimConservation.t.sol`, `test/foundry/L4MedianCap.t.sol`

- [ ] **Step 1: L3 claim conservation (RegistryCustody)**

```solidity
// test/foundry/L3ClaimConservation.t.sol
// Fuzz wrap/unwrap/settleCreate sequences on a RegistryRebalanceVault; assert for each token:
//   sum of all ERC-6909 claim balances (holders + vault) == real ERC20 balanceOf(vault)   (no claim without backing)
// and a create-then-redeem round-trip returns <= deposited (no value creation).
```

Port the registry fixture to Solidity (deploy tokens, factory, registry impl, `createRegistryIndex`, bootstrap). Register a handler over `wrap`/`unwrap`/`create`/`redeem`.

- [ ] **Step 2: L4 median-cap (PriceAggregator)**

```solidity
// test/foundry/L4MedianCap.t.sol
// Register N MockSource instances for one asset; fuzz (prices, depths) across sources; assert:
//   no single source with weight <= maxWeightBps can move priceOf().price beyond the divergence band, and
//   safe == true  =>  band <= maxSafeBandBps AND survivors >= minSafeSources.
// This generalizes the single-example "thin source x25" exploit test into a property.
```

- [ ] **Step 3: Run forge, verify green**

Run: `forge test`
Expected: all invariants pass.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add test/foundry/L3ClaimConservation.t.sol test/foundry/L4MedianCap.t.sol
git commit -m "test(foundry): L3 claim-conservation + L4 median-cap invariants"
```

---

## Task 16: Backlog cleanup + submission addresses

**Files:**
- Modify: `docs/IMPROVEMENTS.md`

- [ ] **Step 1: Mark the done items**

In `docs/IMPROVEMENTS.md`, change these statuses to DONE (confirmed by the second-pass verification 2026-06-11):
- IMP-2 → `DONE (flat creation/redeem fee shipped in CloneFactory + FeeCore)`.
- IMP-6 → `DONE (split-during-accrual test exists: test/L1/ManagedVault.test.ts:266 "scaled-UI split ... does not affect the fee or raw redeem")`.
- IMP-8 → `DONE (holdings-based previewCreate/previewRedeem implemented + wei-exact tested; ManagedRebalanceVault holdings previews)`.

Also annotate IMP-1: the second pass confirmed the current fee math is already the dilution-exact form `S·x/(1−x)` (NOT the linear approximation), so IMP-1 remains a purely optional refinement to per-second compounding, not a correctness gap. Add a one-line note to IMP-9/IMP-10 that PERMISSIONLESS stays hard-disabled and the auction is not wired to registry vaults (H1) until the domain fix lands.

- [ ] **Step 2: Record the submission addresses**

Confirm `config/testnet.json` has the live `CloneFactory`, `RegistryIndex`, `ForwardCashQueue` addresses on chain 46630. These fill the `0x…REPLACE` placeholders on the pitch `shipped` slide and the demo end-card (`docs/guides/pitch-video.md:65,70`).

- [ ] **Step 3: Final gate**

Run: `npm test && forge test && npm run verify:l5`
Expected: hardhat all green, forge invariants green, verify-l5 all ✅.

- [ ] **Step 4: Checkpoint (user commits)**

```bash
git add docs/IMPROVEMENTS.md config/testnet.json
git commit -m "docs: mark IMP-2/IMP-8 done; record testnet submission addresses"
```

---

## Self-Review notes (spec coverage map)

- Spec §2 P0-1 → Tasks 5, 6 (USDG + fee globals + registry impl register). P0-2 → Task 5. P0-3 → Task 7. P0-4 → Task 8. P0-5 → Task 8 Step (heldTokens assert) + Task 3/3b.
- Spec §3 P1-1 → Tasks 9, 10. P1-2 → Task 12. P1-3 → Task 13. P1-4 → Task 13 Step 3 (observer pre-seed). P1-5 (AP setOperator) → covered by the registry settle path; add a `verify-l5` note if APs are external (here the deployer self-APs). P1-6 → Task 16 Step 2.
- Spec §4 security one-liners → Tasks 1, 2; foundry workstream → Tasks 14, 15.
- Spec §8 coverage holes H1-H4 → Tasks 4, 3, 1, 2 respectively; deploy-path test → Task 11; property fuzz → Tasks 14, 15.
- Spec §5 backlog cleanup → Task 16.
