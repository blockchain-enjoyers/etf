"""Stage 01 — parse the Dune/growthepie export into normalized base records.

No network. Pure transformation of the supplied snapshot
(tools/registry/input/stocksTable.json). The on-chain extraction the original
ТЗ described (deployer txlist → factory → Multicall3) is already captured by
this snapshot, so this stage only normalizes and derives cheap local fields.
"""
import json
import re

from eth_utils import to_checksum_address

CHAIN_ID = 42161  # Arbitrum One
DECIMALS = 18  # Robinhood Stock Tokens are 18-decimal ERC-20s (constant; not in snapshot)

# "ETF"/"ETN" as a capitalized whole word — real fund names capitalize it
# ("...S&P 500 ETF"), so this avoids false hits like the 'etf' inside "Netflix".
_ETF_TOKEN = re.compile(r"\b(ETF|ETN)\b")
# name keywords -> commodity (closed-end trusts / share classes that are not ETFs)
_COMMODITY_WORDS = ("gold", "silver", "platinum", "palladium", "crude oil", "natural gas")


def load_dune_table(path):
    """Read a Dune-style {data.stocks.{columns,rows}} export into a list of dicts."""
    with open(path) as f:
        payload = json.load(f)
    stocks = payload["data"]["stocks"]
    cols = stocks["columns"]
    return [dict(zip(cols, row)) for row in stocks["rows"]]


def provisional_asset_class(name):
    """First-pass asset class from the token name. Refined later by yfinance quoteType.

    Order matters: an explicit 'ETF' token wins over 'treasury' (e.g. a Treasury
    Bond ETF is an ETF, not a bare treasury). Bare 'Trust' is NOT treated as a
    fund here (too many real companies, e.g. "Northern Trust", carry it) — those
    funds are caught instead by yfinance quote_type in the classify stage.
    """
    if _ETF_TOKEN.search(name):
        return "etf"
    nl = name.lower()
    if "treasury" in nl or "t-bill" in nl or "tbill" in nl:
        return "treasury"
    if any(w in nl for w in _COMMODITY_WORDS) and (
            "trust" in nl or "fund" in nl or "shares" in nl):
        return "commodity"
    return "stock"


def base_record(row):
    """Normalize one Dune row into the base shape consumed by later stages."""
    supply = row.get("stocks_tokenized") or 0.0
    return {
        "ticker": row["ticker"],
        "name": row["name"],
        "address": to_checksum_address(row["contract_address"]),
        "chain_id": CHAIN_ID,
        "decimals": DECIMALS,
        "deployed_at": row.get("tokenization_date"),
        "asset_class": provisional_asset_class(row["name"]),
        "tradable": supply > 0,
        "onchain": {
            "aum_usd": row.get("usd_outstanding"),
            "total_supply": str(supply),
            "usd_stock_price": row.get("usd_stock_price"),
            "change_7d_pct": row.get("stocks_tokenized_7d_change_pct"),
            "cumulative_mint_usd": None,
        },
    }


def load_base(path):
    """Full stage-01: snapshot path -> list of normalized base records."""
    return [base_record(r) for r in load_dune_table(path)]
