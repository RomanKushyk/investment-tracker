# Inzhur fund price history — what the files are and what they are not

What the two Excel files the provider publishes hold, and the arithmetic that says which basis it
is. The files live in `C:\Users\roman\.quirenote\` and are **never committed** — `*.xlsx` is
gitignored as real financial data — so `infra/src/fund-history.local.test.ts` reads them from there
when present and skips everywhere else. The archive gets their rows through the Lambda's
`importFundHistory` mode, which re-reads each fund's document list in the provider's CMS for the
current link ([`INZHUR-PUBLIC-SURFACE.md`](INZHUR-PUBLIC-SURFACE.md)).

| File | Instrument | Span | Rows |
|---|---|---|---|
| `Inzhur_REIT_czina_06_07_2026_*.xlsx` | `inzhur-reit` | 2025-09-09 → **2026-07-06** | 301 |
| `Enerdzhi_czina_06_07_2026_*.xlsx` | `inzhur-energy` | 2024-11-14 → **2026-07-06** | 600 |

Sheets are one per calendar year. Four columns: date · price per security in UAH · USD rate · USD
equivalent. **Calendar-daily including weekends**, with the value repeating across a weekend — the
same plateau shape the live feed shows. Nothing exists after 2026-07-06 in file form; Inzhur moved
it into the mobile app as a chart and an API for clients is in their backlog — true of per-account
data, though a public fund roster endpoint does exist. Our own capture starts 2026-08-11, so **the
file-to-archive gap is 2026-07-07 … 2026-08-10, 35 days**.

## THE PRICE IS `nav`, NOT `sell` — and the header is not what proves it

REIT's column says *«Вартість ВЧА 1 ЦП»* and Energy's says only *«Вартість 1 ЦП»*, so the labels
alone decide nothing, and a trend argument fails too: the gap is 35 days and the extrapolation
cannot separate two series 0.9 % apart, as they were on both sides of it. **It was settled by unit
arithmetic instead.** The owner's tracker records position VALUE per asset per date; divide it by
the file's unit price and you get the implied holding:

| | raw | ÷ 1.009 |
|---|---|---|
| REIT | 4443.651 · 5210.469 · 5240.722 · 6183.175 | **4404 · 5164 · 5194 · 6128** |
| Energy | 8.072 · 9.081 | **8.000 · 9.000** |

Raw is never whole; divided by 1.009 it is, and exactly so with the quote's rounding kept: the
tracker's value is a whole holding times `nav × 1.009` rounded to four decimals, to the kopeck, on
every overlap day but one per fund. And 1.009 is exactly the `sell / nav` ratio the archive measured
from its first capture to 2026-08-31, every day, to the rounding of a four-decimal quote. Anchoring
the other end, the tracker's value divided by the archive's **`sell`** gives exactly
6207.000 and 9.000 on three separate days, while dividing by `nav` gives 6262.88 and 9.081. So **the
tracker is `sell`-based and the files are `nav`.** All of this evidence predates 2026-09-01, when the
provider changed its factors, so that change leaves the conclusion standing.

**The contract gives the `sell / nav` factor no formula, and the 0.5 % in it is a different
thing.** The services agreement defines *Базова ціна* as "the price of the Security offered by
INZHUR for purchase and/or sale" with no formula relative to NAV anywhere in it; its only 0.5 % is a
tariff on selling referral-discounted securities within 12 months. The provider describes its
pricing in its news instead:
[«Inzhur запровадив у фондах мінімальний спред»](https://www.inzhur.reit/news/inzhur-zaprovadiv-u-fondah-minimalnij-spred)
says that before 2026-01-31 an investor bought REIT and Energy at «ВЧА + 1%» and sold «за ВЧА», and
that from then an investor sells «за ціною, максимально наближеною до реальної ціни покупки»: «Різниця
між купівлею та продажем є динамічною і може змінюватися — від 0,1% до 1%». Measured:
1.009 held across the 75-day overlap the tracker gives (2026-04-23 → 2026-07-06) on every day its
value is that day's quote, all but one per fund, as `infra/src/fund-history.local.test.ts` pins;
then on 2026-07-28, the one day of the gap a committed feed capture holds, and again in the archive
to 2026-08-31.
**The factor is the provider's to set, and it moves:** REIT's and Energy's changed on 2026-09-01,
MilTech's has not matched theirs on any archived day, and
`packages/core/src/inzhur/fund-quotes.test.ts` pins each committed feed fixture's. So before the
tracker's overlap the 0.9 % is not merely unverified: before 2026-01-31 the provider's account has an
investor selling at ВЧА itself, and from then until the overlap it describes a floating price rather
than a fixed factor.

## So: store `nav` as published, and derive no `sell` from it

The premise is what the provider published; the conversion is a conclusion resting on a factor the
provider sets and has changed, measured for only part of the file's span. Store the premise,
never the conclusion — the same line *The price archive* draws about the FX rate and the date.
**Multiplying the history by 1.009 and storing the result would put an unverified number into an
append-only archive**, which is the one thing this project has repeatedly refused to do, and before
2026-01-31 the provider's own account contradicts that number outright. The series
is archived as published, no screen reads it, and converting it to `sell` at read time is rejected
permanently; drawing it as its own labelled line is not refused, only deferred to a design brief.

What that costs is **historical portfolio value in the terms the app computes in.** The app values
holdings at `sell`, because that is the amount actually realisable — and a nav/sell toggle was
declined because `nav` reads zero for `ocean-plaza` and `zhytniy`. From 2026-04-23 the owner's
tracker already holds real `sell` values; before that, any "what would this have sold for" rests on
the provider's account rather than a measurement: `sell` at ВЧА before 2026-01-31, a floating price
after it, and 1.009 measured no earlier than 2026-04-23.

## One parsing defect, already found

The **last row of Energy's 2025 sheet** stores its value as TEXT — `6 234,8244`, with a non-breaking
space for thousands and a comma decimal — and leaves the USD rate empty, where every other row in
both files is numeric. A parser that assumes numbers will either drop that row silently or throw on
it, and **it is the row that joins 2025 to 2026.** `infra/src/fund-history.ts` reads exactly that
spelling, and only when the cell is a string; any other text is refused by address rather than cast.
