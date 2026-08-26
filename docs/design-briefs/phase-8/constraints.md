# Phase 8 — global constraints

> Moved **verbatim** from [`../phase-8-period-and-analytics.md`](../phase-8-period-and-analytics.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first** — a surface section is written under constraints stated there.

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

