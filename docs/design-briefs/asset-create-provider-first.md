# Brief — provider-first asset creation

**Written 2026-08-19.** Input to a separate Claude design session, which produces
`design/extensions/asset-create.dc.html`. Until that extension merges, **no UI
task from this brief may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: one line of the owner's idea list, groomed as **A23**
(`../plans/PLAN-NOW.md` § Section H). **Not a phase brief** — it covers one
flow, the way `design/extensions/muted-legibility.dc.html` covers one token.

Shape is governed by **D56**; the two shells by **D66**; language by **Contract
0 / D58**. This brief adds no exception to any of them.

---

## What the owner asked for, in their words

> upgrade 'new asset form': first show dropdown with asset provider e.g. Inzhur,
> custom; after selecting provider show list of fetched assets, for custom show
> name input; if provider specified fill all possible inputs automatically. Main
> idea is that user should input minimum data, especially minimum sensitive
> data, so with that approach user will input only asset name and amount

**This is a re-ordering of a form that already exists**, not a new capability.
Everything it needs — the live picker, the manual fallback, the fetch, the
matching — shipped in Phase 3 (`feat/fetch-quotes`, S7). What changes is which
question comes first.

---

## What the code is today — read 2026-08-19, not assumed

| Fact | Where | Why it matters here |
|---|---|---|
| The Inzhur link is the **LAST** group in the form and is **off by default** | `components/forms/AssetForm.tsx` `InzhurGroup`, rendered at the end of `AssetFormFields` | The brief inverts this: what is currently an opt-in afterthought becomes the first question, and the manual fields become the fallback. |
| Inside that group the order is **Units → Kind (Fund/Bond) → Ref picker** | `AssetForm.tsx:130-200` | Units already leads, deliberately ("units-first framing", S3). The provider-first order has to decide whether units stays first when the pick now precedes it. |
| The picker already has every state | same | loading · loaded · empty · error→manual · stale (cache, with its date) · demo-disabled. **None of this is new work** — it moves. |
| The fetch is **manual-only** (D19) — nothing fires on mount | `hooks/useInzhurAssets.ts`, `ensureFeed()` | Provider-first makes the fetch fire on the FIRST interaction rather than a late one, so the loading state becomes the first thing a user sees. That is a new moment for an old state. |
| **The fetch is disabled in the demo dataset — and demo is the DEFAULT** | `useDataset()` → `disabled`; G4/D16 | A provider-first form has a dead provider list on first run, for every new user. **This is the single most important state in the brief** and it is the one the current design treats as an edge case. |
| `inzhurRefOptions(entries, kind, ref, f, t)` builds the option list | `components/forms/asset-form.ts:45` | Exists; reused. |
| `deriveCode(name)` fills the 2-letter avatar code until edited | `asset-form.ts:74` | Already automatic. Not a field the user must fill today. |
| `TransactionPanel` renders `AssetFormFields` inline with its own form | `AssetForm.tsx:43`, `TransactionPanel` quick-create | Whatever the flow becomes has to work in BOTH hosts, or S5 has to say why not. |

---

## The finding that reshapes the request

**The feed cannot fill "all possible inputs" — it fills almost everything for a
BOND and about half for a FUND.** Mapped field by field from `InzhurQuote`
(`core/inzhur/parse.ts:32`) onto `Asset` (`core/types.ts:22`):

| `Asset` field | Bond | Fund |
|---|---|---|
| `name` | the ISIN, which is already the picker's label | `title` ✓ |
| `code` | derived from the name (`deriveCode`) | derived ✓ |
| `yieldType` | **`fixed_coupon`, from `kind`** ✓ | **NOT IN THE FEED** — nothing distinguishes dividends / capitalization / div+cap |
| `expectedPct` | **`returnRates.sell`**, the published annual yield ✓ | **NOT IN THE FEED** — the type's own comment says *"Bonds only — funds carry none"* |
| `payoutSchedule` | derivable from `paymentSchedule` spacing ✓ | **NOT IN THE FEED** |
| `maturity` | ✓ | n/a |
| `couponAmount` | from `paymentSchedule` amounts ✓ | n/a |
| `nextCoupon` | the next `paymentSchedule` date ✓ | n/a |
| `targetPct` | **never** — a portfolio decision, not a provider fact | **never** |
| `colorKey` | app-assigned (cycled tint) | app-assigned |
| `inzhur.units` | **the user's** | **the user's** |

