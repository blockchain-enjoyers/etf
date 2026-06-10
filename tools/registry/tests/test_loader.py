import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from registry.loader import load_dune_table, provisional_asset_class, base_record, CHAIN_ID


def test_load_dune_table_columns_to_dicts():
    payload = {
        "data": {"stocks": {
            "columns": ["contract_address", "ticker", "name", "tokenization_date",
                        "usd_outstanding", "stocks_tokenized", "stocks_tokenized_7d_change_pct",
                        "usd_stock_price"],
            "types": ["string"] * 4 + ["number"] * 4,
            "rows": [
                ["0x1ae6c59c3482a91e1527ea482b0e380e0ece6848", "NVDA", "NVIDIA",
                 "2025-06-30", 1000.0, 50.0, 1.2, 20.0],
            ],
        }}
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f); path = f.name
    rows = load_dune_table(path)
    assert len(rows) == 1
    assert rows[0]["ticker"] == "NVDA"
    assert rows[0]["usd_outstanding"] == 1000.0


def test_provisional_asset_class():
    assert provisional_asset_class("NVIDIA Corporation") == "stock"
    assert provisional_asset_class("Invesco QQQ Trust ETF") == "etf"
    assert provisional_asset_class("YieldMax MSTR Option Income Strategy ETF") == "etf"
    # ETF wins even when 'treasury' appears
    assert provisional_asset_class("iShares 20+ Year Treasury Bond ETF") == "etf"
    assert provisional_asset_class("US Treasury 2Y Note") == "treasury"
    assert provisional_asset_class("SPDR Gold Trust") == "commodity"
    assert provisional_asset_class("SPDR Gold Shares") == "commodity"
    assert provisional_asset_class("Alphabet Class A") == "stock"
    # regressions: substring 'etf' inside Netflix, bare 'Trust' in a bank name
    assert provisional_asset_class("Netflix") == "stock"
    assert provisional_asset_class("Northern Trust") == "stock"
    assert provisional_asset_class("State Street SPDR Portfolio S&P 500 ETF") == "etf"


def test_base_record_normalizes():
    row = {"contract_address": "0x1ae6c59c3482a91e1527ea482b0e380e0ece6848",
           "ticker": "NVDA", "name": "NVIDIA", "tokenization_date": "2025-06-30",
           "usd_outstanding": 1000.0, "stocks_tokenized": 50.0,
           "stocks_tokenized_7d_change_pct": 1.2, "usd_stock_price": 20.0}
    rec = base_record(row)
    # EIP-55 checksum applied
    assert rec["address"] == "0x1Ae6c59C3482A91e1527ea482b0E380E0ECe6848"
    assert rec["chain_id"] == CHAIN_ID == 42161
    assert rec["ticker"] == "NVDA"
    assert rec["asset_class"] == "stock"
    assert rec["tradable"] is True
    assert rec["onchain"]["aum_usd"] == 1000.0
    assert rec["onchain"]["total_supply"] == "50.0"


def test_base_record_zero_supply_not_tradable():
    row = {"contract_address": "0x1ae6c59c3482a91e1527ea482b0e380e0ece6848",
           "ticker": "DEAD", "name": "Dead Co", "tokenization_date": "2025-06-30",
           "usd_outstanding": 0.0, "stocks_tokenized": 0.0,
           "stocks_tokenized_7d_change_pct": None, "usd_stock_price": 0.0}
    rec = base_record(row)
    assert rec["tradable"] is False
