import { useMemo, useState } from 'react';

import { SeasonalityBars } from '../components/charts/SeasonalityBars';
import type { SeasonalityChartPoint } from '../components/charts/SeasonalityBars';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TAP_44 } from '../components/ui/tap-target';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { shortLabel } from './daily-quotes/quotes';
import { seasonalityView } from '@quirenote/core/view/seasonality';
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

  const { period, control } = usePeriodWindow(assets, snapshots, transactions);
  // Every FLOW figure here reads the windowed ledger, so a bar and the card beneath it
  // are on the same side of the boundary (`seasonalityView`).
  const view = useMemo(
    () => seasonalityView({ assets, snapshots, transactions, period }),
    [assets, snapshots, transactions, period],
  );

  /**
   * THE AXIS TOGGLE IS EPHEMERAL, and that is forced: the day buckets are what
   * the reference draws, the subtitle says so, and the three insight cards are
   * written about days, so persisting it would make one press change all of them
   * on every future visit. The mirror of the nav groups, which reached the
   * opposite answer for the opposite reason.
   */
  const [axis, setAxis] = useState<'day' | 'month'>('day');
  const { anchor, anchorAsset, anchorGrowth: growth, bigBond: big, bigBondInfo: bigInfo } = view;

  // The month axis carries no per-bucket colour: a month aggregates several assets, so a
  // "dominant asset" hue would be a claim the bucket does not support.
  const monthData: SeasonalityChartPoint[] = useMemo(
    () =>
      view.months.map((m): SeasonalityChartPoint => ({
        day: m.month,
        actual: m.actual,
        expected: m.expected,
        actualLabel: m.actual > 0 ? f.moneyWhole(m.actual) : undefined,
        expectedLabel: m.expected !== undefined ? `${f.moneyWhole(m.expected)}*` : undefined,
      })),
    [view, f],
  );

  const chartData: SeasonalityChartPoint[] = useMemo(
    () =>
      view.days.map((d): SeasonalityChartPoint => {
        const dominantAsset = assets.find((a) => a.id === d.dominantAssetId);
        const expectedAsset = assets.find((a) => a.id === d.expectedAssetId);
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
    [view, assets, anchor, f, t],
  );

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
                {view.otherBonds.map(({ asset: o, info, month }) => {
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
            {view.quiet ? (
              <>
                <strong>{t.analytics.seasonality.quietDays(view.quiet.from, view.quiet.to)}</strong>
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
