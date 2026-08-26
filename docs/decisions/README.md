# Decisions — index

Why the project is the way it is. Read the one-liner here, open the one file for
the decision you actually need — **`D<n>` is `D<n>.md`**, always.

## Rules

- **Append-only, and appending now means creating a file.** A new decision is a
  new `D<n>.md` — nothing to overflow, nothing to keep in step with a filename.
  **D96 retired the range files** (`D01-D20.md` … `D81-D100.md`) on 2026-08-26
  for exactly that reason: the old rule sent every entry to the highest-numbered
  file, and a 200-line cap made that file overflow on its fourth entry. Both
  historical slips — `D41-D50.md` holding D41–D60, `D61-D80.md` holding D81–D83
  for a day — were one failure, a filename asserting a range it did not hold,
  and neither is possible now.
- **Moving is not rewriting.** All 95 entries moved verbatim into their own
  files and were verified byte-identical. **Numbers never change** — ~20
  citations across `src/` and `docs/` are by bare number. Tidying or renumbering
  in transit is the one thing that breaks callers.
- **Never rewrite a decision — supersede it.** A wrong entry stays, and a newer
  one says what replaced it and why. `D43` is the worked example: the original
  diagnosis is kept directly under its replacement, labelled, because being
  wrong about *which* of five explanations held is the reusable lesson.
- **A contract change requires an entry.** Pinned contracts in
  `../archive/BUILD-PLAN.md` and `../plans/NEXT-PHASE-PLAN.md` stay binding
  until a decision here supersedes them.
- Entries are numbered, never renumbered. Code comments cite `D5`, `D30` and so
  on by bare number — those citations must keep resolving forever.

**One file per decision, named as it is cited.** `D5` is [`D5.md`](D5.md); D96
opened [`D96.md`](D96.md) by existing. The range files `D01-D20.md`,
`D21-D40.md`, `D41-D50.md`, `D61-D80.md` and `D81-D100.md` were retired on
2026-08-26 — **D96** says why, and their entries moved verbatim.

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
| [D1](D1.md) | Tech stack: use `package.json` as-is | 2026-07-27 |
| [D2](D2.md) | Persistence: Dexie.js on IndexedDB | 2026-07-27 |
| [D3](D3.md) | Personal pet project: no Jira | 2026-07-27 |
| [D4](D4.md) | Testing: vitest for pure logic only | 2026-07-27 |
| [D5](D5.md) | Reference-data reconciliation | 2026-07-27 |
| [D6](D6.md) | Personal git identity + GitHub remote | 2026-07-27 |
| [D7](D7.md) | Fluid, soft motion on every interaction | 2026-07-27 |
| [D8](D8.md) | `src/core/` pure domain layer, structured returns, one sign convention | 2026-07-28 |
| [D9](D9.md) | Dexie `meta` table + versioning policy | 2026-07-28 |
| [D10](D10.md) | Scoped D4 amendment: `fake-indexeddb` for repository tests | 2026-07-28 |
| [D11](D11.md) | Settings persist versioning | 2026-07-28 |
| [D12](D12.md) | Backup envelope v1: hand-rolled JSON + zod | 2026-07-28 |
| [D13](D13.md) | Formula model: dual metric families + ledger-reconciled cash | 2026-07-29 |
| [D14](D14.md) | Design-extension workflow: immutable originals + `design/extensions/` | 2026-07-29 |
| [D15](D15.md) | Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions | 2026-07-29 |
| [D16](D16.md) | Dual datasets: two Dexie DBs, boot-time binding, demo-first | 2026-08-02 |
| [D17](D17.md) | Destructive clears: typed-name AlertDialog idiom + erase scope | 2026-08-02 |
| [D18](D18.md) | Metrics exposure: per-asset XIRR flow model + additive placements | 2026-08-02 |
| [D19](D19.md) | Inzhur feed policy: public bare GET, tolerant parse, last-good cache | 2026-08-04 |
| [D20](D20.md) | Fetch quotes: draft-only fill, provenance in the draft, live ref picker | 2026-08-04 |

## D21–D40 — the cloud direction

