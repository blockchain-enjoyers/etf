# Stock Token Registry

Builds a classified JSON registry of Robinhood Stock Tokens (Arbitrum One) for the
ETF-basket constructor UI. Takes a Dune/growthepie snapshot of deployed tokens and adds
sector / asset-class / market-cap classification on top.

Design: `../../docs/superpowers/specs/2026-06-11-stock-token-registry-design.md`.

## Layout

```
input/stocksTable.json          source snapshot (Dune export: address, ticker, name, AUM, supply)
overrides/ticker_overrides.json  manual fixes (yf_symbol remap, forced sector/class, drop junk)
cache/yf/<TICKER>.json           per-ticker yfinance cache (gitignored; makes reruns free)
build/0{1,2,3}_*.json            intermediate stage artifacts (gitignored)
out/registry.json                FINAL registry (§5 schema)
out/unclassified_review.csv      tokens that need manual classification
out/suggested_funds.json         pre-filled fund templates (built from the registry)
src/registry/                    loader / enrich / classify / build / taxonomy / schema / funds
src/run.py                       orchestrator (01 -> 04)
src/build_funds.py               suggested-fund generator (reads out/registry.json)
tests/                           unit tests for the pure logic
```

## Setup (once)

```bash
cd tools/registry
python3 -m venv .venv
./.venv/bin/python -m pip install -U pip
./.venv/bin/python -m pip install yfinance jsonschema "eth-hash[pycryptodome]" eth-utils pytest
```

## Run

```bash
./.venv/bin/python src/run.py                 # full rebuild (uses yfinance cache)
./.venv/bin/python src/run.py --skip-enrich   # rebuild from cache only, no network
./.venv/bin/python src/run.py --limit 50      # dev: first 50 tokens
./.venv/bin/python src/run.py --force-enrich   # ignore cache, refetch every ticker
```

The first full enrichment hits yfinance once per unique ticker (~2000 calls, ~15-20 min,
sequential with a small pause). Results are cached, so every later run is fast. Output is
`out/registry.json`.

## Suggested funds (pre-filled basket templates)

```bash
./.venv/bin/python src/build_funds.py   # reads out/registry.json -> out/suggested_funds.json
```

Generates "1-click create" fund templates: curated themes (Magnificent 7, AI & Semiconductors,
Crypto & Blockchain, Mega-Cap 20, Equal-Weight Tech 20) + an auto "Top 15 <Sector>" per sector.
Each fund carries its constituents + target weights + the recommended vault type. Methodology
(weighting + vault choice) lives in `src/registry/funds.py`; the catalog in `src/build_funds.py`.
Field reference: `../../docs/guides/suggested-funds-fields-ru.md`.

## Tests

```bash
./.venv/bin/python -m pytest tests/ -q
```

Covers the pure logic: Dune parsing, asset-class heuristic, address checksum, GICS→sector
mapping, ETF categorization, schema assembly + dedup. yfinance network I/O is not unit-tested
(it is cached glue).

## Pipeline stages

1. **01 load** (`loader.py`) — parse the Dune columns/rows export, checksum addresses, derive
   provisional `asset_class` from the name, `tradable = supply > 0`, `chain_id = 42161`. No network.
2. **02 enrich** (`enrich.py`) — per unique ticker, yfinance `.info` → sector, industry,
   market cap, quote type, exchange, business summary. Disk-cached.
3. **03 classify** (`classify.py` + `taxonomy.py`) — map GICS sector → our 12-sector enum;
   crypto override list (MSTR/COIN/miners → крипто и блокчейн); ETFs → `etf_category` from name;
   apply `overrides/`. Anything unresolved → `out/unclassified_review.csv`.
4. **04 build** (`build.py` + `schema.py`) — assemble the §5 schema (nested
   `deployments[] / underlying{} / onchain{}`, `source` + `verification`, `sectors`), then
   JSON-Schema-validate and assert no duplicate `(ticker, chain_id)`.

## Overrides

Edit `overrides/ticker_overrides.json`. Per ticker, any of:

| field | effect |
|---|---|
| `yf_symbol` | symbol yfinance knows it by (class shares, e.g. `BRK.B` → `BRK-B`) |
| `sector` | force a §4 sector (for stocks yfinance can't resolve) |
| `asset_class` | force `stock` / `etf` / `treasury` / `commodity` |
| `etf_category` | force the ETF category |
| `crypto` | `true` → крипто и блокчейн |
| `drop` | `true` → exclude (junk / non-asset contracts) |

After editing, rerun with `--skip-enrich` (or `--force-enrich` if you added a `yf_symbol` that
needs a refetch).

## Refresh / cron

The token list grows in batches and market caps drift. Refresh weekly. To pick up newly
deployed tokens, replace `input/stocksTable.json` with a fresh export, then run `src/run.py`
(only new tickers hit the network; the rest come from cache). Example cron (Mondays 06:00):

```
0 6 * * 1  cd /path/to/tools/registry && ./.venv/bin/python src/run.py >> build/cron.log 2>&1
```

## Swapping the data source

The schema is chain-agnostic (`chain_id` + `deployments[]`). To migrate to Robinhood Chain,
or use a different exporter, only `loader.load_dune_table` needs to change (or add a second
deployment per token). The rest of the pipeline is source-independent.
```
