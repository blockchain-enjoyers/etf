# Demo Stand Deploy — Faucet + Stock scale-out + signed price oracle + keeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the colleague's already-deployed L1-L5+SP500 stand (chain 46630) host a respectable, honestly-valued (`safe=true`) 100+ constituent USDG-entry demo fund, keyless (no Chainlink Streams key), plus a capped judge faucet.

**Architecture:** We hold the deployer/owner EOA, so all owner-gated wiring is ours. We (1) write a capped `Faucet` contract, (2) scale our mock `Stock` instances to a gas-budgeted N under real Robinhood tickers from `registry.json`, (3) register **two `UniversalSignedSource` instances** (weekday + weekend) per constituent so `sourceCount >= 2` and the median moat holds, (4) run an off-chain committee-signing keeper that serves per-asset signed payloads, and (5) (re)bootstrap a `RegistryRebalanceVault` registry index + wire its `ForwardCashQueue` so a judge enters with one USDG `requestCreate`. The thin `MockSource` stays only as the manipulation-scene knob. Chainlink Streams (`ChainlinkStreamsSource` → `MockVerifierProxy`) is an OPTIONAL drop-in third source, not on the critical path.

**Tech Stack:** Solidity 0.8.35, Foundry (`forge test`, primary for unit/invariant), Hardhat + ethers v6 (deploy scripts, TS), Node.js (keeper service), OpenZeppelin AccessControl (role grants).

---

## Design decisions locked by this plan (resolving spec ambiguities)

