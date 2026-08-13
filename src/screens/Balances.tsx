import { useState } from 'react';

import { BalancesArea } from '../components/charts/BalancesArea';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots } from '../hooks/queries';
import { fmtDate, fmtTable } from '../core/money';
import { balanceChartData, buildBalanceRow, paginateSnapshots } from './balances/balances';

export function Balances() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const [page, setPage] = useState(0);

  const chartData = balanceChartData(snapshots, assets);
  const { rows, page: currentPage, totalPages, total } = paginateSnapshots(snapshots, page);
  const earliest = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;

  return (
    <div>
      <ScreenHeader title="Balances" subtitle="Total capital by daily snapshot" />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        {chartData.length === 0 ? (
          <EmptyState message="No snapshots yet — save your first daily quote to start this chart." height={260} />
        ) : (
          <BalancesArea data={chartData} />
        )}
      </Card>

      <Card radius={24} className="animate-in fade-in overflow-x-auto px-[22px] py-2.5 duration-300">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-muted text-left">
              <th className="py-2 font-normal">Snapshot</th>
              {assets.map((a) => (
                <th key={a.id} className="py-2 text-right font-normal">
                  {a.name}
                </th>
              ))}
              <th className="py-2 text-right font-normal">Cash</th>
              <th className="py-2 text-right font-normal">Total, ₴</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={assets.length + 3} className="text-muted py-4 text-center">
                  No snapshots yet — save your first daily quote to fill this table.
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const row = buildBalanceRow(s, assets);
              return (
                <tr key={s.date} className="border-hairline hover:bg-page/60 border-t transition-colors">
                  <td className="py-2 font-semibold whitespace-nowrap">{fmtDate(s.date)}</td>
                  {row.cells.map((cell, i) => (
                    <td key={assets[i].id} className="py-2 text-right">
                      {cell.status === 'value' && fmtTable(cell.amount)}
                      {cell.status === 'pending' && <span className="text-faint">pending</span>}
                      {cell.status === 'none' && '—'}
                    </td>
                  ))}
                  <td className="py-2 text-right">{fmtTable(row.cash)}</td>
                  <td className="py-2 text-right font-bold">
                    {row.total === null ? <span className="text-faint">—</span> : fmtTable(row.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-muted">
          <span>
            Showing last {rows.length} snapshots · {total} total since{' '}
            {earliest ? fmtDate(earliest) : '—'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="px-3.5 py-1.5 text-xs"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              className="px-3.5 py-1.5 text-xs"
              onClick={() => setPage((p) => p + 1)}
              disabled={currentPage >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
