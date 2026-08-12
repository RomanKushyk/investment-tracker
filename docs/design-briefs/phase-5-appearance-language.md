# Phase 5 brief — appearance & language

**Written 2026-08-12 (A8).** Input to a separate Claude design session, which
produces `design/extensions/appearance-language.dc.html`. Until that extension
merges, **A9 (dark theme) and A10 (Ukrainian) may not start** — G7.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Owner decisions taken 2026-08-12, and they set the whole shape:

1. **Theme has three states** — Light / Dark / **System**, System being the
   default. Not two.
2. **Ukrainian is the default language; English stays** as the second.
3. **Formatting separates completely per language, with no exceptions.**

---

## Contract 0 — the formatting split (read this before anything else)

This is the sharpest new contract in the phase and the one with the longest
reach, so it comes before the surfaces.

**Today the app mixes two conventions.** Tables already use the Ukrainian form
(`68 702,10` — narrow-space thousands, comma decimals) and dates are `dd.MM.yyyy`,
while prose and KPIs use the English form (`₴68,629.36` — comma thousands, dot
decimals, symbol first). That mixture is what the owner ruling rejects.

From Phase 5 each language owns **one coherent set, applied everywhere**:

| | Ukrainian (default) | English |
|---|---|---|
| Number | `68 702,10` | `68,702.10` |
| Money, ₴ | `68 629,36 ₴` | `₴68,629.36` |
| Money, $ | `3 324,03 $` | `$3,324.03` |
| Percent | `+3,08 %` | `+3.08%` |
| Date | `12.08.2026` | `12 Aug 2026` |
| Date, short | `12.08` | `12 Aug` |

**Three notes on the choices, because each is a decision rather than a lookup:**

- **The Ukrainian thousands separator is U+00A0 (NBSP), not a plain space.**
  A plain space lets a figure wrap across lines mid-number. The existing table
  formatter already does this; the rule now extends to prose.
- **Ukrainian puts a space before `%`** (`3,08 %`) per ДСТУ; English does not
  (`3.08%`). This is the kind of detail that reads as a typo if got wrong in
  either direction.
- **English dates use `12 Aug 2026`, deliberately not `12/08/2026`.** A slashed
  form is ambiguous between British and American reading, and this app has
  exactly one user who would be misled by the wrong guess. The month name also
  makes the EN/UK difference obvious at a glance, which is useful while the
  switch is being tested.

**Consequence, stated plainly:** switching to English now changes **table**
figures too, which it never did before. That touches `core/money.ts`, its
tests, and every checkpoint in `navigation-map.md` that quotes a formatted
string. A10 must carry that cost; the alternative — keeping tables Ukrainian in
English mode — is exactly the exception the ruling forbids.

**What does NOT change:** the stored data, every D5-pinned *value*, and the
₴/$ currency toggle's scope (headline KPIs and the sidebar only — tables stay
in ₴ regardless of language, because that is a currency rule, not a locale
rule). Language changes how a number is *written*, never which number it is.

---

## Surface 1 — Theme control

### 1. Purpose, parent, reference lines

A three-state segmented control choosing Light / Dark / System. Lives in
**`/settings` → Appearance**, as the first row, above "Currency".

Match the existing segmented control exactly: `design/Investment Tracker.dc.html`
sidebar currency toggle, and its light-surface twin already implemented in
`src/screens/Settings.tsx` → `CurrencyControl` (track `panel`, 1 px
`panel-border`, radius 999, thumb `card` with `0 1px 3px rgba(38,38,42,.06)`,
segments 12 px bold, `px-[18px] py-1.5`). The extension must show the
**three**-segment variant of that control, which does not exist yet: the thumb
is `calc(33.333% - 6px)` wide and translates to `calc(100% + 4px)` /
`calc(200% + 8px)`.

### 2. Content inventory — exact copy

