import { useMemo, useState } from 'react';

import { SeasonalityBars } from '../components/charts/SeasonalityBars';
import type { SeasonalityChartPoint } from '../components/charts/SeasonalityBars';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TAP_44 } from '../components/ui/tap-target';
import { useAssets, useTransactions } from '../hooks/queries';
import type { Asset, Transaction } from '../core/types';
import { shortLabel } from './daily-quotes/quotes';
import {
  anchorAssetGrowth,
  bondCouponInfo,
  dominantAssetOnDay,
  dominantExpectedAssetOnDay,
  incomeAnchorDay,
  quietStretch,
  seasonalityDays,
  seasonalityMonths,
} from './seasonality/seasonality';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
// The "Coupon season" card spells months out (design line 448 says "June", not
// the chart axes' "Jun"). Both forms live in the dictionary: t.dates.monthFull
// for the card's heading, t.dates.monthIn after a preposition.

// A token, not a word: the phrase it turns into is prepositional in Ukrainian
// ("на початку червня") and adverbial in English ("in early June"), so only the
// dictionary can spell it.
function dayPart(day: number): 'early' | 'mid' | 'late' {
  if (day <= 10) return 'early';
  if (day <= 20) return 'mid';
  return 'late';
}

// Stable empties, so `?? []` does not hand `useMemo` a new array every render
// and defeat the memo it depends on — the idiom `Overview` and `DailyQuotes`
// already use.
const NO_ASSETS: Asset[] = [];
const NO_TRANSACTIONS: Transaction[] = [];

