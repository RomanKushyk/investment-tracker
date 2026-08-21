# Phase 8 brief — the period, and the three screens that need it

**Written 2026-08-19.** Input to a separate Claude design session, which produces
`design/extensions/period-and-analytics.dc.html`. Until that extension merges,
**no Phase 8 UI task may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: the 2026-08-18 brainstorm on `/overview`, `/yield` and `/seasonality`,
groomed as **A26** (`../plans/PLAN-NOW.md` § Section I).

Shape is governed by **D56** throughout; the two shells and the 768 breakpoint by
**D66**; scrolling by **D65**. This brief adds no exception to any of them.

---

## Owner decisions, taken 2026-08-18

1. **The sequence is A24 → this brief → A25 → readability last**, and readability
   is last on purpose rather than by neglect: a period control, a second
   seasonality axis and a portfolio XIRR all add content to these three screens.
   Designing the hierarchy of `/yield`'s eight columns and then adding a ninth
   element is drawing the same screen twice.
2. **Nothing on these three screens becomes editable.** Every candidate for
   editing was declined in favour of deriving — which is why A24 derived the
   portfolio start rather than making it a setting. The A22 brief's rule (a page
   is editable where it shows STORED data) therefore holds for all three, now as
   a tested conclusion rather than an assumption.

---

## What the code is today — read 2026-08-19, not assumed

| Fact | Where | Why it matters here |
|---|---|---|
| **NOTHING in `core/derive.ts` is date-bounded.** Every function takes the whole array and answers since-inception | `src/core/derive.ts` | A period is **not a control over existing functions.** `latestQuotes` merges ALL snapshots, `investedByAsset` sums ALL transactions, `netDeposits` sums ALL. This phase needs a windowing layer that does not exist. |
| The ONLY time-walking code in the app | `screens/yield/yield.ts` `cumulativeYieldSeries` | It filters `t.date <= s.date` inline, per point, inside one screen's glue. That is the pattern to lift into `core/`, not to copy a second time. |
| Seasonality buckets by `dayOfMonth(t.date)` | `screens/seasonality/seasonality.ts:18` | A month-of-year axis is the same shape with the month instead of the day. Mechanically trivial; how the two axes coexist is the design question. |
| Expected coupons come from `couponProjection`, **one projected coupon per asset** | `seasonality.ts` `expectedByDayOfMonth` | On a day axis one projection is one bar. On a MONTH axis one projection still lands in exactly one bucket, which will read as "this fund pays only in June". S4 must say what expected means per month. |
| `/yield`'s table is 8 columns; below `md` it is 8 `Fact` rows per card | `screens/Yield.tsx:76-83, 123-147` | Nothing marks any of them as more important. XIRR weighs the same as Invested. |
| `/overview` is 5 KPIs + 4 cards, all "now" | `screens/Overview.tsx` | No figure on it has a time dimension except the derived start date in one sub-line. |
| `portfolioXirr` exists, is tested, and is displayed nowhere | `core/derive.ts` (A25) | Where it goes is this brief's question, stated in as many words in A25's own comment. |

**Measured**, Chromium, demo dataset, 2026-08-19: at 1440 the viewport gives
`main` **1196 px**; `/allocation`'s grid is `340px 1fr` collapsing below `lg`;
the `ScreenHeader` `<h2>` renders at **39 px**.

**The seed spans 2026-02-03 → 2026-07-27** — under six months. Every period
option longer than that is degenerate on it, which is exactly why G-3 exists.

---

## AMENDMENT, 2026-08-20 — what Phase 7 changed under this brief

Written the day before Phase 7 shipped. **A29–A35 have since landed and v1.7.0
is in production**, so five statements above are stale in ways that would
mislead a drawing. Amended in place per the folder rule, because the extension
has not merged.

