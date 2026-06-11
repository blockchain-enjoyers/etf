# @meridian/app

Meridian frontend — a wallet-connected React "terminal" (Vite SPA) that reads live data through `@meridian/sdk` and performs capability-gated on-chain writes.

## Running locally

```bash
# 1. Install all workspaces (run once at repo root)
yarn install

# 2. Copy env and fill in values
cp app/.env.example app/.env

# 3. Start the dev server
yarn workspace @meridian/app dev
# → http://localhost:5173
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:3000` |
| `VITE_CHAIN_ID` | EVM chain id (Arbitrum Sepolia = 421614) | `421614` |
| `VITE_USE_FIXTURES` | Use local fixture data instead of live API | `true` |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect cloud project id | *(empty)* |

Set `VITE_USE_FIXTURES=true` to run without a live backend (fixture data is served in-process).

## Routes

| Path | Screen |
|---|---|
| `/` | Redirects to `/explore` |
| `/explore` | Basket index — lists all baskets |
| `/index/:vaultAddress` | Index detail — holdings, NAV, order rail |
| `/portfolio` | Portfolio — connected wallet's positions |
| `/activity` | Activity — transaction history (placeholder) |
| `/create` | Create wizard — deploy a new basket |

## On-chain writes

Write hooks (`useMint`, `useRedeem`, `useDeployBasket`) compile against the generated ABIs in `packages/contracts` but are gated dormant by `useCapabilities`. They activate automatically when contracts are deployed and `yarn abi:sync` populates addresses — no code change needed.
