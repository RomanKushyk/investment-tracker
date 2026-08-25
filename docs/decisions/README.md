# Decisions — index

Why the project is the way it is. Read the one-liner here, open the range file
only for the decision you actually need.

## Rules

- **Append-only.** New entries go at the bottom of the **highest-numbered file**
  whose name covers the number you are writing — the range table below is the
  only place that list lives. **Never write an entry into a file whose name does
  not cover its number**: D101 opens `D101-D120.md` before D101 is written, not
  after. `D41-D50.md`'s name is a fossil for a different reason — it holds
  D41–D60 because the rule then said to append until D60, and renaming is not
  worth it.
- **Splitting a file moves entries, and moving is not rewriting.** `D61-D80.md`
  held D81–D83 for a day before the split of 2026-08-24 — ten entries less
  overflow than `D41-D50.md`'s, caught because the file no longer matched its
  name. When you split: entries move **verbatim**, **numbers never change**
  (~20 citations across `src/` and `docs/` are by bare number), the drained
  file's header is closed and points at the successor, and the range table here
  is updated. Tidying or renumbering in transit is the one thing that breaks
  callers.
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
| [`D61-D80.md`](D61-D80.md) | D61–D80 | Production hardening and the edge |
| [`D81-D100.md`](D81-D100.md) | D81–D100 | Open; theme written when the file closes |

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

## D41 onward — rename, alerting, durability, observations, FX, radii, the shells, production, the window

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
| D66 | Two shells, one composition; and 44 px is hit area, never geometry | 2026-08-17 |
| D67 | Production moves on a version, not on a calendar — supersedes D59's cadence | 2026-08-17 |
| D68 | `muted` is re-derived against the surface it is worst on, and `label` is retired into it | 2026-08-17 |
| D69 | The provider's FX rate is not stored at all — supersedes D30's placement of it | 2026-08-17 |
| D70 | Capture checks are structural; the value check is retired — supersedes D28's frozen-feed half | 2026-08-18 |
| D71 | `as_of` is per source; the Inzhur rows were a day early and were migrated | 2026-08-18 |
| D72 | "the provider publishes no price history" is too strong — narrows D27 | 2026-08-18 |
| D73 | A branch always; there is no diff small enough to commit straight onto `dev` | 2026-08-18 |
| D74 | The funds' `nav` history is archived and never shown; the read-time conversion is rejected — closes O21 | 2026-08-18 |
| D75 | A hand-entered value is marked, an archive one is not — closes O22 by dissolving it into D33 | 2026-08-19 |
| D76 | Every branch is code-reviewed before it is squash-merged into `dev` — **amends D73's "no gate"** | 2026-08-19 |
| D77 | A merged reference wins the LAYOUT, not the class list — the reference owns the RESULT, the code owns the mechanism; three divergences on `/transactions` recorded, and the one that was NOT allowed named | 2026-08-20 |
| D78 | A window's opening position is valued the DAY BEFORE it opens — the boundary at which each transaction is counted exactly once, and the one that makes the full history reduce exactly; the extension's figures are off by one boundary day (37,00 ₴ on the seed) | 2026-08-21 |
| D79 | A derived schedule ASKS the walkers (`rollNextCoupon`, `nextUnsettledCoupon`) and never re-derives the grid — A41's first cut broke where the roll clamps at maturity (losing …6475's final травень coupon) and ended by the calendar where the app ends by settlement | 2026-08-24 |
| D80 | The window DOES change `Річна`'s basis (superseding Phase 6's pinned trap fix, owner's ruling on O24) — and F-3's grey ships with it: a row whose holding falls >10 % short of its basis renders `Річна` and `проти очікуваної` in muted, in every window including the default | 2026-08-24 |
| D81 | Every `/seasonality` insight card that summarises the bars reads the windowed ledger; only the `nextCoupon` half of «Купонний сезон» is a genuine forecast — a derived statement inherits the classification of the DATA it comes from, not of the sentence it is written as (A42) | 2026-08-24 |
| D82 | SMIDA's open-data API is alive and always was — D27's "retired 2021-06-30 (verified: 404)" recorded the wrong host: that date is where `stockmarket.gov.ua` stops, and its endpoints still answer `200` over frozen data. D27's ruling is untouched; only the availability sentence changes | 2026-08-24 |
| D83 | The provider's price files may be fetched automatically, superseding D72's by-hand rule (owner's ruling) — they are linked from the allowed offer pages and served from a CDN origin that publishes no `robots.txt`; `/documents` stays off-limits, and the filename carries a content hash so the link is re-read rather than polled | 2026-08-24 |
| D84 | Prettier is SCOPED, not retired — the 245 failures were an unset `endOfLine` on a CRLF checkout plus a default 80-char width against a 104-char codebase; `design/` (D14), all Markdown and the captured fixtures are ignored, 110 files reformatted, `format:check` joins BOTH CI gates | 2026-08-24 |
| D85 | `Річна` keeps ONE span shared by every asset rather than a per-asset one (the span itself is the window's since D80) — closing O23: the whole question rested on one young position, per-asset would have a fixed-coupon bond beating its own contract by 19,3 pp, XIRR already is the per-asset column, and D80's grey removed the silence that was the case for switching | 2026-08-24 |
| D86 | SMIDA's open-data API is NOT fetched by our code — categorically, closing O25 without the email: the file was ABSENT for sixteen months and returned in Nov 2021 carrying a `/db/` rule, so the restriction postdates the API and intent is on the record; the statute licenses use with attribution; the current file is an unambiguous blanket `Disallow` | 2026-08-24 |
| D87 | The number grammar FOLLOWS THE LANGUAGE, closing O26 — uk groups on whitespace and takes both `,` and `.` as the decimal, en keeps the comma as grouping; the both-marks rule is unchanged, `GROUPED_INTEGER` becomes English-only, every field groups live, and every in-flight string is re-formatted on a language switch. **Supersedes D58's one-parser half** | 2026-08-25 |
| D88 | **`/` and `/transactions` are composed like `/payouts`** — main's own width, `grid-cols-[1.6fr_1fr]`, `gap-3.5`, one column below `lg`, and `/transactions` mirrored so the ledger leads. **Supersedes the composition halves of two merged drawings** (screen-density § S1-B's centred 944, where-things-live § S4's form-on-the-left): the owner's own reason — both screens read as a different product from the rest of the app — and D14 was never meant to bind the person the drawing is for. Their findings stand; only the geometry framing them changed. Priced: the void returns to 238,9 from 115,8, and a container query left without a container evaluates false in silence | 2026-08-25 |

## A pattern these entries kept finding

D43, D44, D48, D49, D50 and D53 are six independent instances of one defect:
**a green indicator that was green because nothing had been attempted.** A dead
alert channel with zero failed notifications, a backfill whose result nobody
read, an archive with deletion protection and no backup, an insert counter that
could not tell a re-run from a re-write, and — in D53 — a failure handler that published no datapoint at all, inside the very check written to catch this. When adding a check, ask what it reads
when the thing it watches has stopped entirely — if the answer is "the same as
healthy", the check is not one.
