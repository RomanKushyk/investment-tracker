# Inzhur fund price history — what the files are and what they are not

Measured 2026-08-18, from the two Excel files the provider publishes and the
owner's own tracker. **Written now so that W15 does not have to re-derive it**:
the analysis was the expensive half and the files may not stay identical.

The files themselves live in `C:\Users\roman\.quirenote\` and are **never
committed** — `*.xlsx` is gitignored as real financial data.

## What exists

| File | Instrument | Span | Rows |
|---|---|---|---|
| `Inzhur_REIT_czina_06_07_2026_*.xlsx` | `inzhur-reit` | 2025-09-09 → **2026-07-06** | 301 |
| `Enerdzhi_czina_06_07_2026_*.xlsx` | `inzhur-energy` | 2024-11-14 → **2026-07-06** | 600 |

Sheets are one per calendar year. Four columns: date · price per security in
UAH · USD rate · USD equivalent. **Calendar-daily including weekends**, with the
value repeating across a weekend — the same plateau shape the live feed shows.

Nothing exists after 2026-07-06 in file form. Inzhur moved it into the mobile
app as a chart; **an API for clients is in their backlog** (their words,
2026-08-18) — true for per-account data, but a public roster endpoint does
exist; see the 2026-08-24 section at the end. Our own capture starts
2026-08-11, so the file-to-archive gap is **2026-07-07 … 2026-08-10, 35
days**.

## THE PRICE IS `nav`, NOT `sell` — and the header is not what proves it

REIT's column says *«Вартість ВЧА 1 ЦП»* and Energy's says only *«Вартість 1
ЦП»*, so the labels alone decide nothing. A trend argument also fails: the gap
is 35 days and the extrapolation is not tight enough to separate two series
0.9 % apart. **It was settled by unit arithmetic instead.**

The owner's tracker records position VALUE per asset per date. Divide it by the
file's unit price and you get the implied holding:

| | raw | ÷ 1.009 |
|---|---|---|
| REIT | 4443.651 · 5210.469 · 5240.722 · 6183.175 | **4404 · 5164 · 5194 · 6128** |
| Energy | 8.072 · 9.081 | **8.000 · 9.000** |

Raw is never whole; divided by 1.009 it always is. And 1.009 is exactly the
`sell / nav` ratio measured in the archive (1.008997–1.009004, every day).
Anchoring the other end: the tracker's value divided by the archive's **`sell`**
gives **exactly 6207.000 and 9.000** on three separate days, while dividing by
`nav` gives 6262.88 and 9.081.

So: **the tracker is `sell`-based, the files are `nav`, and the spread is a flat
0.9 %.**

## The spread is UNDOCUMENTED, and the 0.5 % in the contract is a different thing

The services agreement (edition 12.08.2026, 35 pages, the owner's own copy)
defines *Базова ціна* in cl. 1.4 as "the price of the Security offered by INZHUR
for purchase and/or sale" — **no formula relative to NAV anywhere in it**. The
only 0.5 % in the document is a tariff: a fee on selling securities that were
bought under the referral programme at a discount, sold within 12 months of
purchase. It has nothing to do with this spread.

**Measured instead:** 1.009 held constant across the whole 75-day overlap the
tracker gives us (2026-04-23 → 2026-07-06). Had it drifted, the implied unit
counts would have drifted with it; they held to three decimals, and the residual
wobble is the tracker's own rounding to the kopeck. **For 2024 and 2025 there is
nothing to check it against.**

## So: store `nav`, derive `sell` — never the reverse

The premise is what the provider published; the conversion is a conclusion
resting on an assumption we cannot verify for the earlier years. Store the
premise, and let a reader derive if a screen ever wants it, with the assumption
stated. Same line D69 drew about the FX rate and D71 about the date.

**Multiplying the history by 1.009 and storing the result would put an unverified
number into an append-only archive**, which is the one thing this project has
repeatedly refused to do.

## One parsing defect, already found

The **last row of Energy's 2025 sheet** stores its value as TEXT — `6 234,8244`,
with a non-breaking space for thousands and a comma decimal — and leaves the USD
rate empty. Every other row in both files is numeric. A parser that assumes
numbers will either drop that row silently or throw on it, and it is the row
that joins 2025 to 2026.

## What this does NOT give

**Historical portfolio value in the terms the app computes in.** The app values
holdings at `sell`, because that is the amount actually realisable (D31, and the
owner's ruling 2026-08-18 declining a nav/sell toggle — it would read zero for
`ocean-plaza` and `zhytniy`, whose `nav` is 0). From 2026-04-23 the owner's own
tracker already holds real `sell` values. Before that, any "what would this have
sold for" is an estimate carrying an unverified 0.9 %.

**Ruled on 2026-08-18 — D74.** The series is archived as published and no screen
reads it; converting it to `sell` at read time is rejected permanently, on the
evidence above. Drawing it as its own labelled line is not refused, only deferred
to a design brief. The measurement of the 0.9 % stays here precisely because it
is the thing being declined.

---

## The provider's public read surface is its own file now

What this document said below this line — the offer-page payload, its devalue
encoding, the free cross-checks, `robots.txt` and D83's fetching rule — moved
verbatim to [`INZHUR-PUBLIC-SURFACE.md`](INZHUR-PUBLIC-SURFACE.md) on 2026-08-26
(D95). It was always a separate document sharing a filename: this one is what
the **published files** are, that one is what the **site** serves.
