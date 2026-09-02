# Plan B — Phases W-IV and W-V

> Bodies of the waiting items in these phases. Dated table and rules: [`PLAN-WAITING.md`](PLAN-WAITING.md).

Moved verbatim from `PLAN-WAITING.md` on 2026-08-26 as `W09-W17.md`; renamed by section, 2026-08-27 (D98).

# Phase W-IV — Calendar events

## W9 — First year sealed — **2027-01-01**

The read contract seals a period **on verified completeness, never on the calendar**, and the 01:00 run writes the previous day — so 31 December lands on 1 January. Sealed years serve `Cache-Control: public, max-age=31536000, immutable` with a strong ETag.

- [ ] Do not seal before verifying completeness for the whole year.
- [ ] **Version by filename** (`2026.v1.ndjson` behind a short-TTL manifest). `immutable` cannot be retracted — a wrong price cached under it persists on every device forever, and a filename bump is the only escape.

## W10 / W12 — Maturities — **2027-03-24**, **2028-09-27**

The first redemption is the first production exercise of the `sold` term added to `netResult` on 2026-08-11 (commit `290b26f`). Before that defect was fixed, a redemption inverted the headline sign.

- [ ] Before 2027-03-24, confirm `netResult` receives `soldAmount(transactions)` on every screen that renders it, and that `rollNextCoupon` returns `{kind:'matured'}` rather than rolling past maturity.
- [ ] The maturity row carries **coupon and principal on the same date** (7840 + 100000 kopecks). Confirm the traversal counts the coupon once and does not treat the principal as one.
- [ ] `status` flips around delisting and `bond_terms` is the only surviving copy of the schedule afterwards — verify it was captured before the instrument disappears.

## W11 — AWS credits expire — **2027-07-29**

$119.99, 12 months from account creation. Burn to date is **$0.01 in ~2 weeks**, so credits were never the binding constraint and expiry costs nothing in practice. Listed because it is a real date on the account, not because it needs action.

No closure deadline remains — the account moved to the Paid plan on 2026-08-10, retiring the 6-month Free-plan clock that would have closed it on 2027-01-29.

**Standing guardrail, unchanged:** $5 monthly budget, absolute alert thresholds at $1 and $3 actual and $5 forecast, all to the owner's email. Absolute rather than percentage because at a ~$0.02 baseline percentage thresholds fire on noise. **No budget actions attached** — notification only, never automated shutdown.

---

# Phase W-V — Sequenced after the migration by judgment, not by a gate

These two are **not blocked** — they are deferred on purpose, and the reason is written down so nobody re-derives it or, worse, quietly starts them.

## W13 — Phase 6: chart analytics — **after W7**

**Technically startable today.** The logic is pure: `core/dates.filterRange`, `useDateRange` on `useSearchParams`, `core/day-deltas.ts`. Deferred because every *browser* checkpoint would need re-verifying after W7 replaces the persistence layer, and the phase is checkpoint-heavy — five chart screens × presets × themes × 360 px. Doing it twice costs more than waiting.

**If it is pulled forward anyway** (a legitimate call if the migration slips), the pinned trap fixes in `NEXT-PHASE-PLAN.md` are non-negotiable — they were bought with the formula audit. The one that gets broken by accident: ~~**annualized keeps the PORTFOLIO_START `daysHeld` basis regardless of the selected window.** A range filter that changes an annualised figure is a wrong figure, not a filtered one.~~ **SUPERSEDED 2026-08-24 by D80** — and it WAS broken by accident, in A39, three days before anyone noticed. The ruling went the other way on measured evidence (F-2), but the accident is the point this sentence was making: the change reached `dev` with no decision and without F-3's grey, which is the combination neither source argued for.

## W14 — Phase 7: DB browser — **after W7, by construction**

Not a judgment call. It is built directly on the repository write surface, which W7 replaces — building it first means building it twice.

Two things already decided that shape it: `deleteAsset` is retired (assets accumulate, nothing is deleted), so the browser may edit but not delete assets; and impact hints are derived from core (`"removes 14 transactions, quotes on 174 days; Income received −₴472,13"`), not counted in the component.

## W15 — Import the provider's fund NAV history — **GATE MET 2026-09-03**

**What these rows are allowed to become is now settled — D74, closing O21.**
They are **archived as published and read by no screen.** The read-time
conversion to `sell` is rejected permanently, not deferred: the 0.9 % spread is
undocumented and verifiable over 75 days against a history reaching back to
2024-11-14. Drawing the series as its own labelled line is *not* refused — it is
simply not now, and it needs a design brief (G7) rather than a component. None of
that changes a single box below; it changes what may be built on top of them.

**Scope added 2026-08-24, from measuring the provider's public surface** (all
of it in `docs/reference/INZHUR-FUND-HISTORY.md`):

- **D83 supersedes the by-hand rule** — fetch the files from the CDN link on the
  offer page. Do not poll a known URL: the filename carries a content hash, so a
  new cut appears at a new address and the old one keeps returning the stale
  file. Re-read the offer page for the current link; `Last-Modified` confirms the
  cut.
- **The offer-page quote payload is devalue-encoded.** The numbers inside
  `{"buy":…,"sell":…,"nav":…}` are indices into a shared table, not prices. A
  literal read records `1354` as a unit price and nothing downstream would catch
  it. Take the rendered DOM or resolve the table.
- **Quarterly «Довідка ВЧА» PDFs are a free validation** the plan was not using —
  the provider's own attested quarter-end NAV, four quarters for REIT and eight
  for Energy. **Assert agreement only on quarters the series covers** — Energy's
  earliest PDF (30.09.2024) predates its `.xlsx` start (2024-11-14) and has no
  rows behind it.
