# Roadmap

We think in a ladder from L1 to L7. The lower rungs are the honest backing engine; the upper rungs are the consumer economy that sits on top of it. We shipped the engine first, on purpose, because a safe 24/7 NAV is the hard part and everything above it depends on it.

## Shipped (deployed on chain 46630)

- **L1: in-kind create and redeem.** Deploy a basket fund via clones; mint and burn in kind, price-free.
- **L2: large-constituent registry.** Merkle-committed custody for a many-name index.
- **L3: keeper-triggered rebalance.** Dutch-auction price discovery, keeper paid from a bounded incentive.
- **L4: fair-value NAV with band and `safe`.** Depth-weighted median across multiple sources, manipulation-resistant, honestly calibrated band.
- **L5: forward-priced cash queue.** Cash in and out settles at the next open, never at an estimate.

All five are live and verified on Robinhood Chain testnet. The live registry demo is a small named subset (a volatile-tech basket); the larger constituent scale-out is a deployment task, not a redesign.

## Designed (next)

- **L6: 24/7 binding create and redeem with a buffered trigger.** The consumer-facing second half of the wedge: a mint-and-redeem experience that stays open across the weekend, using the band as a buffer. This is where any "mint at mid plus a spread" experience would live. It is deliberately **not** part of the L1 to L5 settlement engine, which never settles on an estimate.

## Vision (later)

- **L7: leverage and derivatives** on top of an honestly-valued basket.
- A **creator economy of funds**: anyone deploys a basket; the engine values and backs it neutrally.
- A **tradeable secondary market** for basket tokens.
- **Dividend pass-through** to basket holders.

