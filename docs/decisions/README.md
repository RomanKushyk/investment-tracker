# Decisions — index

Why the project is the way it is. Read the one-liner here, open the range file
only for the decision you actually need.

## Rules

- **Append-only.** New entries go at the bottom of the **highest-numbered file**,
  which is now `D61-D80.md`. Note that `D41-D50.md`'s name is a fossil: it holds
  D41–D60, because the earlier rule said to append until D60 and renaming a file
  is not worth it. Start the next file when this one passes D80.
- **Never rewrite a decision — supersede it.** A wrong entry stays, and a newer
  one says what replaced it and why. `D43` is the worked example: the original
  diagnosis is kept directly under its replacement, labelled, because being
  wrong about *which* of five explanations held is the reusable lesson.
- **A contract change requires an entry.** Pinned contracts in
  `../archive/BUILD-PLAN.md` and `../plans/NEXT-PHASE-PLAN.md` stay binding
  until a decision here supersedes them.
- Entries are numbered, never renumbered. Code comments cite `D5`, `D30` and so
  on by bare number — those citations must keep resolving forever.

| File | Range | Theme |
|---|---|---|
| [`D01-D20.md`](D01-D20.md) | D1–D20 | v1: stack, persistence, formulas, deploy |
| [`D21-D40.md`](D21-D40.md) | D21–D40 | The cloud direction: prices, auth, the domain |
| [`D41-D50.md`](D41-D50.md) | D41–**D60** | The rename, alerting, durability, observations, the FX rate, radii, the theme and language contracts, the prod/dev split |
| [`D61-D80.md`](D61-D80.md) | D61– | Production hardening and the edge |

## The ones worth reading before touching anything

- **D5** — reference-data reconciliation. Read before touching seed data or any
  derivation; every figure in the app is derived, none is hard-coded.
- **D2** — persistence is Dexie on IndexedDB, and the app is still local.
- **D13 / D18** — the dual metric families. Consult with
  `../reference/FORMULA-AUDIT.md` before changing `core/derive.ts` or
  `core/xirr.ts`.
- **D30** — the observation key. Immutable on DSQL: a wrong key is a
  DROP/CREATE of a live archive, not a migration.
- **D45 / D47** — alerts do not go to email, and that is deliberate. Do not
  "fix" it by adding an SNS topic.

## D1–D20 — v1

| # | Decision | Date |
|---|---|---|
| D1 | Tech stack: use `package.json` as-is | 2026-07-27 |
| D2 | Persistence: Dexie.js on IndexedDB | 2026-07-27 |
| D3 | Personal pet project: no Jira | 2026-07-27 |
| D4 | Testing: vitest for pure logic only | 2026-07-27 |
| D5 | Reference-data reconciliation | 2026-07-27 |
| D6 | Personal git identity + GitHub remote | 2026-07-27 |
| D7 | Fluid, soft motion on every interaction | 2026-07-27 |
| D8 | `src/core/` pure domain layer, structured returns, one sign convention | 2026-07-28 |
| D9 | Dexie `meta` table + versioning policy | 2026-07-28 |
| D10 | Scoped D4 amendment: `fake-indexeddb` for repository tests | 2026-07-28 |
| D11 | Settings persist versioning | 2026-07-28 |
| D12 | Backup envelope v1: hand-rolled JSON + zod | 2026-07-28 |
| D13 | Formula model: dual metric families + ledger-reconciled cash | 2026-07-29 |
| D14 | Design-extension workflow: immutable originals + `design/extensions/` | 2026-07-29 |
| D15 | Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions | 2026-07-29 |
| D16 | Dual datasets: two Dexie DBs, boot-time binding, demo-first | 2026-08-02 |
| D17 | Destructive clears: typed-name AlertDialog idiom + erase scope | 2026-08-02 |
| D18 | Metrics exposure: per-asset XIRR flow model + additive placements | 2026-08-02 |
| D19 | Inzhur feed policy: public bare GET, tolerant parse, last-good cache | 2026-08-04 |
| D20 | Fetch quotes: draft-only fill, provenance in the draft, live ref picker | 2026-08-04 |

## D21–D40 — the cloud direction

