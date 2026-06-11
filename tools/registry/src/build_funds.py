#!/usr/bin/env python
"""Build suggested-fund templates by replicating REAL, popular ETFs.

Pulls each target ETF's published holdings (constituents + weights) from the
issuer file (SPDR xlsx / ARK csv — see registry/etf_holdings.py), intersects them
with our tokenized-stock registry, renormalizes weights across the matched
(tokenizable) subset, and picks a vault type. Output: out/suggested_funds.json.

We never redistribute the raw issuer file; we surface only the derived weights we
computed against our own registry, plus a coverage % (how much of the source ETF
we can actually replicate). See research/results/Q8.md and the licensing note there.

Target catalog + ETF->theme metadata is the TARGETS table below.

Usage: .venv/bin/python src/build_funds.py [--force]
"""
import argparse
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from registry.etf_holdings import get_holdings, match_holdings, normalize_ticker
from registry.funds import recommend_vault

ROOT = os.path.join(os.path.dirname(__file__), "..")
REGISTRY = os.path.join(ROOT, "out", "registry.json")
OUT = os.path.join(ROOT, "out", "suggested_funds.json")

MIN_COVERAGE = 70.0  # below this the replicated basket no longer faithfully tracks (Q8)

# Real ETFs we replicate. issuer in {spdr, ark}; ark_file is the CSV filename.
TARGETS = [
    # broad market
    {"id": "sp500", "ticker": "SPY", "issuer": "spdr",
     "name": "S&P 500", "theme": "broad market", "weighting": "cap-weighted S&P 500",
     "description": "The 500 large-cap US companies in the S&P 500 (SPY)."},
    {"id": "dow30", "ticker": "DIA", "issuer": "spdr",
     "name": "Dow Jones 30", "theme": "broad market", "weighting": "price-weighted Dow 30",
     "description": "The 30 blue-chip US companies in the Dow Jones Industrial Average (DIA)."},
    # 11 GICS sectors — SPDR Select Sector flagships (cap-weighted within sector)
    {"id": "sector-technology", "ticker": "XLK", "issuer": "spdr",
     "name": "Technology", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Technology sector (XLK)."},
    {"id": "sector-health-care", "ticker": "XLV", "issuer": "spdr",
     "name": "Health Care", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Health Care sector (XLV)."},
    {"id": "sector-financials", "ticker": "XLF", "issuer": "spdr",
     "name": "Financials", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Financials sector (XLF)."},
    {"id": "sector-energy", "ticker": "XLE", "issuer": "spdr",
     "name": "Energy", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Energy sector (XLE)."},
    {"id": "sector-industrials", "ticker": "XLI", "issuer": "spdr",
     "name": "Industrials", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Industrials sector (XLI)."},
    {"id": "sector-consumer-discretionary", "ticker": "XLY", "issuer": "spdr",
     "name": "Consumer Discretionary", "theme": "sector",
     "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Consumer Discretionary sector (XLY)."},
    {"id": "sector-consumer-staples", "ticker": "XLP", "issuer": "spdr",
     "name": "Consumer Staples", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Consumer Staples sector (XLP)."},
    {"id": "sector-utilities", "ticker": "XLU", "issuer": "spdr",
     "name": "Utilities", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Utilities sector (XLU)."},
    {"id": "sector-materials", "ticker": "XLB", "issuer": "spdr",
     "name": "Materials", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Materials sector (XLB)."},
    {"id": "sector-real-estate", "ticker": "XLRE", "issuer": "spdr",
     "name": "Real Estate", "theme": "sector", "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Real Estate sector (XLRE)."},
    {"id": "sector-communication-services", "ticker": "XLC", "issuer": "spdr",
     "name": "Communication Services", "theme": "sector",
     "weighting": "cap-weighted S&P sector",
     "description": "S&P 500 Communication Services sector (XLC)."},
    # thematic-growth — ARK active funds (we replicate the published weights as a snapshot)
    {"id": "innovation", "ticker": "ARKK", "issuer": "ark",
     "ark_file": "ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv",
     "name": "Disruptive Innovation", "theme": "thematic / innovation", "weighting": "active",
     "description": "ARK's flagship disruptive-innovation basket (ARKK)."},
    {"id": "next-gen-internet", "ticker": "ARKW", "issuer": "ark",
     "ark_file": "ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS.csv",
     "name": "Next-Generation Internet", "theme": "thematic / web3 + AI",
     "weighting": "active",
     "description": "Cloud, AI, fintech and crypto-adjacent internet names (ARKW)."},
    {"id": "genomics", "ticker": "ARKG", "issuer": "ark",
     "ark_file": "ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS.csv",
     "name": "Genomics & Biotech", "theme": "thematic / genomics", "weighting": "active",
     "description": "Gene editing, diagnostics and next-gen biotech (ARKG)."},
    {"id": "fintech", "ticker": "ARKF", "issuer": "ark",
     "ark_file": "ARK_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS.csv",
     "name": "Fintech & Blockchain", "theme": "thematic / fintech", "weighting": "active",
     "description": "Digital payments, fintech and blockchain enablers (ARKF)."},
    {"id": "space-defense", "ticker": "ARKX", "issuer": "ark",
     "ark_file": "ARK_SPACE_EXPLORATION_&_INNOVATION_ETF_ARKX_HOLDINGS.csv",
     "name": "Space & Defense", "theme": "thematic / space", "weighting": "active",
     "description": "Space exploration, aerospace and defense innovation (ARKX)."},
]


def _registry_index(registry):
    """ticker (normalized) -> token, over the whole registry."""
    return {normalize_ticker(t["ticker"]): t for t in registry["tokens"]}


def build_fund(target, reg_index, force=False):
    holdings = get_holdings(target, force=force)
    matched, coverage = match_holdings(holdings, reg_index)
    if not matched:
        return None

    constituents = []
    for m in matched:
        tok = reg_index[normalize_ticker(m["ticker"])]
        constituents.append({
            "ticker": tok["ticker"],
            "name": tok["name"],
            "sector": tok["sector"],
            "weight_pct": m["weight_pct"],
            "address": tok["deployments"][0]["address"],
            "market_cap_usd": tok["underlying"].get("market_cap_usd"),
        })
    constituents.sort(key=lambda c: -c["weight_pct"])

    vault_type, level, rationale = recommend_vault(target["weighting"], len(constituents))
    return {
        "id": target["id"],
        "name": target["name"],
        "description": target["description"],
        "theme": target["theme"],
        "source_etf": {
            "ticker": target["ticker"],
            "issuer": target["issuer"],
            "weighting": target["weighting"],
            "source_holdings": len(holdings),
        },
        "coverage_pct": coverage,
        "coverage_warning": coverage < MIN_COVERAGE,
        "constituent_count": len(constituents),
        "vault": {
            "type": vault_type, "level": level, "rationale": rationale,
            "cash_entry": "Wrap with ForwardCashQueue (L5) for forward-priced cash "
                          "create/redeem; in-kind create/redeem works without it.",
        },
        "constituents": constituents,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="ignore holdings cache, refetch")
    args = ap.parse_args()

    with open(REGISTRY) as f:
        registry = json.load(f)
    reg_index = _registry_index(registry)

    built = []
    for t in TARGETS:
        try:
            fund = build_fund(t, reg_index, force=args.force)
        except Exception as e:
            print(f"  {t['ticker']:6} FAILED: {type(e).__name__}: {str(e)[:70]}")
            continue
        if fund:
            built.append(fund)
        time.sleep(0.3)

    # Faithful replicas only in the catalog; sub-threshold ones are recorded
    # transparently in `skipped` (Q8: de-list <70% coverage).
    funds = [f for f in built if not f["coverage_warning"]]
    skipped = [{"id": f["id"], "name": f["name"], "etf": f["source_etf"]["ticker"],
                "coverage_pct": f["coverage_pct"],
                "reason": f"coverage {f['coverage_pct']}% < {MIN_COVERAGE}% "
                          "(too few constituents tokenized on Robinhood)"}
               for f in built if f["coverage_warning"]]
    for f in funds:
        f.pop("coverage_warning", None)

    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = {
        "schema_version": "2.0",
        "generated_at": generated_at,
        "source_registry": "out/registry.json",
        "methodology": "Constituents + weights replicated from real ETFs (issuer "
                       "holdings files), intersected with our registry and renormalized "
                       "over the tokenizable subset. coverage_pct = matched source weight. "
                       "We surface derived weights only, never the raw issuer file.",
        "min_coverage_pct": MIN_COVERAGE,
        "fund_count": len(funds),
        "funds": funds,
        "skipped": skipped,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\nwrote {OUT}: {len(funds)} funds ({len(skipped)} skipped, low coverage)")
    for fund in funds:
        print(f"  {fund['source_etf']['ticker']:5} {fund['name']:26} "
              f"{fund['constituent_count']:3}/{fund['source_etf']['source_holdings']:<3} "
              f"cov={fund['coverage_pct']:5.1f}%  -> {fund['vault']['type']}")
    for s in skipped:
        print(f"  SKIP {s['etf']:5} {s['name']:26} cov={s['coverage_pct']:5.1f}%")


if __name__ == "__main__":
    main()
