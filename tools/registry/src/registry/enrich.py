"""Stage 02 — enrich tickers with yfinance (sector, industry, market cap, ...).

Each ticker's raw result is cached to cache/yf/<TICKER>.json so reruns are free
and partial runs resume. Negative results are cached too (with ok=false) to avoid
re-hitting yfinance for known-missing tickers; delete the cache file to retry one,
or run with force=True to refresh all.
"""
import json
import os
import time

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "cache", "yf")

# fields we keep out of yfinance's large .info dict
_KEEP = {
    "quoteType": "quote_type",
    "sector": "sector",
    "industry": "industry",
    "marketCap": "market_cap",
    "longBusinessSummary": "summary",
}


def _cache_path(ticker):
    safe = ticker.replace("/", "_").replace(".", "_")
    return os.path.join(CACHE_DIR, f"{safe}.json")


def load_cached(ticker):
    p = _cache_path(ticker)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return None


def _save(ticker, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(_cache_path(ticker), "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def _normalize(ticker, info):
    rec = {"ticker": ticker, "ok": True, "error": None}
    for src, dst in _KEEP.items():
        rec[dst] = info.get(src)
    rec["long_name"] = info.get("longName") or info.get("shortName")
    rec["exchange"] = info.get("fullExchangeName") or info.get("exchange")
    return rec


def fetch_one(ticker, retries=2, pause=0.4):
    """Fetch one ticker from yfinance. Returns a normalized record (ok True/False)."""
    import yfinance as yf

    last_err = None
    for attempt in range(retries + 1):
        try:
            info = yf.Ticker(ticker).get_info() or {}
            # yfinance returns a near-empty dict for unknown symbols
            if not info or (info.get("quoteType") is None and info.get("marketCap") is None
                            and info.get("sector") is None and info.get("longName") is None):
                return {"ticker": ticker, "ok": False, "error": "not_found"}
            return _normalize(ticker, info)
        except Exception as e:  # network / parse / rate-limit
            last_err = str(e)
            if attempt < retries:
                time.sleep(pause * (attempt + 1) * 3)
    return {"ticker": ticker, "ok": False, "error": last_err or "unknown"}


def enrich_tickers(tickers, force=False, pause=0.3, progress_every=50, remap=None):
    """Enrich a list of tickers, using/refreshing the disk cache. Returns {ticker: record}.

    `remap` maps a ticker to the symbol yfinance actually knows it by (e.g.
    BRK.B -> BRK-B). The result is still keyed by the original ticker. A remapped
    ticker whose cache is a failure is refetched (the remap may fix it).
    """
    remap = remap or {}
    out = {}
    total = len(tickers)
    fetched = 0
    for i, t in enumerate(tickers, 1):
        cached = None if force else load_cached(t)
        stale_remap = t in remap and cached is not None and not cached.get("ok")
        if cached is not None and not stale_remap:
            out[t] = cached
            continue
        rec = fetch_one(remap.get(t, t))
        rec["ticker"] = t  # key by original ticker even when fetched via remap symbol
        _save(t, rec)
        out[t] = rec
        fetched += 1
        time.sleep(pause)
        if progress_every and i % progress_every == 0:
            ok = sum(1 for r in out.values() if r.get("ok"))
            print(f"  [{i}/{total}] fetched={fetched} ok={ok}", flush=True)
    return out