**1. `ScreenHeader`'s action slot is REAL, not proposed.** S1 calls it "the slot
the A22 brief adds"; A29 shipped it, and `/allocation` and `/portfolio` carry
edit controls in it today. This *strengthens* S1's first candidate in a way the
brief could not argue: **on all three Phase 8 screens the slot is EMPTY**,
because the A22 rule gives a page that displays only DERIVED data no edit
control at all — and `/overview`, `/yield` and `/seasonality` are exactly that.
A period control there collides with nothing and inherits a row whose geometry
is already drawn and shipped.

**2. `main` is 1196 as a BORDER box; its content box is 1124.** `main` carries
`px-9` (36 a side, `src/app/Layout.tsx`). The 1196 above is correct and was
still misread twice during A34/A35 — every column sum must use **1124**. Two
figures in this project were wrong for exactly this reason in the last day.

**3. The sidebar S1's second candidate would sit in has changed.** Since A33 the
three nav groups collapse and persist; the currency toggle lives in band 3 of a
three-band grid whose middle band is the only part that scrolls (D65). A control
placed "near the currency toggle" joins a pinned cluster, not a free column.

**4. There are eleven routes, not ten.** `/transactions` (A32) and `/settings`.
None is a Phase 8 screen, but the nav the sidebar candidate would join is a
different shape.

**5. D77 now governs how faithfully the extension must be followed.** A merged
reference wins the RESULT; the code owns the MECHANISM. Draw the geometry, and
where a static sheet cannot express a case — intermediate widths, viewport
height, a second language — say so in the header instead of drawing one width
and leaving the rest to be guessed.

**6. `core/derive.ts` IS DATE-BOUNDED, and the row above saying it is not was
the stalest line in the brief.** A27 landed 2026-08-19 — the day the brief was
written — and added `src/core/period.ts` (`PeriodOption`, `PeriodWindow`,
`resolveWindow`) plus `transactionsIn(txs, w: PeriodWindow)` at `derive.ts:125`,
`quotesAsOf`, `cashAsOf` and `headlineTotalAsOf`, with `latestQuotes`,
`latestCash` and `headlineTotal` delegating to them. `derive.ts` imports
`PeriodWindow` on line 4. **The windowing layer this brief calls missing already
ships**, and the session must build on it rather than propose it.

This item is here twice over, because the first version of this amendment
CLOSED by re-asserting the false claim — "everything else was re-checked and
stands: `core/derive.ts` is still not date-bounded" — in a note whose entire
purpose is to kill staleness. Caught by review, not by writing. Re-checking a
list is not the same as checking it.

What genuinely was re-checked and does stand: `portfolioXirr` is computed,
tested and displayed nowhere; `/yield` is still 8 columns; and the seed still
spans 2026-02-03 → 2026-07-27.

---

## The spine: a period means three different things

This is the finding the whole brief rests on. **A window does not mean the same
operation to every figure**, and a control that pretends it does will silently
mislead. Three kinds:

| Kind | What a period does to it | Examples |
|---|---|---|
| **FLOW** — accumulates over time | **Sum over the window.** | income received, payouts, deposits, taxes, seasonality's bars |
| **STOCK** — a level at an instant | **Value at the window's END.** "Free cash in the last 12 months" is not a question. | total capital, free cash, share %, position value |
| **RETURN** — relates two instants | **Needs BOTH ends.** The opening value becomes a synthetic inflow. | Δ total, annualized, total return, XIRR |

**Every figure this phase touches must be classified in the extension**, and the
classification must be visible to the reader — not as a label on each number,
but through the design making it obvious which card answers "over this period"
and which answers "as of the end of it". A KPI grid mixing all three with one
period control above it, unmarked, is the failure mode.

**The RETURN row is where the real work is.** `annualizedPct(value, invested,
daysHeld)` divides by a span; under a window `daysHeld` becomes the window
length, which is straightforward. `portfolioXirr` under a window is NOT: it needs
the portfolio's value at the window's open as a synthetic outflow, and that value
has to come from the snapshot on (or before) that date. That is computable — the
data is there — but it is a different formula from the one A25 shipped, and the
brief must not pretend otherwise.

