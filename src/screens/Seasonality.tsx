import { SeasonalityBars } from '../components/charts/SeasonalityBars';
import type { SeasonalityChartPoint } from '../components/charts/SeasonalityBars';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useTransactions } from '../hooks/queries';
import { fmtProseWhole } from '../lib/format';
import type { Asset } from '../lib/types';
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
import { MONTH_SHORT } from './shared/dates';

const SCHEDULE_FREQUENCY: Record<Asset['payoutSchedule'], string> = {
  monthly: 'every month',
  quarterly: 'every quarter',
  semiannual: 'twice a year',
  maturity: 'at maturity',
  none: '',
};

function dayDescriptor(day: number): string {
  if (day <= 10) return 'early';
  if (day <= 20) return 'mid';
  return 'late';
}

export function Seasonality() {
  const assets = useAssets().data ?? [];
  const transactions = useTransactions().data ?? [];

  const days = seasonalityDays(transactions, assets);
  const anchor = incomeAnchorDay(days);

  const chartData: SeasonalityChartPoint[] = days.map((d) => {
    const dominantId = d.actual > 0 ? dominantAssetOnDay(transactions, d.day) : undefined;
    const dominantAsset = assets.find((a) => a.id === dominantId);
    const expectedId = d.expected !== undefined ? dominantExpectedAssetOnDay(assets, d.day) : undefined;
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
            ? `${fmtProseWhole(d.actual)} · day ${d.day}`
            : fmtProseWhole(d.actual)
          : undefined,
      expectedLabel: d.expected !== undefined ? `${fmtProseWhole(d.expected)}*` : undefined,
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
      <ScreenHeader
        title="Seasonality"
        subtitle="When money actually arrives — income by day of month, Feb – Jul 2026"
      />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        <SeasonalityBars data={chartData} />
        <div className="text-muted mt-2 text-[11.5px]">
          * expected — projected from the asset's next coupon date. Gray stubs = ordinary price-drift
          days with no income.
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <div className="animate-in fade-in bg-pos-tint rounded-3xl px-[22px] py-5 duration-300">
          <div className="text-pos-tint-text mb-1 text-[10px] tracking-[.12em] uppercase">
            Income anchor
          </div>
          <div className="text-[13.5px] leading-[1.5]">
            {anchor && anchorAsset && growth ? (
              <>
                <strong>Day {anchor.day}</strong> is the paycheck: {shortLabel(anchorAsset)} dividends
                land {SCHEDULE_FREQUENCY[anchorAsset.payoutSchedule]}, {fmtProseWhole(growth.first)} →{' '}
                {fmtProseWhole(growth.last)} and growing.
              </>
            ) : (
              'No recurring income yet.'
            )}
          </div>
        </div>

        <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
          <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">Coupon season</div>
          <div className="text-[13.5px] leading-[1.5]">
            {big && bigInfo ? (
              <>
                <strong>
                  {bigInfo.months.map((m) => MONTH_SHORT[m - 1]).join(' & ')} (day {bigInfo.day})
                </strong>{' '}
                carry the big {shortLabel(big)} coupons
                {others.map((o) => {
                  const info = bondCouponInfo(o, transactions);
                  const month = info?.historicalMonths[0] ?? info?.months[0];
                  return info && month ? (
                    <span key={o.id}>
                      ; {shortLabel(o)} pays in {dayDescriptor(info.day)} {MONTH_SHORT[month - 1]}
                    </span>
                  ) : null;
                })}
                .
              </>
            ) : (
              'No bond coupons yet.'
            )}
          </div>
        </Card>

        <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
          <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">Quiet stretch</div>
          <div className="text-[13.5px] leading-[1.5]">
            {quiet ? (
              <>
                <strong>
                  Days {quiet.from}–{quiet.to}
                </strong>{' '}
                see almost no cash events — a good window for rebalancing buys.
              </>
            ) : (
              'Income is spread evenly across the month.'
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
