import { PayoutsBars } from '../components/charts/PayoutsBars';
import { Card } from '../components/ui/Card';
import { Amount } from '../components/ui/Amount';
import { KpiCard } from '../components/ui/KpiCard';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useView } from '../hooks/queries';
import { selectPayouts } from '../hooks/slices';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { TableBox } from '../components/ui/TableBox';
import { TABLE, TD, TH, THEAD, TH_NUM, TR } from '../components/ui/table-anatomy';
import { useIsDesktop } from '../hooks/useIsDesktop';

export function Payouts() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  // The view's day, not the last snapshot — see the note in Overview.tsx.
  const { payouts: view, assets } = useView(selectPayouts);
  const { income, reinvested, reinvestedPct, nextPayouts: payoutRows } = view;

  const chartData = view.months.map((m) => ({
    monthLabel: t.dates.monthShort[Number(m.month.slice(5, 7)) - 1],
    dividends: m.dividends,
    coupons: m.coupons,
    totalLabel: f.num(m.total),
  }));

  const logRows = view.log;
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
            className="animate-in duration-300 fade-in"
            label={t.analytics.receivedTotal}
            value={<Amount parts={f.moneyParts(income.total)} />}
            subClassName="text-pos"
            sub={t.analytics.prose.dividendsAndCoupons(
              f.money(income.dividends),
              f.money(income.coupons),
            )}
          />

          <Card radius={24} className="animate-in px-[22px] py-5 duration-300 fade-in">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-muted uppercase">
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
                  <strong className="font-mono whitespace-nowrap">
                    {r.approx ? '~' : ''}
                    {f.moneyWhole(r.amount)} · {f.dateShort(r.date)}
                  </strong>
                </div>
              ))}
            </div>
          </Card>

          <KpiCard
            className="animate-in duration-300 fade-in"
            valueSize="md"
            label={t.analytics.reinvested}
            value={<Amount parts={f.moneyParts(reinvested)} />}
            sub={t.analytics.prose.ofReceivedIncome(f.pctPlain(reinvestedPct))}
          />
        </div>
      </div>

      {/* ONE MECHANISM FOR ONE DECISION: `useIsDesktop` mounts one branch and only one, so a
          phone never builds the min-width table or derives the rows twice. */}
      {desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table scrolls in a box of its own, so its header can stick. Card sets no
              overflow, so the box, not the card, clips (*Scrolling*). */}
          <TableBox>
            {/* 720 for the seven columns: a smaller bound would cramp the two tax columns
                instead of letting the box scroll. */}
            <table className={`${TABLE} min-w-[720px] text-[12.5px]`}>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className={TH}>
                    {t.analytics.date}
                  </th>
                  <th scope="col" className={TH}>
                    {t.analytics.asset}
                  </th>
                  <th scope="col" className={TH}>
                    {t.analytics.type}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.amountUah}
                  </th>
                  {/* AFTER the amount, where they read as a deduction from it and the remainder —
                      the order the tax spec names. */}
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.withheldUah}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.netOfTaxUah}
                  </th>
                  <th scope="col" className={TH}>
                    {t.analytics.destination}
                  </th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => (
                  <tr key={`${row.date}-${row.assetId}-${row.amount}`} className={TR}>
                    <td className={`${TD} whitespace-nowrap`}>{f.date(row.date)}</td>
                    <td className={`${TD} font-semibold`}>{assetName(row.assetId)}</td>
                    <td className={TD}>
                      <Tag colorKey={typeColorKey(row.type)}>{typeLabel(row.type)}</Tag>
                    </td>
                    <td className={`${TD} text-right font-bold`}>{f.num(row.amount)}</td>
                    {/* EMPTY WHERE THERE IS NONE, the net cell included: such a row's net IS the
                        amount column, so printing it would repeat one figure on most rows. Not a
                        dash and not a zero. */}
                    <td className={`${TD} text-right font-bold`}>
                      {row.taxWithheld !== undefined ? f.num(row.taxWithheld) : ''}
                    </td>
                    <td className={`${TD} text-right font-bold`}>
                      {row.taxWithheld !== undefined ? f.num(row.net) : ''}
                    </td>
                    <td className={TD}>{destination(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </Card>
      ) : (
        /* Below the breakpoint the log becomes one card per payout: the DATE and the
         asset are the record's identity, so they go in the header. */
        <div className="flex flex-col gap-2.5">
          {logRows.map((row, i) => (
            <RecordCard
              key={`${row.date}-${row.assetId}-${row.amount}`}
              index={i}
              eyebrow={<span className="font-mono">{f.date(row.date)}</span>}
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
