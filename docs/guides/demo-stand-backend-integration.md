# Demo Stand — Backend Integration Guide

> Chain: **Robinhood Chain Testnet, chainId 46630**. Explorer: `https://explorer.testnet.chain.robinhood.com/address/<addr>`.
> Source of truth for every address: `blockchain/config/testnet.json` (read it programmatically, do not hardcode).
> Status label for all of this: **sandbox / synthetic prices**. Not a live-Chainlink or real-price claim.

This guide explains how the backend integrates the on-chain ETF demo: how a stock is valued, how the price keeper works, how to get demo tokens, and how a fund is entered with USDG. The smart contracts are already deployed; the backend's job is to **run the keeper** and **pass its signed payloads into the read/settle calls**.

---

## 1. The big picture

A fund (a `RegistryIndex` vault) holds a basket of stock tokens and issues shares. Its value (NAV) is computed 24/7 by `FairValueNAV` + `PriceAggregator`, which read **price sources** per constituent. A source only returns a price if the reading is **committee-signed**; the signature is verified on-chain at read time. So the flow is:

```
keeper (off-chain)  --signs prices-->  payloads
   |                                      |
   |  GET /reports                        v
backend / frontend  --payloads-->  PriceAggregator.priceOf / FairValueNAV.navOf / ForwardCashQueue.settle
                                          |
                                          v
                                   safe NAV  ->  shares
```

Three things must be true for a constituent to value `safe=true`:
1. It has **>= 2 registered price sources** (`PriceAggregator.sourceCount(asset) >= 2`). Done on-chain for all 200 demo stocks (weekday + weekend `UniversalSignedSource`).
2. The caller passes **fresh keeper-signed payloads** for those sources into the read/settle call.
3. The committee that signed is the one registered on the source (`setCommittee`). Done.

If a constituent has < 2 sources, or stale/missing payloads, `navOf.safe == false` and `ForwardCashQueue.settle` reverts `NotSafe`.

---

## 2. Addresses (chain 46630)

**Ours (deployed for the demo fund):**
| Name | Address | Role |
|---|---|---|
| AccessControlsRegistry | `0xC2c43ea6789048C74ea88e086819796c352326f2` | role registry for our Stock clones (MINTER_ROLE etc.) |
| Stock_impl | `0x7b8F92e75F5Ef7E80B34aFEbc766492740fFd593` | shared Stock implementation behind every clone |
| StockCloneFactory | `0x536ecff29A204d8177E7aBF4bc28b2D1B1589007` | EIP-1167 clone factory |
| 200 stock clones | see `config.params.demo.stocks` | the demo constituents (object map `{ ticker: { address, priceUsd } }`) |

**Colleague's stand (reused, do not redeploy):**
| Name | Address | Role |
|---|---|---|
| PriceAggregator | `0x25f04d55C0b3608C258c21CB603aCEe197Ca5301` | multi-source median NAV referee |
| FairValueNAV | `0xcfaA21689D7273fADBD7576eDA0991576900aD96` | NAV engine (`navOf` / `navOfHoldings`) |
| UniversalSignedSource (weekday) | `0x41BE2284c8bBc5C89B5e2Bd4784a10B2646691aA` | committee-signed source; `weekendAware=false` |
| UniversalSignedSource (weekend) | `0x32207892289a101d8546A430AbBdf62DD2049fFd` | committee-signed source; `weekendAware=true` |
| ForwardCashQueue | `0xf109Cf55511d15E7906FbE421a39dB9f42121994` | USDG cash-in entry queue (`requestCreate` / `settle`) |
| RegistryIndex | `0x3F78db0F384e4bf325809F0f417ef4Afa76B2E4F` | the registry index vault (the fund) |
| MockAPFiller | `0x11B223e71BdB272695F489e5ecE2994694CFA512` | authorized participant (sources the basket) |
| USDG | `0x5F28D5E0939FDb94943d5C65241cBf850c3d98d1` | the cash-in stablecoin |
| CloneFactory | `0x453B28529273E240120D6475F2369e002deb13F5` | vault/constituent factory (constituent allowlist) |
| BasketNavObserver | `0x16221e4FA1842B36587B496f81Ad3B51cc78E0B7` | TWAP observer (settle gate g7) |

**Demo price committee signer (sandbox):** `0x1bCC28037Ee100818857F7da936EF1bD39E84639` (private key in `blockchain/.env` `KEEPER_KEYS`, gitignored — burner, rotate after the buildathon).

The 3 original colleague stocks (`MSTRx`/`TSLAx`/`NVDAx`, public-mint MockERC20) are the controlled-scene subset — see `config.params.demo.scene`. They are NOT part of the 200-name fund's price wiring.

---

## 3. The price keeper

Reference implementation: `blockchain/keeper/server.ts` (+ the signing core `blockchain/keeper/sign.ts`). It is **transport, not a price origin**: it signs prices with the committee key and relays them. It never holds funds or moves value.

