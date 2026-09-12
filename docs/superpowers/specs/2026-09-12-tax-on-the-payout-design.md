# Tax belongs to the payout, not to a row of its own

A withholding is recorded as a FIELD on the payout it was taken from. The `tax`
transaction type retires, and the self-referential settlement key that was going to
tie two rows together is never built.

> **This spec exists because the question it replaces could not be answered.**
> [#54](https://github.com/RomanKushyk/investment-tracker/issues/54) asked what
> `transaction.delete` does to a payout a `tax` row settles. Three review rounds —
> the cap this repository allows — produced three rulings, each written for the
> shape the round before had found. The root-cause comment on that issue is the
> record; this file is the redesign the owner ruled in its place.

## §1 — Why the key goes

`settles_payout_id` was to be a self-referential, user-scoped foreign key from a
`tax` row to the row it settles. Four shapes it admits, each found by a review
of a ruling written without it:

- **Chains.** `transaction_settles_ck` constrains only the SETTLING row's type, so a
  `tax` settling a `tax` is legal. `transaction_settles_uq` bounds breadth to one
  settler per row; it says nothing about depth.
- **Not only payouts.** The key targets any transaction row, so a `tax` may settle a
  `buy`, a `sell` or a `deposit` — and where it is a `deposit`,
  `transaction_asset_absent_ck` bars that row from naming an asset at all.
- **Another asset's row.** A settling `tax` may be filed against a different asset
  than the row it settles. `infra/schema/user.ts` names the case and calls deleting
  such a row *"issue #34's shape: a row destroyed for carrying a reference"*.
- **Cycles.** Probed in PGlite: insert `tax` A, insert `tax` B settling A, then
  `UPDATE` A to settle B — accepted, every immediate key check passes. Deleting
  either row first refuses; only a single statement covering both succeeds.

**A self-referential, mutable, user-scoped key on a flat transaction table describes
a GRAPH. The application only ever wanted one sentence: this payout was taxed by
this much.** Every round was the graph producing a shape the sentence never had.

**And the key buys nothing that is read.**
`docs/reference/WEALTH-MANAGEMENT-ARCHITECTURE.md` defines `TaxesPaid` as the sum of
rows of type Tax per asset; `taxesPaidByAsset` and `payoutsNetByAsset`
(`src/core/derive.ts`) sum by the row's own asset; `derive.ts` states outright that
*"a 'tax' row carries only an assetId, not which payout it taxed"*. No derivation,
screen or export asks which payout a tax belongs to.

In double-entry terms a withholding is a posting inside the entry that generated it,
never a second entry pointing back at the first — plain-text ledgers record a
distribution and its withholding as one balanced transaction. A field is the flat
model's form of the same thing.

**And it is what the user actually saw.** The cash does pass through the broker
account before anything else happens to it, but the provider's automation hides
every step of that: one distribution arrives, already net, as a single event.
`Store what was observed` is this model's first principle, and a second row for the
withholding records the MECHANISM rather than the observation. The form follows from
the same place — it asks for one payout and what was taken from it, because that is
the shape of the thing the person is looking at.

## §2 — The row

`tax_withheld`, nullable numeric on `transaction`, named and shaped after the
`quantity` trio it sits beside:

```
transaction_tax_absent_ck  CHECK (type IN ('interest_payout','dividend_payout')
                                  OR tax_withheld IS NULL)
transaction_tax_sign_ck    CHECK (tax_withheld IS NULL OR tax_withheld > 0)
transaction_tax_bound_ck   CHECK (tax_withheld IS NULL OR tax_withheld < amount)
```

**And `transaction_asset_present_ck` widens from four types to six**, which is what
keeps the withholding attributable. It requires an asset on the position-moving
types only and carries no comment of its own. The reasoning sits in two places and
both turn on the `tax` row: `src/core/types.ts` permits one with no asset — "a tax
levied on the account rather than on one payout, say" — and `infra/schema/user.ts`
calls the pair "TWO ONE-WAY RULES, not a biconditional", because a biconditional
"would force an asset onto every `tax` row". Both retire with the type, and the
second inverts: across the eight surviving types the two rules ARE that
biconditional, so that comment goes with the widening, as does
`infra/src/user-schema.test.ts`'s "ACCEPTS a tax row with no asset". That case
retires with the type, and what it leaves behind is a hole: a payout naming no asset is
schema-legal, taxes are attributed by the row's own asset (`sumByAsset` keys on it),
so a withholding on such a payout lands under the empty key rather
than vanishing — no per-asset consumer reads it while the portfolio totals still
count it, so the maps and the totals disagree, which is worse than a gap because
nothing looks missing. Requiring the asset closes that at the source
and spares the withholding a guard of its own.

It also completes the partition for the first time: `deposit` and `withdrawal` must
name NO asset, the other six must name one, and no type is left to judgement. The
store has been looser than the form here for no recorded reason — the form has
always asked for an asset on a payout — so this is the two agreeing, not a new rule.

**The backup envelope is the third door and tightens with them.**
`src/core/backup/json.ts` gates on `movesPosition` rather than `targetsAsset`, so an
imported payout with no asset still reaches the store — pinned by a passing test in
`src/core/backup/import.test.ts`, whose rationale the widening falsifies while
leaving it green. Left alone, such a row would carry a withholding past attribution
and then fail the CHECK at migration. The looseness was deliberate and its reason is
spent: `backup/json.ts` argues that a stricter rule would lock the database out of
exporting once anything put `{ type: 'tax', assetId: '' }` into Dexie — D126's
deadlock. With the type retired, the form always requiring an asset on a payout, no
fixture producing an asset-less one and the live store ruled expendable, that
population is empty. The envelope gates on `targetsAsset`, and the test moves.

The type names are the schema's: the app spells the SECOND of that pair
`dividend_accrual`, and the migration maps it; `interest_payout` reads the same on
both sides.

**One field rather than two, and that is settled rather than deferred.** A taxed
distribution here carries income tax and the military levy, but the provider reports
a single withheld figure — so recording the two apart would mean deriving them from
the rates, which is the one thing this model refuses: rates change, and a computed
figure eventually lies where a recorded one cannot. Mature trackers land in the same
place, carrying gross, withholding and net with no breakdown beneath them. Should a
screen ever need the components, a second nullable column is additive.

NULL is the only spelling of "none", exactly as it is for `quantity` — a withholding
of zero and no withholding are one state, and the bond half of this portfolio is
always in it. The bound check catches a decimal slipped the wrong way UP — 654,40 on a payout of
467,46 — and deliberately not one slipped down, which stays a plausible figure that
no constraint can tell from a real one.

## §3 — What goes with it

`settles_payout_id`, `transaction_settles_ck` and `transaction_settles_uq` come OUT.
They are in the draft today — the column and both constraints in
`infra/schema/user.ts`, the generated `003_user_schema.sql`, the assertions in
`infra/src/user-schema.test.ts`, and the header paragraphs arguing for them —
so this is a removal, not an omission. Editing only the type list would leave a
permanently dead column: `transaction_settles_ck` reads `settles_payout_id IS NULL
OR type = 'tax'`, so with the type gone every row satisfies it by leaving the column
NULL, and `transaction_settles_uq` never bites because Postgres counts NULLs as
distinct. Nothing fails; the column simply becomes unusable and silent. **The key set this schema
prescribes drops from six to five** (it declares none yet; W7 writes them), the
self-referential one being the one that goes.

`asset.delete` loses its first step entirely — the batched `UPDATE` that nulled
settlement links has nothing left to null — and becomes transactions, then
`user_price`, then the asset, parent last.

`tax` leaves `TxType`: nine types become eight, in `transaction_type_ck` and in
`src/core/types.ts`, `schemas.ts`, `backup/json.ts`, `TransactionPanel`, `yield.ts`
and the copy in both languages. The seed holds no `tax` row, so the demo translates
nothing. The LIVE store is a different question and has an answer: the owner rules
it expendable and will re-enter by hand anything worth keeping, which is what makes
the retirement safe. It would not otherwise be — `src/core/backup/json.ts` records
that a `{ type: 'tax' }` row the envelope refuses locks the database out of
exporting, importing and backing up before a wipe, which is D126's deadlock. The
discard is the ruling that avoids it, not an oversight that walks into it.

## §4 — What the derivations gain

Attribution stops being approximate. `taxesPaidByAsset` and `payoutsNetByAsset`
count against the asset of the PAYOUT rather than the asset a tax row happened to
name, so the cross-asset shape above stops existing rather than being handled.

`incomeReceivedNet` carries a comment saying that splitting tax between dividends
and coupons would be guesswork, *because* a tax row carries only an asset. The
withholding now sits on the payout, so the category is exact and the comment goes
with the guesswork. This is a correction, not a migration.

**Free cash keeps its arithmetic and needs one clause.** Today's `freeCashFromLedger`
excludes payout, `reinvest` and `tax` rows outright; the ledger model removes those
exclusions, crediting a payout to the account and debiting the tax beside it. With no tax row
left to debit, a payout's signed amount is `amount − coalesce(tax_withheld, 0)`.
That is not an exclusion rule returning by another door — nothing is skipped, two
columns of one row are read — and no tax is computed, only recorded and subtracted.
Without the clause, free cash would overstate by every hryvnia ever withheld.

**Per-asset XIRR needs the same clause, and there it bites hardest.**
`src/screens/yield/yield.ts` pushes a `tax` row as a negative flow beside its
payouts' positives — that is what nets the series to net-of-tax at each date.
Removing the case without netting the payout flow by `tax_withheld` turns every
per-asset XIRR from net to gross: no type error, no failing test, no visible break.

## §5 — What this does not decide

- **A tax that is not a withholding.** The schema deliberately permits a `tax` row
  naming no asset — a levy on the account rather than on one payout — and the form
  offers the type today. Retiring the type gives that up. If such a levy ever
  arrives it is a new decision, not a gap this one left.
- **Tax on a disposal.** Nothing is withheld on a sale; it is declared and paid from
  a bank account, which is not a portfolio event. That question belongs to the
  declaration screen issue, not to this model.
- **The backup envelope's next version number.** A required member leaves a strict
  object, so the version moves; which number it moves to belongs to the issue that
  lands the change alongside whatever else moves in the same release.
- **Whether a settlement link could ever return.** If a screen is ever built that
  must say which payout a given withholding came from, this design already answers
  it — they are the same row.