---

## Global constraints

### G-1 — The period is one concept with one writer

Whatever surface carries it, the selected window is **a single value read by
three screens**, not three independent controls that happen to look alike. It
follows the app's existing pattern for exactly this: one owner, everyone else
reads (`app/theme.ts` owns `data-theme`, `app/keyboard-inset.ts` owns
`--keyboard-inset`).

### G-2 — Ephemeral or persisted, and the brief must choose

Two precedents exist and they point opposite ways, which is why this cannot be
left to the implementer:

- **A21** made the currency toggle a **glance** — session only, outside
  `partialize`, because flipping to `$` to read one KPI is not a preference.
- **The A22 brief's S5** makes collapsed sidebar groups **persisted** — a nav
  arrangement is a durable choice.

A period reads more like the second than the first: someone who thinks in
12-month terms thinks that way tomorrow too. **The design session should
default to persisting it** — and if it does, the standing invariant applies:
the field enters `PersistedSettings`, `PERSISTED_DEFAULTS`, `migrateSettings`
**and `partialize`, in the same commit.**

### G-3 — A period longer than the history is not that period

The seed holds under six months. "12 months" on it is "since start" wearing a
longer name, and a figure annualized over a window the data does not fill is the
exact defect A24 just removed from `PORTFOLIO_START`.

**Options longer than the available history must either be absent or say what
they actually did.** The design session picks which, and draws it. What it may
not do is show "12M" over five months of data with no mark.

### G-4 — "Since start" stays the default and stays honest

The default window is the whole history — today's behaviour, byte for byte, so
that a user who never touches the control sees exactly what they see now. Every
D5-pinned demo figure must be reproducible in the default state, and the
acceptance checklist says so per surface.

### G-5 — The windowing lives in `core/`, not in three screens

`cumulativeYieldSeries` already filters by date inline; that is one screen's
glue and it is the only one. Three screens each growing their own window filter
is three chances to disagree about whether a boundary date is inclusive.

**Pure-logic, therefore not design-blocked** — the windowing helpers may be
built before this extension merges. Only the surfaces below wait.

### G-6 — Motion (D7)

Within `docs/archive/BUILD-PLAN.md` → "Motion & interaction standards": soft
curve `cubic-bezier(0.22,1,0.36,1)`, 220 ms default, hover may drop to 150 ms,
reveals 300–400 ms, `active:scale-[.97]` on pressables. The global
`prefers-reduced-motion` kill-switch is always the ultimate fallback.

**One motion already exists and must be honoured:** headline KPI numbers tween
~300 ms whenever they change (`useTweenedNumber`, D7) — currently on the currency
toggle. A period change moves the same numbers, so it uses the same tween rather
than a new one.

### G-7 — Tokens

**No new token should be needed.** Charts take `var(--color-chart-*)` through
`core/colors.ts`; the palette already carries `pos`/`neg`/`warn` and their tints.
If the session believes a new hue is required it names it in the extension's
header comment, in both themes, and says why an existing one will not do.

### G-8 — Hit area, not geometry (D66)

Every new control takes `TAP_44` for its pressable region and keeps the radius
D56 gives its drawn box. A segmented period control is **both**: segment
proportional, track concentric (`segment + padding`).

### G-9 — Ukrainian is the measuring language (D54/D58)

Every width is checked in Ukrainian, the default and the longer language on the
period labels this brief introduces (`Від початку` against `Since start`).
Contract 0: no string here is written in a component.

---

## S1 — The period control

### 1. Purpose, parent, references

The one control that selects the window, and the one place the current window is
named. It serves `/yield`, `/overview` and `/seasonality`.

**Where it lives is the session's first decision**, and the brief deliberately
does not pre-empt it. Two candidates, both with precedent in the app:

- **In `ScreenHeader`'s action slot** — the slot the A22 brief adds for the edit
  control. Per-screen, visible where it acts. Risk: three screens showing the
  same control makes it look like three settings.
