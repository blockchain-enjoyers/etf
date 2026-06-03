# Meridian — contracts

Neutral 24/7 NAV + in-kind create/redeem infrastructure for tokenized-equity baskets on Robinhood Chain / Arbitrum.

This repo holds the Foundry contracts. Strategy and research live alongside (`state.md`, `plan.md`, `research/`, `docs/`). Full design: [`docs/specs/2026-06-03-meridian-contracts-architecture.md`](docs/specs/2026-06-03-meridian-contracts-architecture.md).

## Status

Architecture scaffold. `forge build` is green: full interfaces + fully implemented mocks + module skeletons. The hard logic (closed-market fair value, buffered-trigger enforcement, corporate actions, cash settlement) is intentionally not built yet; it is marked `NotImplemented()` with `[R#]` research pointers. Tests are the matrix in the spec, implemented in a later pass.

## Build

```bash
forge build
```

No external dependencies (minimal `IERC20` and access control are vendored), so it compiles offline. solc 0.8.33.

## Layout

```
src/
  types/MeridianTypes.sol     enums, structs, role ids
  interfaces/                 11 module interfaces (+ external/ feed shapes)
  mocks/                      settable, fully implemented external deps (no network)
  modules/                    the modules (spine + engines)
    adapters/ChainlinkAdapter
script/
  RHCConfig.sol               Robinhood Chain testnet (46630) + real stock-token addresses
  MeridianDeployer.sol        deploys + wires the full set (reusable in tests/deploy)
docs/specs/                   architecture spec
```

## Architecture in one paragraph

Pattern: **Registry + Engines around an immutable vault.** `BasketVault` is immutable (no proxy), custodies the underlying and does in-kind mint/redeem with **no price dependency** — the strongest non-custodial claim. Everything risky and evolving (oracle, NAV, rebalance, corporate actions, guard, proof-of-reserve) lives behind upgradeable engines resolved through `ModuleRegistry`, swappable without touching the spine and freezable per slot (road to immutability). Engines **propose**; the vault **disposes** under its own invariants, so a compromised engine cannot drain it.

**Iron rule:** a closed-market estimate is NEVER a settlement price. Settlement is in-kind (oracle-free) or forward-priced (next market open). `NavResult.estimated == true` flags the wedge NAV as informational only.

**Fees:** zero protocol fee on-chain. Keeper incentives are paid by arbitrageurs, not taken from volume (red line #3).

## v1 vs v2

- **v1 (safe):** in-kind vault, market-hours NAV, market-status gating, read-only fair value, rebalance only when the Chainlink feed is fresh and Regular (else pause). Sequencer-uptime gating. Proof-of-reserve on-chain check.
- **v2 (gated on V0):** closed-market fair value (off-chain-fitted betas, attestation-pushed, never on-chain regression), buffered-trigger binding settlement, multi-source fusion (perp/DEX-TWAP), weekend redeem/rebalance, real corporate-action feed.

v2 = register new engines; the v1 core is not rewritten.

## Networks

- Robinhood Chain Testnet — chain `46630`. Real stock tokens (synthetic, no organic weekend discovery) in `script/RHCConfig.sol`: TSLA, AMZN, PLTR, NFLX, AMD.
- Arbitrum Sepolia fork — secondary target. Prize gate = deploy on an Arbitrum-family chain (RHC counts).

The real weekend price-discovery evidence runs on Solana xStocks, not here (see `research/v0/`).

## Test scenarios (matrix — see spec §7)

market open · weekend-stale · halt · split · dividend · sequencer-down · thin-pool listing gate · forward-queue settle · unconditional redeem · incomplete bundle · decimals mix · malicious rebalance.
