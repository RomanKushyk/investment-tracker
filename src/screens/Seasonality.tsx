import { SeasonalityBars } from '../components/charts/SeasonalityBars';
import type { SeasonalityChartPoint } from '../components/charts/SeasonalityBars';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useTransactions } from '../hooks/queries';
import type { Asset } from '../core/types';
import { shortLabel } from './daily-quotes/quotes';
import {
  anchorAssetGrowth,
  bondCouponInfo,
  dominantAssetOnDay,
  dominantExpectedAssetOnDay,
  incomeAnchorDay,
  quietStretch,
  seasonalityDays,
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

export function Seasonality() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const transactions = useTransactions().data ?? [];

  const days = seasonalityDays(transactions, assets);
  const anchor = incomeAnchorDay(days);

  const chartData: SeasonalityChartPoint[] = days.map((d) => {
    const dominantId = d.actual > 0 ? dominantAssetOnDay(transactions, d.day) : undefined;
    const dominantAsset = assets.find((a) => a.id === dominantId);
    const expectedId =
      d.expected !== undefined ? dominantExpectedAssetOnDay(assets, transactions, d.day) : undefined;
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
  });

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
        <SeasonalityBars data={chartData} />
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