| # | Decision | Date |
|---|---|---|
| [D21](D21.md) | Fixed-yield automation: accrual ghosts, coupon confirm, projection fallback | 2026-08-04 |
| [D22](D22.md) | Reminders: derived ids, self-expiring dismissals, one toast per open | 2026-08-04 |
| [D23](D23.md) | Coupon occurrences are derived from the grid, not from the pointer | 2026-08-04 |
| [D24](D24.md) | Import replaces, never merges: validate → diff → confirm → one transaction | 2026-08-04 |
| [D25](D25.md) | `neg-tint` widened to irreversible-harm framing at block scale | 2026-08-04 |
| [D26](D26.md) | A price archive exists; the app is still local | 2026-08-11 |
| [D27](D27.md) | No single source of truth for prices; the axis is backfillability | 2026-08-11 |
| [D28](D28.md) | The capture journal, and how a frozen feed is caught | 2026-08-11 |
| [D29](D29.md) | CSV ships export-only; the round trip is cancelled | 2026-08-11 |
| [D30](D30.md) | **The observation key**: basis vocabulary, FX placement, instrument ref | 2026-08-11 |
| [D31](D31.md) | What one payload proves: fund basis, the FX channel, matured bonds | 2026-08-11 |
| [D32](D32.md) | Auth: Cognito Essentials, managed login, open registration | 2026-08-11 |
| [D33](D33.md) | There is no past-date prefill; value is derived | 2026-08-11 |
| [D34](D34.md) | The seed is rewritten to reconcile, not replaced | 2026-08-11 |
| [D35](D35.md) | Round 3 stays derived, and the small Round 4 items | 2026-08-11 |
| [D36](D36.md) | Three sign-in methods, one account per email | 2026-08-11 |
| [D37](D37.md) | Watching the 10,000 MAU free tier: what exists and what does not | 2026-08-11 |
| [D38](D38.md) | Registration is an application, not an open door | 2026-08-11 |
| [D39](D39.md) | Applications never touch Cognito; onboarding is passkey-first; SES with W7 | 2026-08-11 |
| [D40](D40.md) | The domain is `quirenote.com` | 2026-08-11 |

## D41 onward — rename, alerting, durability, observations, FX, radii, the shells, production, the window

