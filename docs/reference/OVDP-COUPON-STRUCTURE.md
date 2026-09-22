# The OVDP coupon, measured

Every bond Inzhur lists is a Ukrainian government bond with a **fixed** coupon, and the rate is
**exactly derivable** from the published payment schedule. It is not published as a rate anywhere in
the feed, and the field that looks like one is a different quantity entirely. Measured against a
live `GET /_api/assets` carrying 32 bonds; every figure below is all 32 unless stated.

## The schedule has one shape, with no exceptions

| property | measured |
|---|---|
| principal at maturity | **₴1000 per unit** — 32 of 32 |
| distinct coupon values within one bond | **exactly 1** — 32 of 32 |
| rows dated on the maturity date | **2** — the final coupon and the principal |
| gap between consecutive coupon dates | **182 days** — 90 of 92 gaps |
| bonds with an empty schedule | 0 |

**One coupon value per bond is the load-bearing observation**, not the ₴1000: it proves the accrual
convention is a **fixed amount per period** rather than ACT/365 or ACT/ACT, because a coupon
computed from day count would differ between a 182-day and a 181-day period, and no bond's does.
**182 days is 26 weeks**, so a schedule keeps its weekday for life — of 124 coupon dates, **123 fall
on a Wednesday**, the single exception being `UA4000235782`, whose 2027-06-03 payment is a Thursday
with gaps of 183 then 181 around it, so the shift is one day and self-correcting.

## The rate

```
annual coupon rate % = perUnitCoupon × paymentsPerYear / faceValue × 100
                     = perUnitCoupon × 2 / 1000 × 100
                     = perUnitCoupon / 5
```

Across the live 32: **9.79 % … 18.50 %**, 25 distinct values, and **every one is
exact to two decimals** — `perUnitCoupon` is always a whole number of 5-kopiyka
steps, which is what makes the division clean.

> A first pass of this measurement reported `UA4000239107` (₴80.35) as an exception.
> It is not: `80.35 * 100` evaluates to `8034.999999999999` in binary floating
> point. Its rate is 16.07 % like any other. Compare in kopiykas, not in ₴.

## `returnRates` is NOT the coupon rate

The feed's `returnRates.buy` / `.sell` is the **yield to maturity** — the discount
rate that prices the bond, and it moves with the price every day. The coupon rate is
fixed at issuance. They are different numbers and the gap is large:

| ISIN | coupon rate | `returnRates.sell` | gap |
|---|---|---|---|
| UA4000229264 | **17.80 %** | 13.50 % | 4.30 pp |
| UA4000230262 | **17.60 %** | 14.00 % | 3.60 pp |
| UA4000230809 | **17.00 %** | 14.25 % | 2.75 pp |
| UA4000238976 | **15.68 %** | 15.55 % | 0.13 pp |
| UA4000238992 | **16.16 %** | 16.75 % | −0.59 pp |

The sign changes: a bond trading at a discount yields more than its coupon, at a
premium less. **Reading `returnRates` as the coupon rate would be wrong by up to
4.3 percentage points and wrong in both directions.**

This is also why `Asset.expectedPct` on a bond, rendered "YTM at purchase", cannot be folded into
the coupon rate: it depends on the price *this holder paid*, so the same bond bought on two dates
has two values where its coupon rate has one for life.

## What the app derives from this

**A linked bond needs no rate at all** — `paymentSchedule` carries ₴/unit per date directly, so the
position's coupon is `perUnit × units`. **An unlinked bond needs the rate**, because nothing else can
supply the per-unit figure:

```
couponPerPayment = ratePct / 100 / paymentsPerYear × FACE × units
```

`units` comes from the ledger for **any** asset, linked or not (*Metric families and windows*), so
the amount scales with the holding instead of being a constant somebody has to remember to edit.

## The one assumption, stated

**`FACE = ₴1000` is the UAH OVDP nominal.** True for all 32 measured and the standard denomination,
but it would not hold for a USD- or EUR-denominated OVDP (nominal 1000 of that currency) or for a
corporate bond, which may be denominated anything. Inzhur lists only UAH bonds, so the app carries
this as a constant with this note attached rather than as a field nobody would have a value for. If
a non-UAH instrument is ever listed the constant becomes a field — **and the tell is a principal row
that is not 100000 kopecks.**

## Reproducing this

One public `GET https://www.inzhur.reit/_api/assets`, then per entry with a non-empty
`assetDetails.isin`: read `assetDetails.paymentSchedule`, convert `amount` from kopecks, treat the
₴1000 rows as principal and the rest as coupons, and read dates in **Kyiv** time — they are instants
at local midnight, so parsing them as UTC lands them a day early
([`parse.ts`](../../packages/core/src/inzhur/parse.ts) `feedDate`).
