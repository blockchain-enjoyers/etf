# Meridian — token contract addresses

The demo constituent universe is **300 tokenized-equity tokens** (the top US tickers by market cap). Each is an EIP-1167 clone of the verified Stock implementation, wired with two committee-signed price sources (so each has a 24/7 safe NAV), and exposes an open `faucetMint()` that gives 100 tokens per claim. 

Settlement token:

| Address | Label |
|---|---|
| `0x5F28D5E0939FDb94943d5C65241cBf850c3d98d1` | MockUSDG (USDG settlement stablecoin) |

Top 15 by market cap:

| Address | Ticker |
|---|---|
| `0x0c779f3d751a146991E52EB3a7306830F8e7E59E` | NVDA |
| `0x0c56701C39946460A563b44a11aA548DcE5ad80C` | GOOGL |
| `0x479EE6cc380f0777fCc8AfbEC5E2a1f7a16bdcAa` | GOOG |
| `0x60527A2ef132433E378d89De8bE8595c578f4241` | AAPL |
| `0xE83429D1051f50D21992825A77abc2EC5E85Ceb3` | MSFT |
| `0x0674A361A6ab8CD11c2Bdc2717174692665b7e69` | AMZN |
| `0xCC15dB2288BD637f7f259A1D7d2fc274d039C12E` | AVGO |
| `0x6da4Ab90c63cc6F60afdE327dFFCf683277Bbca7` | META |
| `0xFB34AB8B3B586b2dFbf1ea1B5AfE942998e4Ae92` | TSLA |
| `0x41465FB86F3E609b119495333ba66c06458e64e7` | BRK-A |
| `0xa74DA3E26751B979b8520Fd0FaD24335Cb6EeB0D` | BRK-B |
| `0x228109E2C4517c64eA14889c669aA664198671f8` | LLY |
| `0x10CB6BD7FfFB5123f5Ee0068aBb8773AF946F20f` | MU |
| `0x025817A0659f384fDDFEf8124eDF1F3696Cb0250` | WMT |
| `0xabbBFE02DE0AAf17B0b598758d07c57AF252234E` | JPM |

Stock-clone infrastructure (the 300 above delegate to this):

| Address | Label |
|---|---|
| `0x7b8F92e75F5Ef7E80B34aFEbc766492740fFd593` | Stock (shared implementation behind every constituent clone) |
| `0x536ecff29A204d8177E7aBF4bc28b2D1B1589007` | StockCloneFactory (EIP-1167 factory for constituents) |
| `0xC2c43ea6789048C74ea88e086819796c352326f2` | AccessControlsRegistry (roles for the constituent tokens) |


[Find other contracts](https://github.com/blockchain-enjoyers/etf/blob/main/blockchain/config/testnet.json)