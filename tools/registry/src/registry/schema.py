"""JSON Schema for the final registry (ТЗ §5/§6)."""

REGISTRY_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["schema_version", "generated_at", "source", "sectors", "tokens"],
    "properties": {
        "schema_version": {"type": "string"},
        "generated_at": {"type": "string"},
        "source": {
            "type": "object",
            "required": ["chain", "chain_id", "deployers", "verification"],
            "properties": {
                "chain": {"type": "string"},
                "chain_id": {"type": "integer"},
                "deployers": {"type": "array", "items": {"type": "string"}},
                "verification": {
                    "type": "object",
                    "required": ["dune_count", "extracted_count"],
                    "properties": {
                        "dune_count": {"type": ["integer", "null"]},
                        "extracted_count": {"type": "integer"},
                    },
                },
            },
        },
        "sectors": {"type": "array", "items": {"type": "string"}},
        "tokens": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["ticker", "name", "asset_class", "sector",
                             "deployments", "underlying", "onchain"],
                "properties": {
                    "ticker": {"type": "string"},
                    "name": {"type": "string"},
                    "description": {"type": ["string", "null"]},
                    "asset_class": {"enum": ["stock", "etf", "treasury", "commodity"]},
                    "sector": {"type": ["string", "null"]},
                    "industry": {"type": ["string", "null"]},
                    "etf_category": {"type": ["string", "null"]},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "classified_by": {"enum": ["auto", "override", "unresolved"]},
                    "deployments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "required": ["chain_id", "address"],
                            "properties": {
                                "chain_id": {"type": "integer"},
                                "address": {"type": "string",
                                            "pattern": "^0x[0-9a-fA-F]{40}$"},
                                "token_name": {"type": ["string", "null"]},
                                "token_symbol": {"type": ["string", "null"]},
                                "decimals": {"type": ["integer", "null"]},
                                "deployed_at": {"type": ["string", "null"]},
                                "deploy_tx": {"type": ["string", "null"]},
                            },
                        },
                    },
                    "underlying": {
                        "type": "object",
                        "properties": {
                            "exchange": {"type": ["string", "null"]},
                            "isin": {"type": ["string", "null"]},
                            "market_cap_usd": {"type": ["number", "null"]},
                            "cik": {"type": ["string", "null"]},
                        },
                    },
                    "onchain": {
                        "type": "object",
                        "properties": {
                            "tradable": {"type": "boolean"},
                            "total_supply": {"type": ["string", "null"]},
                            "aum_usd": {"type": ["number", "null"]},
                            "cumulative_mint_usd": {"type": ["number", "null"]},
                        },
                    },
                },
            },
        },
    },
}
