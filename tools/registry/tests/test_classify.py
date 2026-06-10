import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from registry.taxonomy import map_gics, is_crypto, etf_category
from registry.classify import classify


def _base(ticker, name, ac="stock"):
    return {"ticker": ticker, "name": name, "address": "0xabc", "chain_id": 42161,
            "decimals": 18, "deployed_at": "2025-06-30", "asset_class": ac,
            "tradable": True, "onchain": {}}


def _enr(ok=True, quote_type="EQUITY", sector=None, industry=None, market_cap=None,
         summary=None, long_name=None, exchange=None):
    return {"ticker": "X", "ok": ok, "quote_type": quote_type, "sector": sector,
            "industry": industry, "market_cap": market_cap, "summary": summary,
            "long_name": long_name, "exchange": exchange}


# --- taxonomy units ---
def test_map_gics():
    assert map_gics("Technology") == "Technology"
    assert map_gics("Healthcare") == "Healthcare"
    assert map_gics("Financial Services") == "Financials"
    assert map_gics("Communication Services") == "Communication Services"
    assert map_gics(None) is None
    assert map_gics("Nonsense") is None


def test_is_crypto():
    assert is_crypto("MSTR", "Strategy Inc") is True
    assert is_crypto("COIN", "Coinbase Global") is True
    assert is_crypto("BMNR", "BitMine Immersion Technologies") is True  # name keyword
    assert is_crypto("AAPL", "Apple Inc.") is False


def test_etf_category():
    assert etf_category("Invesco QQQ Trust") == "broad_index"
    assert etf_category("Defiance Daily Target 2X Long HIMS ETF") == "leveraged"
    assert etf_category("YieldMax MSTR Option Income Strategy ETF") == "income"
    assert etf_category("iShares 20+ Year Treasury Bond ETF") == "bond"
    assert etf_category("SPDR Gold Shares") == "commodity"
    assert etf_category("Some Random Sector Fund") == "sector"


# --- classify integration ---
def test_classify_stock_tech():
    r = classify(_base("NVDA", "NVIDIA Corporation"),
                 _enr(sector="Technology", industry="Semiconductors",
                      market_cap=4_000_000, long_name="NVIDIA Corporation"))
    assert r["asset_class"] == "stock"
    assert r["sector"] == "Technology"
    assert r["industry"] == "Semiconductors"
    assert r["underlying"]["market_cap_usd"] == 4_000_000
    assert r["classified_by"] == "auto"


def test_classify_crypto_override_beats_gics():
    # MSTR reports Technology but must land in crypto sector
    r = classify(_base("MSTR", "Strategy Inc"), _enr(sector="Technology"))
    assert r["sector"] == "Crypto & Blockchain"


def test_classify_etf_quotetype_wins():
    r = classify(_base("QQQ", "Invesco QQQ Trust", ac="etf"),
                 _enr(quote_type="ETF"))
    assert r["asset_class"] == "etf"
    assert r["sector"] is None
    assert r["etf_category"] == "broad_index"


def test_classify_income_etf():
    r = classify(_base("MSTY", "YieldMax MSTR Option Income Strategy ETF", ac="etf"),
                 _enr(quote_type="ETF"))
    assert r["etf_category"] == "income"


def test_classify_treasury_is_bond():
    r = classify(_base("UST2Y", "US Treasury 2Y Note", ac="treasury"),
                 _enr(ok=False, quote_type=None))
    assert r["asset_class"] == "treasury"
    assert r["etf_category"] == "bond"


def test_classify_unresolved_stock():
    # EQUITY but no sector and not crypto -> unresolved
    r = classify(_base("BRKB", "Berkshire Hathaway"), _enr(quote_type="EQUITY"))
    assert r["sector"] is None
    assert r["classified_by"] == "unresolved"


def test_classify_override_forces_sector():
    r = classify(_base("BRKB", "Berkshire Hathaway"), _enr(quote_type="EQUITY"),
                 override={"sector": "Financials"})
    assert r["sector"] == "Financials"
    assert r["classified_by"] == "override"