- **In the sidebar, near the currency toggle** — one control, plainly global,
  next to the other thing that reframes every figure. Risk: it is far from the
  numbers it changes, and the sidebar is a drawer below `md`.

The session picks one, draws it, and says why in the extension header.

- Reference: master file lines 1–54 (sidebar, currency toggle) and 147–210
  (analytics headers); `design/extensions/mobile.dc.html` for the drawer.

### 2. Content inventory — exact copy, EN + UK

| Key | EN | UK |
|---|---|---|
| default option | `Since start` | `Від початку` |
| option | `1 month` | `1 місяць` |
| option | `3 months` | `3 місяці` |
| option | `6 months` | `6 місяців` |
| option | `12 months` | `12 місяців` |
| option | `Year to date` | `Від початку року` |
| control label (aria) | `Period` | `Період` |
| the G-3 mark | `Full history — shorter than the period you picked.` | `Уся історія — коротша за обраний період.` |

**Ukrainian plurals are the rule, not the English pattern:** `1 місяць` ·
`3 місяці` · `12 місяців` — three forms with the 11–14 exception, the same rule
`i18n/messages.ts` already applies to the delete-cascade sentence. A fixed
`місяців` on every option is a defect.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | `Since start` selected. The app opens here and every figure matches today's. |
| **hover** | Segment/option hover at 150 ms; no layout shift. |
| **focus** | The app's existing focus ring, unmodified. |
| **disabled** | **Options longer than the history: see G-3.** Absent, or present with the mark — never silently short. |
| **loading** | No control until snapshots resolve; a period over data that has not arrived would flash a wrong window. |
| **error** | n/a — selecting a window cannot fail. |
| **empty** | No snapshots → no control. There is no window over nothing, and every screen is already in its empty state. |
| **stale** | n/a. |
| **demo-disabled** | n/a — the demo dataset is real data with a real span. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Select a period | segmented thumb `translateX` | 300 ms soft — **the existing sidebar/Settings toggle value**, not a new one | instant |
| Select a period | every headline number | the existing ~300 ms tween (`useTweenedNumber`, G-6) | instant |
| Select a period | chart series | recharts' own animation as already configured | disabled |

### 5. Tokens

The segmented-control family already in use by the currency toggle and the
dataset switch: `panel`, `panel-border`, `card`, `ink`, `muted`, plus
`sidebar-inset`/`sidebar-text` if it lands in the sidebar. Nothing minted.

### 6. Layout

- Segmented control if the option count stays at or below four; a `Select` (the
  one place the styled native bar survives, D65) if it grows past that. **Six
  options do not fit a segmented track at 360 px in Ukrainian** — the session
  measures this rather than assuming.
- Segment radius `round(min(w,h) × 0.26)`, track concentric at `segment +
  padding` (D56).
- At 360 the control must not push the screen title onto a third line.

### 7. Acceptance

- [ ] Default `Since start` reproduces **every D5-pinned figure** on all three
      screens, byte for byte (G-4).
- [ ] One writer, three readers (G-1); no screen keeps its own copy.
- [ ] If persisted, the field enters `partialize` **in the same commit** as the
      other three persist touchpoints (G-2).
- [ ] A period longer than the history is absent or marked, never silent (G-3).
- [ ] Zero horizontal overflow at 360 in both languages and both themes.

---

## S2 — `/yield` under a period

### 1. Purpose, parent, references

The screen the period matters most to: its annualized column and its four-line
chart are both locked to one window today.

- Reference: master file lines 303–339 (chart + per-asset table + footnote);
  `design/extensions/metrics-exposure.dc.html` for the Total return and XIRR
  columns added in P2.

### 2. Content inventory

Existing column headers, unchanged: `Asset` · `Invested` · `Value now` ·
`Δ total` · `Annualized` · `Total return` · `XIRR` · `vs expected`.

**Two of them stop being true under a window and the copy must move with the
meaning:**

