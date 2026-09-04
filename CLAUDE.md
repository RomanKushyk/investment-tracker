# Quirenote — investment portfolio tracker

Single-user tracker for Ukrainian government bonds (ОВДП) and Inzhur funds. React 19 + Vite + TypeScript + Tailwind 4, pnpm. Persistence today is Dexie on IndexedDB. `infra/` is a separate AWS backend (a daily price archive on Aurora DSQL) that the app does not read yet.

## Commands
- `pnpm dev` — port and `strictPort` live in `vite.config.ts`, nowhere else. It refuses to boot on a conflict instead of drifting: check what holds the port, attach if it is this app, else `pnpm dev --port N`. The owner usually has one running.
- Gates, all four before any merge: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.
- Fifth gate when `infra/` or a shared core file (`src/core/types.ts`, `dates.ts`, `ovdp.ts`, `inzhur/{parse,dcf,ref}.ts`, `nbu/{date,fair-value}.ts`) changes: `npm ci` in `infra/`, then `pnpm exec tsc --noEmit -p infra` from the root.

## Workflow
1. Session start: read the Project's `Triage` column (`gh project item-list 2 --owner RomanKushyk --format json`). Non-empty → run the `triage-issue` skill first. Nothing is coded against an untriaged issue.
2. Pick a `Ready` issue with no open blocker from the open version milestone; a `bug` goes first. Move it to `In progress` — that column must be empty before. One issue at a time. A multi-part ask that will not fit one issue goes through the `plan-epic` skill first and lands as an epic with `Ready` sub-issues to pick from.
3. Branch `<type>/<kebab-title>` from `dev`. Always a branch, however small the diff; `dependabot/…` is the one naming exception.
4. Failing test first, then the change, then the gates.
5. `/code-review` on the branch diff. One round is the norm. A second or third only when a fix changed behaviour in `src/core/**`, `src/lib/repository.ts`, `src/lib/seed.ts`, `infra/**` or `.github/workflows/**`, or the review found a defect class. Three is the cap; a fourth wanted means the branch is wrong — write a root-cause comment on the issue, then split or redesign.
6. Squash-merge into `dev` with `Closes #N` in the body; push `dev`. The `work-issue` skill is this list as a procedure.

## Definition of Done
Every acceptance criterion ticked · a behaviour change has a test, a bug fix started from a failing one · gates green · UI verified in the browser at desktop and 360 · `navigation-map.md` updated if a route's expected values changed · a changed decision rewritten in `docs/DECISIONS.md` in the same branch · reviewed within the cap · squash-merged with `Closes #N`, `dev` pushed.

## Git
- `dev` integrates and deploys to dev.quirenote.com. `main` is production (quirenote.com) and moves only by fast-forward from `dev` when a version is cut. Never branch from `main`; never push to it directly.
- Squash-merge only; no merge commits. Rulesets enforce linear history on both branches and bind the owner too. Rebase is allowed.
- Every `gh` command runs with `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"`. `gh auth switch` is forbidden: two accounts share the keyring and the other repo's session would lose its account. `git push` is unaffected — `origin` is the `github-personal` SSH alias.
- Author identity is repo-local: `RomanKushyk <romankushyk0@gmail.com>`. No AI attribution in any git artifact. Personal project: no Jira, never ask for a ticket key.
- Dependabot is security-only. Never add `.github/dependabot.yml`; merge its PRs locally (`docs/reference/DEPENDABOT.md`).

## Invariants — the why is in `docs/DECISIONS.md`, under the topic in brackets
- Every portfolio figure is derived from stored data; nothing is hard-coded. [Derived figures and the seed]
- The app is local: Dexie, two databases (demo, live). `infra/` archives prices; no screen reads it yet. [Persistence today · The price archive]
- Alarms carry no `AlarmActions` and there is no SNS topic. Deliberate; do not add one. [Alerting]
- Inzhur dealer quotes and NBU fair values are different bases and are never merged. [The price archive]
- Nothing is a capsule: standalone radius `round(min(w,h) × 0.26)`, nested `outer = inner + gap`. Only avatars, colour dots, the blob and the mark's own circle are round. [Shape system]
- Nothing scrolls with the platform bar: every constrained box goes through `src/components/ui/Scroller.tsx`. [Scrolling]
- Two shells, one breakpoint: `md` = 768 px, written in Tailwind and in `src/hooks/useIsDesktop.ts` — keep them equal. 44 × 44 is hit area, never geometry. [Two shells, one breakpoint]
- The logo lives in three places that change together: `src/app/Sidebar.tsx`, `public/favicon.svg`, `public/apple-touch-icon.png` (`node scripts/build-touch-icon.mjs`). [Brand]
- Fonts are IBM Plex Sans + JetBrains Mono because Ukrainian is the default language. Number grammar follows the language; tables stay in ₴; dates `dd.MM.yyyy`. [Language, numbers, fonts]
- Every interaction has fluid, soft motion; `prefers-reduced-motion` is respected. [Interaction rules]
- Measure in the chrome-devtools MCP, never Playwright's headless Chromium. Calibrate a probe first, disable transitions, check `document.visibilityState`, reload rather than flip the theme, and measure the rendered height — `text-[11px]` sets no line height. [Measurement]
- The design reference is `design/Investment Tracker.dc.html`, styles inline (ignore `support.js` and `_ds/`); colours come from the Tailwind theme tokens, never ad-hoc hex. [Design pipeline]
- `src/core/` is pure and returns keys, never prose; `src/lib/` is persistence; new code calls `repository.ts`, never `db.ts`. [Core is pure]

## Documentation
- This file stays under 100 lines: rules, not memory. Details live behind the pointers below.
- `README.md` what and how to run · `docs/DECISIONS.md` why, current state only · `navigation-map.md` per-route expected values · `docs/reference/` external facts code cannot carry · `docs/superpowers/specs/` live design specs · `infra/README.md` the backend.
- Decisions are rewritten in place; the history is `git log`. Delete dead documentation, never archive it. A figure lives in a test or not at all; documentation carries no dates and no measurements.
- A comment says why in one or two lines. Trim history, dates and measurements out of a file's comments when you touch it. Cite decisions by topic heading; old `D<n>` citations resolve through the table at the end of `docs/DECISIONS.md`. No new `D<n>` is ever minted.
- A merged drawing under `design/` is immutable. New UI gets a brief, a design session, an extension under `design/extensions/`, then code.
