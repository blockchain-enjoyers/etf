#!/usr/bin/env python
"""Orchestrate the registry pipeline: 01 load -> 02 enrich -> 03 classify -> 04 build.

Usage:
    .venv/bin/python src/run.py [--limit N] [--force-enrich] [--skip-enrich]

Outputs:
    build/01_base.json, build/02_enriched.json, build/03_classified.json
    out/registry.json, out/unclassified_review.csv
"""
import argparse
import csv
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from registry.loader import load_base
from registry.enrich import enrich_tickers, load_cached
from registry.classify import classify
from registry.build import assemble, validate

ROOT = os.path.join(os.path.dirname(__file__), "..")
INPUT = os.path.join(ROOT, "input", "stocksTable.json")
OVERRIDES = os.path.join(ROOT, "overrides", "ticker_overrides.json")
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "out")


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def load_overrides():
    if not os.path.exists(OVERRIDES):
        return {}
    with open(OVERRIDES) as f:
        raw = json.load(f)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="process only first N tokens (dev)")
    ap.add_argument("--force-enrich", action="store_true")
    ap.add_argument("--skip-enrich", action="store_true", help="use only cached enrichment")
    args = ap.parse_args()

    overrides = load_overrides()

    # ---- 01 load ----
    base = load_base(INPUT)
    if args.limit:
        base = base[:args.limit]
    _write(os.path.join(BUILD, "01_base.json"), base)
    print(f"01 load: {len(base)} base records")

    # ---- 02 enrich ----
    tickers = [r["ticker"] for r in base]
    remap = {t: o["yf_symbol"] for t, o in overrides.items() if o.get("yf_symbol")}
    if args.skip_enrich:
        enriched = {t: (load_cached(t) or {"ticker": t, "ok": False, "error": "no_cache"})
                    for t in tickers}
    else:
        enriched = enrich_tickers(tickers, force=args.force_enrich, pause=0.15, remap=remap)
    _write(os.path.join(BUILD, "02_enriched.json"), enriched)
    ok = sum(1 for r in enriched.values() if r.get("ok"))
    print(f"02 enrich: {ok}/{len(enriched)} resolved")

    # ---- 03 classify ----
    classified = []
    dropped = 0
    for rec in base:
        ov = overrides.get(rec["ticker"], {})
        if ov.get("drop"):
            dropped += 1
            continue
        classified.append(classify(rec, enriched.get(rec["ticker"]), override=ov))
    _write(os.path.join(BUILD, "03_classified.json"), classified)

    unresolved = [c for c in classified if c["classified_by"] == "unresolved"]
    auto = sum(1 for c in classified if c["classified_by"] in ("auto", "override"))
    pct = 100.0 * auto / len(classified) if classified else 0.0
    print(f"03 classify: {auto}/{len(classified)} classified ({pct:.1f}%), "
          f"{len(unresolved)} unresolved, {dropped} dropped")
    _write_review(unresolved, enriched)

    # ---- 04 build ----
    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    registry = assemble(classified, generated_at=generated_at, dune_count=len(base))
    validate(registry)
    _write(os.path.join(OUT, "registry.json"), registry)
    print(f"04 build: out/registry.json — {len(registry['tokens'])} tokens, schema valid")


def _write_review(unresolved, enriched):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "unclassified_review.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ticker", "name", "asset_class", "yf_ok", "yf_sector", "address"])
        for c in unresolved:
            e = enriched.get(c["ticker"], {})
            w.writerow([c["ticker"], c["name"], c["asset_class"],
                        e.get("ok"), e.get("sector"), c["address"]])
    print(f"   wrote {path} ({len(unresolved)} rows)")


if __name__ == "__main__":
    main()
