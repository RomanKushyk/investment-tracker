import { useMemo, useState } from 'react';

import { SeasonalityBars } from '../components/charts/SeasonalityBars';
import type { SeasonalityChartPoint } from '../components/charts/SeasonalityBars';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TAP_44 } from '../components/ui/tap-target';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import { couponPerPayment } from '@quirenote/core/accrual';
import { transactionsFromWindow, unitsByAsset } from '@quirenote/core/derive';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { shortLabel } from './daily-quotes/quotes';
import {
  anchorAssetGrowth,
  bondCouponInfo,
  dominantAssetOnDay,
  dominantExpectedAssetOnDay,
  incomeAnchorDay,
  quietStretch,
  seasonalityDaysIn,
  seasonalityMonthsIn,
} from '@quirenote/core/view/seasonality';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

// A token, not a word: the phrase is prepositional in Ukrainian and adverbial in
// English, so only the dictionary can spell it.
function dayPart(day: number): 'early' | 'mid' | 'late' {
  if (day <= 10) return 'early';
  if (day <= 20) return 'mid';
  return 'late';
}

const NO_ASSETS: Asset[] = [];
const NO_TRANSACTIONS: Transaction[] = [];
const NO_SNAPSHOTS: Snapshot[] = [];

export function Seasonality() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;
  const snapshots = useSnapshots().data ?? NO_SNAPSHOTS;

  const { window: win, control } = usePeriodWindow(assets, snapshots, transactions);

  // THE LEDGER THIS SCREEN READS FOR EVERY *FLOW* QUESTION. Everything derived
  // from the windowed bars must be read on the same side of the boundary, or a
  // windowed height wears an unwindowed colour and the card beneath it names an
  // asset that paid nothing inside the window.
  const windowed = useMemo(() => transactionsFromWindow(transactions, win), [transactions, win]);

  const days = useMemo(
    () => seasonalityDaysIn(transactions, assets, win),
    [transactions, assets, win],
  );

  /**
   * THE AXIS TOGGLE IS EPHEMERAL, and that is forced: the day buckets are what
   * the reference draws, the subtitle says so, and the three insight cards are
   * written about days, so persisting it would make one press change all of them
   * on every future visit. The mirror of the nav groups, which reached the
   * opposite answer for the opposite reason.
   */
  const [axis, setAxis] = useState<'day' | 'month'>('day');
  const anchor = incomeAnchorDay(days);

  // The month axis carries no per-bucket colour: a month aggregates several assets
  // by construction, so a "dominant asset" hue would be a claim the bucket does not
  // support. MEMOISED, and built only for the axis on screen — the day set walks
  // the whole ledger once per day of the month.
  const monthData: SeasonalityChartPoint[] = useMemo(
    () =>
      axis === 'month'
        ? seasonalityMonthsIn(transactions, assets, win).map((m): SeasonalityChartPoint => ({
            day: m.month,
            actual: m.actual,
            expected: m.expected,
            actualLabel: m.actual > 0 ? f.moneyWhole(m.actual) : undefined,
            expectedLabel: m.expected !== undefined ? `${f.moneyWhole(m.expected)}*` : undefined,
          }))
        : [],
    [axis, transactions, assets, win, f],
  );

  const chartData: SeasonalityChartPoint[] = useMemo(
    () =>
      days.map((d): SeasonalityChartPoint => {
        const dominantId = d.actual > 0 ? dominantAssetOnDay(windowed, d.day) : undefined;
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
    [days, windowed, transactions, assets, anchor, f, t],
  );

  const anchorAssetId =
    anchor && anchor.actual > 0 ? dominantAssetOnDay(windowed, anchor.day) : undefined;
  const anchorAsset = assets.find((a) => a.id === anchorAssetId);
  // WINDOWED, because the DAY this sentence names already is. `bondCouponInfo`
  // below stays on the whole ledger on purpose: it describes a SCHEDULE, which the
  // spine classifies as FORECAST.
  const growth = anchorAsset ? anchorAssetGrowth(windowed, anchorAsset.id) : undefined;

  // RANKED BY THE DERIVED COUPON, not by the stored rate: what a bond PAYS depends
  // on how much is held, so ranking off the rate headlines the wrong bond.
  const bondUnits = useMemo(() => unitsByAsset(transactions), [transactions]);
  const bonds = assets
    .map((a) => ({ asset: a, coupon: couponPerPayment(a, bondUnits[a.id]) }))
    // `coupon !== undefined` ALONE: `couponPerPayment` returns `undefined` for any
    // non-`fixed_coupon` asset, so re-checking the yield type was a second gate.
    .filter((b): b is { asset: Asset; coupon: number } => b.coupon !== undefined)
    .sort((x, y) => y.coupon - x.coupon)
    .map((b) => b.asset);
  const big = bonds[0];
  // HALF OF THIS IS HISTORY, AND THAT HALF WINDOWS: the months a bond HAS PAID in
  // come from the ledger, so leaving them whole headlined a month the chart drew no
  // bar for. The schedule half is genuinely a forecast.
  const bigInfo = big ? bondCouponInfo(big, windowed) : undefined;
  const others = bonds.slice(1);

  // THE THIRD CARD WINDOWS TOO, and stating it is the point: under a narrow window
  // it reports the quiet the WINDOW made rather than a seasonal shape. Every card
  // that summarises the bars must agree with the bars above it, and the risk
  // belongs in the copy rather than the derivation.
  const quiet = quietStretch(days);

  return (
    <div>
      {/* `control` is `undefined` rather than an element rendering null, so
          `ScreenHeader`'s empty-dataset branch survives. */}
      <ScreenHeader
        title={t.screen.seasonality.title}
        subtitle={t.screen.seasonality.subtitle}
        actions={control}
      />

      <Card radius={24} className="mb-3.5 animate-in p-[22px] duration-300 fade-in">
        {/* A CONTROL THAT CHANGES ONE CHART SITS ON THAT CHART, where the period control
            that changes a whole screen sits in its header. */}
        <div className="mb-3 flex justify-end">
          <div
            role="group"
            aria-label={t.analytics.seasonality.axisAriaLabel}
            data-filled-track
            className="flex gap-1 rounded-[11px] border border-ink bg-ink p-[3px]"
          >
            {(['day', 'month'] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={axis === a}
                onClick={() => setAxis(a)}
                // 44 × 44 IS HIT AREA, NEVER GEOMETRY: the overlay grows only up and down, and
                // the segments are wide enough that it cannot reach across the gap.
                className={`cursor-pointer rounded-[7px] px-4 py-[5px] text-xs font-bold transition duration-220 ease-soft active:scale-[.97] ${TAP_44} ${
                  axis === a ? 'bg-card text-ink' : 'text-page hover:opacity-85'
                }`}
              >
                {a === 'day'
                  ? t.analytics.seasonality.axisByDay
                  : t.analytics.seasonality.axisByMonth}
              </button>
            ))}
          </div>
        </div>
        <SeasonalityBars data={axis === 'day' ? chartData : monthData} axis={axis} />
        <div className="mt-2 text-[11.5px] text-muted">{t.analytics.prose.seasonalityNote}</div>
      </Card>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <div className="animate-in rounded-3xl bg-pos-tint px-[22px] py-5 duration-300 fade-in">
          <div className="mb-1 text-[10px] tracking-[.12em] text-pos-tint-text uppercase">
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

        <Card radius={24} className="animate-in px-[22px] py-5 duration-300 fade-in">
          <div className="mb-1 text-[10px] tracking-[.12em] text-muted uppercase">
            {t.analytics.seasonality.couponSeason}
          </div>
          <div className="text-[13.5px] leading-[1.5]">
            {big && bigInfo ? (
              <>
                <strong>
                  {t.analytics.seasonality.couponMonths(
                    bigInfo.months.map((m) => t.dates.monthFull[m - 1]).join(t.dates.listAnd),
                    bigInfo.day,
                  )}
                </strong>
                {t.analytics.seasonality.couponRest(shortLabel(big), bigInfo.months.length)}
                {others.map((o) => {
                  const info = bondCouponInfo(o, windowed);
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

        <Card radius={24} className="animate-in px-[22px] py-5 duration-300 fade-in">
          <div className="mb-1 text-[10px] tracking-[.12em] text-muted uppercase">
            {t.analytics.seasonality.quietStretch}
          </div>
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