| Element | Ukrainian | English |
|---|---|---|
| Row title | `Тема` | `Theme` |
| Row helper | `Системна стежить за налаштуванням пристрою.` | `System follows your device setting.` |
| Segment 1 | `Світла` | `Light` |
| Segment 2 | `Темна` | `Dark` |
| Segment 3 | `Системна` | `System` |
| `aria-label` on the group | `Тема оформлення` | `Colour theme` |

No toast on change — the whole screen repainting *is* the feedback.

### 3. State matrix

| State | Treatment |
|---|---|
| default | Selected segment `ink` text on the `card` thumb; unselected `muted` |
| hover | Unselected segment to `opacity .85`, 150 ms |
| focus | 2 px `pos` ring at 2 px offset on the pressed segment (keyboard only, `:focus-visible`) |
| disabled | n/a — never disabled, in either dataset. Theme is not data |
| loading | n/a — synchronous |
| error | n/a — no failure mode |
| empty | n/a |
| stale | n/a |
| demo-disabled | n/a — appearance is not data, so G4/D16 does not apply |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Segment press | thumb `transform` | 300 ms `cubic-bezier(0.22,1,0.36,1)` | no transition; thumb jumps |
| Segment press | `scale` to `.97` | 120 ms | none |
| Theme applied | page/card/text `background-color`, `color` | **200 ms linear, once** | none — instant swap |
| Hover | `opacity` | 150 ms | none |

**The theme cross-fade is the one new motion decision.** A 200 ms tint on
colours only — never on `box-shadow` or `border-color` en masse, which produces
visible banding across a page this dense. The design session should show the
transition scoped to a small, named set of properties rather than `all`.

### 5. Token constraints

Uses only `panel`, `panel-border`, `card`, `ink`, `muted`, `pos` (focus ring).
**No new tokens.** Both themes define all of them (Surface 3).

### 6. Layout

Radius 999 track, 3 equal segments. The Ukrainian labels are the longest
(`Системна` = 8 chars vs `System` = 6), so the control must size to the widest
label **in the active language** and not jump when the language changes.
At 360 px it shares the wrapping behaviour of every other `SettingRow`: the
control drops to its own line, **right-aligned** (`ml-auto` — a left-aligned
control on a wrapped row reads as a mistake; this was a real review finding on
the ₴/$ rate row).

### 7. Acceptance

- [ ] Three segments, System selected on a profile that has never chosen.
- [ ] Choosing System and then changing the OS appearance repaints the app
      **without a reload** — this is the whole reason the third state exists.
- [ ] An explicit Light choice does **not** follow the OS.
- [ ] The choice persists across reload in `quirenote-settings`.
- [ ] No horizontal scroll at 360 px in either language.

---

## Surface 2 — Language control

### 1. Purpose, parent, reference lines

A two-state segmented control choosing Ukrainian / English, in
**`/settings` → Appearance**, directly under Theme. Same control anatomy as
Surface 1 with two segments — i.e. identical to the existing `CurrencyControl`.

### 2. Content inventory — exact copy

| Element | Ukrainian | English |
|---|---|---|
| Row title | `Мова` | `Language` |
| Row helper | `Змінює текст, формат чисел і дат.` | `Changes text, number and date formats.` |
| Segment 1 | `Українська` | `Ukrainian` |
| Segment 2 | `English` | `English` |
| `aria-label` | `Мова інтерфейсу` | `Interface language` |

**`English` is written in English in both languages, and `Українська` in
Ukrainian in both.** A language switch that names languages in a language you
cannot read is the one place where translating the label defeats its purpose.

The helper says the formats change — Contract 0 makes that a bigger claim than
it looks, and the user is entitled to know before pressing.

### 3. State matrix

Identical to Surface 1, with one addition:

| State | Treatment |
|---|---|
| default / hover / focus | as Surface 1 |
| disabled | n/a |
| loading | n/a — the dictionary ships in the bundle; no fetch, no suspense |
| error / empty / stale / demo-disabled | n/a |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Segment press | thumb `transform` | 300 ms soft | jump |
| Language applied | text swap | **none — instant** | none |

