# Design brief — Phase 3: Living data (Inzhur fetch, fixed yield, reminders)

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/NEXT-PHASE-PLAN.md` Phase 3 (+ G5 suggest-only
doctrine, key fact #1 Inzhur endpoint); metric semantics:
`docs/FORMULA-AUDIT.md`; decisions D13, D16 (demo guard `useDataset()`).

**Suggested extension files:** `daily-quotes-live.dc.html` (S1–S5),
`reminders.dc.html` (S6), `automation.dc.html` (S7–S8). The design session
may split differently; one surface must never span two files.

## Global constraints (apply to every surface below)

- **Suggest, never silently write (G5 — binding):** fetched and accrued
  values land ONLY in the draft store or a prefilled, editable confirm UI;
  the user's Save/Confirm press is the sole write path. Nothing in this
  phase auto-records, auto-overwrites a user-typed value, or rewrites
  history. Every surface below is a *suggestion* surface — its visual
  language must always read as "proposed, not saved".
- **Demo-figure invariant (binding):** additive only — no D5-pinned demo
  figure changes (`docs/DECISIONS.md` D5, `navigation-map.md` checkpoints:
  ₴149,016.36 total · +₴4,452.61/+3.08% · deposited ₴143,176 · income
  ₴5,040.94 · top-up ₴11,429.49 · …6475 annualized +10.9%).
- **Demo-mode doctrine (G4/D16):** network surfaces disable in the demo
  dataset — the Fetch-quotes button (S1) and the live Inzhur picker (S7)
  read `useDataset()` and degrade as specced per surface. Pure derivations
  stay ACTIVE in demo: accrual ghosts (S4), the coupon-due card (S5) and
  reminders (S6) run on local data and demo editing is allowed ("Reset demo
  data" is the escape hatch). Every surface states its `demo-disabled` row.
- **Tokens** (`src/index.css` `@theme`) — existing vocabulary: `page`,
  `ink`, `card`, `muted`, `faint`, `hairline`, `panel`, `panel-border`,
  `label`, sidebar family, `pos`, `pos-tint`, `pos-tint-text`,
  `pos-on-dark`, `pos-border`, `neg`, the P2-minted warn family
  (`--color-warn: #8f6b33` · `--color-warn-tint: #f0e6cb` ·
  `--color-warn-tint-text: #6b5527` — every stale/caution state in this
  phase reuses it), the 4 asset hues + `-tint`/`-tint-text`, `chart-*`
  aliases. **New tokens this phase mints — values chosen by the design
  session:** `--color-neg-tint` + `--color-neg-tint-text` — a soft tint
  family of the existing `--color-neg` (#a8695a terracotta) for the
  OVERDUE reminder severity (S6); must stay visually distinct from the
  `energy` asset tint (#efe4e0) and from `warn-tint` (#f0e6cb), with
  tint-text on tint ≥ 4.5:1. The extension file's header comment is the
  single source for the minted values (D14 precedent); implementers copy
  them into `src/index.css` `@theme`. No other new tokens; no ad-hoc hex.
- **Layout:** cards radius 20–24 px; pills/badges/segments/chips radius
  999; inputs radius 10; nested sub-panels radius 16; sidebar 232 px
  (136 px below `sm`); the shell holds at 360 px with no page-level
  horizontal scroll.
- **Type:** `font-display` (Space Grotesk) for headings/buttons/KPI values;
  `font-body` (Spline Sans Mono) elsewhere; microlabels 10 px uppercase
  tracking .12em; body 13 px; row sublines 11 px.
- **Motion (D7):** defaults 220 ms `cubic-bezier(0.22,1,0.36,1)`; hover may
  drop to 150 ms; reveals 300–400 ms; every pressable gets
  `active:scale-[.97]`; `prefers-reduced-motion` collapses everything
  (global kill-switch) — listed per surface below.
- **Numbers/dates:** tables/inputs `68 702,10`; prose/KPIs `₴68,629.36`;
  dates `dd.MM.yyyy`; times `HH:MM` 24-hour; signed values use U+2212 (D8).
  Figures in this brief are illustrations (demo seed, the trimmed live
  fixture `src/core/inzhur/__fixtures__/assets-sample.json`, or the user's
  real dashboard capture: 6 164 × 11.1389 = 68 660.18 ₴) — the app always
  derives them.
- **Structured returns (D8):** all copy below is component-layer English;
  pure modules (`core/inzhur/parse`, `core/accrual`, `core/reminders`)
  return tokens/keys only.

---

## S1 — Fetch-quotes button (5-state machine)

**Purpose/parent/refs:** One click fills the draft inputs of every
Inzhur-linked asset with units × fetched `sellUAH`. Parent: Daily-quotes
header row, design lines 58–62 (h2 + "1 of 4 filled" pill + Date field);
button anatomy per the outline pill, line 92 (`Copy yesterday`). The button
sits in the header row between the progress pill and the `ml-auto` Date
group — it is the phase's headline control and must read as part of the
daily ritual, not as a table action.

**Content inventory (EN):**
- Button label (idle): `Fetch quotes` — outline pill, refresh/cloud-down
  icon 13 px left of the label.
- Loading label: `Fetching…`
- Success flash label: `Fetched 13:05` (then reverts to `Fetch quotes`
  after ~2.5 s; the persistent record lives in the S2 row chips).
- Header microcopy (persistent once a fetch has ever succeeded, muted 11 px
  next to the button): `Inzhur 13:05` — fresh; `Inzhur as of 25.07` — when
  the last-good cache is older than today (stale, warn-colored).
- Error toast: `Couldn't reach Inzhur — check your connection.`
- Error toast action (only when a last-good cache exists):
  `Use values from 25.07` — applies the cached feed to the draft (rows go
  stale-amber per S2).
- No-linked-assets tooltip (`title`, button disabled):
  `No Inzhur-linked assets yet — link one in Settings → Portfolio.`
- Demo tooltip (`title`): `Fetching is disabled in the demo dataset —
  switch to Live in Settings → Data.`
- In-button demo tag: `DEMO` (10 px uppercase micro-pill, warn-tint family,
  right of the label — same family as the sidebar badge, D16).

**State matrix (the 5-state machine + gating states):**

| State | Treatment |
|---|---|
| default (idle) | outline pill (1.5 px `ink` border, transparent bg), icon + `Fetch quotes`; enabled only in live with ≥1 linked asset |
| hover | soft fill `hairline`-level per the outline variant, 150 ms |
| focus | global `:focus-visible` 2 px `ink` outline, offset 2 |
| disabled | no linked assets in live: opacity .5 + `title` tooltip (see copy) |
| loading | disabled; icon rotates (1 s linear loop); label `Fetching…`; draft inputs untouched until resolve |
| success | transient: label `Fetched 13:05`, icon → check, border/text flush `pos` for the flash, then back to idle; linked rows fill + chip `auto` (S2); dirty rows get the S3 affordance instead — NEVER overwritten |
| error | toast (copy above) + optional stale action; button returns to idle (no persistent error styling on the button itself) |
| empty | n/a — the button renders whenever the Daily-quotes header renders |
| stale (stale-cache) | fetch failed but cache served, or cache applied via the toast action: header microcopy `Inzhur as of 25.07` in `warn`; affected rows get warn chips (S2); button back to idle, ready to retry |
| demo-disabled | disabled opacity .5 + in-button `DEMO` micro-tag + `title` tooltip; never removed from the layout (the ritual header keeps its shape in both datasets) |

Machine notes for the design session: idle → loading (click) → success |
error; error → stale-cache (user applies cache) or → idle; success with a
pre-13:00-Kyiv payload date = still success (freshness is the payload's,
`staleTime` runs to the next ~13:00 Europe/Kyiv refresh); a click while the
query is still fresh re-serves the cache instantly — render it as success
(values + chips), not as a new network roundtrip.

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| hover | bg fill | 150 ms | instant |
| press | scale → .97 | 220 ms soft | none |
| idle → loading | icon rotation loop | 1 s linear, repeats | icon static, label alone signals |
| loading → success flash | label crossfade + border/text color | 220 ms soft | instant swap |
| success flash → idle | label crossfade back | 220 ms soft | instant |
| row values fill (linked rows) | input text + chip fade/zoom-in-95, stagger 50 ms per row | 200 ms soft | instant |
| microcopy fresh ↔ stale | color crossfade | 220 ms | instant |

**Tokens:** `ink` (outline), `pos` (success flash), `warn` (stale
microcopy), `warn-tint(-text)` (DEMO tag), `muted` (microcopy), `hairline`
(hover fill). Never `neg` — a failed fetch is a toast, not a red button.
**Layout:** pill radius 999, same height as the progress pill row; at
360 px the header wraps (title row, then pill + button row, then Date) with
no horizontal scroll.
**Acceptance:**
- [ ] All 5 machine states reachable and visually distinct: idle, loading, success flash, error (toast + optional stale action), stale-cache (amber microcopy + row chips).
- [ ] Fetch fills ONLY linked, non-dirty rows in the draft store; user-typed values are never overwritten (S3 handles the conflict).
- [ ] Demo: button disabled with in-button `DEMO` tag + tooltip; no request ever leaves the app in demo.
- [ ] Progress pill ("N of M filled") increments from fetch-filled rows exactly as from typed ones.
- [ ] User still presses `Save snapshot` — fetch alone never writes a snapshot (G5).

## S2 — Per-row provenance chips (auto / manual / stale)

**Purpose/parent/refs:** Every quote input of an Inzhur-linked asset shows
where its current draft value came from. Parent: Daily-quotes entry rows,
design lines 65–88 (row anatomy: avatar · name + 11 px subline · input ·
delta chip); chip idiom: the progress pill, line 60.

**Content inventory (EN):**
- Chip `auto` — draft value came from the fetch (or from an accepted S4
  suggestion); paired microcopy right of the chip, muted 10 px:
  `fetched 13:05` (fetch) / `accrual` (accepted suggestion).
- Chip `manual` — the user typed the value into a LINKED row (unlinked
  rows never carry chips — there is no provenance to distinguish).
- Chip `as of 25.07` — stale: value filled from the last-good cache whose
  payload date is older than the selected date (warn family; replaces the
  `auto` chip, no extra microcopy — the date IS the message).
- Chip `title` tooltips: `Filled from Inzhur (units × sell price).` /
  `Typed by hand — fetch never overwrites it.` /
  `From the last successful fetch — Inzhur was unreachable.`

**State matrix:**

| State | Treatment |
|---|---|
| default (no draft) | no chip — an empty linked row is just an empty row |
| auto | 10 px uppercase micro-pill, `pos-tint` bg / `pos-tint-text` text, radius 999, in the subline row after "₴… yesterday"; microcopy `fetched 13:05` muted after it |
| manual | same geometry, `panel` bg / `muted` text — deliberately quiet |
| stale | same geometry, `warn-tint` bg / `warn-tint-text` text, label `as of 25.07` |
| hover | native `title` tooltip only (chips are not pressable) |
| focus | n/a — non-interactive |
| disabled | n/a |
| loading | during S1 loading, existing chips stay unchanged (no flicker) |
| error | n/a — a failed fetch changes no chips (stale only appears when cache VALUES are applied) |
| empty | n/a — covered by default |
| demo-disabled | chips never render in demo (fetch is disabled, so `auto`/`stale` are impossible; `manual` would be noise on every demo row) |

Provenance transitions: typing into an `auto`/`stale` row flips its chip to
`manual` immediately (the fetch value is now edited — it is the user's
number); re-applying fetch via S3 flips it back to `auto`. Saving the
snapshot does not remove chips; they describe the DRAFT and reset with it
(chips are gone next day when the draft is fresh).

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| chip appears / label changes | re-keyed: fade + zoom-in-95 | 150 ms | instant |
| auto ↔ manual ↔ stale flips | bg/color crossfade on the re-keyed chip | 150 ms | instant |

**Tokens:** `pos-tint(-text)` (auto), `panel` + `muted` (manual),
`warn-tint(-text)` (stale). Never asset hues, never `neg`.
**Layout:** chips live in the name block's subline row (wrap with it at
360 px); they must not widen the row past the input+delta columns.
**Acceptance:**
- [ ] Chips appear only on Inzhur-linked rows with a draft value; unlinked rows byte-identical to v1.
- [ ] `auto` + `fetched HH:MM` after fetch; typing over flips to `manual` on the first keystroke.
- [ ] Stale chip shows the cache's payload date `as of dd.MM`, warn family only.
- [ ] Demo dataset: no chips anywhere; row anatomy identical to the P2 state.

## S3 — Dirty-field "Use fetched?" inline affordance

**Purpose/parent/refs:** The no-silent-overwrite rule made visible: when a
fetch returns a value for a row whose draft the user already typed, the
fetched number is OFFERED under the input, never applied. Parent: the
Daily-quotes entry row (design lines 65–88), rendered as a second row-line
under the input column.

**Content inventory (EN):**
- Affordance pill (pressable): `Use fetched 68 660,18?` — table-format
  number, applies the fetched value to the draft (chip → `auto`).
- Dismiss: `×` icon-button right of the pill (11 px, `muted`), keeps the
  typed value, hides the affordance until the NEXT fetch resolves.
- `aria-label` for the dismiss: `Keep my value`.

**State matrix:**

| State | Treatment |
|---|---|
| default | ghost pill: dashed 1 px `faint` border, transparent bg, `ink` text 11 px, radius 999, aligned under the input (right-aligned in the row); `×` after it |
| hover | pill bg `page`-level soft fill, 150 ms; `×` opacity .85 → 1 |
| focus | global ring on pill and on `×` separately (both tabbable) |
| disabled | n/a — the affordance either exists or does not |
| loading | n/a — it appears only after a fetch resolves |
| error | n/a |
| empty | n/a — never renders without both a dirty draft AND a differing fetched value |
| stale | when the offered value comes from cache, the pill reads `Use 68 660,18 (as of 25.07)?` — warn-tint dashed border instead of `faint` |
| demo-disabled | never renders in demo (no fetch) |
| resolved | press → pill collapses, input re-renders with the fetched value + `auto` chip; dismiss → collapses, `manual` chip stays |

Equality guard: the affordance never appears when the typed value equals
the fetched one after parse (`68 660,18` typed vs 68 660.18 fetched — no
offer, chip flips to `auto` silently is WRONG; chip stays `manual`, simply
no offer). Only a *differing* fetched value creates the offer.

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| affordance appears | fade + slide-from-top-1, height reveal | 300 ms soft | instant show |
| accept / dismiss | fade + height collapse; input value crossfades | 220 ms soft | instant |
| press | scale → .97 | 220 ms | none |

**Tokens:** `faint` (dashed border), `ink` (label), `page` (hover fill),
`warn-tint`/`warn` (stale variant border/text), `muted` (`×`).
**Layout:** one line under the input column, right-aligned; the row grows
vertically (rows below shift softly); at 360 px the pill wraps whole, never
truncates the number.
**Acceptance:**
- [ ] Typed drafts survive every fetch untouched; the affordance is the only path to the fetched value.
- [ ] Accept applies exactly the offered value (draft + `auto` chip); dismiss keeps everything and stays hidden until the next fetch resolve.
- [ ] Appears per-row, only where typed ≠ fetched.
- [ ] Both pill and `×` are keyboard-reachable with visible focus.

## S4 — Ghost "suggested" quote-input state (fixed-coupon accrual)

**Purpose/parent/refs:** With `autoQuoteSuggest` on, an UNQUOTED
fixed-coupon asset's input shows the accrual carry-forward
(`core/accrual.suggestedQuote`: last quote + daily accrual × days, coupons
in the gap subtracted; Inzhur-linked bonds prefer units × fetched price via
S1 instead) as a GHOST value — visible, one tap from real, but not a draft.
Parent: the quote input, design lines 80–88 (…8976/…6475 rows); must be
unmistakably distinct from BOTH the user-typed state (solid border, ink
text) AND the saved/valid-green state (`pos-border` border) AND the plain
placeholder (yesterday's value, disappears on focus).

**Content inventory (EN):**
- In-input ghost value: `15 907,45` (table format, rendered as real text in
  `muted`, NOT via `placeholder`).
- Micro-tag inside the input's top-right corner area or right of it
  (design session's call): `suggested` — 9–10 px uppercase.
- Accept affordance under the input (same idiom/slot as S3):
  `Use suggested 15 907,45?` + `×` dismiss (`aria-label`:
  `Dismiss suggestion`).
- Input `title`: `Suggested from coupon accrual — accept or type your own.`

**State matrix:**

| State | Treatment |
|---|---|
| default (ghost) | input border DASHED 1 px `hairline`, bg `card`, value text `muted`, `suggested` micro-tag `faint`; delta chip stays `—` (a ghost is not a value); NOT counted in "N of M filled" |
| hover | dashed border → `faint`, 150 ms |
| focus | global ring; ghost text stays until the first keystroke |
| disabled | n/a |
| loading | n/a — accrual is synchronous local math |
| error | n/a — a ghost can never be invalid (it is derived) |
| empty | no last quote to carry forward (asset never quoted) → no ghost, plain empty input |
| stale | n/a — accrual recomputes from local data every render |
| demo-disabled | ACTIVE in demo (pure derivation) — demo's …8976/…6475 rows may show ghosts when unquoted; `autoQuoteSuggest` off kills the state everywhere |
| accepted | via affordance press or typing the same digits: real draft, solid border, ink text, counts filled, chip `auto` + microcopy `accrual` (S2) |
| typed-over | first keystroke clears the ghost text and micro-tag instantly; normal manual editing from that keystroke on |

Precedence: for an Inzhur-LINKED fixed-coupon asset, a successful fetch
(S1) fills a real draft and the ghost never shows; the accrual ghost is the
fallback for unlinked bonds or before any fetch today. `autoQuoteSuggest`
(S8) gates the whole state.

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| ghost appears on mount | fade-in with the row (no separate pop) | 300 ms soft | instant |
| accept | border dashed→solid + text muted→ink crossfade; affordance collapses | 220 ms soft | instant |
| type-over | ghost text/micro-tag fade out | 150 ms | instant |
| dismiss | ghost + affordance collapse to plain empty input | 220 ms soft | instant |

**Tokens:** `hairline`/`faint` (dashed border), `muted` (ghost text),
`faint` (micro-tag), `card` (bg). NEVER `pos-border` (reserved for real
valid values) and never `pos-tint` — a suggestion must not look saved.
**Layout:** input geometry unchanged (h 36, radius 10, max-w 160); the
micro-tag must not push the value out of the input at 360 px (the design
session may place it outside the input, right-aligned above the affordance).
**Acceptance:**
- [ ] Four states visually distinct side by side: empty+placeholder / ghost-suggested / typed (ink, solid) / valid-green (`pos-border`).
- [ ] Ghost never counts as filled, never saves with the snapshot, never shows a delta.
- [ ] Accept → real draft + `auto`/`accrual` provenance; dismiss → plain empty input until tomorrow (or until toggled off/on).
- [ ] `autoQuoteSuggest` off → no ghosts anywhere; works in demo when on.
- [ ] Fixed-coupon assets created by users (not just seed bonds) get ghosts — the silently-skipped-asset fix rides this task.

## S5 — Coupon-due suggestion card

**Purpose/parent/refs:** When `core/accrual.dueCoupons` finds a coupon date
≤ today with no matching `interest_payout` in the window, a suggestion card
offers one-tap recording. Parent: the Daily-quotes aside — the card renders
ABOVE the Transaction panel (design lines 101–133), i.e. between the quote
rows and the TransactionPanel in DOM/flow order (at 360 px it stacks
exactly between them). Sub-panel idiom: the dashed "New asset details"
reveal, lines 116–125; editable amount precedent: G5 (seed paid 1 183,50 vs
scheduled 1 240).

**Content inventory (EN):**
- Card microlabel: `Coupon due` (+ warn-tint micro-pill `25.07` with the
  due date when it is in the past).
- Title line (13 px semibold): `OVDP UA4000238976 — coupon ₴1,240.00`
- Body (12 px muted): `Scheduled for 25.07.2026. Confirm to record it —
  the amount is editable, history is never rewritten.`
- Amount field label: `Amount, ₴` — decimal input prefilled from
  `couponAmount` (or the Inzhur `paymentSchedule` forecast when linked:
  7840 kopecks → `78,40`-style per-unit × units); table format `1 240,00`.
- Paired-reinvest checkbox label: `Also record a reinvest of this amount`
  — helper microcopy: `Same date, same asset — the payout then counts as
  reinvested, not paid out.`
- Confirm button (primary dark pill): `Record coupon`
- Skip button (ghost): `Skip`
- Success toast: `Coupon recorded` (variant with reinvest:
  `Coupon + reinvest recorded`).
- Error copy (invalid amount): `Enter an amount.` (pinned form message).
- Multiple due coupons → one card per coupon, stacked (aside order:
  cards, then Transaction, then Recent transactions).

**State matrix:**

| State | Treatment |
|---|---|
| default | white `card`, radius 20, DASHED 1 px `faint` border (suggestion, not saved), padding 16–20; microlabel + title + body + amount + checkbox + button row |
| hover | confirm/skip per their button variants; card itself inert |
| focus | ring on every control |
| disabled | `Record coupon` disabled while the mutation is pending (opacity .5) |
| loading | n/a beyond pending-disable (derivation is local) |
| error | amount invalid: `neg` border + message under the field; confirm blocked |
| empty | no due coupons → no cards (the aside starts with Transaction, byte-identical to P2) |
| stale | overdue > 0 days: the date micro-pill uses `warn-tint(-text)`; card border stays `faint` (urgency lives in S6's strip, not here) |
| demo-disabled | ACTIVE in demo (writes allowed there); card identical in both datasets |
| confirmed | card collapses; one `interest_payout` (+ optional paired `reinvest`, same date/asset/amount) recorded via the existing transaction path; `nextCoupon` rolls forward exactly once (clamped at maturity; at maturity → flag-only, no further suggestions) |
| skipped | card collapses; the suggestion's derived id (`coupon:assetId:date`) joins `dismissedReminders` — it will not re-offer for this occurrence; the NEXT coupon date suggests normally; restore path = S8 |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| card appears | fade + slide-from-bottom-1 with the aside's mount | 300 ms soft | instant |
| confirm / skip | height collapse + fade out; cards below slide up | 300 ms soft | instant remove |
| checkbox toggle | check draw/fill | 150 ms | instant |
| press (either button) | scale → .97 | 220 ms | none |
| amount error | message fade + slide-from-top-1 | 220 ms | instant |

**Tokens:** `card`, `faint` (dashed border), `ink`, `muted`, `label`,
`neg` (validation only), `warn-tint(-text)` (overdue date pill), primary
button = `ink` bg + `card` text per the existing dark pill.
**Layout:** full aside width (max-w 360), radius 20, dashed sub-panel
idiom; controls stack; fits 360 px unclipped.
**Acceptance:**
- [ ] Card appears only for due/overdue coupons with no matching `interest_payout` in the window (dedupe vs manually recorded ones).
- [ ] Confirm records exactly one `interest_payout` (+ one paired `reinvest` when checked) and rolls `nextCoupon` once — StrictMode double-fire safe.
- [ ] Amount editable; prefill from attributes or Inzhur schedule; no `tax` row ever drafted (D13/G5).
- [ ] Skip dismisses this occurrence only; restorable from Settings → Automation.
- [ ] `couponSuggest` off → no cards; aside identical to P2.

## S6 — ReminderStrip + app-open toast

**Purpose/parent/refs:** Serverless derive-don't-schedule reminders
(`core/reminders.computeReminders` → `quote-missing:today`,
`coupon:id:date` ≤ lead days, `coupon-overdue:id:date`, `maturity:id:date`
≤ 30 d). Parent: a banner strip rendered ABOVE the screen content on `/`
(above the header row, design line 58) and `/overview` (above the
`ScreenHeader`, lines 147–150); one toast on app open (sonner, existing
toaster). Severity → tint mapping is this surface's core design job.

**Content inventory (EN):**
- Banner copy per kind (component assembles from reminder tokens):
  - quote-missing (warn): `No quotes saved today yet.` — action link
    (only on `/overview`): `Enter quotes →` (navigates `/`). This kind is
    SUPPRESSED on `/` itself (the ritual UI already says it — progress
    pill).
  - coupon upcoming (info): `OVDP UA4000238976 pays a coupon in 5 days
    (25.08.2026).`
  - coupon overdue (overdue): `OVDP UA4000238976 coupon was due
    25.07.2026 — record it on Daily quotes.` — action link on `/overview`:
    `Open Daily quotes →`; on `/` no link (the S5 card is right there).
  - maturity (info): `OVDP UA4000236475 matures in 23 days (27.09.2028).`
- Dismiss button per banner: `×` — `aria-label`: `Dismiss reminder`.
- App-open toast (once per app load, only if ≥1 undismissed reminder):
  highest-severity reminder's banner text; if more exist, suffix
  ` · +2 more`. Toast is informational (default sonner look, no action).
- Empty/none: strip renders nothing (zero height, no placeholder).

**State matrix:**

| State | Treatment |
|---|---|
| default | one full-width banner row per reminder, stacked gap 8, radius 16, padding 12 × 16; 13 px text; severity icon left (info `i`, warn `!`, overdue clock — lucide, 16 px); `×` right |
| hover | `×` opacity .85 → 1; action link underline-fades in |
| focus | ring on `×` and on the action link |
| disabled | n/a |
| loading | strip renders only after queries resolve (no skeleton — it appears with the data) |
| error | n/a |
| empty | nothing rendered — the screens are byte-identical to P2 when no reminders fire |
| stale | n/a — reminders recompute from local data every render |
| demo-disabled | ACTIVE in demo (`remindersEnabled` gates globally; demo data legitimately fires quote-missing) |
| severity: info | bg `pos-tint`, text/icon `pos-tint-text` (matches the "Next payouts" green-tint idiom — an upcoming payout IS good news) |
| severity: warn | bg `warn-tint`, text/icon `warn-tint-text` |
| severity: overdue | bg `neg-tint`, text/icon `neg-tint-text` — the phase's minted family; reserved for overdue ONLY |
| dismissed | banner collapses; derived id joins `dismissedReminders` (settings); ids naturally expire when the underlying condition passes (derived-id doctrine); restore path = S8 |

Ordering: overdue → warn → info; within a severity, by date ascending.
The strip caps at 3 visible banners; further reminders collapse into a
final muted line `+2 more reminders` (pressable, expands the strip).

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| strip mount | banners fade + slide-from-top-1, stagger 60 ms | 300 ms soft | instant |
| dismiss | height collapse + fade; banners below slide up | 220 ms soft | instant remove |
| expand `+N more` | height reveal | 300 ms soft | instant |
| toast | sonner's built-in enter/exit | library default | library handles |
| press (`×`, links) | scale → .97 | 220 ms | none |

**Tokens:** `pos-tint(-text)` (info), `warn-tint(-text)` (warn),
`neg-tint(-text)` (overdue — minted this phase, values from the extension
header), `muted` (`+N more`). Banner text NEVER uses raw `neg`/`pos` — the
tint-text tokens carry the contrast.
**Layout:** full content width above the screen header; radius 16; at
360 px text wraps, `×` stays top-right, no horizontal scroll.
**Acceptance:**
- [ ] Severity → tint mapping exact: info/pos-tint, warn/warn-tint, overdue/neg-tint; minted `neg-tint(-text)` used nowhere else.
- [ ] Dismissed ids persist (settings), expire naturally, and restore via S8.
- [ ] quote-missing suppressed on `/`, shown on `/overview`; action links navigate.
- [ ] Exactly one toast per app open, only when ≥1 undismissed reminder exists.
- [ ] `remindersEnabled` off (or lead-days edits) reflected immediately; strip absent when empty — zero layout shift vs P2.

## S7 — AssetForm Inzhur ref: live picker upgrade

**Purpose/parent/refs:** The P2 manual slug/ISIN text field
(`design/extensions/asset-form.dc.html`, Inzhur group; implementation
`src/components/forms/AssetForm.tsx` Kind + ref row) upgrades to a picker
fed by the live feed (`useInzhurAssets`, fetched on demand). Parent: the
AssetForm Inzhur group in both hosts (Settings dialog + TransactionPanel
quick-create). Select anatomy: the existing `Select` primitive (radius 10,
h 36, `page` bg).

**Content inventory (EN):**
- Field label (unchanged by kind): `Fund` → picker of funds;
  `Bond` → picker of bonds (label stays `Fund slug` / `Bond ISIN` in
  manual-fallback mode only).
- Picker placeholder: `Pick from Inzhur…`
- Option rows: funds `Inzhur REIT · inzhur-reit` (title + slug, slug
  muted); bonds `UA4000238976 · matures 24.03.2027` (ISIN + maturity,
  maturity muted).
- Loading row (inside the open picker): `Loading Inzhur assets…`
- Error row + fallback: `Couldn't load the list — enter it manually.`
  (the picker swaps to the P2 text input, prefilled with anything already
  chosen).
- Manual toggle (always visible under the picker, ghost link 11 px):
  `Enter manually` ↔ `Pick from the list` (round-trips between modes;
  manual mode = the exact P2 text field).
- Demo note (demo dataset, manual mode forced): `Live list is disabled in
  demo — enter the slug or ISIN manually.`
- Updated group helper line (replaces the P2 "Fetching arrives in the next
  release…" copy): `Linked assets are valued as units × the fetched sell
  price — use Fetch quotes on Daily quotes.`

**State matrix:**

| State | Treatment |
|---|---|
| default | Select-idiom trigger (h 36, radius 10, `page` bg, `hairline` border); fetch fires on first open per form mount |
| hover | border → `faint`, 150 ms |
| focus | global ring |
| disabled | n/a — the group only renders when the link toggle is on |
| loading | open list shows the loading row (muted, non-selectable) with a subtle pulse |
| error | list closes into the manual text input + error helper in `muted` (NOT `neg` — offline is normal, not a user mistake); retry via `Pick from the list` |
| empty | feed parsed but zero entries of the active kind: row `Nothing of this kind in the feed — enter it manually.` |
| stale | last-good cache feeds the list when live fetch fails AND a cache exists: options render normally + list footer microcopy `as of 25.07` in `warn` |
| demo-disabled | picker never renders in demo — manual text field + demo note (the P2 experience, explained) |
| selected | option fills `ref`; trigger shows the option's primary text; validation unchanged (pinned P2 messages `Enter the fund slug.` / `Enter the bond ISIN.` apply in manual mode) |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| picker open/close | existing Select open/close (fade + zoom-in-95) | 220 ms soft | instant |
| loading pulse | opacity oscillation on the loading row | 1.2 s ease-in-out loop | static text |
| picker ↔ manual swap | crossfade + height | 220 ms soft | instant swap |
| option hover | bg `page` fill | 150 ms | instant |
| press | scale → .97 on trigger | 220 ms | none |

**Tokens:** `page`, `hairline`, `faint`, `muted`, `warn` (stale footer),
`ink`. `neg` only for the pinned validation messages in manual mode.
**Layout:** picker inherits the ref field's grid slot (Kind segment left,
ref right); options list max-h ~240 px, scrolls internally; fits 360 px in
both hosts.
**Acceptance:**
- [ ] Picking an option stores the same `inzhur.ref` string the manual field would (slug/ISIN) — schema and patch mappers untouched.
- [ ] Error/offline path always lands in a working manual input — linking is NEVER blocked by the network.
- [ ] Demo forces manual mode with the demo note; no request leaves the app.
- [ ] Kind flip (Fund ↔ Bond) swaps the option set and the manual labels/placeholders exactly as P2 pinned.
- [ ] Group helper line updated to the new copy in BOTH hosts.

## S8 — Settings → Automation section

**Purpose/parent/refs:** The P2 placeholder card ("Nothing to configure
yet…", `src/screens/Settings.tsx`) becomes the phase's control home.
Parent: Settings → Automation card (S2 of the P2 brief; extension
`design/extensions/settings.dc.html` card 3) — reuses the pinned
`SettingRow` (title + helper left, control right) + `Divider` idiom and the
P2 switch anatomy (track 40 × 22 radius 999, off `hairline`/`panel-border`,
on `ink`; 16 px `card` thumb — the AssetForm `InzhurSwitch`).

**Content inventory (EN):**
- Row 1 — title: `Quote suggestions`; helper: `Pre-fill ghost values for
  unquoted fixed-coupon assets from coupon accrual. Suggestions stay
  ghosts until you accept them.`; control: switch (`autoQuoteSuggest`,
  default ON).
- Row 2 — title: `Coupon suggestions`; helper: `Offer one-tap recording
  when a coupon date arrives. Every entry is confirmed by you — amounts
  stay editable.`; control: switch (`couponSuggest`, default ON).
- Row 3 — title: `Reminders`; helper: `In-app banners for missing quotes,
  upcoming and overdue coupons, and maturities. Nothing leaves the app.`;
  control: switch (`remindersEnabled`, default ON).
- Row 4 (indented sub-row of Reminders, hidden while reminders are off) —
  title: `Lead time, days`; helper: `How many days ahead coupon reminders
  appear.`; control: decimal input w ~72 px, prefilled `7`, valid range
  1–30 integers; error: `Enter 1–30 days.`
- Row 5 (sub-row, hidden while reminders are off) — title:
  `Dismissed reminders`; helper: `Dismissed banners stay hidden until
  their date passes.`; control: outline button `Restore dismissed (3)` —
  count = current `dismissedReminders` length; disabled at 0 with label
  `Restore dismissed`; success toast: `Dismissed reminders restored`.
- The S1/S7 demo constraint is NOT repeated here — fetching has no toggle
  (it is a manual click by construction).

**State matrix:**

| State | Treatment |
|---|---|
| default | 3 top-level `SettingRow`s + 2 reminder sub-rows, dividers between top-level rows; switches per the pinned track/thumb anatomy |
| hover | switch/button per their variants; input border → `faint` |
| focus | global ring on every control |
| disabled | `Restore dismissed` at count 0: opacity .5, no count suffix |
| loading | n/a — synchronous local store |
| error | lead-days invalid: `neg` border + `Enter 1–30 days.`; store keeps the last valid value (S8/P2 usdRate precedent) |
| empty | n/a |
| stale | n/a |
| demo-disabled | n/a — all three features run in demo (doctrine above); the card is identical in both datasets |
| reminders off | sub-rows 4–5 collapse (height + fade); strip/toast/coupon-reminder banners all cease; S5 cards are governed by `couponSuggest`, not this switch |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| switch flip | thumb transform + track color | 220 ms soft | jump |
| sub-rows reveal/collapse | height + fade + slide-from-top-1 | 300 ms soft | instant |
| press | scale → .97 | 220 ms | none |
| error message | fade + slide-from-top-1 | 220 ms | instant |
| restore button count change | re-keyed label fade | 150 ms | instant |

**Tokens:** `ink` (switch on), `hairline`/`panel-border` (switch off),
`card` (thumb), `muted`, `neg` (validation), existing button variants.
**Layout:** rows follow the pinned label-left/control-right pattern,
wrapping to stacked below ~480 px; sub-rows indent 12 px with a `hairline`
left rule; fits 360 px.
**Acceptance:**
- [ ] All five persisted fields (`autoQuoteSuggest`, `couponSuggest`, `remindersEnabled`, `reminderLeadDays`, `dismissedReminders`) enter `partialize` + `PersistedSettings` + `PERSISTED_DEFAULTS` + `migrateSettings` in the same commit (G3/D11); defaults ON / ON / ON / 7 / `[]`.
- [ ] Each toggle's effect is immediate on its surfaces (S4 ghosts, S5 cards, S6 strip/toast) without reload.
- [ ] Lead-days edits re-window coupon reminders immediately; invalid input never writes.
- [ ] Restore clears `dismissedReminders`, re-surfacing everything still in window (incl. S5-skipped coupons).
- [ ] The P2 placeholder copy is fully gone.

---

## Phase-wide acceptance (the design session's definition of done)

- [ ] Every surface above has a corresponding region in a
      `design/extensions/*.dc.html` file, master-idiom inline styles, exact
      values literal; one surface never spans two files.
- [ ] The minted `--color-neg-tint`/`--color-neg-tint-text` values are
      defined once in an extension header comment, used ONLY for the
      overdue reminder severity, distinct from `energy-tint` and
      `warn-tint`, tint-text ≥ 4.5:1 on tint.
- [ ] The suggestion visual language is coherent and unmistakable across
      S3/S4/S5: dashed borders + ghost/muted values = proposed; solid +
      ink = user's; `pos-border`/`pos-tint` = valid/saved (never used for
      suggestions).
- [ ] The 5 fetch-button states, 3 provenance chips, 4 input states
      (empty/ghost/typed/valid) and 3 reminder severities are each drawn or
      annotated; motion annotations may be comments in the markup.
- [ ] Demo-disabled treatments drawn where specced (S1 button + DEMO tag,
      S7 manual fallback + note); demo-active surfaces (S4/S5/S6) shown
      identical to live.
- [ ] No D5-pinned demo figure appears altered anywhere in the extension
      mock copy; Inzhur illustrations use the fixture/dashboard figures
      (sellUAH 11.1389 · 6 164 units · 68 660,18 · coupon 78,40 · maturities
      24.03.2027 / 27.09.2028).