| Today | Under a window | UK |
|---|---|---|
| `Δ total` | `Δ over period` | `Δ за період` |
| `Value now` | unchanged — it is a STOCK, always the window's end | `Вартість зараз` |

The footnote (`yieldNote`) names the basis date. Under a window it must name the
**window**, not the portfolio start, or it will contradict the column beside it.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Today's screen exactly, at `Since start`. |
| **hover / focus** | Table row and chart tooltip behaviour unchanged. |
| **disabled** | n/a. |
| **loading** | Chart and table show their existing skeleton/empty treatment. |
| **error** | n/a. |
| **empty** | Existing `EmptyState`; the A24 footnote already drops when there is no start. |
| **stale** | n/a. |
| **demo-disabled** | n/a. |
| **an asset bought AFTER the window opens** | **The case the session must draw.** Its window return is measured from its first purchase, not the window's open, and the row has to say so — or the table silently compares a 3-week holding against a 12-month one. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Period change | table figures | the existing number tween where a figure already tweens; otherwise instant | instant |
| Period change | chart x-domain | recharts' configured animation | disabled |

### 5. Tokens

`pos` / `neg` for signed figures, `muted` for "—", chart colours from
`core/colors.ts`. Nothing new.

### 6. Layout

- Eight columns is already the maximum this table holds at 1196 px; **the period
  control must not add a ninth**, and if the window forces an extra column the
  session says which existing one gives way (see S6).
- Below `md` the eight `Fact` rows per card stay; a window changes their values,
  not their count.

### 7. Acceptance

- [ ] `Since start` reproduces REIT `+4,41 % / +9,3 % / −4,7 в.п.` and …6475
      `+5,20 % / +10,9 %` exactly.
- [ ] The footnote names the active window and never contradicts the column.
- [ ] An asset younger than the window is marked, not silently compared.
- [ ] `yield.test.ts`'s existing assertions pass unchanged in the default state.

---

## S3 — `/overview` gains a time dimension

### 1. Purpose, parent, references

Five KPIs and four cards, all answering "now". The period gives them a "versus
what" — but **only the ones a period applies to**, which is where the spine
above becomes a layout problem rather than a formula problem.

- Reference: master file lines 147–210; `design/extensions/metrics-exposure.dc.html`
  for the five-KPI grid as it stands.

### 2. Content inventory

Existing labels unchanged. New:

| Key | EN | UK |
|---|---|---|
| KPI delta | `vs period start` | `проти початку періоду` |
| KPI, no comparison | `no comparison in this period` | `немає з чим порівняти в цьому періоді` |

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Today's five KPIs and four cards at `Since start`. |
| **hover / focus** | Unchanged. |
| **disabled** | n/a. |
| **loading** | Existing staggered mount (`STAGGER`), unchanged. |
| **error** | n/a. |
| **empty** | Existing empty states; A24 already drops the capital-gain sub-line when there is no start. |
| **stale** | n/a. |
| **demo-disabled** | n/a. |
| **a STOCK KPI under a window** | **Free cash and Total capital do not change with the window** — they are levels at its end. The design must make that legible without labelling every card, or a user will read an unchanged number as a broken control. |
| **no snapshot at the window's open** | A window opening before the first snapshot, or on a gap day, has no baseline. Fall back to the nearest snapshot on or before it; if none exists, the comparison is absent with the copy above — never zero. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Period change | KPI headline numbers | existing ~300 ms tween (G-6) | instant |
| Period change | a delta appearing/disappearing | `fade-in` 220 ms | instant |

### 5. Tokens

`pos` / `neg` / `pos-on-dark` for the dark capital card (the token the Phase 5
sheet minted for exactly that surface). Nothing new.

### 6. Layout

- The KPI grid keeps five cards. **A delta line is a sub-line, not a sixth
  card** — the grid's proportions are D5-pinned reference geometry.
- Sparklines were raised in the brainstorm and are **deliberately left to the
  session to accept or reject**: they would be a new mark type on a surface that
  has none, and `dataviz` rules apply if they land.