**So the owner's "only asset name and amount" is achievable for a bond and is
not for a fund.** Picking a bond leaves the user with **units** and **target
share**; picking a fund leaves them with **units, target share, yield type and
expected yield**. The design must not pretend these are the same flow, and it
must not present an empty required field as though the machine had filled it.

The seed shows why the fund gap is real rather than pedantic: **Inzhur REIT pays
dividends and Inzhur Energy capitalizes**, and no field in the feed separates
them.

---

## Global constraints

### G-1 — The catalog boundary is already decided, and this brief only states it

`NEXT-PHASE-PLAN.md` pins it as a B3/W7 constraint, verbatim: *"the scheduler
registers newly listed provider assets **into the catalog, never into a
portfolio**."*

So the split is not an open question and the design session must not re-open it:

- **The catalog's half (backend, W7):** what the provider lists, kept current by
  the 01:00 job.
- **This form's half (app):** letting the user choose from that list and put it
  in **their** portfolio, with **their** units and **their** target.

Nothing this brief draws may cause an asset to enter a portfolio without the
user's press (G5, and the catalog rule says the same thing from the other side).

### G-2 — Provider-first must not make the demo dataset worse

Demo is the default dataset and its fetch is disabled by construction (G4/D16,
D19). A form whose first question is "which provider" and whose only provider
answers "not here" is a worse first run than today's, where the link is an
opt-in the user can simply ignore.

**The design session must draw the demo state as a first-class path, not a
degradation** — see S4. This is the state most people see first.

### G-3 — Editing an existing asset is not this flow

The provider step is a CREATE question. An existing asset already has its
provider link (or not), and re-asking on edit would invite re-pointing a linked
asset at a different instrument — which would silently re-value its whole
history. Edit mode keeps today's form.

### G-4 — Nothing becomes less reversible

Today every field is visible and typeable. Provider-first hides fields behind a
pick. **Whatever the feed fills must stay visible and editable** — the user's
own value always wins over the machine's (G5, and the same rule D20's provenance
map draws for quotes). A filled field is a prefill, never a lock.

### G-5 — Motion (D7)

Within `docs/archive/BUILD-PLAN.md` → "Motion & interaction standards": soft
curve `cubic-bezier(0.22,1,0.36,1)`, 220 ms default, hover may drop to 150 ms,
reveals 300–400 ms, `active:scale-[.97]` on pressables; the global
`prefers-reduced-motion` kill-switch is the ultimate fallback.

The form already has a reveal idiom — `components/ui/Reveal.tsx`, the app's ONE
symmetric reveal/hide group, used by the existing conditional groups. The
provider step's reveals use it rather than a second one.

### G-6 — Tokens

No new token should be needed: the picker, its states and its notes are all
drawn already in `design/extensions/automation.dc.html`. If the session believes
otherwise it names the token in the extension header with both theme values.

---

## S1 — The provider step

### 1. Purpose, parent, references

The new FIRST question of asset creation. Parent: `AssetFormFields` in create
mode, in both its hosts (the standalone dialog and the `TransactionPanel`
quick-create sub-card).

- Reference: `design/extensions/asset-form.dc.html` — the form being re-ordered.
- `design/extensions/automation.dc.html` — the live picker and all six of its
  states, which move rather than change.

### 2. Content inventory — exact copy, EN + UK

