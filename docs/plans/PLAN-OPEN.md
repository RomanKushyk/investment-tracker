# Plan C — Open questions

> **For agentic workers:** **do not implement an item from this file.** If a task you are doing depends on one, stop and surface the question — an assumption silently baked into code is how an open question becomes a wrong decision nobody remembers making.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-WAITING.md` (dated). Parent: `NEXT-PHASE-PLAN.md`. Answers land in `../decisions/` as a **new `D<n>.md`** (D96 — there are no range files; index at `../decisions/README.md`) and the item leaves this file.

Written 2026-08-11. **Resolved the same day, 18 of 19 items** — D30–D35 closed the original Rounds 1, 2 and 4; D36–D39 then reworked the auth answers as the design sharpened. What remains: Round 3, which was never a gap (three derivations deferred at zero migration cost), the archive row's non-key columns, and three of the owner's own — **O27** (2026-08-24, how one ОВДП is told apart from another), **O28** (2026-08-25, the server-side derivation boundary, decided at W7 design) and **O29** (2026-08-25, installability without a service worker; undated and cheap). The older two are open BY DESIGN; O27 and O28 wait on a ruling.

## Status

| # | Question | Round | Outcome |
|---|----------|-------|---------|
| O1 | Auth model: which Cognito shape | 1 | **closed — D32/D36/D39** Essentials, managed login, HTTP API JWT authorizer, refresh token in years, **passkey-first** onboarding |
| O2 | `basis` vocabulary from row one | 1 | **closed — D30** `buy \| sell \| nav \| fair`; currency is not a basis |
| O3 | `instrument_ref` allocation scheme | 1 | **closed — D30** `isin` for bonds, `slug` for funds; the feed's `id` rejected |
| O4 | Account bootstrap and registration policy | 1 | **closed — D38/D39** an application creates a DB row, not a Cognito user; super-admin approves; toggle opens it fully |
| O5 | Archive row schema, Inzhur half | 2 | **key closed — D30**; the non-key columns stay gated on `PLAN-WAITING.md` W3 |
| O6 | Fund valuation basis | 2 | **closed — D31** `sell`; `nav` is 0 for two of four funds |
| O21 | Does the funds' `nav` history ever reach the app, and as what? | — | **closed — D74** archived as published, never shown; the read-time `sell` conversion is rejected permanently |
| O22 | May a settings toggle make G5 opt-out — the app writing daily quotes with no Save press? | — | **closed — D75**, by DISSOLVING into D33: after B3 there is no write for a toggle to authorise. The ruling left over is that a hand-entered value is marked and an archive one is not |
| O23 | Should annualization use each asset's OWN holding period instead of one portfolio-wide span? | — | **closed — D85**, owner's ruling 2026-08-24: NO, the one portfolio-wide basis stands and D5#5 is re-affirmed. The question rested on a single young position; per-asset would have a fixed-coupon bond beating its own contract by 19,3 pp; XIRR already IS the per-asset column; and **D80's grey removed the silence that was the strongest case for switching**. No figure moves |
| O24 | Does the selected window change `Річна`'s `daysHeld` basis — and if it does, must the sheet's grey treatment ship with it? | — | **closed — D80**, owner's ruling 2026-08-24: the sheet in full. The window changes the basis (superseding Phase 6's pin) AND F-3's grey ships with it, in every window including the default. The threshold the sheet delegated is `basisIsShort`, 10 %, derived against the shipped producers and tested |
| O25 | May we fetch SMIDA's open-data API, given that its `robots.txt` is a blanket `Disallow: /`? | — | **closed — D86**, owner's ruling 2026-08-24: **no, categorically**, and without the email it was filed against. The Wayback history settles intent — the file was rewritten into a targeted `/db/` rule AFTER the API shipped, then tightened back to blanket in mid-2024 — so nothing was waiting on АРІФРУ. The research is preserved in D86 |
| O26 | Should the number parser stop being locale-blind for values a locale makes ambiguous — or should the ranges disambiguate? | — | **closed — D87**, owner's ruling 2026-08-25: **the grammar follows the language.** uk groups on whitespace and takes BOTH `,` and `.` as the decimal; en keeps the comma as grouping. `GROUPED_INTEGER` is not deleted — it becomes English-only — and the both-marks-present rule is untouched, so pasted `1,234.56` still reads 1234.56. Every editable field groups LIVE through one shared component, and an unsaved draft is re-formatted on a language switch because `useDraft` stores strings. **Supersedes D58's one-parser half.** The keyboard layout was rejected as a signal: no browser exposes one — `navigator.keyboard.getLayoutMap()` is Chromium-only and reports key→character, not numeric convention. Implementation is `PLAN-NOW.md` A46 |
| O27 | How is one ОВДП told apart from another — in «Код», and on screen? | — | **open, 2026-08-24, the owner's.** Widening «Код» to 4–6 characters is PARKED on it: `deriveCode` gives every «ОВДП …» the same «ОВ», and the only separator today is a tint handed out by arrival order. Four candidate answers, three of which cost a decision (D56, the palette) |
| O28 | Server-side derivation boundary — what may the backend compute, and when? | — | **open, 2026-08-25, the owner's, raised with D92.** Cross-browser now outranks offline, which removes the offline argument for all-client derivation and QUESTIONS the cloud-stack spec's pinned `Derivation \| 100% client-side` row (annotated in place; still binding). Direction stated, not ruled — see below. **Decide at W7 design, with a decision number** |
| O29 | Installability without a service worker — wanted at all? | — | **open, 2026-08-25.** D92 removed the PWA shell from W7; a bare manifest still gives install at near-zero cost, no service worker involved. Undated, unblocked, cheap — decide if and when install matters |
| O7 | Fund T-1 dedup rule | 2 | **closed — D31, rejected permanently.** The FX channel is proven non-informative |
| O8 | The 6 short-dated bonds outside the DCF model | 2 | **closed — D31** they are 7 matured bonds; `status` is the discriminator, no threshold |
| O9 | `provenance` enum and its assignment rule | 3 | **open by design** — see below |
| O10 | Volatility / max-drawdown / best-worst-day rules | 3 | **open by design** — see below |
| O11 | UI treatment of carried and computed days | 3 | **open by design** — see below |
| O12 | Past-date prefill vs the suggest-only rule | 4 | **closed — D33** dissolved: value is derived, history moves to a `user_price` overlay |
| O13 | The seed's fate and its ~97 coupled test blocks | 4 | **closed — D34** rewritten to reconcile, checkpoints preserved |
| O14 | Which parse controls are stored settings vs code | 4 | **closed — D35** toggles are settings, mappings are code |
| O15 | The cash-reconciliation warning after stored cash | 4 | **closed — D35** retires; supersedes D13's cash half |
| O16 | CSV export after the repository becomes HTTP | 4 | **closed — D35** a scope note, not a decision |
| O17 | SES sender identity — domain or address | 1 | **closed — D40** `quirenote.com`, acquired 2026-08-11; A11 unblocked |
| O18 | Is the app renamed from Kubushka to match the domain? | 4 | **closed — D41** user-facing renamed to Quirenote; every addressed identifier left alone |
| O20 | Separate dev and production databases — worth it, and when? | — | **closed — D63** the split happens at W7 and covers USER data only; one archive and one capture serve every environment |

---
## Where the detail is

**Split 2026-08-26 (D95)** — this file is the Status table and the rules. The
open questions' bodies are in the range file below; the closed ones' evidence
moved to [`../archive/plan-c/`](../archive/plan-c/README.md), and their rows
above stay here pointing at the decision that answered them.

| File | Holds |
|---|---|
| [`O05-O29.md`](O05-O29.md) | O27, O28, O29, O5 (part), O9/O10/O11, and the trail from each resolution to the plan it fed |

Question numbers never change. Splitting moves bodies verbatim; no file goes
over 200 lines.

## How an item leaves this file

1. The answer is written as a new `../decisions/D<n>.md` with its reasoning — **not** just the conclusion. A decision whose reasoning is lost gets re-litigated.
2. The Status table is updated to point at the decision; the detail section is deleted.
3. If it produced work, that work is filed into `PLAN-NOW.md` or `PLAN-WAITING.md` and recorded in the table above.

## What must never happen

An item from this file being resolved implicitly, by a commit that assumes an answer without naming it. If you find yourself needing one of these to proceed, that is the signal to stop and ask — not the signal to pick the obvious option quietly.