- **A third file exists and is NOT this task's scope**:
  `Inzhur_REIT_dividendi_28_07_*.xlsx`, dividend history per certificate. It is a
  payment series, not a price observation, so it does not belong in
  `price_observation` and W4's natural-key decision does not gate it. Recorded
  here only so it is not silently imported into the wrong table or silently
  dropped; it needs its own home and its own gate before anyone loads it.
- **Do not check NAV by dividing assets by certificates** — for REIT it leaves
  129 706 541 ₴ unexplained (2.04 % of the stated total, 2.09 % of the derived
  one) because ВЧА is net and «Вартість активів фонду» is gross. Either figure is
  close enough to the pinned 0.9 % to be mistaken for a basis error.
- **No exchange-priced alternative exists**: all ten funds report
  `UkrainianStockExchange: false`, so ПФТС cannot price them. D72's "exists
  nowhere else" is confirmed.

**Gate: W4 — MET 2026-09-02, and the reason it was a gate is not impatience.** The series lands in
`price_observation`, whose Inzhur-side natural key `(as_of, ref, basis, source)`
W4 exists to decide. Writing 900 rows into a key that is still being designed is
exactly the "schema decided on thin evidence" W3 was created to avoid — and DSQL
primary keys are immutable, so a wrong one is a DROP/CREATE of a live archive
rather than a migration.

**There is also no user-visible payoff before W7.** `src/` reads nothing from the
backend today; the app cannot display an archived observation until the
migration. So the whole value of doing this early would be the analysis, and the
analysis is already banked.

**Everything the task needs is written up** in
[`docs/reference/INZHUR-FUND-HISTORY.md`](../reference/INZHUR-FUND-HISTORY.md) for the files themselves and [`INZHUR-PUBLIC-SURFACE.md`](../reference/INZHUR-PUBLIC-SURFACE.md) for D83 and the site —
what the files cover, the arithmetic proving they are `nav` and not `sell`, the
undocumented 0.9 % spread and why it must not be applied, and the one row that is
stored as text and will break a naive parser.

- [ ] Parse both files to `(as_of, instrument_ref, basis='nav', source='inzhur',
      price)`. Handle the text-formatted row explicitly rather than by a
      tolerant number cast — a silent coercion here is a wrong price, not a
      missing one.
- [ ] **Store `nav` as published. Do not derive `sell` into the archive.** The
      0.9 % holds for the 75 days the tracker can check and is unverifiable for
      2024–2025; storing the product would put an unverified number into an
      append-only archive (D69's line, D71's line).
- [ ] The FX column travels as the provider's own, or not at all — **D69 already
      ruled that the provider's rate is not stored**, and this file's rate is the
      same kind of serve-time figure. Decide explicitly, do not default.
- [ ] Idempotent: `ON CONFLICT DO NOTHING` on the natural key, and safe to re-run
      when a newer file arrives with more months.
- [ ] Verify against the owner's tracker over the 2026-04-23 → 2026-07-06
      overlap: implied units must stay whole after dividing by 1.009. That is the
      same check that identified the basis, reused as a regression test.

**The 35-day gap (2026-07-07 → 2026-08-10) is a separate question** and is not
this task. The tracker covers it, but at `sell` and as position value, so it
would need units per date from the transactions sheet — a different source, a
different basis, and a different provenance story.

---

## W16 — User profile page and its settings — **after W7**

**From the owner's idea list, groomed 2026-08-18** (`../archive/plan-a/section-h-1.md`, Section H
records the whole mapping).

**Gate: W7, and it is a gate by construction rather than by judgment.** The app
has no notion of a user. Identity arrives with the B3 migration — Cognito
Essentials, managed login, passkey-first onboarding (D32/D36/D39) and a user
schema (D38/D39: an application creates a DB row, not a Cognito user). A profile
page before that would be a settings screen with a person's name typed into
local storage, which is not a profile and would have to be thrown away.

**Do not confuse it with Settings, which already exists.** Today's `/settings`
holds preferences that belong to the BROWSER — theme, language, currency,
dataset, automation switches, reminders. A profile holds what belongs to the
ACCOUNT and follows it to another device. W7 is exactly the line between those
two, so the split is free if it is drawn then and expensive if it is drawn twice.

- [ ] Decide at W7 which of today's settings are account-scoped and which stay
      local. `dataset` is plainly local; `language` and `theme` are arguable.
- [ ] Needs a design brief (G7) before implementation, like any new screen.

---

## W17 — How a hand-entered value is marked as the user's — **after W7**

**D75 ruled the WHAT and deliberately left the HOW.** A value the user entered by
hand is marked as theirs; a value taken from the archive is not. How that mark is
drawn — a chip, a weight, a dot, a tooltip — is a design question and must not be
invented inside an implementation task.

**Gated on W7 by construction:** the mark distinguishes the two halves of
`coalesce(user_price(a, D), archive(a, D))`, and neither half exists until the
migration lands. Today every value in the app is the user's, so a mark on all of
them would say nothing.

- [ ] It belongs in a brief **with the model notes it will sit beside** —
      `stale` and `revised` already print under a quote row (`QuoteRow.tsx`
      `ModelNote`), and a third annotation on the same line invented separately
      is how a row grows three unrelated vocabularies.
- [ ] **It INVERTS D20 and the brief must say so where a reader will find it.**
      The draft store marks the MACHINE's value; this marks the USER's. One rule
      — mark the exception — with the exception on the other side because the
      default moved from the user's typing to the archive's supply. A reader who
      meets both without that sentence will file a bug against one of them.