export function Seasonality() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;

  const days = useMemo(() => seasonalityDays(transactions, assets), [transactions, assets]);

  /**
   * D-11 — THE AXIS TOGGLE IS EPHEMERAL, and that is forced rather than
   * preferred. All three of D-4's reasons for opening on the day axis are
   * arguments about the state the screen ARRIVES in: the D5-pinned day buckets
   * are what the reference draws, the shipped subtitle says «дохід за днями
   * місяця», and the three insight cards below are written about days.
   * Persisting the toggle would make one press change every one of those on
   * every future visit — so the choice lasts as long as the visit does, and
   * `state/settings.ts` gains nothing. It is the mirror of A33's reasoning
   * about the nav groups, which reached the opposite answer for the opposite
   * reason: an arrangement someone chose for their own tool is durable, a look
   * at the same data from another angle is not.
   */
  const [axis, setAxis] = useState<'day' | 'month'>('day');
  const anchor = incomeAnchorDay(days);

  // The month axis carries no per-bucket colour: a month aggregates several
  // assets by construction, so a "dominant asset" hue would be a claim the
  // bucket does not support. The day axis keeps its hues, where a day usually
  // is one asset.
  //
  // MEMOISED, and built only for the axis on screen (A41 review): both datasets
  // were rebuilt on every render regardless of which one was displayed, and the
  // day set walks `dominantExpectedAssetOnDay` 31 times, each walking the whole
  // ledger again.
  const monthData: SeasonalityChartPoint[] = useMemo(
    () =>
      axis === 'month'
        ? seasonalityMonths(transactions, assets).map((m): SeasonalityChartPoint => ({
            day: m.month,
            actual: m.actual,
            expected: m.expected,
            actualLabel: m.actual > 0 ? f.moneyWhole(m.actual) : undefined,
            expectedLabel: m.expected !== undefined ? `${f.moneyWhole(m.expected)}*` : undefined,
          }))
        : [],
    [axis, transactions, assets, f],
  );

  const chartData: SeasonalityChartPoint[] = useMemo(
    () =>
      days.map((d): SeasonalityChartPoint => {
        const dominantId = d.actual > 0 ? dominantAssetOnDay(transactions, d.day) : undefined;
        const dominantAsset = assets.find((a) => a.id === dominantId);
        const expectedId =
          d.expected !== undefined
            ? dominantExpectedAssetOnDay(assets, transactions, d.day)
            : undefined;
        const expectedAsset = assets.find((a) => a.id === expectedId);
        return {
          day: d.day,
          actual: d.actual,
          expected: d.expected,
          colorKey: dominantAsset?.colorKey,
          expectedColorKey: expectedAsset?.colorKey,
          actualLabel:
            d.actual > 0
              ? anchor?.day === d.day
                ? `${f.moneyWhole(d.actual)} · ${t.analytics.seasonality.dayShort(d.day)}`
                : f.moneyWhole(d.actual)
              : undefined,
          expectedLabel: d.expected !== undefined ? `${f.moneyWhole(d.expected)}*` : undefined,
        };
      }),
    [days, transactions, assets, anchor, f, t],
  );

  // "Income anchor" card copy.
  const anchorAssetId = anchor && anchor.actual > 0 ? dominantAssetOnDay(transactions, anchor.day) : undefined;
  const anchorAsset = assets.find((a) => a.id === anchorAssetId);
  const growth = anchorAsset ? anchorAssetGrowth(transactions, anchorAsset.id) : undefined;

  // "Coupon season" card copy — the bond with the biggest coupon drives the
  // headline months; other bonds get a one-line "pays in {descriptor} {month}".
  const bonds = assets
    .filter((a): a is Asset & { couponAmount: number } => a.yieldType === 'fixed_coupon' && a.couponAmount !== undefined)
    .sort((a, b) => b.couponAmount - a.couponAmount);
  const big = bonds[0];
  const bigInfo = big ? bondCouponInfo(big, transactions) : undefined;
  const others = bonds.slice(1);

  const quiet = quietStretch(days);

  return (
    <div>
      <ScreenHeader title={t.screen.seasonality.title} subtitle={t.screen.seasonality.subtitle} />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        {/* D-10 — A CONTROL THAT CHANGES ONE CHART SITS ON THAT CHART, where
            the period control that changes a whole screen sits in its header.
            Same rule, read at two scales. */}
        <div className="mb-3 flex justify-end">
          <div
            role="group"
            aria-label={t.analytics.seasonality.axisAriaLabel}
            className="border-panel-border bg-panel flex gap-1 rounded-[11px] border p-[3px]"
          >
            {(['day', 'month'] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={axis === a}
                onClick={() => setAxis(a)}
                // 44 × 44 IS HIT AREA, NEVER GEOMETRY: the segment renders 26 px
                // tall (a 16 px `text-xs` line box plus 5 px either side), and the
                // overlay grows only downward and upward — the segments are ~92 px
                // wide, so it cannot reach across the 4 px gap into its neighbour.
                className={`ease-soft cursor-pointer rounded-[7px] px-4 py-[5px] text-xs font-bold transition duration-220 active:scale-[.97] ${TAP_44} ${
                  axis === a ? 'bg-ink text-page' : 'text-muted hover:opacity-85'
                }`}
              >
                {a === 'day' ? t.analytics.seasonality.axisByDay : t.analytics.seasonality.axisByMonth}
              </button>
            ))}
          </div>
        </div>
        <SeasonalityBars data={axis === 'day' ? chartData : monthData} axis={axis} />
        <div className="text-muted mt-2 text-[11.5px]">
          {t.analytics.prose.seasonalityNote}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <div className="animate-in fade-in bg-pos-tint rounded-3xl px-[22px] py-5 duration-300">
          <div className="text-pos-tint-text mb-1 text-[10px] tracking-[.12em] uppercase">
            {t.analytics.seasonality.incomeAnchor}
          </div>
          <div className="text-[13.5px] leading-[1.5]">
            {anchor && anchorAsset && growth ? (
              <>
                <strong>{t.analytics.seasonality.anchorDay(anchor.day)}</strong>
                {t.analytics.seasonality.anchorRest(
                  shortLabel(anchorAsset),
                  t.analytics.seasonality.frequency[anchorAsset.payoutSchedule],
                  f.moneyWhole(growth.first),
                  f.moneyWhole(growth.last),
                )}
              </>
            ) : (
              t.analytics.seasonality.anchorEmpty
            )}
          </div>
        </div>

        <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
          <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">{t.analytics.seasonality.couponSeason}</div>
          <div className="text-[13.5px] leading-[1.5]">
            {big && bigInfo ? (
              <>
                <strong>
                  {t.analytics.seasonality.couponMonths(
                    bigInfo.months.map((m) => t.dates.monthFull[m - 1]).join(t.dates.listAnd),
                    bigInfo.day,
                  )}
                </strong>
                {t.analytics.seasonality.couponRest(shortLabel(big))}
                {others.map((o) => {
                  const info = bondCouponInfo(o, transactions);
                  const month = info?.historicalMonths[0] ?? info?.months[0];
                  return info && month ? (
                    <span key={o.id}>
                      {t.analytics.seasonality.couponOther(
                        shortLabel(o),
                        t.analytics.seasonality.dayPart[dayPart(info.day)],
                        t.dates.monthIn[month - 1],
                      )}
                    </span>
                  ) : null;
                })}
                .
              </>
            ) : (
              t.analytics.seasonality.couponEmpty
            )}
          </div>
        </Card>

        <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
          <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">{t.analytics.seasonality.quietStretch}</div>
          <div className="text-[13.5px] leading-[1.5]">
            {quiet ? (
              <>
                <strong>{t.analytics.seasonality.quietDays(quiet.from, quiet.to)}</strong>
                {t.analytics.seasonality.quietRest}
              </>
            ) : (
              t.analytics.seasonality.quietEmpty
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
