# Section D — the one large sweep

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A8, A9, A10, A12, A13. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section D — The one large sweep

Independent of persistence: it touches design tokens and strings, so the B3 migration cannot invalidate it. Doing it now means B3 lands on an already-themed, already-localised app rather than doubling the surface to re-verify. Phase 1's `var()`-emitting colors and the structured-returns rule exist to make both sweeps mechanical.

## A8 — Design brief — `docs/design-brief-phase-5`

**The G7 gate — and it is now OPEN.** `design/extensions/appearance-language.dc.html` merged 2026-08-12 in `f486121`, so **A9 and A10 are no longer design-gated**. This section header said "awaiting the design session" until 2026-08-13, three commits after the session had in fact run and its own amendment (D56) had been applied to the file.

> **The gate artifact was amended 2026-08-12 (D56).** `design/extensions/appearance-language.dc.html` drew every control as a capsule; the app no longer has a single one. All 231 capsules in it were rewritten to the radius rule and its 23 segmented tracks made concentric with their segments — measured off the file's own rendered boxes, nothing else touched. **A9/A10 must read shape from README §4, not from the drawing's original capsules.** The brief carries the same amendment at its head.

- [x] **Written 2026-08-12** — five surfaces, each with the pinned seven parts: theme control, language control, the dark palette sheet, charts in dark, Ukrainian copy.
- [x] All 57 tokens given dark values with **measured** WCAG ratios (23 checks, 0 failures) — not estimated.
- [x] Owner decisions taken and pinned: theme is **Light/Dark/System** with System default and OS-reactive; **Ukrainian is default**, English stays; and formatting **separates completely per language, no exceptions** — which is a bigger contract than it looks, because table figures now change in EN too.

**Two findings from the measurement, both recorded in the brief:**
- the ≥4.5:1 bar is the bar for TEXT, and the four asset hues are **never** text — verified across the codebase, they appear only as `bg-*` fills. The correct requirement is WCAG 1.4.11 (3:1, non-text); the dark values clear 4.5 anyway, so the sheet meets both readings;
- **the light theme does not meet even 3:1 today** — `reit` 2.77, `energy` 2.40, `ovdp8976` 2.57 on white. Inherited from the immutable master reference, out of scope here, and written down so the dark sheet is never misread as a regression against a light theme that was the weaker of the two.

**No longer open — the design session answered it, and re-measuring on 2026-08-12 confirms the answer.** The brief's premise (232 px will not hold `Щоденні котирування` on one line) is simply wrong: the nav runs in a monospace face at 0.6em, so 19 characters are 153.9 px in a 172 px text box — it fitted **before** the rail widened. At today's 244 px the text box is 184 px and the spare is **30.1 px**. The extension had already worked this out and **rejected** the shortened `Котирування` for buying nothing.

**What is actually tight is the rail, and by 1.1 px.** At 136 px the pill's text box is 88 px and the longest single word, `котирування`, measures **89.1 px** — so it cannot break cleanly and wraps to *three* lines, not the two the session drew. **2 px** closes it (1 px off each side of the rail pill's `px-3.5`, or 2 px more rail width). Left for A10 rather than pre-empted here: Ukrainian is not shipped yet and A10 is G7-gated. Start it with this number.

**Brief:** `docs/design-briefs/phase-5-appearance-language.md`. **Next step is not code** — it is the design session that turns it into `design/extensions/appearance-language.dc.html`.

## A9 — Dark theme — **DONE 2026-08-13** — `feat/dark-theme`

- [x] ~~Split double-duty tokens into surface/on-surface pairs.~~ **Superseded by the merged extension**, which wins visual disputes (D14). Its FINDING 3 solves the same problem with no new token and no component branching on theme: filled emphasis keeps `bg-ink` and swaps `text-white`→`text-page`; inverted planes keep white and swap `bg-ink`→`bg-sidebar`. Both are no-ops in light — `sidebar` and `ink` are both #26262a. A split would have added names the design deliberately avoided.
- [x] Purge literal colours and the nine rgba shadows into tokens. `text-white` survives at exactly two sites (sidebar capital, `KpiCard` dark) because both are inverted planes in *both* themes, and the reasoning is written in beside them.
- [x] `[data-theme=dark]` for the 38 palette tokens; the 19 `--color-chart-*` aliases are `var()` references and follow, verified at runtime. recharts Tooltip and cursor themed — the tooltip is `panel` (not `card`, so it lifts off what it covers) and the cursor replaces recharts' hard-coded `rgba(204,204,204,.5)`.
- [x] FOUC-free head script + `color-scheme`; `theme` through the full persist contract; `matchMedia` only while the preference is `system`; Light/Dark/System control in Settings → Appearance.

**Three things the plan did not know, all recorded in the commits:**

