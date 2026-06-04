# Meridian — monorepo

Tokenized-equity ETF platform on Robinhood Chain / Arbitrum: 24/7 NAV + in-kind create/redeem.

## Layout
- `contracts/` — Foundry smart contracts (the NAV + create/redeem engine). See `contracts/README.md`.
- `backend/` — Node.js + TypeScript API.
- `frontend/` — Next.js + TypeScript app (reads everything via the SDK).
- `packages/contracts` — generated, typed contract ABIs + addresses (`@meridian/contracts`).
- `packages/sdk` — TS SDK wrapping the API + on-chain reads (`@meridian/sdk`).
- `packages/config` — shared ESLint / Prettier presets (`@meridian/config`).
- `docs/` — architecture specs and product context.

## Commands
- `yarn install` — install all workspaces.
- `yarn build` / `yarn test` / `yarn lint` — run across every workspace.
- `cd contracts && forge build` — compile contracts directly.
- `yarn contracts:export-abi` — regenerate typed ABIs into `packages/contracts`.

Design source of truth: `docs/specs/2026-06-03-meridian-contracts-architecture.md`.