| Key | EN | UK |
|---|---|---|
| step label | `Provider` | `Постачальник` |
| option | `Inzhur` | `Inzhur` |
| option | `Custom` | `Власний` |
| helper, provider chosen | `Everything the provider publishes is filled in for you. You can change any of it.` | `Усе, що публікує постачальник, заповнюється за вас. Будь-що з цього можна змінити.` |
| helper, custom | `You enter the asset's details yourself.` | `Ви вводите дані активу самостійно.` |
| what the feed could not fill | `The provider does not publish this — please set it.` | `Постачальник цього не публікує — вкажіть, будь ласка, самі.` |

The picker's own copy (`t.asset.picker`: loading, empty, failed, demo, fund,
bond, fundManual, bondManual) exists and is unchanged.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | `Custom` or `Inzhur` preselected — **the session decides which and says why.** Preselecting Inzhur is the request's spirit; preselecting Custom is what works on the default dataset (G-2). |
| **hover / focus** | Segmented-control treatments as elsewhere; standard focus ring. |
| **disabled** | Never disabled. In demo the Inzhur option is still *offered* — see S4 — because disabling the headline choice on the default dataset is the failure G-2 names. |
| **loading** | Choosing `Inzhur` fires the first fetch (D19, manual-only). The picker's existing loading row shows; **the rest of the form must not jump** as fields fill. |
| **error** | The existing `failed` note plus the manual fallback, already drawn. |
| **empty** | Feed parsed but nothing matched the kind — existing `empty` row. |
| **stale** | Cache served; existing warn line naming its date. |
| **demo-disabled** | S4. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Choose a provider | the fields below | `Reveal` group, 300 ms in / 220 ms out | instant |
| Fields fill from the feed | value change | **no motion** — a field that animates its own value reads as the user's edit being undone | none |
| Segment change | thumb `translateX` | 300 ms soft, the app's segmented value | instant |

### 5. Tokens

The form's existing families. Nothing minted (G-6).

### 6. Layout

- Two options fit a segmented control at 360 in Ukrainian (`Постачальник`,
  `Власний`); the session measures rather than assumes.
- Radii per D56 at the RENDERED heights, arithmetic stated.
- The step must not push the dialog's first input below the fold at 360 with the
  keyboard up — the `--keyboard-inset` rule already governs the panel's height.

### 7. Acceptance

- [ ] Create mode only; edit mode is byte-identical to today (G-3).
- [ ] Every auto-filled field remains visible and editable (G-4).
- [ ] No asset can be created without an explicit press (G5, G-1).
- [ ] Both hosts (dialog and quick-create) render the step.
- [ ] Zero horizontal overflow at 360, both languages, both themes.

---

## S2 — The provider path, and the honest split between bond and fund

### 1. Purpose, parent, references

What the form looks like after an Inzhur instrument is picked. **Two variants,
because the feed genuinely carries different amounts for the two kinds** — see
the finding above.

### 2. Content inventory

No new strings beyond S1's "The provider does not publish this" note. Every
field label already exists.

### 3. State matrix

| State | Treatment |
|---|---|
| **bond picked** | `yieldType`, `expectedPct`, `payoutSchedule`, `maturity`, `couponAmount`, `nextCoupon` all filled. The user is left with **units** and **target share**. |
| **fund picked** | `name` and `code` filled. `yieldType`, `expectedPct` and `payoutSchedule` are **empty and required**, each carrying the "provider does not publish this" note. The user is left with **units, target share, yield type, expected yield**. |
| **a filled field edited** | The user's value stands, permanently, and re-picking the same instrument must not overwrite it silently — **the session draws how that is shown**, and D20's provenance idiom for quotes is the precedent. |
| **re-picking a different instrument** | Fields filled by the previous pick refill; fields the user typed do not. If that is too subtle to draw, the session says so and proposes the alternative rather than inventing a silent rule. |
| **loading / error / empty / stale / demo** | S1 and S4. |

### 4. Motion (D7)

Fields appearing when the kind changes use the `Reveal` group. Values filling do
not animate (S1 § 4).

