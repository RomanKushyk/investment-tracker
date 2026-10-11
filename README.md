# Quirenote — Investment Portfolio Tracker

[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml/badge.svg?branch=main)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml)

A single-user tracker for a Ukrainian portfolio: government bonds (ОВДП) and Inzhur real-estate funds. Every figure on every screen — capital, income, yield, XIRR, allocation — is derived from stored quotes, transactions and assets; no total is ever typed in. Ukrainian first, English second; light and dark; desktop and phone.

Live: https://quirenote.com (`main`) · https://dev.quirenote.com (`dev`, behind basic auth).

## Stack
React 19 · Vite · TypeScript · Tailwind 4 · TanStack Query · Radix UI · vitest · Manrope + JetBrains Mono. Backend in `infra/`: AWS SAM, Lambda, Cognito and Aurora DSQL — the user API the app reads and writes its portfolio over, and a daily price archive that API reads.

## Run
```sh
pnpm install
pnpm dev                                                    # http://localhost:3300
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```
The portfolio lives on the server, so the app needs an account: `pnpm dev` proxies `/relay` to the dev API, and a signed-in account that has no data opens to an empty portfolio that nothing seeds. `/settings → Data` imports a backup or erases the data; `navigation-map.md` says how to import the reference seed.

## Layout
| Path | Holds |
|---|---|
| `packages/core/` | `@quirenote/core`, the pure domain layer the app and `infra/` both import: types, derivations, XIRR, accrual, parsers, the per-screen view models and the reference seed; no I/O, returns keys not prose |
| `src/lib/` | the client of the user API and browser I/O: `repository.ts` (reads, writes, backup), `transport.ts`, `api.ts` (the one client and query cache), the sign-out wipe, the feed caches in `localStorage`, file download |
| `src/state/` | the settings store |
| `src/screens/`, `src/components/` | the routes and the UI kit |
| `src/i18n/` | the dictionary — English canonical, Ukrainian default |
| `infra/` | the AWS backend, with its own README |
| `design/` | the design reference and merged extensions; immutable once merged |
| `docs/` | `DECISIONS.md`, `reference/`, `superpowers/specs/` |
| `public/`, `scripts/` | favicon and touch icon; `build-touch-icon.mjs` |

## Documentation
- `CLAUDE.md` — working rules, workflow, Definition of Done.
- `docs/DECISIONS.md` — why things are the way they are; current state only.
- `navigation-map.md` — every route's expected values on the reference seed.
- `docs/reference/` — deployment, versioning, Dependabot, provider and market-data facts, the formula audit, the Cognito pool's immutable parameters.
- Work is tracked in GitHub Issues and the `Quirenote` project; milestones are releases (`vX.Y.Z`).

## Deploy
Pushing `dev` deploys dev.quirenote.com through Amplify Hosting; production moves by fast-forwarding `dev` into `main` when a version is cut. Release procedure: `docs/reference/VERSIONING.md`. Hosting: `docs/reference/DEPLOYMENT.md`. Backend: `infra/README.md`.