1. **Tailwind 4 inlines shadows but not colours.** `.bg-page` emits `var(--color-page)`; `.shadow-card` emits the literal, so redefining a shadow token in the dark block does nothing. Components call `shadow-(--shadow-card)` instead. Found by reading the emitted CSS.
2. **A third double-duty family the reference missed** — `bg-sidebar-text` + `text-ink`, a light chip on a dark rail. The active nav pill, the active currency segment and the logo circle rendered as empty white lozenges in dark. Fixed as FINDING 3 fixes its own cases: `text-sidebar`.
3. **FINDING 2 is wider than its own description.** The prescribed `panel-border` edge is needed by the `Switch` knob too, measured at 1.19:1 on its off track in dark — against 1.24:1 in *light*, i.e. the light theme was already leaning on the shadow. One `--shadow-thumb` token, four call sites.

**One light-theme change, deliberate and flagged:** the chart tooltip goes from recharts' default `#ffffff` to `panel`. The app never specified a tooltip background, so the white was a library default rather than a designed value.

**Verification note worth keeping.** `getComputedStyle` / `getBoundingClientRect` in the Playwright evaluation context returned **stale** values after React updates — at one point reporting a white background on a segment whose `className` did not carry `bg-card`. Several hours went into chasing defects that did not exist. For anything the DOM has just re-rendered, screenshot it.

## A10 — Ukrainian — `feat/i18n-uk`