### 5. Tokens

Existing. The "not published" note is a `muted` helper, not a `warn` — nothing
is wrong, the feed simply does not carry it.

### 6. Layout

- **Does `units` still lead?** Today it does, deliberately (S3's units-first
  framing: while linked, quantity is the input and value is derived). With the
  pick now preceding it, the session decides whether units stays first inside
  the group or follows the pick, and states the reason.
- The bond variant is materially shorter than the fund variant. Both must read
  as finished forms, not as one form with holes.

### 7. Acceptance

- [ ] A bond pick leaves exactly two fields for the user; a fund pick leaves
      four. Nothing is presented as filled that is not.
- [ ] A user edit is never overwritten by a later fill.
- [ ] `AssetForm`'s existing validation messages are unchanged.

---

## S3 — The custom path

### 1. Purpose, parent, references

`Custom` is today's form, and the brief's position is that it should stay
today's form.

### 2–7

- Reference: `design/extensions/asset-form.dc.html`, unchanged.
- **The only change is that it now sits behind a choice.** Field order, labels,
  validation, the conditional fixed-coupon group and the quick-create context
  all stand.
- **Acceptance:** a `Custom` create produces an asset byte-identical to one
  created by today's form, with the same fields in the same order.

---

## S4 — The demo dataset, drawn as a path rather than an error

### 1. Purpose, parent, references

**The state most first-time users see, and the reason G-2 exists.** Demo is the
default dataset and its fetch is disabled by construction (G4/D16, D19).

- Reference: `design/extensions/automation.dc.html` — the picker's existing
  `demo` state and its amber `DEMO` tag.

### 2. Content inventory

The existing `t.asset.picker.demo` note. If the session finds it insufficient
for a first-run experience it proposes new copy here, in both languages, rather
than in the drawing alone.

### 3. State matrix

| State | Treatment |
|---|---|
| **demo, provider step** | The Inzhur option is offered, not hidden and not disabled — hiding it would make the feature invisible on the dataset every new user starts in. |
| **demo, Inzhur chosen** | The manual ref fallback (today's `showManual` path) plus the existing demo note. **The session decides whether choosing Inzhur in demo is worth allowing at all**, or whether the honest design is an inline explanation with a route to Settings → Data. Draw the answer. |
| **live, first ever fetch** | S1's loading. |

### 4–7

- Motion: the note appears with the group, no separate spec.
- Tokens: `warn`/`warn-tint` already carry the demo tag.
- Layout: the note must not reflow the fields beneath it as it appears.
- **Acceptance:** the demo path is drawn as a complete, unembarrassed screen —
  if the drawing needs an apology, the design is wrong.

---

## S5 — The quick-create host

### 1. Purpose, parent, references

`TransactionPanel` renders `AssetFormFields` inline, in create mode, inside its
own form (`AssetForm.tsx:43`). Whatever S1–S4 become, they appear here too.

### 2–7

- The sub-card is dashed (`New asset details`) and its context is the
  transaction being recorded — `firstPurchase` is derived from the transaction's
  date and is deliberately absent as a field.
- **The constraint:** the provider step lands inside an already-nested card,
  inside a panel, inside a screen. The session checks the nesting depth reads at
  360 and says what gives if it does not.
- **Acceptance:** the quick-create path still creates asset and transaction
  atomically in one press, with the provider step in it and no second submit.

---

## What this brief does not decide

- **Which provider option is preselected** (S1 § 3) — the request's spirit and
  the default dataset point different ways.
- **Whether units still leads inside the linked group** (S2 § 6).
- **How a user's edit is shown to be protected from a later fill** (S2 § 3).
- **Whether choosing Inzhur in demo is allowed at all** (S4 § 3).
- **More providers than Inzhur.** The dropdown's shape allows a third; nothing
  in this brief designs one, and the catalog is the backend's (G-1). A second
  real provider is its own brief.
