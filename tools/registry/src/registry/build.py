"""Stage 04 — assemble classified records into the final §5 registry + validate."""
import jsonschema

from registry.schema import REGISTRY_SCHEMA
from registry.taxonomy import SECTORS

DEPLOYER = "0xcBdF630A858E7D87B5b08d92968cA14cA0F8f556"  # Robinhood: Deployer
CHAIN = "arbitrum-one"
CHAIN_ID = 42161
SCHEMA_VERSION = "1.0"


def _deployment(rec):
    return {
        "chain_id": rec["chain_id"],
        "address": rec["address"],
        "token_name": None,                 # not in snapshot (needs RPC name())
        "token_symbol": rec["ticker"],      # Dune symbol == on-chain symbol()
        "decimals": rec.get("decimals"),
        "deployed_at": rec.get("deployed_at"),
        "deploy_tx": None,                  # not in snapshot
    }


def _token(rec):
    onchain = rec.get("onchain", {})
    return {
        "ticker": rec["ticker"],
        "name": rec.get("long_name") or rec["name"],
        "description": rec.get("description"),
        "asset_class": rec["asset_class"],
        "sector": rec.get("sector"),
        "industry": rec.get("industry"),
        "etf_category": rec.get("etf_category"),
        "tags": rec.get("tags", []),
        "classified_by": rec.get("classified_by", "auto"),
        "deployments": [_deployment(rec)],
        "underlying": {
            "exchange": rec.get("underlying", {}).get("exchange"),
            "isin": rec.get("underlying", {}).get("isin"),
            "market_cap_usd": rec.get("underlying", {}).get("market_cap_usd"),
            "cik": rec.get("underlying", {}).get("cik"),
        },
        "onchain": {
            "tradable": bool(rec.get("tradable")),
            "total_supply": onchain.get("total_supply"),
            "aum_usd": onchain.get("aum_usd"),
            "cumulative_mint_usd": onchain.get("cumulative_mint_usd"),
        },
    }


def assemble(classified, generated_at, dune_count=None):
    """Build the registry dict from classified records, merging same-ticker rows."""
    by_ticker = {}
    order = []
    for rec in classified:
        t = rec["ticker"]
        if t not in by_ticker:
            by_ticker[t] = _token(rec)
            order.append(t)
        else:  # same underlying, additional contract/chain -> extra deployment
            by_ticker[t]["deployments"].append(_deployment(rec))

    tokens = [by_ticker[t] for t in order]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": {
            "chain": CHAIN,
            "chain_id": CHAIN_ID,
            "deployers": [DEPLOYER],
            "verification": {
                "dune_count": dune_count,
                "extracted_count": len(tokens),
            },
        },
        "sectors": SECTORS,
        "tokens": tokens,
    }


def validate(registry):
    """Schema-validate + assert no duplicate (ticker, chain_id) pairs. Raises on failure."""
    jsonschema.validate(registry, REGISTRY_SCHEMA)
    seen = set()
    for tok in registry["tokens"]:
        for d in tok["deployments"]:
            key = (tok["ticker"], d["chain_id"])
            if key in seen:
                raise ValueError(f"duplicate (ticker, chain_id): {key}")
            seen.add(key)
    return True