**No cross-fade on text.** Fading a whole screen of copy draws attention to the
mechanism rather than the result, and re-flowed text mid-fade reads as a
rendering fault. The theme fades; the language does not.

### 5. Token constraints

Same as Surface 1. No new tokens.

### 6. Layout

**The layout risk of the phase lives here.** Ukrainian runs 20–30 % longer than
English, and a few strings much more. The design session must draw the widest
real cases and prove they hold:

| Surface | English | Ukrainian | Growth |
|---|---|---|---|
| Sidebar nav item | `Daily quotes` | `Щоденні котирування` | +58 % |
| Sidebar nav item | `Seasonality` | `Сезонність` | −9 % |
| KPI title | `Total return (net)` | `Загальна дохідність (чиста)` | +58 % |
| Button | `Save snapshot` | `Зберегти зріз` | +7 % |
| Button | `Record transaction` | `Записати транзакцію` | +5 % |
| Progress pill | `4 of 4 filled` | `Заповнено 4 з 4` | +14 % |
| Danger button | `Reset demo data…` | `Скинути демодані…` | −6 % |
| Empty state | `No transactions yet.` | `Транзакцій ще немає.` | +5 % |

The sidebar is the tightest: **232 px** (136 px below `sm`) with 8 analytics
items. `Щоденні котирування` at the nav's 13 px will not fit one line — the
design session must choose and show one of: a two-line nav pill with tightened
leading, or a shorter accepted Ukrainian label. **Do not solve it by
truncating with an ellipsis** — a navigation item the user cannot read is worse
than a taller pill.

### 7. Acceptance

- [ ] Every one of the eight rows above rendered in both languages at 1280 px
      **and** 360 px, with no clipping, no ellipsis in navigation, and no
      horizontal scroll.
- [ ] The sidebar nav resolution is drawn, not described.
- [ ] Switching language does not move any figure's **value**, only its form.

---

## Surface 3 — The dark palette

### 1. Purpose, parent, reference lines

The complete dark counterpart of the `@theme` block in `src/index.css`
(57 colour tokens). Applies to every screen. The light values are those of
`design/Investment Tracker.dc.html` and are **not** changed by this phase.

### 2. Content inventory — the sheet

Measured with WCAG relative luminance on 2026-08-12; every ratio below is
computed, not estimated.

**Surfaces and text**

| Token | Light | Dark | Contrast (dark) |
|---|---|---|---|
| `page` | `#f6f5f3` | `#141416` | — |
| `card` | `#ffffff` | `#1c1c1f` | — |
| `ink` | `#26262a` | `#eceae7` | **15.32** on page · **14.16** on card |
| `muted` | `#8b8a86` | `#9b9a96` | **6.04** on card · 6.53 on page |
| `faint` | `#b3b2ae` | `#6e6d6a` | **3.29** on card — decorative only |
| `hairline` | `#e8e7e4` | `#2a2a2e` | — |
| `panel` | `#eceae7` | `#232327` | — |
| `panel-border` | `#dedcd8` | `#33333a` | — |
| `label` | `#6f6e6a` | `#a8a7a3` | **7.06** on card |

**The card must stay lighter than the page, as in light mode.** Inverting that
relationship (cards darker than the page) is the commonest dark-theme mistake
and it silently breaks every elevation cue in the app.

**Sidebar** — in light mode the sidebar is already dark (`#26262a`) against a
light page. In dark mode it must go **darker than the page**, not lighter, or
it stops reading as a distinct plane.

| Token | Light | Dark | Contrast (dark) |
|---|---|---|---|
| `sidebar` | `#26262a` | `#0f0f11` | — |
| `sidebar-text` | `#e9e8e6` | `#eceae7` | **15.95** |
| `sidebar-muted` | `#96959b` | `#8b8a90` | **5.59** |
| `sidebar-inset` | `#333338` | `#1c1c20` | — |
| `sidebar-hover` | `#3d3d42` | `#26262b` | — |
| `sidebar-nav` | `#cfcecb` | `#c4c3c0` | **10.86** |

