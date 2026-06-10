"""Stage 03 — classify each token into the §4 taxonomy.

Combines a base record (stage 01) with its yfinance enrichment (stage 02) and
optional manual overrides into a single classified record consumed by stage 04.
"""
from registry.taxonomy import (CRYPTO_SECTOR, etf_category, is_crypto, map_gics)

_NON_STOCK = {"etf", "treasury", "commodity"}


def _final_asset_class(base, enrich, override):
    if override and override.get("asset_class"):
        return override["asset_class"]
    qt = (enrich or {}).get("quote_type")
    if qt in ("ETF", "MUTUALFUND"):
        return "etf"
    if qt == "EQUITY":
        # yfinance occasionally mislabels an ETF as EQUITY (e.g. SPYM). The
        # name-derived 'etf' (a capitalized ETF token) overrides that; otherwise
        # an EQUITY quote means a real stock.
        return "etf" if base["asset_class"] == "etf" else "stock"
    return base["asset_class"]  # unresolved -> provisional (treasury / commodity / stock)


def _truncate(summary, limit=240):
    if not summary:
        return None
    s = summary.strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    dot = cut.rfind(". ")
    return (cut[:dot + 1] if dot > 80 else cut.rstrip() + "…")


def _tags(asset_class, sector, industry, etf_cat):
    tags = []
    if asset_class == "stock":
        if industry:
            tags.append(industry.lower())
        if sector == CRYPTO_SECTOR:
            tags.append("crypto")
    elif etf_cat:
        tags.append(etf_cat)
    return tags


def classify(base, enrich, override=None):
    enrich = enrich or {}
    rec = dict(base)
    override = override or {}

    asset_class = _final_asset_class(base, enrich, override)
    sector = override.get("sector")
    classified_by = "override" if sector else "auto"
    industry = None
    etf_cat = None

    if asset_class == "stock":
        industry = enrich.get("industry")
        if sector is None:
            if override.get("crypto") or is_crypto(base["ticker"], base["name"]):
                sector = CRYPTO_SECTOR
            else:
                sector = map_gics(enrich.get("sector"))
        if sector is None:
            classified_by = "unresolved"
    else:  # etf / treasury / commodity
        if override.get("etf_category"):
            etf_cat = override["etf_category"]
        elif asset_class == "treasury":
            etf_cat = "bond"
        elif asset_class == "commodity":
            etf_cat = "commodity"
        else:
            etf_cat = etf_category(base["name"])

    rec["asset_class"] = asset_class
    rec["sector"] = sector
    rec["industry"] = industry
    rec["etf_category"] = etf_cat
    rec["tags"] = _tags(asset_class, sector, industry, etf_cat)
    rec["classified_by"] = classified_by
    rec["long_name"] = enrich.get("long_name") or base["name"]
    rec["description"] = _truncate(enrich.get("summary"))
    rec["underlying"] = {
        "exchange": enrich.get("exchange"),
        "market_cap_usd": enrich.get("market_cap"),
        "isin": None,
        "cik": None,
    }
    return rec
