import { YieldLines } from '../components/charts/YieldLines';
import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { cumulativeYieldSeriesIn, xirrIsExtrapolatedIn, yieldTableRowsIn } from './yield/yield';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';

// One rule for both forms, so the table and the card can never disagree about
// which figures are good news. `== null` on purpose: some of these rows report
// "no value" as `undefined` and others as `null`.
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

  // A39 — one call gives the window and the control that sets it, so the two
  // cannot resolve differently. `all` is the full history, which is why the
  // default screen is byte-identical to the one before this task.
  const { window: win, control } = usePeriodWindow(assets, snapshots, transactions);

  const series = cumulativeYieldSeriesIn(snapshots, transactions, assets, win);
  const rows = yieldTableRowsIn(assets, snapshots, transactions, win);
  // "(ann.)" clarity suffix while history < 365 days (S9b) — plain "XIRR" after.
  const xirrHeader = xirrIsExtrapolatedIn(win)
    ? t.analytics.yield.xirrAnn
    : t.analytics.yield.xirr;

  // A24 — the basis is derived, so it can be absent. An empty dataset has no
  // start to name, and a footnote reading "365 days from —" is worse than no
  // footnote: the table it annotates is empty too.
  // The footnote names the basis, so it follows the window rather than the
  // portfolio: under `3 місяці` a note reading "from 3 Feb" would describe a
  // table that no longer starts there.
  const note = win ? t.analytics.prose.yieldNote(f.date(win.from)) : undefined;

  return (
    <div>
      {/* The control is passed only when there IS a window. `ScreenHeader`
          branches on `actions === undefined`, and an element that renders null
          is still defined — so handing it one unconditionally would put an
          empty action row on the empty-dataset screen and break the
          byte-identity that component's doc pins (A38 review). */}
      <ScreenHeader
        title={t.screen.yield.title}
        subtitle={t.screen.yield.subtitle}
        actions={control}
      />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        <div className="text-muted mb-2 flex flex-wrap gap-4 text-[11.5px]">
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

      {/* ONE MECHANISM FOR ONE DECISION. The two forms used to be `max-md:hidden`
          and `md:hidden`, so a phone still built the min-width table, mounted a
          `ScrollArea` for it and ran the row derivation twice — CSS hid it, the
          browser still paid for it. `useIsDesktop` is the same breakpoint the
          shell, the charts and the DatePicker already switch on, so this mounts
          one branch and only one. Both forms still render from the same `rows`,
          so neither re-derives — only the arrangement differs (S3). */}
      {desktop ? (
      <Card radius={24} className="animate-in fade-in px-[22px] py-2.5 duration-300">
        {/* The table keeps its min-width; the Scroller is what clips and draws
            the rail. Card no longer sets overflow — a rounded card clipping its
            own content is where the square platform track came from. */}
        <Scroller orientation="horizontal">
          <table className="w-full min-w-[780px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-muted text-left">
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
                <tr key={r.asset.id} className="border-hairline hover:bg-page/60 border-t transition-colors">
                  <td className="py-2 font-semibold">{r.asset.name}</td>
                  <td className="py-2 text-right">{f.num(r.invested)}</td>
                  <td className="py-2 text-right">{r.value === undefined ? '—' : f.num(r.value)}</td>
                  <td className={`py-2 text-right font-bold ${signClass(r.deltaTotal)}`}>
                    {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
                  </td>
                  <td className="py-2 text-right">{r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}</td>
                  <td className={`py-2 text-right font-bold ${signClass(r.totalReturn)}`}>
                    {r.totalReturn == null ? '—' : f.pct(r.totalReturn)}
                  </td>
                  <td className={`py-2 text-right ${r.xirr == null ? 'text-muted' : ''}`}>
                    {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                  </td>
                  <td className={`py-2 text-right ${signClass(r.vsExpectedPp)}`}>
                    {r.vsExpectedPp === undefined ? '—' : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
        {note && <div className="text-muted mt-2.5 text-[11.5px]">{note}</div>}
      </Card>
      ) : (
      /* THE SAME ROWS AS CARDS, below the breakpoint. The `dt` text is the `th`
         text, character for character. */
      <div className="flex flex-col gap-2.5">
        {rows.map((r, i) => (
          <RecordCard
            key={r.asset.id}
            index={i}
            avatar={<AssetAvatar code={r.asset.code} colorKey={r.asset.colorKey} />}
            title={r.asset.name}
          >
            <Fact label={t.analytics.invested}>{f.num(r.invested)}</Fact>
            <Fact label={t.analytics.valueNow}>{r.value === undefined ? '—' : f.num(r.value)}</Fact>
            <Fact label={t.analytics.deltaTotal}>
              <span className={signClass(r.deltaTotal)}>
                {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
              </span>
            </Fact>
            <Fact label={t.analytics.annualized}>
              {r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}
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
              <span className={signClass(r.vsExpectedPp)}>
                {r.vsExpectedPp === undefined ? '—' : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
              </span>
            </Fact>
          </RecordCard>
        ))}
        {note && <div className="text-muted px-1 text-[11.5px]">{note}</div>}
      </div>
      )}
    </div>
  );
}