**Semantic**

| Token | Light | Dark | Contrast (dark) |
|---|---|---|---|
| `pos` | `#5c7355` | `#8fb184` | **7.12** on card |
| `pos-tint` | `#e3eadf` | `#22301f` | — |
| `pos-tint-text` | `#4c5a48` | `#a9c79f` | **7.52** on its tint |
| `pos-on-dark` | `#b9cdb4` | `#b9cdb4` | unchanged — it was always for a dark plane |
| `pos-border` | `#c9d4c4` | `#3a5233` | — |
| `neg` | `#a8695a` | `#d9907e` | **6.67** on card |
| `neg-tint` | `#f0cec7` | `#3a211b` | — |
| `neg-tint-text` | `#693f35` | `#e5a996` | **7.39** on its tint |
| `warn` | `#8f6b33` | `#d1a55f` | **7.50** on card |
| `warn-tint` | `#f0e6cb` | `#332714` | — |
| `warn-tint-text` | `#6b5527` | `#dcbb80` | **7.95** on its tint |

**Asset hues** — and the finding that matters most in this sheet.

| Token | Light | Dark | Contrast (dark, on card) |
|---|---|---|---|
| `reit` | `#8ba283` | `#9dbb93` | **8.07** |
| `reit-tint` / `-tint-text` | `#e3eadf` / `#4c5a48` | `#22301f` / `#a9c79f` | **7.52** |
| `energy` | `#c2a189` | `#d8b394` | **8.74** |
| `energy-tint` / `-tint-text` | `#efe4e0` / `#6d5a53` | `#33261d` / `#e0bfa4` | **8.47** |
| `ovdp8976` | `#98a3ad` | `#a8b6c2` | **8.20** |
| `ovdp8976-tint` / `-tint-text` | `#e4e8eb` / `#525c64` | `#20272d` / `#b3c1cd` | **8.22** |
| `ovdp6475` | `#5f5e5a` | `#a3a19b` | **6.58** |
| `ovdp6475-tint` / `-tint-text` | `#e8e7e4` / `#5f5e5a` | `#26262a` / `#adaba5` | **6.56** |

**Two measured facts the design session must not discover the hard way.**

**The 4.5:1 bar asked for in the task is the bar for TEXT, and these four
tokens are never text.** Verified across the codebase: `reit`, `energy`,
`ovdp8976` and `ovdp6475` appear only as `bg-*` (avatars, chart fills, legend
swatches); text always uses the `-tint-text` variants. The correct requirement
for them is WCAG 1.4.11 — **3:1 against the adjacent surface** for non-text UI.
The dark values above clear 4.5 anyway, so the stricter reading costs nothing
and the sheet meets both.

**The light theme does not meet even 3:1 today**: `reit` 2.77, `energy` 2.40,
`ovdp8976` 2.57 on white; only `ovdp6475` passes at 6.49. This is inherited
from the immutable master reference — **this phase does not change it**, and
the design session should not "fix" the light palette on the way past. It is
recorded here so nobody later reads the dark sheet as a regression against a
light theme that was actually the weaker of the two.

**Colour alone never distinguishes the four assets, in either theme.** Pairwise
luminance separation is 1.02–1.33 in dark and 1.07–2.71 in light — they differ
in hue, barely in lightness. Every chart, legend and donut must therefore carry
a non-colour distinguisher (label, value, or ordering), which the existing
screens already do. The design session must keep that true in dark and must not
introduce a surface where colour is the only key.

### 3. State matrix

Per token set rather than per control:

| State | Treatment |
|---|---|
| default | as tabled |
| hover | surfaces lighten by one step (`card` → `panel`), never by opacity over an unknown backdrop |
| focus | 2 px `pos` ring, 2 px offset, on `page`/`card` — must clear 3:1 against both |
| disabled | `faint` text on unchanged surface; never a lowered opacity on the whole control |
| loading | existing skeleton/spinner idiom, recoloured to `panel` |
| error | `neg` / `neg-tint` as tabled |
| empty | `muted` text, `card` surface |
| stale | `faint` text plus the existing "as of" chip; no new colour |
| demo-disabled | unchanged behaviour, `faint` text |

