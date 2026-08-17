import { useState } from 'react';

import { BalancesArea } from '../components/charts/BalancesArea';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots } from '../hooks/queries';
import { balanceChartData, buildBalanceRow, paginateSnapshots } from './balances/balances';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';

export function Balances() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const [page, setPage] = useState(0);

  const chartData = balanceChartData(snapshots, assets);
  const { rows, page: currentPage, totalPages, total } = paginateSnapshots(snapshots, page);
  const earliest = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;

  return (
    <div>
      <ScreenHeader title={t.screen.balances.title} subtitle={t.screen.balances.subtitle} />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        {chartData.length === 0 ? (
          <EmptyState message={t.analytics.empty.chart} height={260} />
        ) : (
          <BalancesArea data={chartData} />
        )}
      </Card>

      <Card radius={24} className="animate-in fade-in px-[22px] py-2.5 duration-300">
        {/* The table keeps its min-width; the Scroller is what clips and draws
            the rail. Card no longer sets overflow — a rounded card clipping its
            own content is where the square platform track came from. */}
        <Scroller orientation="horizontal">
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-muted text-left">
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
                  <td colSpan={assets.length + 3} className="text-muted py-4 text-center">
                    {t.analytics.empty.table}
                  </td>
                </tr>
              )}
              {rows.map((s) => {
                const row = buildBalanceRow(s, assets);
                return (
                  <tr key={s.date} className="border-hairline hover:bg-page/60 border-t transition-colors">
                    <td className="py-2 font-semibold whitespace-nowrap">{f.date(s.date)}</td>
                    {row.cells.map((cell, i) => (
                      <td key={assets[i].id} className="py-2 text-right">
                        {cell.status === 'value' && f.num(cell.amount)}
                        {cell.status === 'pending' && (
                          <span className="text-faint">{t.analytics.balances.pending}</span>
                        )}
                        {cell.status === 'none' && '—'}
                      </td>
                    ))}
                    <td className="py-2 text-right">{f.num(row.cash)}</td>
                    <td className="py-2 text-right font-bold">
                      {row.total === null ? <span className="text-faint">—</span> : f.num(row.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Scroller>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-muted">
          <span>
            {t.analytics.prose.showingSnapshots(
              rows.length,
              total,
              earliest ? f.date(earliest) : '—',
            )}
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
      </Card>
    </div>
  );
}
