import { YieldLines } from '../components/charts/YieldLines';
import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import {
  cumulativeYieldSeriesIn,
  xirrIsExtrapolatedIn,
  yieldTableRowsIn,
} from '@quirenote/core/view/yield';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';

// One rule for both forms, so the table and the card can never disagree about
// which figures are good news. `== null` on purpose: some rows report "no value"
// as `undefined` and others as `null`.
function signClass(v: number | null | undefined): string {
  return v == null ? 'text-muted' : v < 0 ? 'text-neg' : 'text-pos';
}

export function Yield() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  // One call gives the window and the control that sets it, so the two cannot
  // resolve differently.
  const { window: win, control } = usePeriodWindow(assets, snapshots, transactions);

  const series = cumulativeYieldSeriesIn(snapshots, transactions, assets, win);
  const rows = yieldTableRowsIn(assets, snapshots, transactions, win);
  const xirrHeader = xirrIsExtrapolatedIn(win) ? t.analytics.yield.xirrAnn : t.analytics.yield.xirr;

  // The basis is DERIVED, so it can be absent, and a footnote naming no start is
  // worse than none — the table it annotates is empty too. It names the basis, so
  // it follows the window rather than the portfolio.
  const marked = rows.some((r) => r.shortBasis);
  const note = win
    ? t.analytics.prose.yieldNote(f.date(win.from)) +
      (marked ? ` ${t.analytics.prose.shortBasisNote}` : '')
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

      <Card radius={24} className="mb-3.5 animate-in p-[22px] duration-300 fade-in">
        <div className="mb-2 flex flex-wrap gap-4 text-[11.5px] text-muted">
          {assets.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <ColorDot colorKey={a.colorKey} />
              {a.name}
            </span>
          ))}
        </div>
        {series.length === 0 ? (
          <EmptyState message={t.analytics.empty.chart} height={280} />
        ) : (
          <YieldLines data={series} assets={assets} />
        )}
      </Card>

      {/* ONE MECHANISM FOR ONE DECISION: `max-md:hidden` + `md:hidden` still built the
          min-width table on a phone, mounted a `ScrollArea` for it and ran the row
          derivation twice. `useIsDesktop` mounts one branch and only one. */}
      {desktop ? (
        <Card radius={24} className="animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table keeps its min-width and the Scroller clips and draws the rail. Card
              sets no overflow: a rounded card clipping its own content is where the square
              platform track came from. */}
          <Scroller orientation="horizontal">
            <table className="w-full min-w-[780px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-normal">{t.analytics.asset}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.invested}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.valueNow}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.deltaTotal}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.annualized}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.totalReturn}</th>
                  <th className="py-2 text-right font-normal">{xirrHeader}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.vsExpected}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.asset.id}
                    className="border-t border-hairline transition-colors hover:bg-page/60"
                  >
                    <td className="py-2 font-semibold">{r.asset.name}</td>
                    <td className="py-2 text-right">{f.num(r.invested)}</td>
                    <td className="py-2 text-right">
                      {r.value === undefined ? '—' : f.num(r.value)}
                    </td>
                    <td className={`py-2 text-right font-bold ${signClass(r.deltaTotal)}`}>
                      {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
                    </td>
                    {/* COLOUR ALONE CARRIES NO MEANING to a screen reader or to a reader who cannot
                        separate `muted` from `ink` (WCAG 1.4.1), and nothing in the accessible tree
                        says WHICH cells are grey — so the marked ones name themselves. */}
                    <td
                      className={`py-2 text-right ${r.shortBasis ? 'text-muted' : ''}`}
                      title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                    >
                      {r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}
                    </td>
                    <td className={`py-2 text-right font-bold ${signClass(r.totalReturn)}`}>
                      {r.totalReturn == null ? '—' : f.pct(r.totalReturn)}
                    </td>
                    <td className={`py-2 text-right ${r.xirr == null ? 'text-muted' : ''}`}>
                      {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                    </td>
                    <td
                      className={`py-2 text-right ${r.shortBasis ? 'text-muted' : signClass(r.vsExpectedPp)}`}
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
          </Scroller>
          {note && <div className="mt-2.5 text-[11.5px] text-muted">{note}</div>}
        </Card>
      ) : (
        /* THE SAME ROWS AS CARDS, and the `dt` text is the `th` text, character for character. */
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <RecordCard
              key={r.asset.id}
              index={i}
              avatar={<AssetAvatar code={r.asset.code} colorKey={r.asset.colorKey} />}
              title={r.asset.name}
            >
              <Fact label={t.analytics.invested}>{f.num(r.invested)}</Fact>
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
                <span className={r.xirr == null ? 'text-muted' : ''}>
                  {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                </span>
              </Fact>
              <Fact label={t.analytics.vsExpected}>
                <span
                  className={r.shortBasis ? 'text-muted' : signClass(r.vsExpectedPp)}
                  title={r.shortBasis ? t.analytics.prose.shortBasisNote : undefined}
                >
                  {r.vsExpectedPp === undefined ? '—' : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
                </span>
              </Fact>
            </RecordCard>
          ))}
          {note && <div className="px-1 text-[11.5px] text-muted">{note}</div>}
        </div>
      )}
    </div>
  );
}
