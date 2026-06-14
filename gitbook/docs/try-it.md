# Try it (live addresses)

Everything below is **deployed and live on Robinhood Chain testnet (chain 46630)**. Each address links to the Blockscout explorer. We verified each one resolves to a deployed contract before publishing; notes flag the few the explorer does not yet show a human-readable name for (still confirmed as on-chain contracts).

**Explorer base:** `https://explorer.testnet.chain.robinhood.com/address/<addr>`

**Repo:** [github.com/blockchain-enjoyers/etf](https://github.com/blockchain-enjoyers/etf)

## Core engine

| Contract | Address | Verified |
| --- | --- | --- |
| CloneFactory | [`0x453B28529273E240120D6475F2369e002deb13F5`](https://explorer.testnet.chain.robinhood.com/address/0x453B28529273E240120D6475F2369e002deb13F5) | contract |
| PriceAggregator | [`0x77b009D07BDdC08a6b83c9859fEF77C714f37f00`](https://explorer.testnet.chain.robinhood.com/address/0x77b009D07BDdC08a6b83c9859fEF77C714f37f00) | contract |
| FairValueNAV | [`0xAdec095EBB432239C19ba915aC167B9A3b3E0DD5`](https://explorer.testnet.chain.robinhood.com/address/0xAdec095EBB432239C19ba915aC167B9A3b3E0DD5) | contract |
| USDG (settlement) | [`0x5F28D5E0939FDb94943d5C65241cBf850c3d98d1`](https://explorer.testnet.chain.robinhood.com/address/0x5F28D5E0939FDb94943d5C65241cBf850c3d98d1) | "USD Global" |

## Vault family and registry

| Contract | Address | Verified |
| --- | --- | --- |
| RegistryRebalanceVault | [`0x8937A6EE95097B5a794994Dce7c90C1168Af7205`](https://explorer.testnet.chain.robinhood.com/address/0x8937A6EE95097B5a794994Dce7c90C1168Af7205) | contract |
| RegistryIndex (demo fund) | [`0x3F78db0F384e4bf325809F0f417ef4Afa76B2E4F`](https://explorer.testnet.chain.robinhood.com/address/0x3F78db0F384e4bf325809F0f417ef4Afa76B2E4F) | "Volatile Tech Basket" |
| ManagedRebalanceVault | [`0x2E578Bd5e288ae6f62708D1BFd5f806b2F092e61`](https://explorer.testnet.chain.robinhood.com/address/0x2E578Bd5e288ae6f62708D1BFd5f806b2F092e61) | contract |
| KeeperModule | [`0x746db09AC8c7DE315dCd5A19732033fb0F14f877`](https://explorer.testnet.chain.robinhood.com/address/0x746db09AC8c7DE315dCd5A19732033fb0F14f877) | not name-verified |
| RebalanceAuction | [`0xD39AA1Cab5E24150257e5FEd43A4d79c53e47CCc`](https://explorer.testnet.chain.robinhood.com/address/0xD39AA1Cab5E24150257e5FEd43A4d79c53e47CCc) | not name-verified |

## Forward-cash (L5)

| Contract | Address | Verified |
| --- | --- | --- |
| ForwardCashQueue | [`0x29d7dF7bC257180d56d9340C85Af67fA96fF88a2`](https://explorer.testnet.chain.robinhood.com/address/0x29d7dF7bC257180d56d9340C85Af67fA96fF88a2) | contract |
| BasketNavObserver | [`0xe4f4ABefe290af163142A09dC9C41852DDe09Ca5`](https://explorer.testnet.chain.robinhood.com/address/0xe4f4ABefe290af163142A09dC9C41852DDe09Ca5) | not name-verified |

## Price sources (L4)

| Source | Address | Verified |
| --- | --- | --- |
| UniversalSignedSource | [`0x41BE2284c8bBc5C89B5e2Bd4784a10B2646691aA`](https://explorer.testnet.chain.robinhood.com/address/0x41BE2284c8bBc5C89B5e2Bd4784a10B2646691aA) | contract |
| UniversalSignedSourceWeekend | [`0x32207892289a101d8546A430AbBdf62DD2049fFd`](https://explorer.testnet.chain.robinhood.com/address/0x32207892289a101d8546A430AbBdf62DD2049fFd) | not name-verified |
| ChainlinkStreamsSource | [`0x9b5747f8A46EbEb70Ab4E111dBD873cf7620C2Bb`](https://explorer.testnet.chain.robinhood.com/address/0x9b5747f8A46EbEb70Ab4E111dBD873cf7620C2Bb) | not name-verified |
| MockVerifierProxy | [`0x7703a06F6E43752B989a4aa6cA5e969d3e5af6CB`](https://explorer.testnet.chain.robinhood.com/address/0x7703a06F6E43752B989a4aa6cA5e969d3e5af6CB) | not name-verified |

The on-chain prices in the demo are **synthetic and mock** (sandbox). The keyless multi-oracle (signed committee plus MockVerifier) runs the demo without the Chainlink Streams production key. See [Honesty](honesty.md).

## Demo stocks (our mocks, ERC-8056)

| Token | Address | Verified |
| --- | --- | --- |
| MSTRx | [`0x89eC78b779E00bc99044656b04a8DB059c9b7270`](https://explorer.testnet.chain.robinhood.com/address/0x89eC78b779E00bc99044656b04a8DB059c9b7270) | "MSTRx" |
| TSLAx | [`0xB1EB0688FEA9011F38275a77b1BE7f2dCFb290C3`](https://explorer.testnet.chain.robinhood.com/address/0xB1EB0688FEA9011F38275a77b1BE7f2dCFb290C3) | "TSLAx" |
| NVDAx | [`0x1d2DC78A673E3040E188b2551DA2ec4785fB49a1`](https://explorer.testnet.chain.robinhood.com/address/0x1d2DC78A673E3040E188b2551DA2ec4785fB49a1) | not name-verified |

## Real Robinhood testnet stocks (authentic-create path)

Mint these from the official Chainlink faucet.

| Token | Address | Verified |
| --- | --- | --- |
| TSLA | [`0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`](https://explorer.testnet.chain.robinhood.com/address/0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E) | "BeaconProxy" |
| AMZN | [`0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`](https://explorer.testnet.chain.robinhood.com/address/0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02) | not name-verified |
| PLTR | [`0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`](https://explorer.testnet.chain.robinhood.com/address/0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0) | not name-verified |
| NFLX | [`0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93`](https://explorer.testnet.chain.robinhood.com/address/0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93) | not name-verified |
| AMD | [`0x71178BAc73cBeb415514eB542a8995b82669778d`](https://explorer.testnet.chain.robinhood.com/address/0x71178BAc73cBeb415514eB542a8995b82669778d) | not name-verified |


