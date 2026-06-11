import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from registry.etf_holdings import (parse_ark_csv, parse_spdr_rows, normalize_ticker,
                                   match_holdings)

ARK_CSV = (
    "date,fund,company,ticker,cusip,shares,market value ($),weight (%)\n"
    "06/11/2026,ARKK,TESLA INC,TSLA,88160R101,\"1,786,141\",\"$681,573,544.19\",10.15%\n"
    "06/11/2026,ARKK,ROBINHOOD MARKETS INC - A,HOOD,770700102,\"3,842,276\",\"$331M\",4.94%\n"
    "06/11/2026,ARKK,,,, , ,0.30%\n"            # cash line: no ticker -> dropped
    '06/11/2026,ARKK,"DUMMY",ZZZZ,000,1,1,0.00%\n'
)

# SPDR rows as openpyxl would yield them (list-of-rows, values_only)
SPDR_ROWS = [
    ["Fund Name:", "Tech Select", None, None, None],
    ["Ticker Symbol:", "XLK", None, None, None],
    ["Holdings:", "As of 09-Jun-2026", None, None, None],
    [None, None, None, None, None],
    ["Name", "Ticker", "Identifier", "SEDOL", "Weight"],
    ["NVIDIA CORP", "NVDA", "67066G104", "2379504", "13.62"],
    ["APPLE INC", "AAPL", "037833100", "2046251", "11.48"],
    ["", "-", "", "", "0.01"],                  # cash placeholder -> dropped
]


def test_parse_ark_csv_filters_cash_and_parses_pct():
    h = parse_ark_csv(ARK_CSV)
    tickers = [x["ticker"] for x in h]
    assert "TSLA" in tickers and "HOOD" in tickers
    assert "" not in tickers                     # cash row dropped
    tsla = next(x for x in h if x["ticker"] == "TSLA")
    assert abs(tsla["weight_pct"] - 10.15) < 1e-9
    assert tsla["name"] == "TESLA INC"


def test_parse_spdr_rows_finds_header_and_drops_nonequity():
    h = parse_spdr_rows(SPDR_ROWS)
    tickers = [x["ticker"] for x in h]
    assert tickers == ["NVDA", "AAPL"]           # '-' cash row dropped
    assert abs(h[0]["weight_pct"] - 13.62) < 1e-9


def test_normalize_ticker():
    assert normalize_ticker("BRK.B") == "BRK.B"
    assert normalize_ticker("BRK/B") == "BRK.B"   # slash -> dot
    assert normalize_ticker("BRK-B") == "BRK.B"   # dash (registry form) -> dot
    assert normalize_ticker(" nvda ") == "NVDA"


def test_match_holdings_renormalizes_and_reports_coverage():
    holdings = [
        {"ticker": "NVDA", "name": "NVIDIA", "weight_pct": 50.0},
        {"ticker": "AAPL", "name": "Apple", "weight_pct": 30.0},
        {"ticker": "2330", "name": "TSMC Taiwan", "weight_pct": 20.0},  # not in registry
    ]
    registry = {"NVDA": {"ticker": "NVDA"}, "AAPL": {"ticker": "AAPL"}}
    matched, coverage = match_holdings(holdings, registry)
    assert coverage == 80.0                       # 50 + 30 of 100 matched
    # renormalized across matched subset -> 62.5 / 37.5, summing to 100
    w = {m["ticker"]: m["weight_pct"] for m in matched}
    assert abs(w["NVDA"] - 62.5) < 1e-6
    assert abs(w["AAPL"] - 37.5) < 1e-6
    assert abs(sum(m["weight_pct"] for m in matched) - 100.0) < 1e-6
