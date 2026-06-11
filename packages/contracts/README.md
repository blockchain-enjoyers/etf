# @meridian/contracts

Holds generated typed ABIs and per-chain deployment addresses for the Meridian protocol. Every consumer (backend, frontend, SDK) imports **only** from this package — never directly from `blockchain/` artifacts.

## Generated files

Both files are produced by `scripts/sync-contracts.mjs` (at repo root) and **committed to the repo**. Do not edit by hand.

### `src/abis.ts`

Exports one typed ABI constant per exposed contract:

| Export | Contract | Layer |
|---|---|---|
| `CloneFactoryAbi` | `CloneFactory` | L1 |
| `BasketVaultAbi` | `BasketVault` | L1 |
| `ManagedVaultAbi` | `ManagedVault` | L1 |
| `CommittedVaultAbi` | `CommittedVault` | L1 |
| `NAVEngineAbi` | `NAVEngine` | L2 |
| `OracleRouterAbi` | `OracleRouter` | L2 |
| `CommitmentNAVAbi` | `CommitmentNAV` | L2 (ABI only — not yet deployed) |
| `FairValueNAVAbi` | `FairValueNAV` | L4 |
| `PriceAggregatorAbi` | `PriceAggregator` | L4 |

### `src/addresses.ts`

Exports:

- `CHAIN_IDS` — `{ robinhoodChainTestnet: 46630, arbitrumSepolia: 421614 }`
- `ChainId` — union of the above values
- `addresses` — `Record<ChainId, Record<string, `0x${string}`>>` — maps `chainId → contractName → address`. `CommitmentNAV` has an ABI but no address entry until deployed.

## Regenerate

```bash
# from repo root:
node scripts/sync-contracts.mjs

# or via the root script:
yarn abi:sync
```

Then commit the updated `src/abis.ts` and `src/addresses.ts`.

## Deployment output convention

The sync script reads `blockchain/deployments/<network>.json`. Each file may be **flat** or **nested**:

```json
{ "CloneFactory": "0x...", "BasketVault": "0x..." }
```

```json
{ "deployments": { "CloneFactory": { "address": "0x..." } } }
```

The sync script handles both formats automatically.

`CloneFactory` uses EIP-1167 clones (replacing the previous factory approach). The deploy-time address-prediction helpers are `predictBasketAddress`, `predictManagedVaultAddress`, and `predictCommittedVaultAddress`.

Filename-to-chainId mapping:

| File | Chain ID |
|---|---|
| `robinhoodChainTestnet.json` | 46630 |
| `arbitrumSepolia.json` | 421614 |

If `blockchain/deployments/` does not exist or a network file is absent, the address map for that chain remains empty (`{}`). The package builds and exports cleanly in either state.

## CI

The `contracts-abi-drift` workflow (`.github/workflows/contracts-abi-drift.yml`) runs on every PR or push that touches `blockchain/`, `packages/contracts/`, or `scripts/sync-contracts.mjs`. It:

1. Re-runs `node scripts/sync-contracts.mjs`
2. Fails with a diff if the committed `src/abis.ts` or `src/addresses.ts` does not match the freshly generated output

This ensures generated files in the package never drift from the on-chain source.
