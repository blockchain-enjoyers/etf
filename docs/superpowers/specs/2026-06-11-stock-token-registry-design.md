# Stock Token Registry — Design

**Date:** 2026-06-11 · **Status:** approved, in build
**Source ТЗ:** "Реестр токенизированных акций Robinhood (Arbitrum One) → классифицированный JSON" v1.0 (2026-06-10)

## Goal

Turn the canonical list of Robinhood Stock Tokens into a classified JSON registry that backs an
ETF-basket constructor UI ("pick the top-100 tech / health names in one click").

## What changed from the ТЗ

The ТЗ's heavy on-chain extraction pipeline (Etherscan deployer txlist → factory verification →
Multicall3 metadata → Dune cross-check) is **already done**: the user supplied
`stocksTable.json` (1998 rows, growthepie/Dune export). It carries `contract_address, ticker,
name, tokenization_date, usd_outstanding (AUM), stocks_tokenized (supply), 7d_change,
usd_stock_price`. So ТЗ steps 1, 2, 6 and the §7 "multiple deployers / factory" risk are
**resolved by data**, not code. Count 1998 ≈ Dune → acceptance criterion #1 satisfied.

We only build the missing half: **classification + enrichment + schema assembly**.

## Data profile (measured)

- 1998 rows, **0 duplicate tickers** (clean 1:1 ticker→contract; `deployments[]` stays an array for future RHC migration).
- asset_class by name heuristic: ~1479 stock, ~505 etf (~26%, matches ТЗ ~24%), ~4 treasury.
- 1490/1998 have supply>0 → that is the `tradable` set; ~508 are the empty tail.
- 4 junk tickers (`470CNT015`, `436CVR021`, `037CVR016`, `Chemours`) → handled via overrides.
- Total on-chain AUM ≈ $109M.

## Stack & location

`tools/registry/` — standalone Python (own `.venv`), outside the TS workspaces. yfinance for
enrichment (free, no key; gives sector+industry+marketCap+summary in one call). Source can be
swapped later (different exporter / direct on-chain) without schema change.

## Pipeline (4 stages, each with a build/ artifact so reruns are cheap & debuggable)

1. **01_load** — parse Dune columns/rows → normalized records. Checksum addresses
   (criterion #2/#5). Derive `asset_class` from name (etf/treasury/stock), `tradable = supply>0`,
   `chain_id=42161`. No network. → `build/01_base.json`.
2. **02_enrich** — per unique ticker, yfinance `.info` → sector, industry, marketCap, exchange,
   quoteType, longBusinessSummary. Disk cache `cache/yf/<TICKER>.json` (reruns free), retry+sleep.
   Unresolved tickers recorded. → `build/02_enriched.json`.
3. **03_classify** — map GICS sector → our 12-sector enum (§4); crypto override list
   (MSTR/COIN/miners); ETF → `etf_category` from name keywords; light `tags` from industry;
   apply `overrides/ticker_overrides.json`. Unmapped → `out/unclassified_review.csv`
   (criterion #3, target ≥97% auto). → `build/03_classified.json`.
4. **04_build** — assemble §5 schema (nested `deployments[]/underlying{}/onchain{}`, `source`
   block with verification counts, `sectors` list). Validate: checksummed addresses, no dup
   `(ticker, chain_id)`, required fields. → `out/registry.json`.

`run.py` runs 01→04. README documents venv setup, run, cron (criterion #6), source swap.

## Taxonomy (§4)

12 `sector` enum (GICS English labels): Technology · Healthcare · Financials · Consumer Staples ·
Consumer Discretionary · Industrials · Energy · Materials · Real Estate · Communication Services ·
Utilities · Crypto & Blockchain. ETFs classified by `etf_category`
∈ {broad_index, sector, leveraged, inverse, income, bond, commodity, crypto}. Top-100-by-sector
sort uses `underlying.market_cap_usd` (real company cap, from yfinance).

## YAGNI for v1 (deliberate cuts)

- `description`: store truncated EN `longBusinessSummary`; RU LLM-translation deferred to v1.1.
- `isin` / `cik`: nullable, no SEC/FMP call in v1 (not needed for baskets).
- `tags`: minimal heuristic, no dedicated LLM pass.
- `cumulative_mint_usd`: null (current AUM suffices for liquidity flag).

## Acceptance mapping

#1 count=1998 ✓ · #2 addr/symbol from on-chain-origin snapshot ✓ · #3 ≥97% auto (measured at run) ·
#4 sort by market_cap (AAPL/MSFT/NVDA top) · #5 schema valid, no dups · #6 README + run.py.

## Testing

TDD the pure logic: asset_class derivation, address checksum, GICS→enum mapping, etf_category
detection, schema validation + dedup. yfinance network I/O is glue (cached), not unit-tested.
