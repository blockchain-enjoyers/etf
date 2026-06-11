#!/usr/bin/env python
"""Generate suggested-fund templates (pre-filled baskets) from the registry.

Reads out/registry.json (the classified universe) and emits out/suggested_funds.json:
for each suggested fund -> constituents + target weights + the recommended vault
type. This is the "1-click create" pre-fill for the basket-constructor UI.

Methodology (kept here on purpose, per request):
  - Selection: explicit tickers (curated), or top-N by market cap within a
    sector / industry / the whole universe.
  - Weighting: 'cap' = market-cap weighted with a per-name cap + redistribution
    (so one mega-cap doesn't dominate a small basket); 'equal' = 1/N.
  - Vault: chosen from (weighting, N) — see registry/funds.recommend_vault and
    docs/guides/contracts-reference.md.

Usage: .venv/bin/python src/build_funds.py
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from registry.funds import cap_weights, equal_weights, to_pct, recommend_vault
from registry.taxonomy import SECTORS

ROOT = os.path.join(os.path.dirname(__file__), "..")
REGISTRY = os.path.join(ROOT, "out", "registry.json")
OUT = os.path.join(ROOT, "out", "suggested_funds.json")

# Sectors we don't auto-generate a "Top 15" fund for (thin or already curated).
_SKIP_SECTOR_FUNDS = {"Crypto & Blockchain", "Real Estate"}
_SECTOR_TOP_N = 15

# Curated funds. select: by "tickers" | "sector" | "industry" (+ "top"); weighting:
# "cap" | "equal"; max_weight caps any single name (cap-weighted only).
CURATED = [
    {"id": "mag7", "name": "Magnificent 7",
     "description": "The seven mega-cap US tech leaders driving market returns.",
     "theme": "mega-cap tech", "weighting": "cap", "max_weight": 0.25,
     "select": {"tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]}},
    {"id": "ai-semis", "name": "AI & Semiconductors",
     "description": "Chipmakers and semiconductor-equipment names powering the AI buildout.",
     "theme": "AI / chips", "weighting": "cap", "max_weight": 0.25,
     "select": {"industry": ["Semiconductors", "Semiconductor Equipment & Materials"],
                "top": 15}},
    {"id": "crypto-blockchain", "name": "Crypto & Blockchain Leaders",
     "description": "Listed crypto exchanges, miners and bitcoin-treasury companies.",
     "theme": "crypto equities", "weighting": "cap", "max_weight": 0.25,
     "select": {"sector": "Crypto & Blockchain", "top": 12}},
    {"id": "mega-cap-20", "name": "Mega-Cap 20",
     "description": "The 20 largest US companies by market capitalization, across sectors.",
     "theme": "blue chips", "weighting": "cap", "max_weight": 0.15,
     "select": {"all": True, "top": 20}},
    {"id": "ew-tech-20", "name": "Equal-Weight Tech 20",
     "description": "Top 20 technology names held at equal weight (rebalanced to 1/N).",
     "theme": "tech, equal weight", "weighting": "equal",
     "select": {"sector": "Technology", "top": 20}},
]


def _stocks(registry):
    """Classified stocks that have a market cap (the weightable universe)."""
    return [t for t in registry["tokens"]
            if t["asset_class"] == "stock" and t["underlying"].get("market_cap_usd")]


def _select(sel, stocks):
    by_ticker = {t["ticker"]: t for t in stocks}
    if "tickers" in sel:
        return [by_ticker[t] for t in sel["tickers"] if t in by_ticker]
    pool = stocks
    if "sector" in sel:
        pool = [t for t in pool if t["sector"] == sel["sector"]]
    if "industry" in sel:
        inds = sel["industry"] if isinstance(sel["industry"], list) else [sel["industry"]]
        pool = [t for t in pool if t.get("industry") in inds]
    pool = sorted(pool, key=lambda t: -t["underlying"]["market_cap_usd"])
    top = sel.get("top")
    return pool[:top] if top else pool


def build_fund(spec, stocks):
    picked = _select(spec["select"], stocks)
    if not picked:
        return None
    mcaps = [t["underlying"]["market_cap_usd"] for t in picked]
    if spec["weighting"] == "equal":
        fracs = equal_weights(len(picked))
    else:
        fracs = cap_weights(mcaps, max_weight=spec.get("max_weight", 0.30))
    pct = to_pct(fracs)

    vault_type, level, rationale = recommend_vault(spec["weighting"], len(picked))
    constituents = [{
        "ticker": t["ticker"],
        "name": t["name"],
        "sector": t["sector"],
        "weight_pct": p,
        "address": t["deployments"][0]["address"],
        "market_cap_usd": t["underlying"]["market_cap_usd"],
    } for t, p in zip(picked, pct)]

    return {
        "id": spec["id"],
        "name": spec["name"],
        "description": spec["description"],
        "theme": spec.get("theme"),
        "weighting": spec["weighting"],
        "max_weight_pct": None if spec["weighting"] == "equal"
        else round(spec.get("max_weight", 0.30) * 100, 2),
        "constituent_count": len(constituents),
        "vault": {
            "type": vault_type,
            "level": level,
            "rationale": rationale,
            "cash_entry": "Wrap with ForwardCashQueue (L5) for forward-priced cash "
                          "create/redeem; in-kind create/redeem works without it.",
        },
        "constituents": constituents,
    }


def sector_specs(stocks):
    """Auto-generate a cap-weighted 'Top 15 <Sector>' fund per (non-skipped) sector."""
    specs = []
    for sector in SECTORS:
        if sector in _SKIP_SECTOR_FUNDS:
            continue
        if sum(1 for t in stocks if t["sector"] == sector) < 5:
            continue
        sid = sector.lower().replace(" & ", "-").replace(" ", "-")
        specs.append({
            "id": f"sector-{sid}",
            "name": f"Top {_SECTOR_TOP_N} {sector}",
            "description": f"The {_SECTOR_TOP_N} largest {sector} names by market cap, "
                           f"cap-weighted.",
            "theme": f"sector: {sector}", "weighting": "cap", "max_weight": 0.30,
            "select": {"sector": sector, "top": _SECTOR_TOP_N},
        })
    return specs


def main():
    with open(REGISTRY) as f:
        registry = json.load(f)
    stocks = _stocks(registry)

    specs = CURATED + sector_specs(stocks)
    funds = [f for f in (build_fund(s, stocks) for s in specs) if f]

    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = {
        "schema_version": "1.0",
        "generated_at": generated_at,
        "source_registry": "out/registry.json",
        "weighting_note": "cap = market-cap weighted with per-name cap + "
                          "redistribution; equal = 1/N. Weights are the canonical "
                          "pre-fill; on-chain unitQty is derived at create time from "
                          "live prices.",
        "fund_count": len(funds),
        "funds": funds,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(funds)} suggested funds")
    for fund in funds:
        print(f"  {fund['id']:28} {fund['constituent_count']:3} names  "
              f"-> {fund['vault']['type']}")


if __name__ == "__main__":
    main()