- **Two signed sources = two `UniversalSignedSource` instances** (the deployed weekday `0x41BE…` + weekend `0x3220…`), NOT universal+streams. Same payload encoder for both → the keeper has ONE encoder. Weekday source has `weekendAware=false` (drives `marketStatus=Open` + `anyWeekday`); weekend source has `weekendAware=true`. On a weekend the keeper stops refreshing the weekday source → it goes stale → `k` drops to 1 → `safe=false` (honest). `PriceAggregator.minSafeSources == 2` (constructor default) is the gate.
- **Keeper price origin = derived synthetically from `registry.json`** (`underlying.market_cap_usd / onchain.total_supply`), NOT a `usd_stock_price` field (that field does not exist in `tools/registry/out/registry.json`). For the 5 real RH tokens, a free ticker API is optional; default is the same synthetic derivation so the demo is self-contained and offline-deterministic.
- **`MINTER_ROLE` is global in the shared `AccessControlsRegistry`** — one `grantRole(MINTER_ROLE, faucet)` covers ALL Stock instances that share the registry. We do NOT grant per-stock.
- **Stock instances must be mint-restricted** (so the Faucet's cap means something). We deploy real `Stock` proxies (MINTER_ROLE-gated `mint`), NOT `MockERC20Decimals` (public mint) — the existing `deploy-demo-stocks.ts` that uses `MockERC20Decimals` is rewritten.
- **`ChainlinkStreamsSource` is optional.** It needs no real key against `MockVerifierProxy`, but adding it means the keeper must also emit a Streams-schema report. Out of the critical `safe=true` path; a separate optional task at the end.

---

## Pre-flight: facts that MUST be confirmed against the colleague's deployment before Task 3+

The spec header has **truncated** addresses (`0x453B…`) and our local `config/testnet.json` is a DIFFERENT deployment. Task 0 obtains the real file. These facts are then read on-chain, not assumed:

1. The full address of `AccessControlsRegistry` (the registry behind `Stock.ACCESS_CONTROLLED_REGISTRY`) — needed to `grantRole(MINTER_ROLE, faucet)`.
2. How the colleague deployed the 3 existing mock stocks (`MSTRx`/`TSLAx`/`NVDAx`) — the exact Stock-proxy deploy mechanism (beacon/proxy/clone). We reuse the SAME mechanism for the scale-out.
3. That `UniversalSignedSource 0x41BE…` and the `…Weekend 0x3220…` are two instances of `UniversalSignedSource` (same `read` payload ABI). Confirm `weekendAware` is `false`/`true` respectively (`setWeekendAware` if not).
4. The committee on each signed source (`SignedCommitteeBase.threshold` + `isCommittee`) — we will `setCommittee` to our keeper keys (we are owner).
5. `RegistryRebalanceVault` (the demo registry index) `genesisRoot` + whether it is already bootstrapped (`totalSupply`). If bootstrapped with the wrong set, create a fresh one via `CloneFactory.createRegistryIndex`.
6. `ForwardCashQueue` gate params already set by the colleague (`setGateParams`, `setG1Refs`) — reconcile, fill gaps.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `blockchain/contracts/mock/Faucet.sol` | Capped fixed-amount minter for demo Stocks | Create |
| `blockchain/test/foundry/Faucet.t.sol` | Unit tests for Faucet | Create |
| `blockchain/scripts/deploy/lib/registry-select.ts` | Pick top-N tickers by market cap + derive synthetic price | Create |
| `blockchain/test/registry-select.test.ts` | Unit test for the selection/price helper | Create |
| `blockchain/scripts/deploy/deploy-demo-stocks.ts` | Scale-out: deploy N Stock instances under top-N tickers, gas-budgeted; grant Faucet MINTER_ROLE; whitelist | Rewrite |
| `blockchain/scripts/deploy/deploy-faucet.ts` | Deploy Faucet, allowlist the mocks, grant it MINTER_ROLE | Create |
| `blockchain/scripts/deploy/register-sources.ts` | `addSource ×2` (weekday+weekend) per constituent (mocks + 5 real RH) | Create |
| `blockchain/scripts/deploy/bootstrap-demo-fund.ts` | (Re)bootstrap RegistryIndex with mocks + reconcile ForwardCashQueue gates | Create |
| `blockchain/keeper/sign.ts` | Committee-signing core: build digest, sign, encode UniversalSignedSource payload | Create |
| `blockchain/keeper/server.ts` | `GET /reports?assets=…` + `GET /settle-payloads` HTTP service | Create |
| `blockchain/keeper/sign.test.ts` | Unit test: payload round-trips through `UniversalSignedSource.read` | Create |

---

## Task 0: Verify the colleague's stand on chain 46630 + discover the AccessControlsRegistry

**Files:**
- Modify: `blockchain/config/testnet.json` (already replaced with the colleague's deployment; add the discovered `AccessControlsRegistry` key)

> The colleague's full `config/testnet.json` is already in place (chain 46630). Scripts read it at the default path — NO `DEPLOY_CONFIG` is needed. Confirmed keys: `CloneFactory 0x453B…`, `PriceAggregator 0x77b0…`, `FairValueNAV 0xAdec…`, `USDG 0x5F28…`, `RegistryRebalanceVault 0x8937…` (impl/template), `RegistryIndex 0x3F78…` (the demo index clone — Task 8 targets THIS), `ForwardCashQueue 0x29d7…`, `MockAPFiller 0x11B2…`, `BasketNavObserver 0xe4f4…`, `UniversalSignedSource 0x41BE…` + `UniversalSignedSourceWeekend 0x3220…`, `Stock_MSTRx/TSLAx/NVDAx`, `Source_Shared 0xDb82…`, `USDG`, `MockPegFeed`, `MockFeedRouter`. **Missing:** `AccessControlsRegistry` — discovered in Step 2.

- [ ] **Step 1: Verify deployer is owner of PriceAggregator + CloneFactory on chain 46630**

Run (from `blockchain/`):
```bash
npx hardhat run --network robinhoodTestnet -e '
const {ethers}=require("hardhat");
const c=require("./config/testnet.json").deployments;
(async()=>{
  const me=(await ethers.getSigners())[0].address;
  const agg=await ethers.getContractAt("PriceAggregator", c.PriceAggregator.address);
  const f=await ethers.getContractAt("CloneFactory", c.CloneFactory.address);
  console.log("me", me, "agg.owner", await agg.owner(), "factory.owner", await f.owner());
})();'
```
Expected: `agg.owner` and `factory.owner` both equal `me` (our deployer EOA). If not, STOP — we cannot do owner-gated wiring; escalate.

- [ ] **Step 2: Discover the AccessControlsRegistry from a Stock and record it**

`AccessControlled.ACCESS_CONTROLLED_REGISTRY` is `public immutable` (`AccessControlled.sol:9`), readable from any Stock. Read it from `Stock_MSTRx` and write it into the config under `AccessControlsRegistry`:

```bash
npx hardhat run --network robinhoodTestnet -e '
const {ethers}=require("hardhat"); const fs=require("fs");
const cfg=require("./config/testnet.json");
(async()=>{
  const s=await ethers.getContractAt("Stock", cfg.deployments.Stock_MSTRx.address);
  const reg=await s.ACCESS_CONTROLLED_REGISTRY();
  cfg.deployments.AccessControlsRegistry={address:reg};
  fs.writeFileSync("./config/testnet.json", JSON.stringify(cfg,null,2)+"\n");
  console.log("AccessControlsRegistry", reg);
})();'
```
Expected: prints a non-zero address; the config now has `deployments.AccessControlsRegistry`. Then verify our deployer has `DEFAULT_ADMIN_ROLE` on it (so `grantRole` will succeed in Task 4):
read `AccessControlsRegistry.hasRole(0x00…00, me)` → expect `true`. If `false`, STOP — escalate (the colleague must grant us admin or run the grant themselves).

- [ ] **Step 3: Confirm the two signed-source instances + weekendAware flags**

Read `UniversalSignedSource(0x41BE…).weekendAware()` (expect `false`), `UniversalSignedSource(0x3220…).weekendAware()` (expect `true`), and `.threshold()` on both. If the weekend instance has `weekendAware==false`, call `setWeekendAware(true)` (we are owner) and re-read.
Expected: weekday=false, weekend=true.

- [ ] **Step 4: Commit the config**

```bash
git add config/testnet.json
git commit -m "chore(demo): pin colleague testnet.json (chain 46630) + record AccessControlsRegistry"
```

---

## Task 1: `Faucet.sol` — capped fixed-amount minter

**Files:**
- Create: `blockchain/contracts/mock/Faucet.sol`
- Test: `blockchain/test/foundry/Faucet.t.sol`

The Faucet holds `MINTER_ROLE` (global, in the shared `AccessControlsRegistry`) and calls `IStock.mint(to, amount)` (`Stock.sol:100`). Fixed `100e18` per claim, per-address cumulative cap `1_000_000e18`, owner-managed allowlist of faucetable stocks.

- [ ] **Step 1: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Faucet} from "../../contracts/mock/Faucet.sol";

// Minimal mintable token mirroring IStock.mint(to, amount) with no role check (unit isolation).
contract MintableStub {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
}

contract FaucetTest is Test {
    Faucet internal faucet;
    MintableStub internal stock;
    address internal owner = address(0xA11CE);
    address internal user = address(0xBEEF);

    function setUp() public {
        vm.prank(owner);
        faucet = new Faucet(owner);
        stock = new MintableStub();
        vm.prank(owner);
        faucet.setStock(address(stock), true);
    }

    function testClaimMintsFixedAmount() public {
        vm.prank(user);
        faucet.claim(address(stock));
        assertEq(stock.balanceOf(user), 100e18);
    }

    function testClaimRejectsNonAllowlistedStock() public {
        MintableStub other = new MintableStub();
        vm.prank(user);
        vm.expectRevert(Faucet.NotFaucetable.selector);
        faucet.claim(address(other));
    }

    function testClaimRevertsPastCap() public {
        // cap = 1_000_000e18, fixed 100e18 => 10_000 claims allowed; 10_001st reverts.
        for (uint256 i = 0; i < 10_000; ++i) {
            vm.prank(user);
            faucet.claim(address(stock));
        }
        assertEq(stock.balanceOf(user), 1_000_000e18);
        vm.prank(user);
        vm.expectRevert(Faucet.CapExceeded.selector);
        faucet.claim(address(stock));
    }

    function testSetStockOnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        faucet.setStock(address(stock), false);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-contract FaucetTest -vv` (from `blockchain/`)
Expected: FAIL — `Faucet` source not found / does not compile.

- [ ] **Step 3: Write minimal implementation**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @title Faucet — capped, fixed-amount demo-token dispenser
/// @notice Holds MINTER_ROLE on the demo Stocks (in the shared AccessControlsRegistry) and mints a fixed
///         AMOUNT per claim, bounded by a per-address cumulative CAP. No amount argument exists, so the
///         `mint(uint256.max)` vector cannot be reached; the cap keeps cumulative NAV below the L4 band
///         overflow ceiling. Only mints allowlisted demo Stocks; no power beyond that.
contract Faucet is Ownable {
    uint256 public constant AMOUNT = 100e18;
    uint256 public constant CAP = 1_000_000e18;

    mapping(address => bool) public faucetable;          // stock => allowlisted
    mapping(address => mapping(address => uint256)) public claimed; // stock => user => total

    event Claimed(address indexed stock, address indexed to, uint256 amount);
    event StockSet(address indexed stock, bool allowed);

    error NotFaucetable();
    error CapExceeded();

    constructor(address owner_) Ownable(owner_) {}

    function setStock(address stock, bool allowed) external onlyOwner {
        faucetable[stock] = allowed;
        emit StockSet(stock, allowed);
    }

    function claim(address stock) external {
        if (!faucetable[stock]) revert NotFaucetable();
        uint256 next = claimed[stock][msg.sender] + AMOUNT;
        if (next > CAP) revert CapExceeded();
        claimed[stock][msg.sender] = next;
        IMintable(stock).mint(msg.sender, AMOUNT);
        emit Claimed(stock, msg.sender, AMOUNT);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-contract FaucetTest -vv`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/mock/Faucet.sol test/foundry/Faucet.t.sol
git commit -m "feat(demo): capped fixed-amount Faucet + unit tests"
```

---

## Task 2: `registry-select.ts` — top-N tickers + synthetic price

**Files:**
- Create: `blockchain/scripts/deploy/lib/registry-select.ts`
- Test: `blockchain/test/registry-select.test.ts`

Pure, no chain access: read `tools/registry/out/registry.json`, sort tokens by `underlying.market_cap_usd` desc, take top-N, derive a synthetic USD price `= market_cap_usd / total_supply` (clamped to a sane floor). Returns `{ ticker, symbol, priceUsd }[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect } from "chai";
import { selectTopN, syntheticPriceUsd } from "../scripts/deploy/lib/registry-select";

describe("registry-select", () => {
  const tokens = [
    { ticker: "BIG",   underlying: { market_cap_usd: 1_000_000_000 }, onchain: { total_supply: "10000000.0" }, deployments: [{ token_symbol: "BIG" }] },
    { ticker: "SMALL", underlying: { market_cap_usd: 5_000_000 },    onchain: { total_supply: "1000000.0" },  deployments: [{ token_symbol: "SMALL" }] },
    { ticker: "MID",   underlying: { market_cap_usd: 50_000_000 },   onchain: { total_supply: "2000000.0" },  deployments: [{ token_symbol: "MID" }] },
  ];

  it("returns top-N by market cap, descending", () => {
    const out = selectTopN(tokens as any, 2);
    expect(out.map((t) => t.ticker)).to.deep.equal(["BIG", "MID"]);
  });

  it("derives synthetic price = market_cap / total_supply", () => {
    expect(syntheticPriceUsd(tokens[0] as any)).to.equal(100); // 1e9 / 1e7
  });

  it("clamps price to a 0.01 floor when supply is huge / cap tiny", () => {
    const t = { underlying: { market_cap_usd: 1 }, onchain: { total_supply: "1000000000.0" } };
    expect(syntheticPriceUsd(t as any)).to.equal(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test test/registry-select.test.ts` (from `blockchain/`)
Expected: FAIL — module `registry-select` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RegistryToken = {
  ticker: string;
  underlying?: { market_cap_usd?: number | null };
  onchain?: { total_supply?: string | null };
  deployments?: { token_symbol?: string | null }[];
};

export type Selected = { ticker: string; symbol: string; priceUsd: number };

const PRICE_FLOOR = 0.01;

export function syntheticPriceUsd(t: RegistryToken): number {
  const cap = t.underlying?.market_cap_usd ?? 0;
  const supply = Number(t.onchain?.total_supply ?? 0);
  if (!cap || !supply) return PRICE_FLOOR;
  const p = cap / supply;
  return p < PRICE_FLOOR ? PRICE_FLOOR : p;
}

export function selectTopN(tokens: RegistryToken[], n: number): Selected[] {
  return tokens
    .filter((t) => (t.underlying?.market_cap_usd ?? 0) > 0)
    .sort((a, b) => (b.underlying!.market_cap_usd! - a.underlying!.market_cap_usd!))
    .slice(0, n)
    .map((t) => ({
      ticker: t.ticker,
      symbol: t.deployments?.[0]?.token_symbol ?? t.ticker,
      priceUsd: syntheticPriceUsd(t),
    }));
}

export function loadRegistry(): RegistryToken[] {
  const p = join(__dirname, "..", "..", "..", "..", "tools", "registry", "out", "registry.json");
  return JSON.parse(readFileSync(p, "utf8")).tokens as RegistryToken[];
}
```

> Note: verify the relative path to `tools/registry/out/registry.json` resolves from `blockchain/scripts/deploy/lib/` (four `..` to repo root). Adjust the segment count if the test's `loadRegistry()` smoke fails.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx hardhat test test/registry-select.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/lib/registry-select.ts test/registry-select.test.ts
git commit -m "feat(demo): registry top-N selection + synthetic price helper"
```

---

## Task 3: Rewrite `deploy-demo-stocks.ts` — gas-budgeted Stock scale-out

**Files:**
- Modify (rewrite): `blockchain/scripts/deploy/deploy-demo-stocks.ts`

Deploy N mint-restricted `Stock` instances under top-N tickers using the SAME mechanism the colleague used (confirmed in Task 0 Step 2), staged per the gas-budget protocol; whitelist each via `CloneFactory.setConstituentAllowed`. Persist the address map + ticker→price map into `config.params.demo`.

- [ ] **Step 1: Replace the file body**

```ts
import { ethers } from "hardhat";
import { getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";
import { selectTopN, loadRegistry } from "./lib/registry-select";

// Target constituent count; the actual count is min(TARGET_N, gas-budget cap) computed below.
const TARGET_N = Number(process.env.TARGET_N ?? 100);
const PROBE_BATCH = Number(process.env.PROBE_BATCH ?? 10); // batch to measure costPerStock
const MARGIN = 0.8; // keep 20% native headroom

// RESOLVED mechanism (from test/helpers.ts deployStock): a mint-restricted Stock = one shared Stock impl
// (constructor takes the AccessControlsRegistry address) behind a per-ticker StockProxy (ERC1967) whose
// init data calls initialize(uid, name, symbol). For scale-out we deploy the impl ONCE and one proxy per
// ticker. Extracted into scripts/deploy/lib/deploy-stock.ts so it is unit-tested independently.
//   import { deployStockImpl, deployStockProxy } from "./lib/deploy-stock";
// deployStockProxy(implAddr, registryAddr, name, symbol) -> proxy address; uid = encodeBytes32String(symbol).
// symbol must be <= 31 bytes for encodeBytes32String — tickers are short; truncate/guard if a symbol is longer.

export async function deployDemoStocks() {
  console.log("== DEMO: Stock scale-out under registry top-N ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();
  const factory = requireAddress(config, "CloneFactory", "colleague testnet.json");
  const f = await ethers.getContractAt("CloneFactory", factory);

  const provider = ethers.provider;

  // 1. Probe batch -> costPerStock
  const picks = selectTopN(loadRegistry(), TARGET_N);
  const stocks: Record<string, { address: string; priceUsd: number }> = {};
  let before = await provider.getBalance(deployer);

  const probe = picks.slice(0, PROBE_BATCH);
  for (const p of probe) {
    const a = await deployOneStock(p.ticker, p.symbol);
    stocks[p.ticker] = { address: a, priceUsd: p.priceUsd };
  }
  const after = await provider.getBalance(deployer);
  const costPerStock = (before - after) / BigInt(Math.max(1, probe.length));
  const remaining = after;
  const maxCount = costPerStock === 0n ? TARGET_N : Number((remaining * BigInt(Math.floor(MARGIN * 100)) / 100n) / costPerStock);
  const finalN = Math.min(TARGET_N, PROBE_BATCH + maxCount);
  console.log(`  costPerStock≈${ethers.formatEther(costPerStock)} ETH; budget allows ~${maxCount} more; finalN=${finalN}`);

  // 2. Deploy the rest up to finalN
  for (const p of picks.slice(PROBE_BATCH, finalN)) {
    const a = await deployOneStock(p.ticker, p.symbol);
    stocks[p.ticker] = { address: a, priceUsd: p.priceUsd };
  }

  // 3. Whitelist each constituent on the factory (idempotent)
  for (const { address } of Object.values(stocks)) {
    if (!(await f.constituentAllowed(address))) {
      console.log(`  wiring: factory.setConstituentAllowed(${address})`);
      await (await f.setConstituentAllowed(address, true)).wait();
    }
  }

  (config.params as any) ??= {};
  (config.params as any).demo = { ...((config.params as any).demo ?? {}), stocks, count: Object.keys(stocks).length };
  saveConfig(config);
  console.log(`\n✅ ${Object.keys(stocks).length} demo stocks deployed + whitelisted.`);
  return stocks;
}

if (require.main === module) {
  deployDemoStocks().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Resolve `deployOneStock` against the confirmed mechanism**

From Task 0 Step 2, fill `deployOneStock` with the exact colleague mechanism (StockFactory / CloneFactory stock-create / beacon proxy) and add an `addressFromReceipt` helper that parses the creation event. The function MUST return a Stock whose `mint` is MINTER_ROLE-gated.

- [ ] **Step 3: Dry-run against a fork to validate the script compiles + selects**

Run (from `blockchain/`, does NOT touch real chain):
```bash
DEPLOY_CONFIG=/tmp/demo-dry.json TARGET_N=3 PROBE_BATCH=2 \
  npx hardhat run scripts/deploy/deploy-demo-stocks.ts --network hardhat
```
Expected: with a forked or mocked factory it deploys 3, whitelists, writes `/tmp/demo-dry.json` with `params.demo.stocks`. (If no fork is configured, expect the `deployOneStock` mechanism call — confirm it reaches that line, proving selection + budget math ran.)

- [ ] **Step 4: Commit (script only; real deploy happens after Faucet + sources are ready)**

```bash
git add scripts/deploy/deploy-demo-stocks.ts
git commit -m "feat(demo): gas-budgeted Stock scale-out under registry top-N"
```

---

## Task 4: `deploy-faucet.ts` — deploy Faucet, allowlist mocks, grant global MINTER_ROLE

**Files:**
- Create: `blockchain/scripts/deploy/deploy-faucet.ts`

- [ ] **Step 1: Write the script**

```ts
import { ethers } from "hardhat";
import { ensure, getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";

const MINTER_ROLE = ethers.id("MINTER_ROLE");

export async function deployFaucet() {
  console.log("== DEMO: Faucet deploy + allowlist + global MINTER_ROLE ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  // AccessControlsRegistry address confirmed in Task 0; key it under "AccessControlsRegistry".
  const acr = requireAddress(config, "AccessControlsRegistry", "colleague testnet.json");
  const reg = await ethers.getContractAt("AccessControlsRegistry", acr);

  const faucet = await ensure(config, "Faucet", [deployer], deployer, "Faucet");
  const fc = await ethers.getContractAt("Faucet", faucet);

  // 1. Grant the Faucet MINTER_ROLE ONCE (global — covers every Stock sharing this registry).
  if (!(await reg.hasRole(MINTER_ROLE, faucet))) {
    console.log(`  wiring: AccessControlsRegistry.grantRole(MINTER_ROLE, ${faucet})`);
    await (await reg.grantRole(MINTER_ROLE, faucet)).wait();
  }

  // 2. Allowlist every demo stock on the Faucet.
  const stocks = (config.params as any)?.demo?.stocks ?? {};
  for (const [ticker, v] of Object.entries<any>(stocks)) {
    if (!(await fc.faucetable(v.address))) {
      console.log(`  wiring: faucet.setStock(${ticker} ${v.address})`);
      await (await fc.setStock(v.address, true)).wait();
    }
  }

  (config.params as any).demo = { ...((config.params as any).demo ?? {}), faucet };
  saveConfig(config);
  console.log(`\n✅ Faucet ${EXPLORER}${faucet} holds MINTER_ROLE; ${Object.keys(stocks).length} stocks allowlisted.`);
  return faucet;
}

if (require.main === module) {
  deployFaucet().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Dry-run compile check**

Run: `npx hardhat compile` then `npx hardhat run scripts/deploy/deploy-faucet.ts --network hardhat` with a `DEPLOY_CONFIG` stub that has `AccessControlsRegistry` + an empty `demo.stocks`.
Expected: it deploys the Faucet locally and reaches the grantRole call (proves wiring path).

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy/deploy-faucet.ts
git commit -m "feat(demo): Faucet deploy + global MINTER_ROLE grant + allowlist"
```

---

## Task 5: `keeper/sign.ts` + test — committee-signed UniversalSignedSource payload

**Files:**
- Create: `blockchain/keeper/sign.ts`
- Test: `blockchain/keeper/sign.test.ts`

The keeper builds the EXACT digest `UniversalSignedSource.read` expects (`Stock.sol` adapter `UniversalSignedSource.sol:28`): `keccak256(abi.encode("universal", feedId, price, depth, lastUpdate))`, signs with k committee keys (strictly-ascending signer addresses, per `SignedCommitteeBase._countValidSigners`), and ABI-encodes the payload `(bytes32 feedId, uint256 price, uint256 depth, uint64 lastUpdate, bytes32[] r, bytes32[] s, uint8[] v)`.

- [ ] **Step 1: Write the failing test (round-trips through the real adapter)**

```ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { buildUniversalPayload } from "../keeper/sign";

describe("keeper/sign", () => {
  it("produces a payload the real UniversalSignedSource accepts", async () => {
    // two committee signers, sorted ascending by address
    const a = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const b = new ethers.Wallet("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const signers = [a, b].sort((x, y) => (x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1));

    const owner = (await ethers.getSigners())[0];
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(owner.address);
    await src.setCommittee(signers.map((s) => s.address), 2);

    const feedId = ethers.id("AAPL");
    const price = 200n * 10n ** 18n;
    const depth = 5_000_000n * 10n ** 18n;
    const lastUpdate = 1_700_000_000n;

    const payload = await buildUniversalPayload(
      { feedId, price, depth, lastUpdate },
      signers.map((s) => s.privateKey),
    );
    const r = await src.read.staticCall(payload);
    expect(r.price).to.equal(price);
    expect(r.depth).to.equal(depth);
    expect(r.healthy).to.equal(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx hardhat test keeper/sign.test.ts` (from `blockchain/`)
Expected: FAIL — module `keeper/sign` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { ethers } from "ethers";

export type Report = { feedId: string; price: bigint; depth: bigint; lastUpdate: bigint };

const coder = ethers.AbiCoder.defaultAbiCoder();

export function universalDigest(rep: Report): string {
  return ethers.keccak256(
    coder.encode(
      ["string", "bytes32", "uint256", "uint256", "uint64"],
      ["universal", rep.feedId, rep.price, rep.depth, rep.lastUpdate],
    ),
  );
}

/// Sign `rep` with each committee key and ABI-encode the UniversalSignedSource payload. Signatures are
/// sorted by recovered signer address ascending so the adapter's strictly-increasing `last` counter
/// accepts all of them as distinct.
export async function buildUniversalPayload(rep: Report, committeeKeys: string[]): Promise<string> {
  const digest = universalDigest(rep);
  const parts = committeeKeys
    .map((k) => {
      const w = new ethers.Wallet(k);
      const sig = ethers.Signature.from(w.signingKey.sign(digest)); // raw sign over the 32-byte digest
      return { addr: w.address.toLowerCase(), r: sig.r, s: sig.s, v: sig.v };
    })
    .sort((x, y) => (x.addr < y.addr ? -1 : 1));

  return coder.encode(
    ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
    [
      rep.feedId,
      rep.price,
      rep.depth,
      rep.lastUpdate,
      parts.map((p) => p.r),
      parts.map((p) => p.s),
      parts.map((p) => p.v),
    ],
  );
}
```

> Critical: the adapter calls `ecrecover(h, v, r, s)` directly on the 32-byte digest with NO EIP-191 prefix. Sign the raw digest via `signingKey.sign(digest)`, NOT `wallet.signMessage` (which prefixes). The test will catch a prefix mismatch (`read` reverts `ThresholdNotMet`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx hardhat test keeper/sign.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add keeper/sign.ts keeper/sign.test.ts
git commit -m "feat(keeper): committee-signed UniversalSignedSource payload encoder + test"
```

---

## Task 6: `keeper/server.ts` — `GET /reports` + `GET /settle-payloads`

**Files:**
- Create: `blockchain/keeper/server.ts`

Serves per-asset signed payloads. Price per asset comes from `config.params.demo.stocks[ticker].priceUsd` (synthetic, from Task 2). `feedId = keccak256(ticker)`. `lastUpdate = now` (fresh). Holds the committee keys via `process.env.KEEPER_KEYS` (comma-separated, NEVER hardcoded). Produces BOTH the weekday and weekend source payloads (identical encoder, same report) so the caller has two payloads per asset.

- [ ] **Step 1: Write the server**

```ts
import { createServer } from "node:http";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { buildUniversalPayload } from "./sign";

const CONFIG = process.env.DEPLOY_CONFIG ?? "./config/testnet.json";
const KEYS = (process.env.KEEPER_KEYS ?? "").split(",").filter(Boolean);
const DEPTH = 5_000_000n * 10n ** 18n; // matches DEFAULTS.depthTier; above dMin => full confidence
const PORT = Number(process.env.KEEPER_PORT ?? 8787);

if (KEYS.length === 0) throw new Error("set KEEPER_KEYS (comma-separated committee privkeys) in env");

function stocks(): Record<string, { address: string; priceUsd: number }> {
  return JSON.parse(readFileSync(CONFIG, "utf8")).params?.demo?.stocks ?? {};
}

async function reportFor(ticker: string, priceUsd: number, nowSec: bigint) {
  const rep = {
    feedId: ethers.id(ticker),
    price: ethers.parseUnits(priceUsd.toFixed(8), 18),
    depth: DEPTH,
    lastUpdate: nowSec,
  };
  const payload = await buildUniversalPayload(rep, KEYS);
  // weekday + weekend sources share the encoder/report => same payload twice (order = source registration order)
  return { weekday: payload, weekend: payload };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://x`);
    if (url.pathname === "/reports") {
      const want = (url.searchParams.get("assets") ?? "").split(",").filter(Boolean);
      const all = stocks();
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const out: Record<string, unknown> = {};
      for (const [ticker, v] of Object.entries(all)) {
        if (want.length && !want.includes(ticker) && !want.includes(v.address)) continue;
        out[v.address] = await reportFor(ticker, v.priceUsd, nowSec);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`keeper on :${PORT} (synthetic, committee-signed, sandbox)`));
```

> `now`-based `Date.now()` is fine in the keeper service (a long-running Node process), unlike inside Workflow scripts.

- [ ] **Step 2: Manual smoke**

Run (from `blockchain/`, with a stub config that has 1 stock + two throwaway keys):
```bash
KEEPER_KEYS=0x59c6...,0x8b3a... KEEPER_PORT=8787 DEPLOY_CONFIG=/tmp/demo-dry.json \
  node --loader ts-node/esm keeper/server.ts &
curl 'http://localhost:8787/reports?assets=AAPL'
```
Expected: JSON `{ "<addr>": { "weekday": "0x…", "weekend": "0x…" } }`.

- [ ] **Step 3: Commit**

```bash
git add keeper/server.ts
git commit -m "feat(keeper): GET /reports serving committee-signed per-asset payloads"
```

---

## Task 7: `register-sources.ts` — two signed sources per constituent

**Files:**
- Create: `blockchain/scripts/deploy/register-sources.ts`

For every constituent (the demo mocks + the 5 real RH tokens) register the weekday + weekend `UniversalSignedSource` (owner-gated `addSource`), idempotent. Also `setCommittee` on both sources to the keeper's committee addresses (we are owner). The order of `addSource` calls fixes the payload order the caller must use (weekday first, weekend second) — must match the keeper's `{weekday, weekend}` order.

- [ ] **Step 1: Write the script**

```ts
import { ethers } from "hardhat";
import { getDeployer, loadConfig, saveConfig, requireAddress } from "./_shared";

// 5 real Robinhood testnet tokens (Q7) — judges mint these from the official Chainlink faucet.
const REAL_RH = {
  TSLA: "0xC9f9...", AMZN: "0x5884...", PLTR: "0x1FBE...", NFLX: "0x3b82...", AMD: "0x7117...",
}; // fill full addresses from the colleague's config / Q7 brief before running.

export async function registerSources() {
  console.log("== DEMO: register weekday+weekend signed sources per constituent ==");
  await getDeployer();
  const config = loadConfig();
  const agg = await ethers.getContractAt("PriceAggregator", requireAddress(config, "PriceAggregator", "colleague"));
  const weekday = requireAddress(config, "UniversalSignedSource", "colleague");
  const weekend = requireAddress(config, "UniversalSignedSourceWeekend", "colleague");

  // 1. Committee on both sources (idempotent setCommittee; we are owner).
  const committee = (config.params as any)?.demo?.committee as string[] | undefined;
  if (committee?.length) {
    for (const s of [weekday, weekend]) {
      const src = await ethers.getContractAt("UniversalSignedSource", s);
      const thr = await src.threshold();
      if (thr === 0n) {
        console.log(`  wiring: setCommittee(${s}, [${committee.length}], 2)`);
        await (await src.setCommittee(committee, 2)).wait();
      }
    }
  }

  // 2. addSource x2 per constituent (weekday then weekend), idempotent.
  const mocks = Object.values<any>((config.params as any)?.demo?.stocks ?? {}).map((v) => v.address);
  const assets = [...mocks, ...Object.values(REAL_RH)];
  for (const asset of assets) {
    for (const src of [weekday, weekend]) {
      if (!(await agg.isSource(asset, src))) {
        console.log(`  wiring: addSource(${asset}, ${src})`);
        await (await agg.addSource(asset, src)).wait();
      }
    }
  }

  (config.params as any).demo = { ...((config.params as any).demo ?? {}), realRh: REAL_RH };
  saveConfig(config);
  console.log(`\n✅ ${assets.length} constituents now have 2 signed sources each.`);
}

if (require.main === module) {
  registerSources().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 2: Fill the real RH addresses + confirm the weekend source config key**

Replace the truncated `REAL_RH` addresses with full ones from the colleague's config / Q7. Confirm the weekend instance is recorded under key `UniversalSignedSourceWeekend` in `testnet-colleague.json`; if it has a different key, align it.

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy/register-sources.ts
git commit -m "feat(demo): register weekday+weekend signed sources per constituent"
```

---

## Task 8: `bootstrap-demo-fund.ts` — (re)bootstrap RegistryIndex + reconcile ForwardCashQueue

**Files:**
- Create: `blockchain/scripts/deploy/bootstrap-demo-fund.ts`

The demo index is the deployed `RegistryIndex 0x3F78…` clone (NOT `RegistryRebalanceVault 0x8937…`, which is the impl/template). Decide reuse vs fresh: read `RegistryIndex.totalSupply()` and its held set — if it is already bootstrapped with the colleague's 3-stock set (excludes our 100+ mocks), create a FRESH index via `CloneFactory.createRegistryIndex` (with a `genesisRoot` built from our mocks) and `bootstrap` it; if it is un-bootstrapped (`totalSupply == 0`) and its `genesisRoot` matches our set, bootstrap it directly. Record the chosen vault under `config.params.demo.registryIndex`. Then reconcile `ForwardCashQueue` gate params.

- [ ] **Step 1: Build the genesis Merkle root from the selected mocks**

The vault's `bootstrap(nShares, tokens, unitQty, proofs)` verifies each `(token, unitQty)` against `genesisRoot` via `MerkleRecipeLib.verify`. Reuse the existing Merkle helper the repo already uses to build SP500 leaves (find it under `scripts/` or `contracts/.../MerkleRecipeLib`). Build `leaf_i = keccak(token_i, unitQty_i)`, the root, and per-token proofs. Set each `unitQty_i` so the per-unit USD is sane (e.g. proportional to `1 / priceUsd`, integer-rounded, min 1).

```ts
// pseudo within the script — use the repo's actual MerkleRecipeLib leaf layout (confirm field order!)
import { buildRegistryRoot } from "./lib/merkle"; // create if absent, mirroring SP500 leaf encoding
const { root, proofs, unitQty, tokens } = buildRegistryRoot(selectedMocks);
```

- [ ] **Step 2: Create-or-reuse the registry index**

```ts
const factory = await ethers.getContractAt("CloneFactory", requireAddress(config, "CloneFactory", "colleague"));
// Start from the deployed demo index; fall back to a previously-recorded fresh one.
let vaultAddr = (config.params as any)?.demo?.registryIndex ?? requireAddress(config, "RegistryIndex", "colleague");
const existing = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
const bootstrapped = (await existing.totalSupply()) > 0n;
const setMatchesOurs = /* compare existing.heldTokens() against our selected mocks */ false;
if (bootstrapped && !setMatchesOurs) {
  // colleague's 3-stock index is live with the wrong set => mint a fresh one with our genesisRoot
  const tx = await factory.createRegistryIndex({ /* genesisRoot: root, tokens, unitSize, name, symbol, manager, fees, keeper */ }, ethers.id("meridian-demo"));
  vaultAddr = /* parse the created-vault address from the receipt event */;
}
```

> Fill the `RegistryIndex` struct fields from the actual `CloneFactory.createRegistryIndex` ABI (Task 0). `unitSize` must divide `nShares` in bootstrap. Set `manager` = deployer, fees per `FLOW_FEE_BPS = 0` requirement.

- [ ] **Step 3: Bootstrap (deployer mints itself the genesis shares)**

The deployer must hold the wrapped ERC-6909 claims for each token before `bootstrap` pulls them. Mint each mock to the deployer via the Faucet or direct `mint` (deployer is admin), wrap into claims as the vault expects, then:

```ts
const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
await (await vault.bootstrap(nShares, tokens, unitQty, proofs)).wait();
```

Expected: `await vault.totalSupply()` returns `nShares > 0`.

- [ ] **Step 4: Reconcile ForwardCashQueue gate params**

```ts
const fcq = await ethers.getContractAt("ForwardCashQueue", requireAddress(config, "ForwardCashQueue", "colleague"));
// only set what the colleague left unset; confirm current values first (read), then fill gaps:
await (await fcq.setG1Refs(aggregatorAddr, l2RouterSourceAddr)).wait();      // g1 source registry
await (await fcq.setGateParams(minN, win, twBps, pegBps, pegMaxAge)).wait(); // g6/g7/g8 bands
```

> Read each current value before writing; do NOT clobber working colleague config. `FLOW_FEE_BPS`/flat create fee must remain 0 (confirm `fcq` flat fee getter == 0).

- [ ] **Step 5: Persist + commit**

```ts
(config.params as any).demo = { ...((config.params as any).demo ?? {}), registryIndex: vaultAddr };
saveConfig(config);
```

```bash
git add scripts/deploy/bootstrap-demo-fund.ts scripts/deploy/lib/merkle.ts
git commit -m "feat(demo): bootstrap registry index with mocks + reconcile ForwardCashQueue gates"
```

---

## Task 9: Local-fork integration smoke (safe=true + USDG create + manipulation reject)

**Files:**
- Create: `blockchain/test/demo-fund.integration.test.ts`

End-to-end on the in-process hardhat network: deploy a minimal stand subset (PriceAggregator + FairValueNAV + two UniversalSignedSource + a Stock + Faucet), register 2 sources, feed keeper payloads, assert `navOf.safe == true`; pump the thin MockSource and assert the median rejects it.

- [ ] **Step 1: Write the test**

```ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { buildUniversalPayload } from "../keeper/sign";

describe("demo fund integration", () => {
  it("safe=true with 2 fresh signed sources; manipulation pump is rejected by the median", async () => {
    const [owner] = await ethers.getSigners();

    const Agg = await ethers.getContractFactory("PriceAggregator");
    const agg = await Agg.deploy(owner.address);

    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const weekday = await Src.deploy(owner.address);
    const weekend = await Src.deploy(owner.address);
    await weekend.setWeekendAware(true);

    const k1 = ethers.Wallet.createRandom();
    const k2 = ethers.Wallet.createRandom();
    const committee = [k1.address, k2.address].sort();
    await weekday.setCommittee(committee, 2);
    await weekend.setCommittee(committee, 2);

    const asset = ethers.Wallet.createRandom().address; // stand-in token address
    await agg.addSource(asset, await weekday.getAddress());
    await agg.addSource(asset, await weekend.getAddress());

    const rep = { feedId: ethers.id("AAPL"), price: 200n * 10n ** 18n, depth: 5_000_000n * 10n ** 18n, lastUpdate: BigInt((await ethers.provider.getBlock("latest"))!.timestamp) };
    const payload = await buildUniversalPayload(rep, [k1.privateKey, k2.privateKey]);

    const res = await agg.priceOf.staticCall(asset, [payload, payload]);
    expect(res.safe).to.equal(true);
    expect(res.price).to.equal(rep.price);

    // manipulation: add a thin MockSource pumped x25; median weight-cap + divergence band reject it.
    const Mock = await ethers.getContractFactory("MockSource");
    const thin = await Mock.deploy();
    await thin.set(rep.price * 25n, 1n, rep.lastUpdate, 1 /*ORACLE_PULL*/, 0, false, true);
    await agg.addSource(asset, await thin.getAddress());
    const res2 = await agg.priceOf.staticCall(asset, [payload, payload, "0x"]);
    expect(res2.price).to.be.lt(rep.price * 2n); // pumped outlier did NOT move the median materially
  });
});
```

> Confirm the `MockSource.set` arg order/enum value against `contracts/L4/mocks/MockSource.sol` (Task 0 report item 6) before running; adjust the `SourceKind` ordinal if needed.

- [ ] **Step 2: Run**

Run: `npx hardhat test test/demo-fund.integration.test.ts`
Expected: PASS (safe=true; pumped median unmoved).

- [ ] **Step 3: Commit**

```bash
git add test/demo-fund.integration.test.ts
git commit -m "test(demo): local-fork safe=true + manipulation-reject integration"
```

---

## Task 10: Execute on chain 46630 + acceptance read-back

**Files:** none (operational)

Run the scripts in order against the real chain, then verify the spec's acceptance criteria on-chain.

- [ ] **Step 1: Deploy in order**

```bash
# config is at the default path (config/testnet.json) — no DEPLOY_CONFIG needed against the real chain
export KEEPER_KEYS=<two committee privkeys from env, never hardcoded>
npx hardhat run scripts/deploy/deploy-demo-stocks.ts  --network robinhoodTestnet
npx hardhat run scripts/deploy/deploy-faucet.ts       --network robinhoodTestnet
npx hardhat run scripts/deploy/register-sources.ts    --network robinhoodTestnet
npx hardhat run scripts/deploy/bootstrap-demo-fund.ts --network robinhoodTestnet
# start keeper: node keeper/server.ts
```

- [ ] **Step 2: Acceptance — Faucet**

From a FRESH EOA: `faucet.claim(mock)` mints `100e18`; a claim past `1_000_000e18` reverts `CapExceeded`; `claim` works for every registered mock. Verify `balanceOf` is stable across a simulated `updateMultiplier` split (raw balance unchanged).

- [ ] **Step 3: Acceptance — sources + NAV**

For each constituent (mocks + 5 real): `aggregator.sourceCount(asset) >= 2`. With keeper payloads, `FairValueNAV.navOf(...).safe == true` on a calm weekday (`priceOf.staticCall`).

- [ ] **Step 4: Acceptance — fund entry**

The demo `RegistryRebalanceVault` has the gas-capped N held set and `totalSupply > 0`. A judge `requestCreate` with USDG settles to shares at the next gated open NAV (`ForwardCashQueue.settle` gates pass with keeper payloads).

- [ ] **Step 5: Acceptance — scenes**

Scene subset (MSTRx/TSLAx/NVDAx): a manipulation pump on the thin MockSource is rejected by the median; weekend wiring flips `safe=false`; a `updateMultiplier` split leaves NAV unchanged.

- [ ] **Step 6: Record final addresses + commit the populated config**

```bash
git add config/testnet-colleague.json
git commit -m "chore(demo): record on-chain demo fund addresses (chain 46630)"
```

---

## Out of scope (separate specs)

- The stand itself (colleague-deployed).
- `scripts/demo/scene-runner.ts` (finalization P1-3) — drives the per-scene source manipulation.
- The judge-frontend (`@meridian/app`) wiring + registry/suggested-funds constructor.
- The real Chainlink Streams key + `ChainlinkStreamsSource` as a third REAL source (optional drop-in; would add a Streams-schema encoder to the keeper).

## Red lines / honesty (carried from spec)

- Sandbox badge; prices labeled synthetic; "in prod: neutral on-chain validation of independent signed sources, not a price from one backend." No real-price / live-Chainlink claim (key absent).
- `Faucet` only mints capped demo tokens; the keeper only signs/relays (never custodies, never moves value).
- `FLOW_FEE_BPS = 0` / flat create fee 0 intact; nothing here touches a red line.
- `PRIVATE_KEY` / `KEEPER_KEYS` read only from env, never hardcoded; `.env` stays gitignored; rotate the burner after the buildathon.