- [x] `src/i18n/messages.ts` (`en` canonical, `Dict` derived from it, `uk satisfies Dict`), `useT()` on `settings.language`.
- [x] Sweep the strings — **~260 across ~40 files, not the ~200 estimated here**, and it took three passes: JSX text nodes, then string literals, then TEMPLATE literals, where most of the remainder lived. The three context-split formatters (`date-labels`, `yield-labels`, `schedule-labels`) were retired rather than translated.
- [x] `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT and ordinals into i18n; runtime key-parity test.
- [x] Contract 0 end to end: `makeFormat(lang)` behind `useFormat()`, every figure re-rendering on the switch. Verified in production builds in both directions.

> **Done 2026-08-14.** Verified in the browser, both languages, all ten routes:
> no Latin prose left in Ukrainian and no Cyrillic in English; `<html lang>`
> flips; the calendar reads `пн…нд` / `серпень 2026` and starts Monday against
> English's Sunday. Decision recorded as **D58**; `navigation-map.md` figures
> restated in the default (Ukrainian) rendering.
>
> **Two things this phase found rather than translated.** The English
> placeholder `10,000.00` was REJECTED by the form that offered it — the parser
> read every comma as a decimal mark — so `normalizeNumberInput` now takes the
> last of the two marks as the decimal. And the dark theme's filled-button
> hover, the rail, the dialog and the toast had no edge or an inverted one; that
> is D57's tail, fixed with `--color-ink-hover` and `--color-surface-edge`.
>
> **The 360px sweep is Phase 6's, and here are the numbers.** At 360 the app
> overflows in ENGLISH already, on four of ten routes — attributes 107px,
> settings 48px, overview and payouts 4px each. Ukrainian widens the same four
> (133 / 82 / 5 / 5) and adds ONE of its own: daily quotes, 57px, where English
> is 0. That one is the 136px rail eating a third of a 360px viewport, leaving
> 200px for a control whose Ukrainian label needs 254px. It cannot be fixed by
> letting the label wrap — `size` pins an EXPLICIT button height, so a second
> line spills out of the box. The narrow-width rule for that row belongs to the
> mobile brief (A16/A17), not to a guess made here.
- [ ] ~~**Pinned: `fmtTable` / `fmtProse` / `fmtDate` are byte-identical in both languages.** Formats never follow language.~~ **REVERSED, 2026-08-13.** This line predates the phase-5 design session and its owner ruling, and the brief's **Contract 0** says the opposite: *"formatting separates completely per language, with no exceptions"*. D14 gives the brief copy and behaviour disputes, so the brief wins and this plan was stale, not the brief. Contract 0 is also the phase's widest-reaching item, so it is stated in full below rather than left as a cross-reference.

**Contract 0 — what A10 must actually implement.** Today the app mixes conventions: tables are already Ukrainian (`68 702,10`), prose and KPIs are English (`₴68,629.36`). From Phase 5 each language owns ONE coherent set, applied everywhere:

| | Ukrainian (default) | English |
|---|---|---|
| Number | `68 702,10` | `68,702.10` |
| Money, ₴ | `68 629,36 ₴` | `₴68,629.36` |
| Money, $ | `3 324,03 $` | `$3,324.03` |
| Percent | `+3,08 %` | `+3.08%` |
| Date | `12.08.2026` | `12 Aug 2026` |
| Date, short | `12.08` | `12 Aug` |

Three details that are decisions, not lookups: the Ukrainian thousands separator is **U+00A0**, never a plain space, or a figure wraps mid-number; Ukrainian puts a **space before `%`** per ДСТУ and English does not; English dates are `12 Aug 2026` rather than a slashed form, which is ambiguous between British and American reading.

**The cost, stated rather than discovered:** switching to English now changes **table** figures too, which it never did. That reaches `core/money.ts`, its tests, and every `navigation-map.md` checkpoint quoting a formatted string. What does NOT change: stored data, every D5-pinned *value*, and the ₴/$ toggle's scope — tables stay in ₴ in both languages, because that is a currency rule, not a locale one. Language changes how a number is written, never which number it is.

**Contracts:** settings `theme` / `language`; the final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist key); i18n architecture (typed dict, keys-in-tests, **formats-DO-localize per Contract 0**, `date-fns` dep — G6 entry).
**Verify:** unit — key parity compile-time and runtime, formatter invariance under `uk`. Browser — every route in dark, system and reduced-motion; hard-reload in dark with no white flash; UK with localised calendar, `<html lang>`, unchanged numbers and dates, 360 px overflow sweep; contrast spot-checks. Gates + build; tag.
**Risk:** the i18n sweep is wide though mechanical — freeze other UI branches while it runs.

## A12 — Backfill stops flagging pre-issuance dates — `infra/backfill-tracked-isins`

**Goal:** a backfilled date reads as the success it is.

**Rationale (D43, as corrected).** Every historical date came back `ok: false`. The cause is not the file layout — `parseNbu` reads fields 0–4 and those five are identical across all four generations of the file. It is this:

```js
const TRACKED_ISINS = ['UA4000238976', 'UA4000236475'];
if (parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
```

Both bonds were issued in 2025–2026, so no file from 2020 can contain them. The check is right for a daily capture — an instrument vanishing from *today's* file means it matured, was renamed, or the file changed shape — and wrong for a backfill, where absence is the calendar.

**The stored data was never wrong.** `entry_count` and `quotes_sha256` are correct on all ~1,200 rows already written; only `ok` and `error` are, plus `unchangedDays` was skipped because it is gated on `error === null`.

- [x] `captureOne` takes `expectTracked`, defaulting true; the backfill passes false. Committed 2026-08-11.
- [x] Deploy it.
- [x] **Then** run the backfill to completion, in one pass. Not before: the completeness check keys on a row *existing*, so dates filled by the broken run are skipped forever by a re-run.
- [x] Repair the ~1,200 rows already written — reprocess from stored payloads and recompute `ok`/`error`, or delete and re-fetch. Reprocessing is preferred: the bytes are already held and NBU is spared the requests.
- [ ] Long term this belongs to `listed_from` / `retired_at` on `instrument`, which the data model specifies for exactly this distinction. The flag is the stopgap.

**Verify:** a 2020 date returns `published: 1`; a date after both issuances still flags a genuinely missing tracked ISIN; the full backfill reports `complete: true` with `published` close to the business-day count rather than zero.
**Risk:** none to stored bytes — the change only decides whether an error string is set.

## A13 — The alert channel gets its own liveness signal — **DONE 2026-08-11 (D47)**

> Verified in production: `{"metric":"alertChannels","status":"ACTIVE","value":1}`,
> six alarms in OK, and **zero SNS topics** — the topic was deleted once it
> turned out to deliver nothing and to block the deploy. CloudWatch publishes
> alarm state changes to EventBridge regardless of `AlarmActions`, so alarms
> with no action still alert.

**Goal:** a dead notification channel is visible, instead of looking exactly like a healthy one.

**Rationale (D44).** SNS deleted the email subscription after a spam complaint, and three notifications — including a real `SilenceAlarm` firing — went nowhere. Every indicator read healthy: `NumberOfNotificationsFailed: 0` (which means nothing was *attempted*, not that anything succeeded), the alarm history saying `Successfully executed action`, all five alarms in `OK`. **A silence alarm that cannot deliver is worse than no alarm**, because it turns an unmonitored system into one everyone believes is monitored.

This is the `unchangedDays` principle (D28) one level up: a signal that exists only on failure cannot tell "healthy" from "the check stopped running".

- [x] **Target changed by D45.** The channel is no longer SNS email, so the thing worth checking is not `SubscriptionsConfirmed` on a topic nobody listens to — it is that the **notification configuration is `ACTIVE` and holds at least one channel**. Same principle, different query.
- [x] The 01:00 capture reads it and logs it as JSON, exactly as it already logs `unchangedDays`. No new schedule — the "exactly one automation" ruling holds. Note the API only answers in `us-east-1`.
- [x] Metric filter → metric → alarm on `< 1`. **Verified live 2026-08-14:** `AlertChannelsMetricFilter` → `Quirenote/AlertChannels`, alarm `LessThanThreshold 1.0`, state `OK`, and the 14.08 run logged `{"metric":"alertChannels","status":"ACTIVE","value":1}`.
- [ ] **Accept that this alarm notifies through the channel it is checking.** Not solvable by cleverness; solved by the value being readable *without* push — on the dashboard and in the run journal (W8). The alarm is the backup, the visible number is the primary.
- [x] **Remove the SNS `Subscription` block from `template.yaml`.** Done, and D47 went further than this line expected: `CaptureAlertTopic` is gone too — `grep` finds no SNS in the template at all. The note that "the topic itself stays" is superseded.
- [x] Exec role gains the notifications read actions and nothing else. Shipped as `notifications:ListNotificationConfigurations` + `notifications:ListChannels` (List, not Get — the handler enumerates rather than fetches one by name).

**Verify:** delete the subscription in a test, confirm the logged value drops to 0 and the alarm fires; re-subscribe and confirm it returns to 1.
**Risk:** none — a read of topic metadata.

---

