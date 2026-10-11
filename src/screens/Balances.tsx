import { useState } from 'react';

import { BalancesArea } from '../components/charts/BalancesArea';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { pageHasNotHeldQuote } from '@quirenote/core/view/balances';
import { useHold } from '../hooks/loading';
import { useBalancesPage, useView } from '../hooks/queries';
import { selectBalances } from '../hooks/slices';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { BalancesTablePlaceholder } from './placeholders';

// One source for the glyph: the cell that wears it and the legend that explains it must never disagree.
const NOT_HELD_MARK = '*';

export function Balances() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  const { chart: chartData, earliest, assets } = useView(selectBalances);
  const [page, setPage] = useState(0);

  // The table is one row per snapshot, read a page at a time (#189).
  const body = useBalancesPage(page);
  // The table is a read of its own: its rows are held once the read has been out for a while, and
  // until then the same box is laid out unseen, so nothing moves when they are drawn.
  const held = useHold(body === undefined);
  const waiting = held || body === undefined;
  const rows = body?.rows ?? [];
  const next = body?.next ?? null;
  // A page not read yet states no emptiness and no count: those are for a page that was read.
  const empty = body !== undefined && rows.length === 0;
  // A page the dataset no longer reaches (another tab erased or replaced it) starts over, set while
  // rendering as React allows for state of this component. The
  // page on its way is the one before's rows, so only a page that landed empty starts it over.
  if (empty && page > 0) setPage(0);
  // The cells line up with the assets the page names, so the heads are named from that list.
  const columns = (body?.assets ?? []).map((id) => ({
    id,
    name: assets.find((a) => a.id === id)?.name ?? id,
  }));
  // Derived once for both forms: the footnote has to know whether this page holds
  // a marked cell before either form has drawn one.
  const hasNotHeldQuote = pageHasNotHeldQuote(rows);

  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-muted">
      <span>
        {body &&
          t.analytics.prose.showingSnapshots(
            rows.length,
            body.total,
            earliest ? f.date(earliest) : '—',
          )}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="px-3.5 py-1.5 text-xs"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >
          {t.analytics.prev}
        </Button>
        <Button
          variant="outline"
          className="px-3.5 py-1.5 text-xs"
          onClick={() => setPage(page + 1)}
          // The page shown while the next is out is the one before's, and its `next` is the page
          // already asked for: a step from it would ask for one past the end. Two presses before
          // the screen has drawn the first both step from the page it drew.
          disabled={next === null || body?.page !== page}
        >
          {t.analytics.next}
        </Button>
      </div>
    </div>
  );

  const note = hasNotHeldQuote && (
    <div className="text-[11.5px] text-muted">
      {NOT_HELD_MARK} {t.analytics.balances.notHeldQuote}
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

      {/* ONE MECHANISM FOR ONE DECISION: `max-md:hidden` + `md:hidden` still built the
          min-width table on a phone, mounted a `ScrollArea` for it and ran the row
          derivation twice. `useIsDesktop` mounts one branch and only one. */}
      {waiting ? (
        <div aria-busy="true" className={held ? undefined : 'invisible'}>
          <BalancesTablePlaceholder
            desktop={desktop}
            headers={[
              t.analytics.snapshot,
              ...assets.map((a) => a.name),
              t.analytics.cash,
              t.analytics.totalUah,
            ]}
          />
        </div>
      ) : desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table keeps its min-width and the Scroller clips and draws the rail. Card
              sets no overflow: a rounded card clipping its own content is where the square
              platform track came from. */}
          <Scroller orientation="horizontal">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-normal">{t.analytics.snapshot}</th>
                  {columns.map((c) => (
                    <th key={c.id} className="py-2 text-right font-normal">
                      {c.name}
                    </th>
                  ))}
                  <th className="py-2 text-right font-normal">{t.analytics.cash}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.totalUah}</th>
                </tr>
              </thead>
              <tbody>
                {empty && (
                  <tr>
                    <td colSpan={columns.length + 3} className="py-4 text-center text-muted">
                      {t.analytics.empty.table}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr
                    key={row.date}
                    className="border-t border-hairline transition-colors hover:bg-page/60"
                  >
                    <td className="py-2 font-semibold whitespace-nowrap">{f.date(row.date)}</td>
                    {row.cells.map((cell, i) => (
                      <td
                        key={columns[i].id}
                        className="py-2 text-right"
                        title={
                          cell.status === 'value' && cell.notHeld
                            ? t.analytics.balances.notHeldQuote
                            : undefined
                        }
                      >
                        {cell.status === 'value' && f.num(cell.amount)}
                        {cell.status === 'pending' && (
                          <span className="text-faint">{t.analytics.balances.pending}</span>
                        )}
                        {cell.status === 'none' && '—'}
                        {/* A FIXED SLOT, not an appended glyph: the column is right-aligned, so hanging
                            the mark off the digits would push a marked row out of line. Every cell gets
                            the slot or none does. */}
                        {hasNotHeldQuote && (
                          <span className="inline-block w-2 text-left text-muted">
                            {cell.status === 'value' && cell.notHeld ? NOT_HELD_MARK : ''}
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
         columns, so its width GROWS with the portfolio and a fixed horizontal scroll is
         a different number next year. One `dt` per asset makes the record grow in
         HEIGHT instead, which the page already scrolls. */
        <div className="flex flex-col gap-2.5">
          {empty && (
            <Card radius={24} className="animate-in p-[22px] duration-300 fade-in">
              <div className="text-center text-muted">{t.analytics.empty.table}</div>
            </Card>
          )}
          {rows.map((row, i) => (
            <RecordCard key={row.date} index={i} title={f.date(row.date)}>
              {row.cells.map((cell, ci) => (
                <Fact key={columns[ci].id} label={columns[ci].name}>
                  {/* The same mark in both shells, and it names itself — a glyph with nothing in
                      the accessible tree behind it is not a message. */}
                  {cell.status === 'value' && (
                    <span title={cell.notHeld ? t.analytics.balances.notHeldQuote : undefined}>
                      {f.num(cell.amount)}
                      {cell.notHeld && (
                        <span className="font-normal text-muted">{NOT_HELD_MARK}</span>
                      )}
                    </span>
                  )}
                  {/* A partial row keeps its treatment exactly: the total stays `—` rather than a
                      number that would read as complete. */}
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
