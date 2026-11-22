import { useState } from 'react';

import { noLineMessage, withLine } from '../components/charts/yield-lines';
import { TWO_PANEL_ROWS, YieldGridBlocks } from '../components/charts/YieldGrid';
import { YieldLegend, YieldLines } from '../components/charts/YieldLines';
import { YieldPanels } from '../components/charts/YieldPanels';
import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Fact, RecordCard, RecordList } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useHold } from '../hooks/loading';
import { useSeries, useView } from '../hooks/queries';
import { yieldOf } from '../hooks/slices';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import { TableBox } from '../components/ui/TableBox';
import { TABLE, TD, TH, THEAD, TH_NUM, TR } from '../components/ui/table-anatomy';
import { useIsDesktop } from '../hooks/useIsDesktop';

// One rule for both forms, so the table and the card can never disagree about
// which figures are good news. `== null` on purpose: some rows report "no value"
// as `undefined` and others as `null`.
function signClass(v: number | null | undefined): string {
  return v == null ? 'text-muted' : v < 0 ? 'text-neg' : 'text-pos';
}

// A 1 px hairline closes the basis, with the cells' 8 px either side (Y2).
const BASIS_END = 'border-r border-hairline';

export function Yield() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();

  const { period, control } = usePeriodWindow();
  // «Окремо» on every visit, as /seasonality's axis opens on its days.
  const [chart, setChart] = useState<'separate' | 'combined'>('separate');
  const { yield: view, assets } = useView(yieldOf[period]);
  const win = view.window;
  const rows = view.rows;

  // The curve is one value per asset per date, so it is a read of its own by period.
  const series = useSeries(period)?.series;
  // The curve is a read of its own: its box is held, once the read has been out for a while, even
  // when the table beside it came with the view.
  const curveHeld = useHold(series === undefined);
  // Read once: the «Разом» legend and the no-line message both turn on it.
  const hasLine = series !== undefined && withLine(series, assets).length > 0;
  const xirrHeader = view.xirrExtrapolated ? t.analytics.yield.xirrAnn : t.analytics.yield.xirr;

  // The basis is DERIVED, so it can be absent, and a footnote naming no start is
  // worse than none — the table it annotates is empty too. It names the basis, so
  // it follows the window rather than the portfolio.
  const note = win
    ? t.analytics.prose.yieldNote(f.date(win.from)) +
      (view.shortBasisMarked ? ` ${t.analytics.prose.shortBasisNote}` : '')
    : undefined;

  return (
    <div>
      {/* The control is passed only when there IS a window. `ScreenHeader`
          branches on `actions === undefined`, and an element that renders null
          is still defined — so handing it one unconditionally would put an
          empty action row on the empty-dataset screen and break the
          byte-identity that component's doc pins. */}
      <ScreenHeader
        title={t.screen.yield.title}
        subtitle={t.screen.yield.subtitle}
        actions={control}
      />

      <Card
        radius={24}
        className="mb-3.5 animate-in p-[22px] duration-300 fade-in"
        aria-busy={curveHeld || undefined}
        data-yield-card
      >
        {/* A curve not read yet holds the card's boxes and says nothing: "no snapshots" is for a
            curve that was read and is empty. Past the delay its boxes are drawn. */}
        {curveHeld ? (
          // Only the first read is held (`useSeries` keeps a period's curve until the next lands),
          // and a card opens on «Окремо».
          <YieldGridBlocks panels={assets.length} />
        ) : series === undefined ? (
          <div style={{ height: 280 }} />
        ) : series.length === 0 ? (
          <EmptyState message={t.analytics.empty.chart} height={280} />
        ) : (
          <>
            {/* A control that changes one chart sits on that chart, as on /seasonality. «Разом»'s
                legend sits left of it, and under it below md (wave 14). */}
            <div className="mb-3 flex flex-col items-end gap-2 md:flex-row-reverse md:items-start md:justify-between">
              <SegmentedControl
                aria-label={t.analytics.yield.viewAriaLabel}
                value={chart}
                onChange={setChart}
                options={[
                  { value: 'separate', label: t.analytics.yield.viewSeparate },
                  { value: 'combined', label: t.analytics.yield.viewCombined },
                ]}
              />
              {chart === 'combined' && hasLine && (
                <div className="self-start">
                  <YieldLegend data={series} assets={assets} />
                </div>
              )}
            </div>
            {/* The message stands in place of either view, with no legend (#338): «Разом»'s chart
                height, or two panel rows at every width, as wave 25's render draws it. */}
            {!hasLine ? (
              <div data-yield-no-line>
                <EmptyState
                  message={noLineMessage(period, t.analytics.yield)}
                  height={chart === 'separate' ? TWO_PANEL_ROWS : 280}
                />
              </div>
            ) : chart === 'separate' ? (
              <YieldPanels data={series} assets={assets} />
            ) : (
              <div data-yield-combined>
                <YieldLines data={series} assets={assets} />
              </div>
            )}
          </>
        )}
      </Card>

      {/* ONE MECHANISM FOR ONE DECISION: `max-md:hidden` + `md:hidden` still built the
          min-width table on a phone, mounted a `ScrollArea` for it and ran the row
          derivation twice. `useIsDesktop` mounts one branch and only one. */}
      {desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table scrolls in a box of its own, so its header can stick (*Scrolling*). Card
              sets no overflow: a rounded card clipping its own content is where the square
              platform track came from. */}
          <TableBox>
            <table className={`${TABLE} min-w-[780px] text-[12.5px]`}>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className={TH}>
                    {t.analytics.asset}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.invested}
                  </th>
                  <th scope="col" className={`${TH_NUM} ${BASIS_END}`}>
                    {t.analytics.valueNow}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.deltaTotal}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.annualized}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.totalReturn}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {xirrHeader}
                  </th>
                  <th scope="col" className={TH_NUM}>
                    {t.analytics.vsExpected}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.asset.id} className={TR}>
                    <td className={`${TD} font-semibold`}>{r.asset.name}</td>
                    {/* The basis reads muted, so the returns after the hairline lead (Y2). */}
                    <td className={`${TD} text-right text-muted`}>
                      {r.invested === undefined ? '—' : f.num(r.invested)}
                    </td>
                    <td className={`${TD} ${BASIS_END} text-right text-muted`}>
                      {r.value === undefined ? '—' : f.num(r.value)}
                    </td>
                    <td className={`${TD} text-right font-bold ${signClass(r.deltaTotal)}`}>
                      {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
                    </td>
                    {/* COLOUR ALONE CARRIES NO MEANING to a screen reader or to a reader who cannot
                        separate `muted` from `ink` (WCAG 1.4.1), and nothing in the accessible tree
                        says WHICH cells are grey — so the marked ones name themselves. */}
                    <td
                      className={`${TD} text-right ${r.shortBasis ? 'text-muted' : ''}`}
                      title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                    >
                      {r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}
                    </td>
                    <td className={`${TD} text-right font-bold ${signClass(r.totalReturn)}`}>
                      {r.totalReturn == null ? '—' : f.pct(r.totalReturn)}
                    </td>
                    <td className={`${TD} text-right font-bold ${signClass(r.xirr)}`}>
                      {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                    </td>
                    <td
                      className={`${TD} text-right ${r.shortBasis ? 'text-muted' : signClass(r.vsExpectedPp)}`}
                      title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                    >
                      {r.vsExpectedPp === undefined
                        ? '—'
                        : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          {note && <div className="mt-2.5 text-[11.5px] text-muted">{note}</div>}
        </Card>
      ) : (
        /* THE SAME ROWS AS RECORDS, and the `dt` text is the `th` text, character for character. */
        <div className="flex flex-col gap-2.5">
          <RecordList>
            {rows.map((r, i) => (
              <RecordCard
                key={r.asset.id}
                index={i}
                avatar={<AssetAvatar code={r.asset.code} colorKey={r.asset.colorKey} />}
                title={r.asset.name}
              >
                <Fact label={t.analytics.invested}>
                  {r.invested === undefined ? '—' : f.num(r.invested)}
                </Fact>
                <Fact label={t.analytics.valueNow}>
                  {r.value === undefined ? '—' : f.num(r.value)}
                </Fact>
                <Fact label={t.analytics.deltaTotal}>
                  <span className={signClass(r.deltaTotal)}>
                    {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
                  </span>
                </Fact>
                <Fact label={t.analytics.annualized}>
                  {/* The same mark in both shells — a figure greyed on the rail and black in the
                    drawer is two different claims. */}
                  <span
                    className={r.shortBasis ? 'text-muted' : ''}
                    title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                  >
                    {r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}
                  </span>
                </Fact>
                <Fact label={t.analytics.totalReturn}>
                  <span className={signClass(r.totalReturn)}>
                    {r.totalReturn == null ? '—' : f.pct(r.totalReturn)}
                  </span>
                </Fact>
                <Fact label={xirrHeader}>
                  <span className={signClass(r.xirr)}>
                    {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                  </span>
                </Fact>
                <Fact label={t.analytics.vsExpected}>
                  <span
                    className={r.shortBasis ? 'text-muted' : signClass(r.vsExpectedPp)}
                    title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                  >
                    {r.vsExpectedPp === undefined
                      ? '—'
                      : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
                  </span>
                </Fact>
              </RecordCard>
            ))}
          </RecordList>
          {note && <div className="px-1 text-[11.5px] text-muted">{note}</div>}
        </div>
      )}
    </div>
  );
}