### 4. Motion (D7)

Only the theme cross-fade of Surface 1 applies. No token animates on its own.

### 5. Token constraints

**No new token names.** The dark theme redefines the existing 57 and adds
none — that is what keeps every component free of theme-aware branching. If the
design session finds a case that genuinely needs a new hue, it must name the
token and define it in **both** themes.

Mechanism the extension should assume: a `data-theme="dark"` attribute on the
root re-declaring the same custom properties, with `prefers-color-scheme` as
the System path. Not a second set of class names.

### 6. Layout

Unchanged. The dark theme changes no geometry — no spacing, radius, or size in
this sheet. Shadows are the exception worth naming: the light theme's
`0 1px 3px rgba(38,38,42,.06)` is invisible on a dark surface, so **elevation in
dark comes from the surface step (`page` → `card` → `panel`), not from shadow.**
The design session should show cards reading as raised with the shadow removed
rather than deepened, which merely produces a dark halo.

### 7. Acceptance

- [ ] All 57 tokens defined in dark; none missing, none new.
- [ ] Every ratio in the sheet reproduced by the implementer's own measurement.
- [ ] `card` lighter than `page`; `sidebar` darker than `page`.
- [ ] No `box-shadow` used as the sole elevation cue in dark.
- [ ] No component reads the theme — all of it is tokens.

---

## Surface 4 — Charts in dark

### 1. Purpose, parent, reference lines

Recharts surfaces on `/balances`, `/payouts`, `/seasonality`, `/allocation`,
`/yield`, plus the Overview sparkline. The `chart-*` tokens are aliases of the
palette tokens, so they follow Surface 3 — but grid, axis and tooltip need
their own decisions.

### 2. Content inventory

| Element | Light | Dark |
|---|---|---|
| Grid line | `chart-hairline` `#e8e7e4` | `#2a2a2e` |
| Axis label | `chart-muted` `#8b8a86` | `#9b9a96` |
| Tooltip surface | `card` `#ffffff` | `panel` `#232327` — **not** `card`, so it lifts off the card it covers |
| Tooltip border | `hairline` | `panel-border` `#33333a` |
| Tooltip text | `ink` | `ink` `#eceae7` |
| Reference/zero line | `chart-faint` | `#6e6d6a` |

### 3. State matrix

| State | Treatment |
|---|---|
| default | as tabled |
| hover | the existing highlight, with the tooltip on `panel` |
| focus | keyboard focus on the chart container: `pos` ring |
| disabled | n/a |
| loading | `panel` skeleton block at the chart's exact height — no layout shift |
| error | n/a — charts render from local data that cannot fail |
| empty | existing `EmptyState`, `muted` on `card` |
| stale | n/a |
| demo-disabled | n/a |

### 4. Motion (D7)

Unchanged from the current charts (Recharts enter animation, 300 ms soft). The
theme cross-fade must not re-trigger a chart's enter animation — a bar chart
replaying its grow on every theme flip is the failure mode to avoid.

### 5. Token constraints

`chart-*` aliases only. No literal hex in chart props — this is where ad-hoc
colour historically creeps in, because Recharts takes strings.

### 6. Layout

Unchanged. Wide charts keep scrolling inside their own container.

### 7. Acceptance

- [ ] Grid readable but not competing with the data at both themes.
- [ ] Tooltip legible over a card and over a chart fill.
- [ ] Four-series donut still tellable apart at greyscale — via labels, since
      the hues alone do not carry it (Surface 3).
- [ ] No chart re-animates on a theme change.

---

## Surface 5 — Ukrainian copy

### 1. Purpose, parent, reference lines

Every user-facing string in the app: 11 screens, 16 shared UI components,
roughly 150 strings including toasts, empty states, validation messages and
`aria-label`s.