| # | Decision | Date |
|---|---|---|
| D21 | Fixed-yield automation: accrual ghosts, coupon confirm, projection fallback | 2026-08-04 |
| D22 | Reminders: derived ids, self-expiring dismissals, one toast per open | 2026-08-04 |
| D23 | Coupon occurrences are derived from the grid, not from the pointer | 2026-08-04 |
| D24 | Import replaces, never merges: validate → diff → confirm → one transaction | 2026-08-04 |
| D25 | `neg-tint` widened to irreversible-harm framing at block scale | 2026-08-04 |
| D26 | A price archive exists; the app is still local | 2026-08-11 |
| D27 | No single source of truth for prices; the axis is backfillability | 2026-08-11 |
| D28 | The capture journal, and how a frozen feed is caught | 2026-08-11 |
| D29 | CSV ships export-only; the round trip is cancelled | 2026-08-11 |
| D30 | **The observation key**: basis vocabulary, FX placement, instrument ref | 2026-08-11 |
| D31 | What one payload proves: fund basis, the FX channel, matured bonds | 2026-08-11 |
| D32 | Auth: Cognito Essentials, managed login, open registration | 2026-08-11 |
| D33 | There is no past-date prefill; value is derived | 2026-08-11 |
| D34 | The seed is rewritten to reconcile, not replaced | 2026-08-11 |
| D35 | Round 3 stays derived, and the small Round 4 items | 2026-08-11 |
| D36 | Three sign-in methods, one account per email | 2026-08-11 |
| D37 | Watching the 10,000 MAU free tier: what exists and what does not | 2026-08-11 |
| D38 | Registration is an application, not an open door | 2026-08-11 |
| D39 | Applications never touch Cognito; onboarding is passkey-first; SES with W7 | 2026-08-11 |
| D40 | The domain is `quirenote.com` | 2026-08-11 |

## D41–D56 — rename, alerting, durability, observations, FX, radii

| # | Decision | Date |
|---|---|---|
| D41 | ~~The product is Quirenote; the machines stay Kubushka~~ — **superseded by D42** | 2026-08-11 |
| D42 | The rename goes all the way, and now is when it is cheap | 2026-08-11 |
| D43 | Backfill fails on every historical date, and it is **not** the layout | 2026-08-11 |
| D43 *(original)* | ~~The NBU parser only reads the current file layout~~ — **kept as the record of a wrong diagnosis** | 2026-08-11 |
| D44 | The alerting was silently dead, and every indicator said it was fine | 2026-08-11 |
| D45 | Alerts go to the Console Mobile App, **not** to email | 2026-08-11 |
| D46 | E3 is done: what the stack move actually cost and found | 2026-08-11 |
| D47 | The alert channel measures itself, and SNS is gone | 2026-08-11 |
| D48 | The payload split is not needed; the missing index was | 2026-08-11 |
| D49 | The DSQL durability gate passes, and the archive had no backup at all | 2026-08-11 |
| D50 | The NBU archive becomes observations, scoped narrow on purpose | 2026-08-11 |
| D51 | The NBU rate is fetched on request, and every failure is an HTTP 200 | 2026-08-12 |
| D52 | A price cannot tell you both when it was struck and at what yield | 2026-08-12 |
| D53 | What the xhigh review found, and the two fixes that were wrong first | 2026-08-12 |
| D54 | The brand fonts cannot write the app default language | 2026-08-12 |
| D55 | The display face is chosen on figures, not on cap-height | 2026-08-12 |
| D56 | Nested radii are concentric, standalone radii are proportional | 2026-08-12 |
| D57 | The theme is one list of values, stamped as an answer | 2026-08-13 |
| D58 | Formatting follows the language, and the type system cannot see most of it | 2026-08-14 |
| D59 | Production is a branch, and the domain is what makes that real | 2026-08-14 |
| D60 | The repository is public, writable by one account, and rewritable by none | 2026-08-14 |
| D61 | Production sits behind Cloudflare's edge; the records that must not be proxied are named | 2026-08-14 |
| D62 | SMS is not a way around the SES denial; it trades one queue for two at 1,615x the price | 2026-08-14 |
| D63 | The environment split stops at the user's data; the archive has none | 2026-08-14 |
| D64 | The capture retries by firing again, not by waiting longer | 2026-08-14 |
| D65 | Scrolling is a drawn surface, and its gutter is the parent's padding, not the child's | 2026-08-17 |

## A pattern these entries kept finding

D43, D44, D48, D49, D50 and D53 are six independent instances of one defect:
**a green indicator that was green because nothing had been attempted.** A dead
alert channel with zero failed notifications, a backfill whose result nobody
read, an archive with deletion protection and no backup, an insert counter that
could not tell a re-run from a re-write, and — in D53 — a failure handler that published no datapoint at all, inside the very check written to catch this. When adding a check, ask what it reads
when the thing it watches has stopped entirely — if the answer is "the same as
healthy", the check is not one.
