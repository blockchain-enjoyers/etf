import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from registry.build import assemble, validate, DEPLOYER


def _classified(ticker="NVDA", address="0x1Ae6c59C3482A91e1527ea482b0E380E0ECe6848",
                sector="Technology", ac="stock"):
    return {
        "ticker": ticker, "name": ticker, "long_name": "NVIDIA Corporation",
        "description": "GPU maker.", "address": address, "chain_id": 42161,
        "decimals": 18, "deployed_at": "2025-06-30", "asset_class": ac,
        "sector": sector, "industry": "Semiconductors", "etf_category": None,
        "tags": ["semiconductors"], "classified_by": "auto",
        "underlying": {"exchange": "NMS", "market_cap_usd": 4e12, "isin": None, "cik": None},
        "onchain": {"aum_usd": 1000.0, "total_supply": "50.0",
                    "cumulative_mint_usd": None},
        "tradable": True,
    }


def test_assemble_shape_and_validates():
    reg = assemble([_classified()], generated_at="2026-06-11T00:00:00Z", dune_count=1)
    assert reg["schema_version"] == "1.0"
    assert reg["source"]["chain_id"] == 42161
    assert reg["source"]["deployers"] == [DEPLOYER]
    assert reg["source"]["verification"] == {"dune_count": 1, "extracted_count": 1}
    tok = reg["tokens"][0]
    assert tok["deployments"][0]["address"] == _classified()["address"]
    assert tok["deployments"][0]["token_symbol"] == "NVDA"
    assert tok["underlying"]["market_cap_usd"] == 4e12
    assert tok["onchain"]["tradable"] is True
    validate(reg)  # raises if invalid


def test_dedup_same_ticker_merges_deployments():
    a = _classified(address="0x1Ae6c59C3482A91e1527ea482b0E380E0ECe6848")
    b = _classified(address="0x78A29E34CcdB8643C28Ee13D222a886Fb009Bf2f")
    reg = assemble([a, b], generated_at="t", dune_count=2)
    assert len(reg["tokens"]) == 1
    assert len(reg["tokens"][0]["deployments"]) == 2


def test_no_duplicate_ticker_chain_pairs():
    reg = assemble([_classified("AAPL"), _classified("MSFT")],
                   generated_at="t", dune_count=2)
    seen = set()
    for tok in reg["tokens"]:
        for d in tok["deployments"]:
            key = (tok["ticker"], d["chain_id"])
            assert key not in seen
            seen.add(key)


def test_etf_token_has_category_null_sector():
    etf = _classified("QQQ", sector=None, ac="etf")
    etf["etf_category"] = "broad_index"
    reg = assemble([etf], generated_at="t", dune_count=1)
    tok = reg["tokens"][0]
    assert tok["sector"] is None
    assert tok["etf_category"] == "broad_index"
    validate(reg)