**Scope split, stated so it is not discovered later.** This brief pins the
*terminology*, the *voice* and the *layout-critical* strings — what the design
session needs to draw honest screens. The complete string-by-string table is
**A10's deliverable**, produced against this glossary.

### 2. Content inventory — glossary and voice

The terms that must never vary, because inconsistency here is what makes a
translated app feel machine-made:

| English | Ukrainian | Never |
|---|---|---|
| Snapshot | `зріз` | ~~знімок~~ |
| Quote | `котирування` | ~~ціна~~ |
| Transaction | `транзакція` | ~~операція~~ |
| Asset | `актив` | — |
| Coupon | `купон` | — |
| Payout | `виплата` | ~~платіж~~ |
| Yield | `дохідність` | ~~прибутковість~~ |
| Total return | `загальна дохідність` | — |
| Capital gain | `приріст капіталу` | — |
| Deposit / Withdrawal | `внесок` / `виведення` | — |
| Redemption | `погашення` | ~~викуп~~ |
| Reinvest | `реінвестування` | — |
| Target | `ціль` | ~~таргет~~ |
| Dataset (demo/live) | `набір даних` (`демо` / `робочий`) | ~~лайв~~ |
| Backup / Import | `резервна копія` / `імпорт` | — |
| Fetch quotes | `отримати котирування` | ~~фетчити~~ |

**Voice:** second person plural is avoided entirely — the app addresses nobody
and describes state instead. `Не вдалося зберегти зріз.` rather than
`Ви не змогли…`. Buttons are imperative infinitives (`Зберегти зріз`,
`Записати транзакцію`). No exclamation marks anywhere.

**Ellipsis** stays U+2026 (`…`) and keeps its meaning: a button that opens a
dialog rather than acting (`Скинути демодані…`).

**The minus sign stays U+2212 (`−`)**, not a hyphen, in both languages — an
existing rule that a translation pass is very likely to break.

### 3. State matrix

Copy for every state, per the app's existing states:

| State | Rule |
|---|---|
| default | as glossary |
| hover / focus | no copy change |
| disabled | no copy change; never explain disabled-ness in the label |
| loading | present continuous: `Отримання…`, `Збереження…` |
| error | states what happened and what is still true: `Не вдалося отримати курс — збережений 44,83 лишається чинним.` |
| empty | states absence, never blames: `Транзакцій ще немає.` |
| stale | names the date: `дані станом на 12.08` |
| demo-disabled | names the reason: `Демодані — запити не залишають застосунок.` |

### 4. Motion (D7)

None. Language changes instantly (Surface 2).

### 5. Token constraints

None — copy uses no colour of its own.

### 6. Layout

Covered in Surface 2. The eight measured rows there are the layout contract.

### 7. Acceptance

- [ ] Glossary applied with zero variation; a term never appears two ways.
- [ ] No hard-coded string survives in a component — EN is the second language
      and its presence is the test that the dictionary is real.
- [ ] `−` U+2212 and `…` U+2026 survive translation.
- [ ] Both languages pass at 360 px.

---

## Phase acceptance checklist

- [ ] `design/extensions/appearance-language.dc.html` merged, drawn in **both**
      themes and **both** languages.
- [ ] All 57 tokens defined in dark, no new names, ratios reproduced.
- [ ] Theme = Light/Dark/System, System default and OS-reactive without reload.
- [ ] Language = UK default, EN present.
- [ ] Contract 0 applied with no exceptions in either direction.
- [ ] **No D5-pinned demo figure changes value.** Formatting may change; the
      number may not.
- [ ] `navigation-map.md` updated for both new controls, both languages.
- [ ] No horizontal scroll at 360 px in any of the four theme×language combos.

## Open, and deliberately left to the design session

- The sidebar nav resolution for `Щоденні котирування` (two-line pill vs a
  shorter label). Both are legitimate; the extension picks one and draws it.
- Whether the theme control shows icons alongside the three labels. Icons would
  ease the width pressure the Ukrainian labels create, at the cost of a pattern
  the app does not currently use anywhere.
