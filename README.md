# Quirenote — Investment Portfolio Tracker

[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml/badge.svg?branch=main)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml)

A single-user tracker for a Ukrainian portfolio: government bonds (ОВДП) and Inzhur real-estate funds. Every figure on every screen — capital, income, yield, XIRR, allocation — is derived from stored quotes, transactions and assets; no total is ever typed in. Ukrainian first, English second; light and dark; desktop and phone.

Live: https://quirenote.com (`main`) · https://dev.quirenote.com (`dev`, behind basic auth).

## Stack
React 19 · Vite · TypeScript · Tailwind 4 · Dexie.js on IndexedDB · Radix UI · vitest · IBM Plex Sans + JetBrains Mono. Backend in `infra/`: AWS SAM, Lambda, Aurora DSQL — a daily price archive the app does not read yet.

## Run
```sh
pnpm install
pnpm dev                                                    # http://localhost:3300
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```
An empty IndexedDB seeds the demo dataset on first load. `/settings → Data` resets it or switches to the live dataset.

## Layout
| Path | Holds |
|---|---|
| `src/core/` | pure domain: types, derivations, XIRR, accrual, parsers; no I/O, returns keys not prose |
| `src/lib/` | persistence: Dexie schema, `repository.ts`, seed, backup |
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
- `navigation-map.md` — every route's expected values on the demo seed.
- `docs/reference/` — deployment, versioning, Dependabot, provider and market-data facts, the formula audit.
- Work is tracked in GitHub Issues and the `Quirenote` project; milestones are releases (`vX.Y.Z`).

## Deploy
Pushing `dev` deploys dev.quirenote.com through Amplify Hosting; production moves by fast-forwarding `dev` into `main` when a version is cut. Release procedure: `docs/reference/VERSIONING.md`. Hosting: `docs/reference/DEPLOYMENT.md`. Backend: `infra/README.md`.
