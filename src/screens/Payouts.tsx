import { PayoutsBars } from '../components/charts/PayoutsBars';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useTransactions } from '../hooks/queries';
import { incomeReceived, reinvestedTotal } from '../core/derive';
import { todayIso } from '../core/dates';
import { nextPayoutRows } from './overview/overview';
import { monthlyPayouts, payoutLogRows } from './payouts/payouts';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';

export function Payouts() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  const assets = useAssets().data ?? [];
  const transactions = useTransactions().data ?? [];

  const income = incomeReceived(transactions);
  const reinvested = reinvestedTotal(transactions);
  const reinvestedPct = income.total === 0 ? 0 : (reinvested / income.total) * 100;
  // Today, not the last snapshot — see the note in Overview.tsx.
  const payoutRows = nextPayoutRows(assets, transactions, todayIso());

  const chartData = monthlyPayouts(transactions).map((m) => ({
    monthLabel: t.dates.monthShort[Number(m.month.slice(5, 7)) - 1],
    dividends: m.dividends,
    coupons: m.coupons,
    totalLabel: f.num(m.total),
  }));

  const logRows = payoutLogRows(transactions);
  const assetName = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  // The type Tag's paint is the row's KIND, not the asset's, exactly as the table does.
  const typeColorKey = (type: string): 'reit' | 'ovdp8976' =>
    type === 'dividend_accrual' ? 'reit' : 'ovdp8976';
  const typeLabel = (type: string) =>
    type === 'dividend_accrual' ? t.analytics.prose.dividendTag : t.analytics.prose.couponTag;
  const destination = (row: (typeof logRows)[number]) =>
    row.destination.kind === 'reinvested'
      ? t.analytics.prose.reinvestedInto(f.money(row.destination.amount))
      : t.analytics.prose.toAccount;

  return (
    <div>
      <ScreenHeader title={t.screen.payouts.title} subtitle={t.screen.payouts.subtitle} />

      <div className="mb-3.5 grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in p-[22px] duration-300 fade-in">
          <div className="mb-2 flex gap-4 text-[11.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-reit" />
              {t.analytics.dividends}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-ovdp8976" />
              {t.analytics.coupons}
            </span>
          </div>
          <PayoutsBars data={chartData} />
        </Card>

        <div className="flex flex-col gap-3.5">
          <KpiCard
            tone="wall"
            className="animate-in duration-300 fade-in"
            label={t.analytics.receivedTotal}
            value={f.money(income.total)}
            subClassName="text-pos"
            sub={t.analytics.prose.dividendsAndCoupons(
              f.money(income.dividends),
              f.money(income.coupons),
            )}
          />

          <div className="animate-in rounded-3xl bg-pos-tint px-[22px] py-5 duration-300 fade-in">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-pos-tint-text uppercase">
              {t.analytics.upcoming}
            </div>
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
            className="animate-in duration-300 fade-in"
            valueSize="md"
            label={t.analytics.reinvested}
            value={f.money(reinvested)}
            sub={t.analytics.prose.ofReceivedIncome(f.pctPlain(reinvestedPct))}
          />
        </div>
      </div>

      {/* ONE MECHANISM FOR ONE DECISION: `max-md:hidden` + `md:hidden` still built the
          min-width table on a phone, mounted a `ScrollArea` for it and ran the row
          derivation twice. `useIsDesktop` mounts one branch and only one. */}
      {desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table keeps its min-width and the Scroller clips and draws the rail. Card
              sets no overflow: a rounded card clipping its own content is where the square
              platform track came from. */}
          <Scroller orientation="horizontal">
            {/* 720, NOT the 560 that was written for five columns: there are seven, and the
                smaller bound would cramp the two newest instead of letting the Scroller do its
                job. */}
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-normal">{t.analytics.date}</th>
                  <th className="py-2 font-normal">{t.analytics.asset}</th>
                  <th className="py-2 font-normal">{t.analytics.type}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.amountUah}</th>
                  {/* AFTER the amount, where they read as a deduction from it and the remainder —
                      the order the tax spec names. */}
                  <th className="py-2 text-right font-normal">{t.analytics.withheldUah}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.netOfTaxUah}</th>
                  <th className="py-2 font-normal">{t.analytics.destination}</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => (
                  <tr
                    key={`${row.date}-${row.assetId}-${row.amount}`}
                    className="border-t border-hairline transition-colors hover:bg-page/60"
                  >
                    <td className="py-2 whitespace-nowrap">{f.date(row.date)}</td>
                    <td className="py-2 font-semibold">{assetName(row.assetId)}</td>
                    <td className="py-2">
                      <Tag colorKey={typeColorKey(row.type)}>{typeLabel(row.type)}</Tag>
                    </td>
                    <td className="py-2 text-right font-bold">{f.num(row.amount)}</td>
                    {/* EMPTY WHERE THERE IS NONE, the net cell included: such a row's net IS the
                        amount column, so printing it would repeat one figure on most rows. Not a
                        dash and not a zero. */}
                    <td className="py-2 text-right font-bold">
                      {row.taxWithheld !== undefined ? f.num(row.taxWithheld) : ''}
                    </td>
                    <td className="py-2 text-right font-bold">
                      {row.taxWithheld !== undefined ? f.num(row.net) : ''}
                    </td>
                    <td className="py-2">{destination(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        </Card>
      ) : (
        /* Below the breakpoint the log becomes one card per payout: the DATE and the
         asset are the record's identity, so they go in the header. */
        <div className="flex flex-col gap-2.5">
          {logRows.map((row, i) => (
            <RecordCard
              key={`${row.date}-${row.assetId}-${row.amount}`}
              index={i}
              eyebrow={f.date(row.date)}
              title={assetName(row.assetId)}
              tag={<Tag colorKey={typeColorKey(row.type)}>{typeLabel(row.type)}</Tag>}
            >
              <Fact label={t.analytics.amountUah}>{f.num(row.amount)}</Fact>
              <Fact label={t.analytics.destination}>{destination(row)}</Fact>
              {/* On a row with no withholding the pair is absent rather than empty: a card has
                  no table structure to keep. The labels are the table's headers verbatim,
                  which `RecordCard` requires — a reader who learns a column name on a laptop
                  must find it again on a phone.

                  THE ORDER DIVERGES FROM THE TABLE'S, deliberately: putting the pair after
                  Destination puts Withheld directly BELOW the amount it was taken from in the
                  two-column grid. `RecordCard` binds the LABELS, not the sequence. */}
              {row.taxWithheld !== undefined && (
                <>
                  <Fact label={t.analytics.withheldUah}>{f.num(row.taxWithheld)}</Fact>
                  <Fact label={t.analytics.netOfTaxUah}>{f.num(row.net)}</Fact>
                </>
              )}
            </RecordCard>
          ))}
        </div>
      )}
    </div>
  );
}
