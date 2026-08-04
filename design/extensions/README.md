# design/extensions/ — post-v1 design references

Extension references per decision D14 (`docs/DECISIONS.md`) and pipeline G7
(`docs/NEXT-PHASE-PLAN.md`): a **separate Claude design session** turns each
phase's brief (`docs/design-briefs/phase-N-<name>.md`) into one or more
`<surface>.dc.html` files here. These are the ONLY files ever added under
`design/`; the three original handoff files stay immutable.

## Files

| File | Phase | Purpose |
|------|-------|---------|
| `settings.dc.html` | 2 | `/settings` screen: sidebar Settings group + pill (S1), the 4 section cards (S2), targets editor + Σ pill (S4), dataset switch + DEMO badge (S5), destructive typed-name dialogs (S6), relocated Backup (S7), editable ₴/$ rate (S8). **Header comment mints the `--color-warn/-tint/-tint-text` token values** — the single source for the phase's new token family. |
| `asset-form.dc.html` | 2 | AssetForm (S3): create + edit dialogs, fixed-coupon group, Inzhur link group (toggle reveal, Fund/Bond kind, slug/ISIN ref, units-first framing), validation states + full message vocabulary, TransactionPanel quick-create context. |
| `metrics-exposure.dc.html` | 2 | Audited-metrics exposure fragments: Overview KPI relabel + "Total return (net)" card + income net-of-tax line (S9a), Yield Total return/XIRR columns (S9b), Portfolio "Capital gain" relabel (S9c), ledger-drift warn chip (S9d), TransactionPanel Withdrawal/Redemption types (S10). |
| `daily-quotes-live.dc.html` | 3 | Living `/` screen: Fetch-quotes button 5-state machine + demo tag (S1), per-row `auto`/`manual`/`stale` provenance chips (S2), dirty-field "Use fetched?" offer (S3), ghost "suggested" accrual input vs the other three input states (S4), coupon-due suggestion card above the Transaction panel (S5). **Header comment pins the SUGGESTION VISUAL LANGUAGE** (dashed = proposed · solid+ink = the user's · pos-border = valid/saved) that S3/S4/S5 share. |
| `reminders.dc.html` | 3 | ReminderStrip on `/` and `/overview` (S6): banner anatomy, the 3 severities, stacking + the 3-banner cap and "+N more", dismiss/empty/restore paths, app-open toast. **Header comment mints the `--color-neg-tint` / `--color-neg-tint-text` values** — the single source for the phase's new token family (overdue severity only). |
| `automation.dc.html` | 3 | AssetForm Inzhur ref live picker — loading / loaded / error→manual / empty / stale / demo / selected (S7); Settings → Automation card filled in inside the settings card stack — `autoQuoteSuggest`, `couponSuggest`, reminders switch + lead-days sub-row + restore-dismissed sub-row, with their off/error/disabled states (S8). |

## Rules

- **Idiom = the master reference's** (`design/Investment Tracker.dc.html`):
  `<x-dc>` wrapper, ALL styles inline, every exact color/size/spacing literal
  in the markup, mock values inline. No runtime script, no `_ds/`/`support.js`
  references — extensions are fully static and render coherently via `file://`.
- **Dashed-border chips are spec annotations** (state microlabels), never UI.
  Motion (D7) specs live in HTML comments.
- **Precedence (D14):** once merged, an extension wins visual disputes for its
  surfaces; its brief wins copy/behavior disputes. Don't rework a merged
  surface in place — supersede via a new brief section + a new reference.
- Every literal color maps to an existing `src/index.css` `@theme` token or to
  a token the file's header comment explicitly mints — no ad-hoc hex.
- Light theme only until Phase 5 defines the dark palette.
- Mock figures shown are D5 demo values (pinned — additive-only) or clearly
  annotated live-dataset/audit illustrations; the app always derives them.
