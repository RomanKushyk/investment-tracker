import { useState } from 'react';

import { BalancesArea } from '../components/charts/BalancesArea';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots } from '../hooks/queries';
import {
  balanceChartData,
  buildBalanceRow,
  pageHasEarlyQuote,
  paginateSnapshots,
} from './balances/balances';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';

// One source for the glyph: the cell that wears it and the legend that explains
// it must never be able to disagree.
const EARLY_MARK = '*';

export function Balances() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const [page, setPage] = useState(0);

  const chartData = balanceChartData(snapshots, assets);
  const { rows, page: currentPage, totalPages, total } = paginateSnapshots(snapshots, page);
  const earliest = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
  // Derived once for both forms: the footnote has to know whether this page
  // holds a marked cell before either form has drawn one.
  const built = rows.map((s) => buildBalanceRow(s, assets));
  const hasEarlyQuote = pageHasEarlyQuote(built);

  // The pagination strip belongs to the screen, not to either form of the data,
  // so it is written once and placed under whichever one is on screen.
  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-muted">
      <span>
        {t.analytics.prose.showingSnapshots(rows.length, total, earliest ? f.date(earliest) : '—')}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="px-3.5 py-1.5 text-xs"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={currentPage === 0}
        >
          {t.analytics.prev}
        </Button>
        <Button
          variant="outline"
          className="px-3.5 py-1.5 text-xs"
          onClick={() => setPage((p) => p + 1)}
          disabled={currentPage >= totalPages - 1}
        >
          {t.analytics.next}
        </Button>
      </div>
    </div>
  );

  // The legend for the mark, written once like the pager and placed under
  // whichever form is on screen.
  const note = hasEarlyQuote && (
    <div className="text-[11.5px] text-muted">
      {EARLY_MARK} {t.analytics.balances.earlyQuote}
    </div>
  );

  return (
    <div>
      <ScreenHeader title={t.screen.balances.title} subtitle={t.screen.balances.subtitle} />

      <Card radius={24} className="mb-3.5 animate-in p-[22px] duration-300 fade-in">
        {chartData.length === 0 ? (
          <EmptyState message={t.analytics.empty.chart} height={260} />
        ) : (
          <BalancesArea data={chartData} />
        )}
      </Card>

      {/* ONE MECHANISM FOR ONE DECISION. The two forms used to be `max-md:hidden`
          and `md:hidden`, so a phone still built the min-width table, mounted a
          `ScrollArea` for it and ran the row derivation twice — CSS hid it, the
          browser still paid for it. `useIsDesktop` is the same breakpoint the
          shell, the charts and the DatePicker already switch on, so this mounts
          one branch and only one. */}
      {desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table keeps its min-width; the Scroller is what clips and draws
            the rail. Card no longer sets overflow — a rounded card clipping its
            own content is where the square platform track came from. */}
          <Scroller orientation="horizontal">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-normal">{t.analytics.snapshot}</th>
                  {assets.map((a) => (
                    <th key={a.id} className="py-2 text-right font-normal">
                      {a.name}
                    </th>
                  ))}
                  <th className="py-2 text-right font-normal">{t.analytics.cash}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.totalUah}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={assets.length + 3} className="py-4 text-center text-muted">
                      {t.analytics.empty.table}
                    </td>
                  </tr>
                )}
                {built.map((row) => (
                  <tr
                    key={row.date}
                    className="border-t border-hairline transition-colors hover:bg-page/60"
                  >
                    <td className="py-2 font-semibold whitespace-nowrap">{f.date(row.date)}</td>
                    {row.cells.map((cell, i) => (
                      <td
                        key={assets[i].id}
                        className="py-2 text-right"
                        title={
                          cell.status === 'value' && cell.beforeFirstPurchase
                            ? t.analytics.balances.earlyQuote
                            : undefined
                        }
                      >
                        {cell.status === 'value' && f.num(cell.amount)}
                        {cell.status === 'pending' && (
                          <span className="text-faint">{t.analytics.balances.pending}</span>
                        )}
                        {cell.status === 'none' && '—'}
                        {/* A FIXED SLOT, not an appended glyph: the column is
                          right-aligned, so hanging the mark off the digits would
                          push a marked row out of line. Every cell gets the slot
                          or none does, and only a page with a mark has one. */}
                        {hasEarlyQuote && (
                          <span className="inline-block w-2 text-left text-muted">
                            {cell.status === 'value' && cell.beforeFirstPurchase ? EARLY_MARK : ''}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="py-2 text-right">{f.num(row.cash)}</td>
                    <td className="py-2 text-right font-bold">
                      {row.total === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        f.num(row.total)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>

          {note && <div className="mt-2.5">{note}</div>}
          <div className="mt-2.5">{pager}</div>
        </Card>
      ) : (
        /* THIS IS THE SCREEN THE CARD FORM EXISTS FOR. Balances is `3 + N assets`
          columns, so its width GROWS with the portfolio — a horizontal scroll
          fixed at 684 px today is a different number next year. One `dt` per
          asset, then Cash and Total, makes the record grow in HEIGHT instead,
          which the page already scrolls. */
        <div className="flex flex-col gap-2.5">
          {rows.length === 0 && (
            <Card radius={24} className="animate-in p-[22px] duration-300 fade-in">
              <div className="text-center text-muted">{t.analytics.empty.table}</div>
            </Card>
          )}
          {built.map((row, i) => (
            <RecordCard key={row.date} index={i} title={f.date(row.date)}>
              {row.cells.map((cell, ci) => (
                <Fact key={assets[ci].id} label={assets[ci].name}>
                  {/* The same mark in both shells (D66), and it names itself —
                      a glyph with nothing in the accessible tree behind it is
                      not a message. */}
                  {cell.status === 'value' && (
                    <span
                      title={cell.beforeFirstPurchase ? t.analytics.balances.earlyQuote : undefined}
                    >
                      {f.num(cell.amount)}
                      {cell.beforeFirstPurchase && (
                        <span className="font-normal text-muted">{EARLY_MARK}</span>
                      )}
                    </span>
                  )}
                  {/* A partial row keeps its treatment exactly: `pending` in
                      `faint`, and the total `—` rather than a number that would
                      read as complete. */}
                  {cell.status === 'pending' && (
                    <span className="font-normal text-faint">{t.analytics.balances.pending}</span>
                  )}
                  {cell.status === 'none' && '—'}
                </Fact>
              ))}
              <Fact label={t.analytics.cash}>{f.num(row.cash)}</Fact>
              <Fact label={t.analytics.totalUah}>
                {row.total === null ? (
                  <span className="font-normal text-faint">—</span>
                ) : (
                  f.num(row.total)
                )}
              </Fact>
            </RecordCard>
          ))}
          {note && <div className="px-1">{note}</div>}
          <div className="px-1">{pager}</div>
        </div>
      )}
    </div>
  );
}