| # | Decision | Date |
|---|---|---|
| [D41](D41.md) | ~~The product is Quirenote; the machines stay Kubushka~~ — **superseded by D42** | 2026-08-11 |
| [D42](D42.md) | The rename goes all the way, and now is when it is cheap | 2026-08-11 |
| [D43](D43.md) | Backfill fails on every historical date, and it is **not** the layout | 2026-08-11 |
| [D43 *(original)*](D43.md) | ~~The NBU parser only reads the current file layout~~ — **kept as the record of a wrong diagnosis** | 2026-08-11 |
| [D44](D44.md) | The alerting was silently dead, and every indicator said it was fine | 2026-08-11 |
| [D45](D45.md) | Alerts go to the Console Mobile App, **not** to email | 2026-08-11 |
| [D46](D46.md) | E3 is done: what the stack move actually cost and found | 2026-08-11 |
| [D47](D47.md) | The alert channel measures itself, and SNS is gone | 2026-08-11 |
| [D48](D48.md) | The payload split is not needed; the missing index was — **D90** opens a question against it, **D91** measures the answer: the index was right and could serve the ORDER BY backwards, but the query's own `to_char(...) AS as_of` alias hid the column and forced a table scan. Its "`payload_gzip` is never read" holds on index paths and fails on a table scan | 2026-08-11 |
| [D49](D49.md) | The DSQL durability gate passes, and the archive had no backup at all | 2026-08-11 |
| [D50](D50.md) | The NBU archive becomes observations, scoped narrow on purpose | 2026-08-11 |
| [D51](D51.md) | The NBU rate is fetched on request, and every failure is an HTTP 200 | 2026-08-12 |
| [D52](D52.md) | A price cannot tell you both when it was struck and at what yield | 2026-08-12 |
| [D53](D53.md) | What the xhigh review found, and the two fixes that were wrong first | 2026-08-12 |
| [D54](D54.md) | The brand fonts cannot write the app default language | 2026-08-12 |
| [D55](D55.md) | The display face is chosen on figures, not on cap-height | 2026-08-12 |
| [D56](D56.md) | Nested radii are concentric, standalone radii are proportional | 2026-08-12 |
| [D57](D57.md) | The theme is one list of values, stamped as an answer | 2026-08-13 |
| [D58](D58.md) | Formatting follows the language, and the type system cannot see most of it | 2026-08-14 |
| [D59](D59.md) | Production is a branch, and the domain is what makes that real | 2026-08-14 |
| [D60](D60.md) | The repository is public, writable by one account, and rewritable by none | 2026-08-14 |
| [D61](D61.md) | Production sits behind Cloudflare's edge; the records that must not be proxied are named | 2026-08-14 |
| [D62](D62.md) | SMS is not a way around the SES denial; it trades one queue for two at 1,615x the price | 2026-08-14 |
| [D63](D63.md) | The environment split stops at the user's data; the archive has none | 2026-08-14 |
| [D64](D64.md) | The capture retries by firing again, not by waiting longer — **its guard DPU figure is superseded by D90** (~73/month, not ~6); its 0.3%-of-allowance figure was overtaken by D90, whose 1.6% D91 in turn supersedes. **No current replacement**: 0.3% is a year-1 projection and D91's 0.17% is a measurement of a much smaller archive — not comparable. The ruling stands throughout | 2026-08-14 |
| [D65](D65.md) | Scrolling is a drawn surface, and its gutter is the parent's padding, not the child's | 2026-08-17 |
| [D66](D66.md) | Two shells, one composition; and 44 px is hit area, never geometry | 2026-08-17 |
| [D67](D67.md) | Production moves on a version, not on a calendar — supersedes D59's cadence | 2026-08-17 |
| [D68](D68.md) | `muted` is re-derived against the surface it is worst on, and `label` is retired into it | 2026-08-17 |
| [D69](D69.md) | The provider's FX rate is not stored at all — supersedes D30's placement of it | 2026-08-17 |
| [D70](D70.md) | Capture checks are structural; the value check is retired — supersedes D28's frozen-feed half | 2026-08-18 |
| [D71](D71.md) | `as_of` is per source; the Inzhur rows were a day early and were migrated | 2026-08-18 |
| [D72](D72.md) | "the provider publishes no price history" is too strong — narrows D27 | 2026-08-18 |
| [D73](D73.md) | A branch always; there is no diff small enough to commit straight onto `dev` | 2026-08-18 |
| [D74](D74.md) | The funds' `nav` history is archived and never shown; the read-time conversion is rejected — closes O21 | 2026-08-18 |
| [D75](D75.md) | A hand-entered value is marked, an archive one is not — closes O22 by dissolving it into D33 | 2026-08-19 |
| [D76](D76.md) | Every branch is code-reviewed before it is squash-merged into `dev` — **amends D73's "no gate"** | 2026-08-19 |
| [D77](D77.md) | A merged reference wins the LAYOUT, not the class list — the reference owns the RESULT, the code owns the mechanism; three divergences on `/transactions` recorded, and the one that was NOT allowed named | 2026-08-20 |
| [D78](D78.md) | A window's opening position is valued the DAY BEFORE it opens — the boundary at which each transaction is counted exactly once, and the one that makes the full history reduce exactly; the extension's figures are off by one boundary day (37,00 ₴ on the seed) | 2026-08-21 |
| [D79](D79.md) | A derived schedule ASKS the walkers (`rollNextCoupon`, `nextUnsettledCoupon`) and never re-derives the grid — A41's first cut broke where the roll clamps at maturity (losing …6475's final травень coupon) and ended by the calendar where the app ends by settlement | 2026-08-24 |
| [D80](D80.md) | The window DOES change `Річна`'s basis (superseding Phase 6's pinned trap fix, owner's ruling on O24) — and F-3's grey ships with it: a row whose holding falls >10 % short of its basis renders `Річна` and `проти очікуваної` in muted, in every window including the default | 2026-08-24 |
| [D81](D81.md) | Every `/seasonality` insight card that summarises the bars reads the windowed ledger; only the `nextCoupon` half of «Купонний сезон» is a genuine forecast — a derived statement inherits the classification of the DATA it comes from, not of the sentence it is written as (A42) | 2026-08-24 |
| [D82](D82.md) | SMIDA's open-data API is alive and always was — D27's "retired 2021-06-30 (verified: 404)" recorded the wrong host: that date is where `stockmarket.gov.ua` stops, and its endpoints still answer `200` over frozen data. D27's ruling is untouched; only the availability sentence changes | 2026-08-24 |
| [D83](D83.md) | The provider's price files may be fetched automatically, superseding D72's by-hand rule (owner's ruling) — they are linked from the allowed offer pages and served from a CDN origin that publishes no `robots.txt`; `/documents` stays off-limits, and the filename carries a content hash so the link is re-read rather than polled | 2026-08-24 |
| [D84](D84.md) | Prettier is SCOPED, not retired — the 245 failures were an unset `endOfLine` on a CRLF checkout plus a default 80-char width against a 104-char codebase; `design/` (D14), all Markdown and the captured fixtures are ignored, 110 files reformatted, `format:check` joins BOTH CI gates | 2026-08-24 |
| [D85](D85.md) | `Річна` keeps ONE span shared by every asset rather than a per-asset one (the span itself is the window's since D80) — closing O23: the whole question rested on one young position, per-asset would have a fixed-coupon bond beating its own contract by 19,3 pp, XIRR already is the per-asset column, and D80's grey removed the silence that was the case for switching | 2026-08-24 |
| [D86](D86.md) | SMIDA's open-data API is NOT fetched by our code — categorically, closing O25 without the email: the file was ABSENT for sixteen months and returned in Nov 2021 carrying a `/db/` rule, so the restriction postdates the API and intent is on the record; the statute licenses use with attribution; the current file is an unambiguous blanket `Disallow` | 2026-08-24 |
| [D87](D87.md) | The number grammar FOLLOWS THE LANGUAGE, closing O26 — uk groups on whitespace and takes both `,` and `.` as the decimal, en keeps the comma as grouping; the both-marks rule is unchanged, `GROUPED_INTEGER` becomes English-only, every field groups live, and every in-flight string is re-formatted on a language switch. **Supersedes D58's one-parser half** | 2026-08-25 |
| [D88](D88.md) | **`/` and `/transactions` are composed like `/payouts`** — main's own width, `grid-cols-[1.6fr_1fr]`, `gap-3.5`, one column below `lg`, and `/transactions` mirrored so the ledger leads. **Supersedes the composition halves of two merged drawings** (screen-density § S1-B's centred 944, where-things-live § S4's form-on-the-left): the owner's own reason — both screens read as a different product from the rest of the app — and D14 was never meant to bind the person the drawing is for. Their findings stand; only the geometry framing them changed. Priced: the void returns to 238,9 from 115,8, and a container query left without a container evaluates false in silence | 2026-08-25 |
| [D89](D89.md) | **The backup vault takes a GOVERNANCE lock whose floor is read from the live plan** — found by a routine AWS sweep that was green everywhere else while the vault read `Locked: false`, one command from nothing (the **seventh** instance of the pattern below; D91 is the eighth). Governance not compliance because compliance cannot be lifted by anyone including AWS and the schema is still moving (W3/W4); a floor and no `max` because what is worth forbidding is retention being WEAKENED, and the floor is derived from the live plan because the script only ever CREATES one — a literal would silently reject every nightly job. It does NOT stop the human admin, it turns a one-command accident into a deliberate two-step act, and it also freezes existing lifecycles. The mode is the PRESENCE of `--changeable-for-days`, not an argument. **Proved by attempting a delete** — refused with `InvalidRequestException`, 15 points intact | 2026-08-25 |
| [D90](D90.md) | **What a week of real DPU corrected in D64, and the question it left open against D48** — the `alreadySettled` guard costs ~73 DPU/month not ~6 (its lookup reads 117 KiB, not the 2 KiB minimum the estimate assumed), and the workload uses ~1.6% of the free tier not 0.3%. **D64's ruling is untouched** — a supporting estimate was wrong, not the conclusion. Open question: a capture reads 34.2 MiB against 34.9 MiB stored, **answered by D91** (which also supersedes the allowance share: 0.17% today) | 2026-08-25 |
| [D91](D91.md) | **One aliased column cost ~64 DPU a night** — `to_char(as_of,…) AS as_of` made `ORDER BY as_of` bind to the TEXT output, not the indexed column, so the sort could not inherit index order, `LIMIT 60` bounded nothing and the planner scanned the table. Measured: **64.989 DPU verbatim → 9.508 with the column named**, against 0.559 on the 21-row `inzhur` branch and **1.210 for `count(*)` over all 6,664 rows**. Scanning the index is cheap; scanning the table bills `payload_gzip`. D48's index was capable and never given the chance. Cost now **~173 DPU/month = 0.17%**. `EXPLAIN (ANALYZE, VERBOSE)` prints `Statement DPU Estimate` — use it | 2026-08-25 |
| [D92](D92.md) | **Cross-browser beats offline, and the PWA shell leaves W7** — an owner priority ruling, recorded because it outlives the one deletion it caused. The spec's PWA row was already "installable shell, network-required, no offline", so the service worker vite-plugin-pwa registers was buying only installability at the price of the stack's most browser-divergent machinery. W7's remaining scope shrinks by one item; a bare-manifest install (no service worker) stays available as its own future item. **Supersedes the spec's `PWA \| vite-plugin-pwa` row and the "PWA shell" item in its Phase 3 scope, both annotated in place.** Not decided here: the derivation boundary the same conversation opened (filed as PLAN-OPEN **O28**, questioning the spec's `Derivation` row) and bare-manifest installability (**O29**) | 2026-08-25 |
| [D93](D93.md) | **The ledger's width cap comes off — inside a grid track, the track is the bound** (owner ruling, `/transactions`). `max-w-[884px]` in D88's `1.6fr` track protected nothing and opened a dead strip between the columns; the card now fills its track. Recorded because the cap had already been removed and argued back once — comments, `transactions-layout.test.ts` and `navigation-map.md` all updated in the same change, and the test now pins the cap's ABSENCE. The wide-monitor row stretch is accepted; a row-readability fix, if ever wanted, belongs to the row, not to a card un-filling its track. The form's 560 cap survives as a CONTENT measure — its own in-track binding above ~1800 viewport is priced in the entry; **the form half is superseded by D94 the same day** | 2026-08-25 |
| [D94](D94.md) | **The form cap is scoped to the stacked column** — the call D93 priced and left to the owner, made the same day: `max-w-[560px]` becomes `max-lg:max-w-[560px]`, so beside each other EACH card's own track is the bound (D93's rule, no exception left) and the 560 guards only the stacked column below `lg`, where a full-row form reads as a settings page. Supersedes the form half of D93's "Untouched on purpose" (annotated there); the test pins each card's exact width-token list, collapse prefix read from `/payouts`' row | 2026-08-25 |
| [D95](D95.md) | **No documentation file exceeds 200 lines** — the three plans and `BUILD-PLAN.md` split the way this log did in August: the named file stays put as the index, bodies move verbatim into ID-range files, closed work leaves for `../archive/`, IDs never change. `PLAN-NOW.md` went 2,211 → 58 lines, and `src/docs-line-cap.test.ts` fails the suite if any Markdown file crosses 200 | 2026-08-26 |
| [D96](D96.md) | **One file per decision; the range files are retired** — the append rule and the 200-line cap could not compose, so the bucket they disagreed about is gone. `D<n>` is `D<n>.md` | 2026-08-26 |

## A pattern these entries kept finding

D43, D44, D48, D49, D50, D53, D89 and D91 are eight independent instances of one defect:
**a green indicator that was green because nothing had been attempted.** A dead
alert channel with zero failed notifications, a backfill whose result nobody
read, an archive with deletion protection and no backup, an insert counter that
could not tell a re-run from a re-write, in D53 a failure handler that published no datapoint at all inside the very check written to catch this, in D89 fifteen recovery points that nothing stopped anyone deleting, and in D91 a two-branch query verified on one branch. When adding a check, ask what it reads
when the thing it watches has stopped entirely — if the answer is "the same as
healthy", the check is not one.