### 7. Acceptance

- [ ] `Since start` reproduces `149 016,36 ₴`, `+4 452,61 ₴ / +3,08 %`,
      `+5 839,99 ₴ / +4,08 %`, `143 176 ₴`, `7,75 ₴`.
- [ ] Stock KPIs are legibly not-windowed; no card is silently inert.
- [ ] A missing baseline reads as absent, never as zero.

---

## S4 — `/seasonality` gains a month-of-year axis

### 1. Purpose, parent, references

Today the screen knows only day-of-month: 31 buckets, `dayOfMonth(t.date)`. For a
portfolio holding semiannual bonds the useful cut is the **month**, and the data
is already there.

- Reference: master file lines 410–458 (day bars + three insight cards).

### 2. The case, from the seed, because it makes the argument better than prose

The seed's eight income rows by month:

| Month | Actual |
|---|---|
| February | **1 763,70** (580,20 REIT + 1 183,50 …8976 coupon) |
| March | 595,80 |
| April | 612,40 |
| May | 472,13 |
| June | 896,55 (680,55 REIT + 216 …6475 coupon) |
| July | 700,36 |

**February is three times March, and the day axis cannot show it** — it puts
580,20 in bucket 10 and 1 183,50 in bucket 25, where they read as two ordinary
days. The bond coupons are precisely what a seasonality screen exists to reveal,
and precisely what the current axis hides.

### 3. Content inventory

| Key | EN | UK |
|---|---|---|
| axis toggle | `By day` | `За днями` |
| axis toggle | `By month` | `За місяцями` |
| empty month | `No income in this month yet.` | `Цього місяця доходу ще не було.` |

Month names come from `t.dates.monthFull` / `monthShort`, which already exist and
are already used by the insight cards.

### 4. State matrix

| State | Treatment |
|---|---|
| **default** | **The session picks which axis opens**, and says why. Day-of-month is today's; month-of-year is arguably the more useful first read. |
| **hover / focus** | Existing bar tooltip and toggle treatments. |
| **disabled** | n/a. |
| **loading** | Existing. |
| **empty** | No income rows → existing empty state on both axes. |
| **stale** | n/a. |
| **demo-disabled** | n/a. |
| **months with no history** | The seed fills 6 of 12. Empty months are drawn as empty buckets, not omitted — a 12-month axis missing months is not a calendar. |
| **EXPECTED coupons on a month axis** | **The trap, and it must be solved not inherited.** `expectedByDayOfMonth` takes ONE projected coupon per asset from `couponProjection`, so on a month axis a semiannual bond shows a single expected bar in one month and nothing in the other — reading as "this bond pays once a year". Either the projection is extended across the schedule, or the expected series is absent on this axis and the design says so. |

### 5. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Axis toggle | segmented thumb | 300 ms soft, as every other segmented control | instant |
| Axis toggle | bars | recharts' configured animation | disabled |

### 6. Tokens

Existing bar colours from `core/colors.ts`; `muted` for empty buckets. Nothing
new.

### 7. Layout

- 12 buckets is roomier than 31; the axis labels that recharts thins to seven
  ticks on the day axis fit unthinned on the month one. **Measured precedent:**
  the Phase 6 brief recorded zero tick collisions at a chart width of 277 px with
  seven ticks, so twelve at the same width needs checking, not assuming.
- The three insight cards below are prose and stay prose here — S6 owns whether
  that survives.

### 8. Acceptance

- [ ] Day axis reproduces the pinned buckets: day 10 = `3 641,44`, day 3 = `216`,
      day 25 = `1 183,50` actual + `1 240` expected.
- [ ] Month axis reproduces the six figures in the table above.
- [ ] The expected series is either correct per month or absent — never one bar
      standing for a semiannual schedule.

---

## S5 — Where the portfolio XIRR goes

### 1. Purpose, parent, references

