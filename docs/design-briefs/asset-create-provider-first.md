# Brief — provider-first asset creation

**Written 2026-08-19.** Input to a separate Claude design session, which produces
`design/extensions/asset-create.dc.html`. Until that extension merges, **no UI
task from this brief may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: one line of the owner's idea list, groomed as **A23**
(`../archive/plan-a/section-h-2.md`, Section H — it left `PLAN-NOW.md` in D95). **Not a phase brief** — it covers one
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

## The long sections are in `asset-create/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`asset-create/s1-s5.md`](asset-create/s1-s5.md) | S1 — The provider step · S2 — The provider path, and the honest split between bond and fund · S3 — The custom path · S4 — The demo dataset, drawn as a path rather than an error · S5 — The quick-create host |

## What this brief does not decide

- **Which provider option is preselected** (S1 § 3) — the request's spirit and
  the default dataset point different ways.
- **Whether units still leads inside the linked group** (S2 § 6).
- **How a user's edit is shown to be protected from a later fill** (S2 § 3).
- **Whether choosing Inzhur in demo is allowed at all** (S4 § 3).
- **More providers than Inzhur.** The dropdown's shape allows a third; nothing
  in this brief designs one, and the catalog is the backend's (G-1). A second
  real provider is its own brief.
