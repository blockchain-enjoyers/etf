# @meridian/frontend

Next.js + TypeScript app (wagmi/viem). Not scaffolded yet.

To scaffold (later pass), from this directory:
`yarn create next-app . --ts --app`

The frontend NEVER computes price — it reads everything via `@meridian/sdk` (see docs/FRONTEND_SCREENS.md §0.4).
Add `@meridian/sdk` (`workspace:^`) as a dependency after scaffolding.