`portfolioXirr` was built and tested in A25 and is **displayed nowhere**, by
design: A25's own comment defers the placement to this brief. It is the
portfolio's money-weighted annualized return — measured across the boundary of
external capital only (deposits and withdrawals), which makes it the mirror of
the per-asset XIRR already in `/yield`'s table.

**On the seed it is +8.93 %.**

- Reference: `design/extensions/metrics-exposure.dc.html` for the per-asset XIRR
  column it must not be confused with.

### 2. Content inventory

| Key | EN | UK |
|---|---|---|
| label | `Portfolio XIRR` | `XIRR портфеля` |
| the extrapolation mark | `(ann.)` — the existing token | `(річн.)` |

### 3–7

**The session decides the home; the brief pins the constraints.** Three
candidates:

- a **sixth KPI on `/overview`** — but the grid's five-card proportions are
  D5-pinned reference geometry (S3 § 6), so this is the most expensive option;
- a **total row on `/yield`'s table** — where the per-asset XIRRs already are,
  and where the comparison is most meaningful. `/portfolio` already has a Total
  row, so the anatomy exists;
- a **line in `/yield`'s footnote area**, cheapest and quietest.

Constraints that hold whichever wins:

- [ ] It must be **distinguishable from the per-asset column**. The two answer
      about different boundaries and neither is a total of the other — a
      portfolio XIRR sitting under a column of per-asset XIRRs will be read as
      their sum or average, and it is neither.
- [ ] It carries the same `(ann.)` clarity mark under a year of history, from
      the existing `xirrIsExtrapolated`.
- [ ] Null renders `—` in `muted`, like every other null metric on that screen.
- [ ] Under a window it needs the opening value as a synthetic flow (the spine's
      RETURN row) — if the session places it on a windowed screen, the
      implementation task inherits that, and the brief says so here rather than
      leaving it to be discovered.

---

## S6 — Readability of the three screens

**Last, deliberately** (owner decision 1). Everything above adds content; this
section is written now so the session sees the whole shape, but it is drawn after
S1–S5 are settled.

### 1. Purpose, parent, references

Three specific complaints, each measured rather than felt.

### 2–7 — the three, with what is actually wrong

**C1 — `/yield` has eight columns and no hierarchy.** `Asset | Invested | Value
now | Δ total | Annualized | Total return | XIRR | vs expected`, and below `md`
the same eight as `Fact` rows in a card. XIRR — a money-weighted annualized rate
— is given exactly the weight of `Invested`, a number the user typed. The session
decides what leads, what follows and what (if anything) moves behind a
disclosure. **Constraint:** no column may be *deleted* without a decision entry;
they were each added deliberately (P2 `feat/metrics-exposure`, S9b).

**C2 — `/overview`'s order is fixed and two cards compete.** Five KPIs then
Assets, Next payouts, Rebalance, Income. The rebalance hint and the income card
occupy the same visual rank while answering questions of very different urgency.
**Constraint:** the five-KPI grid's proportions are D5-pinned; the cards below it
are not.

**C3 — `/seasonality`'s three insight cards are prose, and prose does not
scale.** "Income anchor", "Coupon season" and "Quiet stretch" are sentences
assembled from tokens (D8) with four assets. At eight the coupon-season sentence
concatenates every bond into one paragraph. **Constraint:** the WORDS stay in
`i18n/messages.ts` and the assembly stays token-based (D8/Contract 0) — this is a
question about form, not about moving strings back into components.

---

## What this brief does not decide

- **Where the period control lives** (S1 § 1) — two candidates with real
  trade-offs, put to the session rather than guessed.
- **Whether `/overview` gets sparklines** (S3 § 6) — a new mark type on a surface
  that has none; the session accepts or rejects it.
- **Which seasonality axis opens by default** (S4 § 4).
- **Which of the three homes the portfolio XIRR takes** (S5).
- **Custom date ranges.** Deliberately out of scope: the fixed options above
  cover the questions a one-user portfolio asks, and a range picker is a surface
  of its own. If it is wanted later it supersedes S1, it does not extend it.
