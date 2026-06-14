# Architecture

Meridian is a **neutral referee**, not an actor. It consumes oracles, it never overrides them, and the one decision it owns is whether it is safe to act. Every contract maps to an established fiat analog, because we are porting a regulated, in-production recipe rather than inventing one.

## The contract map

| Layer | Contract | What it does | Fiat analog |
| --- | --- | --- | --- |
| L1 | **CloneFactory** plus the in-kind vault | Deploy a basket fund cheaply (EIP-1167 clones); mint and redeem in kind | Unit Investment Trust |
| L2 | **RegistryRebalanceVault** plus RegistryCustody and Merkle | Hold and rebalance a large constituent set with a Merkle-committed registry | Index fund |
| L3 | **KeeperModule**, **RebalanceAuction**, **ManagedRebalanceVault** | Keeper-triggered rebalance via Dutch auction, paid from a bounded incentive (never dilution) | A managed, periodically rebalanced fund |
| L4 | **PriceAggregator**, **FairValueNAV**, the signed and Chainlink-Streams sources | Depth-weighted median NAV with a confidence band and `safe` flag; multi-source, manipulation-resistant | S&P 500 style evaluated index, ICE FVIS |
| L5 | **ForwardCashQueue**, **BasketNavObserver** | Cash in and out settled at the next market open, never at an estimate | Rule 22c-1 forward-priced fund |

Every one of these is **deployed and verified on Robinhood Chain testnet (chain 46630)**. See [Try it](try-it.md) for the addresses and explorer links.

## The neutral-referee framing

The architecture is built so that Meridian never has discretion over value:

- It **reads** prices from multiple independent sources and computes a deterministic, documented function over them.
- It **never overrides** an oracle or substitutes its own judgement for the feed.
- The only thing it decides is **whether it is safe to act**: the `safe` flag and the confidence band. That decision is conservative by construction (in-kind never pauses; the cash path waits rather than guesses).

## How the contracts are built

A few primitives do most of the work and are worth naming, because they are what make the design deployable rather than theoretical:

- **Clones, not redeployments.** Every fund is an **EIP-1167 minimal proxy** to one immutable implementation per vault type. A factory that carried full logic for several vault types hit the 24KB contract-size wall (EIP-170); clones move the logic to shared implementations and leave the factory thin, so a new fund is cheap and the matrix scales by adding implementations, not factory bytecode.
- **A registry for large baskets.** A 500-name index does not move 500 real ERC-20 balances on every create. The registry vault wraps constituents into an **ERC-6909 internal ledger** once, then reassigns claims internally, and commits the whole recipe to a single **Merkle root** so a chunked create proves only the names it touches.
- **One seam between value and price.** The only coupling between a vault (L1) and the NAV engine (L4) is a **recipe commitment**, `keccak256(tokens, unitQty, unitSize)`. The NAV engine validates it before it values anything, so it can never price the wrong basket.
- **Immutable by construction.** A vault has no admin key and no upgrade path. That is the non-custody guarantee, and it has a cost we state plainly: a bug is fixed by deploying a new version and migrating, never by patching a live vault.
