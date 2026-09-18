# Tax belongs to the payout, not to a row of its own

A withholding is recorded as a FIELD on the payout it was taken from. The `tax` transaction type
retires, and the self-referential settlement key that was going to tie two rows together is never
built. This replaces [#54](https://github.com/RomanKushyk/investment-tracker/issues/54), whose
question — what `transaction.delete` does to a payout a `tax` row settles — took three rounds and
three rulings, each written for the shape the round before had found.

## §1 — Why the key goes

`settles_payout_id` was to be a self-referential, user-scoped foreign key from a `tax` row to the
one it settles. Four shapes it admits, each found by a review of a ruling written without it:
**chains**, `transaction_settles_ck` constraining only the SETTLING row's type while
`transaction_settles_uq` bounds breadth rather than depth; **rows that are not payouts**, the key
targeting any transaction row; **another asset's row**, which makes deleting it a row destroyed for
carrying a reference; and **cycles**, probed in PGlite by inserting `tax` A, then `tax` B settling
A, then `UPDATE`-ing A to settle B — accepted, every immediate key check passing, and only a single
statement covering both can then delete either.

**A self-referential, mutable, user-scoped key on a flat transaction table describes a GRAPH. The
application only ever wanted one sentence: this payout was taxed by this much.** Every round was the
graph producing a shape the sentence never had. The key also buys nothing that is read — no
derivation, screen or export asks which payout a tax belongs to. It is also what the user actually
saw: the provider's automation hides the pass through the broker account, so one distribution
arrives already net as a single event. **Store what was observed** is this model's first principle,
and a second row records the MECHANISM instead.

## §2 — The row

`tax_withheld`, nullable numeric on `transaction`, shaped after the `quantity` trio beside it:

```
transaction_tax_absent_ck  CHECK (type IN ('interest_payout','dividend_payout')
                                  OR tax_withheld IS NULL)
transaction_tax_sign_ck    CHECK (tax_withheld IS NULL OR tax_withheld > 0)
transaction_tax_bound_ck   CHECK (tax_withheld IS NULL OR tax_withheld < amount)
```

NULL is the only spelling of "none", exactly as for `quantity` — a withholding of zero and no
withholding are one state, and the bond half of this portfolio is always in it. **The bound check is
one-sided on purpose:** it catches a decimal slipped the wrong way UP, 654,40 on a payout of 467,46,
and deliberately not one slipped down, which stays a plausible figure no constraint can tell from a
real one. **One field rather than two, settled rather than deferred:** the provider reports income
tax and the military levy as a single withheld figure, so recording them apart would mean deriving
them from the rates — the one thing this model refuses, because rates change and a computed figure
eventually lies where a recorded one cannot. A second nullable column is additive.

**`transaction_asset_present_ck` widens from four types to six**, which keeps the withholding
attributable and completes the partition for the first time: `deposit` and `withdrawal` must name NO
asset, the other six must name one, and no type is left to judgement. The reasoning that kept it narrow
turned on the `tax` row and retires with the type, leaving a hole worth closing at the source: a
payout naming no asset is schema-legal and taxes are attributed by the row's own asset, so a
withholding on one lands under the empty key rather than vanishing — no per-asset consumer reads it
while the portfolio totals still count it, which is worse than a gap because nothing looks missing.
**The backup envelope is the third door:** `src/core/backup/json.ts` gates on `movesPosition` rather
than `targetsAsset`, so an imported payout with no asset still reaches the store and would carry a
withholding past attribution, then fail the CHECK at migration. That looseness was deliberate
— a stricter rule would have locked the database out of exporting once anything put `{ type: 'tax',
assetId: '' }` into Dexie (*Persistence today*'s deadlock) — and its reason is spent once the type
retires, so **the envelope gates on `targetsAsset` and the test that pinned the old rationale
moves**.

## §3 — What goes with it

`settles_payout_id`, `transaction_settles_ck` and `transaction_settles_uq` come OUT of the draft, a
removal rather than an omission. **Editing only the type list would leave a permanently dead
column:** `transaction_settles_ck` reads `settles_payout_id IS NULL OR type = 'tax'`, so with the
type gone every row satisfies it by leaving the column NULL, and `transaction_settles_uq` never
bites because Postgres counts NULLs as distinct: nothing fails, the column simply goes silent. The
key set this schema prescribes drops from six to five, and `asset.delete` loses its first step, the
batched `UPDATE` that nulled settlement links having nothing left to null.

`tax` leaves `TxType`: nine types become eight, in `transaction_type_ck` and in `src/core/types.ts`,
`schemas.ts`, `backup/json.ts`, `TransactionPanel`, `yield.ts` and both languages. The seed holds no
`tax` row, so the demo translates nothing. **The LIVE store is what makes the retirement safe or
unsafe, and the owner rules it expendable** — a `{ type: 'tax' }` row the envelope refuses locks the
database out of exporting or backing up before a wipe, so the discard is what avoids that deadlock.

## §4 — Two clauses that break silently if missed

**Free cash keeps its arithmetic and needs one clause.** Today's `freeCashFromLedger` excludes
payout, `reinvest` and `tax` rows outright; the ledger model removes those exclusions, crediting a
payout to the account and debiting the tax beside it. With no tax row left to debit, a payout's
signed amount is `amount − coalesce(tax_withheld, 0)` — not an exclusion rule returning by another
door, since nothing is skipped and two columns of one row are read, and without it free cash
overstates by every hryvnia ever withheld. **Per-asset XIRR needs the same clause, and there it
bites hardest:** `src/screens/yield/yield.ts` pushes a `tax` row as a negative flow beside its
payouts' positives, which is what nets the series to net-of-tax at each date, so removing the case
without netting the payout flow by `tax_withheld` turns every per-asset XIRR from net to gross — no
type error, no failing test, no visible break. Attribution also stops being approximate — the
per-asset sums count against the asset of the PAYOUT rather than one a tax row happened to name —
and `incomeReceivedNet`'s comment about splitting tax by category goes with the guesswork.

## §5 — What this does not decide

- **A tax that is not a withholding.** Retiring the type gives up the account-level levy the schema
  permitted; if one arrives it is a new decision, not a gap this one left.
- **Tax on a disposal.** Nothing is withheld on a sale; it is declared and paid from a bank account.
- **The backup envelope's next version number.** A required member leaves a strict object, so the
  version moves; which number belongs to the issue that lands the change. Whether a settlement link
  could return is already answered: a screen needing to say which payout a withholding came from
  is reading one row, not two.
