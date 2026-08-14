import { PayoutsBars } from '../components/charts/PayoutsBars';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useTransactions } from '../hooks/queries';
import { incomeReceived, reinvestedTotal } from '../core/derive';
import { nextPayoutRows } from './overview/overview';
import { monthlyPayouts, payoutLogRows } from './payouts/payouts';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

export function Payouts() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const transactions = useTransactions().data ?? [];

  const income = incomeReceived(transactions);
  const reinvested = reinvestedTotal(transactions);
  const reinvestedPct = income.total === 0 ? 0 : (reinvested / income.total) * 100;
  const payoutRows = nextPayoutRows(assets, transactions);

  const chartData = monthlyPayouts(transactions).map((m) => ({
    monthLabel: t.dates.monthShort[Number(m.month.slice(5, 7)) - 1],
    dividends: m.dividends,
    coupons: m.coupons,
    totalLabel: f.num(m.total),
  }));

  const logRows = payoutLogRows(transactions);
  const assetName = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  return (
    <div>
      <ScreenHeader title={t.screen.payouts.title} subtitle={t.screen.payouts.subtitle} />

      <div className="mb-3.5 grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in fade-in p-[22px] duration-300">
          <div className="text-label mb-2 flex gap-4 text-[11.5px]">
            <span className="flex items-center gap-1.5">
              <span className="bg-reit inline-block size-2.5 rounded-[3px]" />
              {t.analytics.dividends}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-ovdp8976 inline-block size-2.5 rounded-[3px]" />
              {t.analytics.coupons}
            </span>
          </div>
          <PayoutsBars data={chartData} />
        </Card>

        <div className="flex flex-col gap-3.5">
          <KpiCard
            tone="dark"
            className="animate-in fade-in duration-300"
            label={t.analytics.receivedTotal}
            value={f.money(income.total)}
            subClassName="text-pos-on-dark"
            sub={t.analytics.prose.dividendsAndCoupons(
              f.money(income.dividends),
              f.money(income.coupons),
            )}
          />

          <div className="animate-in fade-in bg-pos-tint rounded-3xl px-[22px] py-5 duration-300">
            <div className="text-pos-tint-text mb-1.5 text-[10px] tracking-[.12em] uppercase">{t.analytics.upcoming}</div>
            <div className="flex flex-col gap-2 text-[13px]">
              {payoutRows.length === 0 && <span>{t.analytics.noUpcoming}</span>}
              {payoutRows.map((r) => (
                <div key={r.assetId} className="flex justify-between gap-2">
                  <span>
                    {r.kind === 'coupon'
                      ? t.analytics.prose.couponOf(r.assetRef)
                      : t.analytics.prose.dividendOf(r.assetRef)}
                  </span>
                  <strong className="whitespace-nowrap">
                    {r.approx ? '~' : ''}
                    {f.moneyWhole(r.amount)} · {f.dateShort(r.date)}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <KpiCard
            className="animate-in fade-in duration-300"
            valueSize="md"
            label={t.analytics.reinvested}
            value={f.money(reinvested)}
            sub={t.analytics.prose.ofReceivedIncome(f.pctPlain(reinvestedPct))}
          />
        </div>
      </div>

      <Card radius={24} className="animate-in fade-in overflow-x-auto px-[22px] py-2.5 duration-300">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-muted text-left">
              <th className="py-2 font-normal">{t.analytics.date}</th>
              <th className="py-2 font-normal">{t.analytics.asset}</th>
              <th className="py-2 font-normal">{t.analytics.type}</th>
              <th className="py-2 text-right font-normal">{t.analytics.amountUah}</th>
              <th className="py-2 font-normal">{t.analytics.destination}</th>
            </tr>
          </thead>
          <tbody>
            {logRows.map((row) => (
              <tr
                key={`${row.date}-${row.assetId}-${row.amount}`}
                className="border-hairline hover:bg-page/60 border-t transition-colors"
              >
                <td className="py-2 whitespace-nowrap">{f.date(row.date)}</td>
                <td className="py-2 font-semibold">{assetName(row.assetId)}</td>
                <td className="py-2">
                  <Tag colorKey={row.type === 'dividend_accrual' ? 'reit' : 'ovdp8976'}>
                    {row.type === 'dividend_accrual'
                      ? t.analytics.prose.dividendTag
                      : t.analytics.prose.couponTag}
                  </Tag>
                </td>
                <td className="py-2 text-right font-bold">{f.num(row.amount)}</td>
                <td className="py-2">
                  {row.destination.kind === 'reinvested'
                    ? t.analytics.prose.reinvestedInto(f.money(row.destination.amount))
                    : t.analytics.prose.toAccount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
