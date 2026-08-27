# Data model — the ledger

> Moved **verbatim** from [`../2026-08-04-data-model.md`](../2026-08-04-data-model.md) on 2026-08-26 (D95). **Contracts here are load-bearing** — the observation key is immutable on DSQL (D30): changing it is a DROP/CREATE of a live archive, not a migration.

## The ledger

Every transaction is one signed movement on one provider account. The sign is a function of the
type, not a stored field.

| Type | Account | Units |
|---|---|---|
| `deposit` | **+** | — |
| `withdrawal` | **−** | — |
| `buy` | **−** | **+** |
| `sell` | **+** | **−** |
| `dividend_payout` | **+** (gross) | — |
| `interest_payout` | **+** (gross) | — |
| `tax` | **−** | — |
| `reinvest` | **−** | **+** (chosen asset) |
| `redemption` | **+** | **−** |

Inzhur always credits the account first and performs any onward routing (bank transfer,
reinvest, tax) as a **separate operation**. Every movement is therefore observable and recorded.
There is no `destination` field — the route is expressed by the following transaction.

### Derivations

```
free_cash(D)  = Σ signed amount over account rows up to D
units(a, D)   = Σ quantity deltas for asset a up to D
value(a, D)   = units(a, D) × price(a, D)      -- price from the archive
```

No exclusion rules, no pairing heuristics, no computed tax. The sum reconciles by construction.

### `transaction`

| Column | Notes |
|---|---|
| `id` | |
| `user_id` | scope; no `portfolio` table (independent accounts) |
| `account_id` | provider account — see below |
| `date` | Kyiv calendar date |
| `type` | one of the nine above |
| `amount` | always positive; the sign comes from `type` |
| `asset_id` | nullable — `deposit` / `withdrawal` carry none |
| `quantity` | **nullable, required on position-moving rows.** Unrecoverable if not captured on the day; FIFO lots stay derivable from it forever |
| `unit_price` | nullable; keep fees in separate rows rather than baking them in |
| `settles_payout_id` | **nullable, `tax` rows only** — the payout this tax belongs to |
| `created_at` | |

**`asset_id` on `tax` rows is required** when the tax relates to a payout. Without it,
`payoutsNet` per asset is uncomputable and the total-return family stays broken — this is the
gap `docs/reference/FORMULA-AUDIT.md` ruling 6 left open.

**`settles_payout_id`** makes double counting structurally impossible and turns "does every
payout have its tax?" into a join rather than a date-fuzzy guess. It cannot be backfilled later,
which is why it goes in now. Validation: a tax may not exceed the payout it settles.

~~Aurora DSQL has **no foreign keys**~~ — it does, measured 2026-08-27 (**D99**), composite and
enforced. What still holds is the shipping design: both references are application-enforced on
write plus a nightly integrity audit, and nothing is ever deleted, so there are no cascades.
Adopting real ones was `docs/plans/PLAN-OPEN.md` **O34**, **closed 2026-08-28 (D101): W7 ships none**, and the adoption question now sits in **O33**.

### `account`

One row per provider per user. Free cash is `Σ` across accounts; the per-provider breakdown is a
`GROUP BY`. Withdrawals to a bank card leave the perimeter and are **excluded from free cash**
but stay in the ledger, so "how much have I withdrawn" remains answerable.

Modelled from day one even though Inzhur is currently the only provider — cheap now, expensive
to retrofit.

### `asset`

Per-user. Joins the global price archive by provider ref (fund slug or bond ISIN).

**No CHECK constraint may enumerate a value naming a specific holding.** `TxSource`'s
`reinvest_reit` / `reinvest_6475` are removed — the reinvest target is user-selectable per
payout, so it is an asset reference, not an enum member. `colorKey` likewise becomes a palette
slot rather than a seed-asset name.