**Price origin (demo):** real per-share USD prices from `tools/registry/input/stocksTable.json` (`usd_stock_price`), mirrored into `config.params.demo.stocks[ticker].priceUsd`. In production these are independent signed feeds (RedStone/Chronicle) behind the same adapter; in the demo it is our committee. Label everything synthetic/sandbox.

**Run it:**
```bash
cd blockchain
KEEPER_KEYS=$(grep '^KEEPER_KEYS=' .env | cut -d= -f2) KEEPER_PORT=8787 \
  node --import tsx/esm keeper/server.ts        # or: npx ts-node keeper/server.ts
```

**Endpoint:** `GET /reports?assets=NVDA,AAPL` (omit `assets` for all 200). Response:
```json
{
  "0x0c779f3d751a146991E52EB3a7306830F8e7E59E": {
    "ticker": "NVDA",
    "priceUsd": 208.19,
    "weekday": "0x...abi-encoded payload...",
    "weekend": "0x...same payload..."
  }
}
```
`weekday` / `weekend` are the payloads for the two sources, **in the order the sources were registered** (weekday first, weekend second). For a calm weekday, pass both. Refresh on every read (payloads carry `lastUpdate`; the aggregator drops readings older than `staleHorizon = 3600s`).

**Payload format** (what `UniversalSignedSource.read` decodes), if you build payloads yourself instead of calling the keeper:
`abi.encode(bytes32 feedId, uint256 price, uint256 depth, uint64 lastUpdate, bytes32[] r, bytes32[] s, uint8[] v)`
where `feedId = keccak256(ticker)`, `price = round(usdPrice * 1e18)`, `depth = 5_000_000e18`, `lastUpdate = now`, and `(r,s,v)` are committee signatures over `keccak256(abi.encode("universal", feedId, price, depth, lastUpdate))` (RAW digest, no EIP-191 prefix), sorted by signer address ascending. `blockchain/keeper/sign.ts` `buildUniversalPayload(report, keys)` does exactly this.

---

## 4. Valuing a constituent (read NAV)

`PriceAggregator.priceOf(asset, payloads)` and `FairValueNAV.navOf(...)` are **non-view** (a source verifies the signature in-tx), so call them with `eth_call` / `staticCall` for a gas-free read:
```ts
const reports = await fetch(`${KEEPER}/reports?assets=NVDA`).then(r => r.json());
const { weekday, weekend } = reports[nvdaAddress];
const res = await priceAggregator.priceOf.staticCall(nvdaAddress, [weekday, weekend]);
// res.safe === true, res.price ≈ 208.19e18, res.confLower/confUpper = band
```
Order matters: `payloads[i]` goes to the i-th registered source. Weekday source is index 0, weekend index 1 (the order `register-sources` used).

---

## 5. Getting demo tokens (faucet)

Each of the 200 stock clones has a built-in open faucet on the token itself — no separate faucet contract:
```solidity
Stock(stockAddr).faucetMint();   // mints a fixed 100e18 to msg.sender; per-address cap 100e18
```
`Stock.mint(to, amount)` remains `MINTER_ROLE`-gated (used by the deployer to bootstrap the index genesis basket). USDG for cash-in comes from the Paxos faucet, not ours.

---

## 6. Entering the fund with USDG

The fund is created via the frontend (it bootstraps the `RegistryIndex`). Once a fund exists and its constituents have their sources (done), a judge enters with one USDG transaction through the shared `ForwardCashQueue` (a singleton; not redeployed per fund):

1. `USDG.approve(ForwardCashQueue, cash)`
2. `ForwardCashQueue.requestCreate(cash)` → returns a ticket id (escrows USDG; settles at the next gated open NAV).
3. A settler (backend bot) calls `ForwardCashQueue.settle(ids, heldTokens, payloads, ap)` where:
   - `heldTokens` = the vault's held token set,
   - `payloads[i]` = the keeper payloads for `heldTokens[i]` (array-of-arrays; fetch all from `/reports`),
   - `ap` = `MockAPFiller`.
   Settle runs gates g0–g8 (bootstrapped, sources registered per held token, market open, safe band, TWAP band, peg band) and mints shares to the ticket owner at the open NAV.

For settle to pass, every `heldToken` must have its 2 sources registered (done for the 200) and fresh payloads supplied. Keep the keeper running and the settler feeding `/reports`.

**One-time gate-param check (ops):** `ForwardCashQueue` is global; verify `setG1Refs(aggregator, l2RouterSource)` points at PriceAggregator `0x77b0…` and the bands (`setGateParams`) are sane before the live demo. Read current values first; do not clobber working config.

---

## 7. Red lines / honesty

- Prices are committee-signed **synthetic/sandbox** values; in prod this is neutral on-chain validation of independent signed feeds, not a price from one backend. No live-Chainlink / real-price claim (no Streams key).
- The keeper only signs and relays — it never custodies funds and never moves value.
- `Stock.faucetMint` is capped (100e18/address); the role-gated `mint` is deployer-only.
- The flat create fee / flow fee stays 0 — the platform never take-rates transaction/flow volume.
