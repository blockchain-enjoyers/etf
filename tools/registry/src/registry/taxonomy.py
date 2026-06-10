"""Stage 03 taxonomy — §4 sector enum, GICS mapping, crypto overrides, ETF categories."""

# 12 fixed sectors (GICS-based, English labels) per ТЗ §4
SECTORS = [
    "Technology", "Healthcare", "Financials", "Consumer Staples",
    "Consumer Discretionary", "Industrials", "Energy",
    "Materials", "Real Estate", "Communication Services",
    "Utilities", "Crypto & Blockchain",
]
CRYPTO_SECTOR = "Crypto & Blockchain"

# yfinance GICS sector -> our enum
GICS_MAP = {
    "Technology": "Technology",
    "Healthcare": "Healthcare",
    "Financial Services": "Financials",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Cyclical": "Consumer Discretionary",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "Basic Materials": "Materials",
    "Real Estate": "Real Estate",
    "Communication Services": "Communication Services",
    "Utilities": "Utilities",
}

# Tickers re-assigned to "крипто и блокчейн" regardless of their GICS sector.
CRYPTO_TICKERS = {
    "MSTR", "COIN", "MARA", "RIOT", "CLSK", "HUT", "BITF", "CIFR", "WULF",
    "BTDR", "HIVE", "IREN", "CORZ", "BMNR", "GLXY", "HOOD", "BLSH", "CRCL",
    "SBET", "BTBT", "CAN", "GREE", "DGHI", "APLD",
}
# name keywords that imply a crypto/blockchain equity (miners, BTC-treasury cos)
CRYPTO_NAME_WORDS = ("bitcoin", "ethereum", "blockchain", "crypto", "digital asset",
                     "miner", "mining")

# ETF category detection — ordered, first match wins (most specific first).
# Each entry: (category, tuple of lowercase substrings to look for in the name).
ETF_CATEGORY_RULES = [
    ("crypto", ("bitcoin", "ethereum", " btc", " eth", "crypto", "blockchain")),
    ("leveraged", ("2x", "3x", "leveraged", "daily target", "ultra ", "ultrapro")),
    ("inverse", ("inverse", "-1x", " short ")),
    ("income", ("income", "covered call", "option income", "yieldmax", "premium",
                "buffer", "dividend")),
    ("bond", ("bond", "treasury", "t-bill", "fixed income", "aggregate", "municipal")),
    ("commodity", ("gold", "silver", "platinum", "palladium", "crude oil",
                   "natural gas", "commodity", "metals")),
    ("broad_index", ("s&p 500", "total market", "total stock", "nasdaq-100",
                     "nasdaq 100", "qqq", "dow jones", "russell", "msci", "ftse",
                     "broad", "1000 index", "500 index")),
]


def map_gics(yf_sector):
    """yfinance sector string -> our enum, or None if unmapped/missing."""
    if not yf_sector:
        return None
    return GICS_MAP.get(yf_sector.strip())


def is_crypto(ticker, name):
    if ticker and ticker.upper() in CRYPTO_TICKERS:
        return True
    nl = (name or "").lower()
    return any(w in nl for w in CRYPTO_NAME_WORDS)


def etf_category(name):
    """Classify an ETF/fund by name keywords. Falls back to 'sector'."""
    nl = (name or "").lower()
    for cat, words in ETF_CATEGORY_RULES:
        if any(w in nl for w in words):
            return cat
    return "sector"
