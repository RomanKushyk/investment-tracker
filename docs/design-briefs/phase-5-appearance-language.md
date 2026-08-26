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
4. **The brand faces change** — `JetBrains Mono` for body, `IBM Plex Sans` for
   display. See the amendment below; this one was forced by a defect in the
   brief's own first draft.

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

## The long sections are in `phase-5/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`phase-5/amendments.md`](phase-5/amendments.md) | Amendment, 2026-08-12 — the fonts had to change first · Amendment, 2026-08-12 — shapes changed under this brief · Amendment, 2026-08-17 — the light muted step is superseded (D68) |
| [`phase-5/s1-s2.md`](phase-5/s1-s2.md) | Surface 1 — Theme control · Surface 2 — Language control |
| [`phase-5/s3.md`](phase-5/s3.md) | Surface 3 — The dark palette |
| [`phase-5/s4-s5.md`](phase-5/s4-s5.md) | Surface 4 — Charts in dark · Surface 5 — Ukrainian copy |

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
