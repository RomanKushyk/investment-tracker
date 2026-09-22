import { Plus } from 'lucide-react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Button } from '../components/ui/Button';
import { EditActions } from '../components/ui/EditActions';
import { useEditMode } from '../hooks/useEditMode';
import { AssetDialogs } from './portfolio/AssetDialogs';
import { useAssetDialogs } from './portfolio/useAssetDialogs';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { Share } from '../components/ui/Share';
import { CashShortChip } from '../components/ui/CashShortChip';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import {
  headlineTotal,
  investedByAsset,
  freeCashFromLedger,
  latestQuotes,
  netResult,
  reinvestedByAsset,
  reinvestedTotal,
  sharePct,
  shareTotal,
  soldAmount,
  yieldSinceStart,
  cashIsShort,
  usableTotal,
} from '@quirenote/core/derive';
import { daysBetween, latestSnapshotDate } from '@quirenote/core/dates';
import type { Asset } from '@quirenote/core/types';
import { bondAbbrev } from './daily-quotes/quotes';
import { bestPerformer, incomeEngine, laggard } from '@quirenote/core/view/portfolio';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';
import { useIsDesktop } from '../hooks/useIsDesktop';

function highlightLabel(asset: Asset): string {
  return asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : asset.name;
}

function signClass(v: number): string {
  return v < 0 ? 'text-neg' : 'text-pos';
}

export function Portfolio() {
  const f = useFormat();
  const t = useT();
  const desktop = useIsDesktop();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const reinvested = reinvestedByAsset(transactions);
  const total = headlineTotal(snapshots, transactions);
  const cash = freeCashFromLedger(transactions);
  const cashShort = cashIsShort(cash);
  const base = shareTotal(total, cash);
  // The Total row's 100 % is a share like the others, absent on the same total.
  const totalShare = usableTotal(base) ? 100 : null;
  const net = netResult(values, invested, soldAmount(transactions));
  const investedTotal = Object.values(invested).reduce((a, b) => a + b, 0);

  const best = bestPerformer(assets, values, invested);
  const worst = laggard(assets, values, invested);
  const engine = incomeEngine(assets, transactions);

  const now = latestSnapshotDate(snapshots);
  const bestWeeks =
    best && now ? Math.round(daysBetween(best.asset.firstPurchase, now) / 7) : undefined;

  // THE PER-ENTITY VARIANT: `Done` alone, no Save and no Cancel, because create /
  // edit / delete each commit through their own dialog. A Save would have nothing
  // to do and a Cancel could not undo the deletion behind it.
  const mode = useEditMode();
  const assetDialogs = useAssetDialogs(assets);
  const editing = mode.editing;

  // The labels stay short on screen; the ACCESSIBLE name carries the asset,
  // because identical action pairs give a screen reader nothing to tell them apart
  // on a control where one choice is destructive.
  const rowActions = (asset: Asset) => (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={t.assets.editAria(asset.name)}
        onClick={() => assetDialogs.openEdit(asset)}
      >
        {t.assets.edit}
      </Button>
      <Button
        variant="outlineDanger"
        size="sm"
        aria-label={t.assets.deleteAria(asset.name)}
        onClick={() => assetDialogs.openDelete(asset)}
      >
        {t.assets.delete}
      </Button>
    </>
  );

  // One shape for both forms, so the table and the cards read the same numbers
  // from the same place rather than each doing the arithmetic again.
  const rows = assets.map((a) => {
    const value = values[a.id] ?? 0;
    const inv = invested[a.id] ?? 0;
    const reinv = reinvested[a.id] ?? 0;
    return { asset: a, value, inv, reinv, pnl: value - inv, pnlPct: yieldSinceStart(value, inv) };
  });

  return (
    <div>
      <ScreenHeader
        title={t.screen.portfolio.title}
        subtitle={t.screen.portfolio.subtitle}
        // The control stays on an EMPTY portfolio, unlike /allocation's: there is
        // nothing to edit, but adding an asset is exactly what an empty portfolio needs.
        actions={<EditActions mode={mode} variant="entity" />}
      />

      {/* ONE MECHANISM FOR ONE DECISION: `max-md:hidden` + `md:hidden` still built the
          min-width table on a phone, mounted a `ScrollArea` for it and ran the row
          derivation twice. `useIsDesktop` mounts one branch and only one. */}
      {/* The screen that owns the assets owns the empty sentence: deleting Settings'
          Portfolio card left the LIVE dataset showing a table of zeros with nothing
          telling anyone what to do. */}
      {assets.length === 0 ? (
        <div className="mb-3.5 text-[13px] leading-normal text-muted">{t.assets.empty}</div>
      ) : desktop ? (
        <Card radius={24} className="mb-3.5 animate-in px-[22px] py-2.5 duration-300 fade-in">
          {/* The table keeps its min-width and the Scroller clips and draws the rail. Card
              sets no overflow: a rounded card clipping its own content is where the square
              platform track came from. */}
          <Scroller orientation="horizontal">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 font-normal">{t.analytics.asset}</th>
                  <th className="py-2 font-normal">{t.analytics.yieldType}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.invested}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.ofItReinvested}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.valueNow}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.capitalGainUah}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.capitalGainPct}</th>
                  <th className="py-2 text-right font-normal">{t.analytics.share}</th>
                  {/* The ninth column exists only in edit mode: an always-present empty column
                      would widen the table's min-width for a control that is not there. */}
                  {editing && (
                    <th className="py-2 font-normal">
                      <span className="sr-only">{t.assets.actionsHeader}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.asset.id}
                    className="border-t border-hairline transition-colors hover:bg-page/60"
                  >
                    {/* `th scope="row"` so the action buttons are announced against the asset. */}
                    <th scope="row" className="py-2 text-left font-semibold">
                      {r.asset.name}
                    </th>
                    <td className="py-2">
                      <Tag colorKey={r.asset.colorKey}>{t.asset.yieldShort[r.asset.yieldType]}</Tag>
                    </td>
                    <td className="py-2 text-right">{f.num(r.inv)}</td>
                    <td className="py-2 text-right">{r.reinv > 0 ? f.num(r.reinv) : '—'}</td>
                    <td className="py-2 text-right">{f.num(r.value)}</td>
                    <td className={`py-2 text-right font-bold ${signClass(r.pnl)}`}>
                      {f.signedNum(r.pnl)}
                    </td>
                    <td className={`py-2 text-right font-bold ${signClass(r.pnlPct)}`}>
                      {f.pct(r.pnlPct)}
                    </td>
                    <td className="py-2 text-right">
                      <Share pct={sharePct(r.value, base)} />
                    </td>
                    {editing && (
                      <td className="py-2 pl-4">
                        <div className="flex animate-in items-center justify-end gap-2.5 duration-300 fade-in slide-in-from-bottom-1">
                          {rowActions(r.asset)}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-panel-border">
                  <td className="py-2 font-bold">
                    {t.analytics.prose.totalPlusCash(f.money(cash))}
                  </td>
                  <td className="py-2"></td>
                  <td className="py-2 text-right font-bold">{f.num(investedTotal)}</td>
                  <td className="py-2 text-right font-bold">
                    {f.num(reinvestedTotal(transactions))}
                  </td>
                  <td className="py-2 text-right font-bold">{f.num(total)}</td>
                  <td className={`py-2 text-right font-bold ${signClass(net.uah)}`}>
                    {f.signedNum(net.uah)}
                  </td>
                  <td className={`py-2 text-right font-bold ${signClass(net.pct)}`}>
                    {f.pct(net.pct)}
                  </td>
                  <td className="py-2 text-right font-bold">
                    <Share pct={totalShare} fractionDigits={0} />
                  </td>
                  {/* The Total row gets no actions — a sum is not an entity. */}
                  {editing && <td className="py-2" />}
                </tr>
              </tbody>
            </table>
          </Scroller>
          {/* Under the "Total + cash" line it explains; the chip does not fit the cell. */}
          {cashShort && <CashShortChip className="mt-2.5" />}
          <div className="mt-2.5 text-[11.5px] text-muted">{t.analytics.prose.capitalGainNote}</div>
        </Card>
      ) : (
        <div className="mb-3.5 flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <RecordCard
              key={r.asset.id}
              index={i}
              avatar={<AssetAvatar code={r.asset.code} colorKey={r.asset.colorKey} />}
              title={r.asset.name}
              tag={<Tag colorKey={r.asset.colorKey}>{t.asset.yieldShort[r.asset.yieldType]}</Tag>}
              // A FOOTER BAND, not the header row, where a 360 overflow was closed and two
              // buttons would re-open it. The band is ALREADY `flex flex-wrap`, so the actions
              // go in bare — a nested flex box makes the pair one unwrappable item and
              // cancels the wrap the band exists to provide.
              footer={editing ? rowActions(r.asset) : undefined}
            >
              <Fact label={t.analytics.invested}>{f.num(r.inv)}</Fact>
              <Fact label={t.analytics.ofItReinvested}>{r.reinv > 0 ? f.num(r.reinv) : '—'}</Fact>
              <Fact label={t.analytics.valueNow}>{f.num(r.value)}</Fact>
              <Fact label={t.analytics.share}>
                <Share pct={sharePct(r.value, base)} />
              </Fact>
              <Fact label={t.analytics.capitalGainUah}>
                <span className={signClass(r.pnl)}>{f.signedNum(r.pnl)}</span>
              </Fact>
              <Fact label={t.analytics.capitalGainPct}>
                <span className={signClass(r.pnlPct)}>{f.pct(r.pnlPct)}</span>
              </Fact>
            </RecordCard>
          ))}
          <RecordCard
            index={rows.length}
            title={t.analytics.prose.totalPlusCash(f.money(cash))}
            className="border-t-2 border-panel-border"
            footer={cashShort ? <CashShortChip /> : undefined}
          >
            <Fact label={t.analytics.invested}>{f.num(investedTotal)}</Fact>
            <Fact label={t.analytics.ofItReinvested}>{f.num(reinvestedTotal(transactions))}</Fact>
            <Fact label={t.analytics.valueNow}>{f.num(total)}</Fact>
            <Fact label={t.analytics.share}>
              <Share pct={totalShare} fractionDigits={0} />
            </Fact>
            <Fact label={t.analytics.capitalGainUah}>
              <span className={signClass(net.uah)}>{f.signedNum(net.uah)}</span>
            </Fact>
            <Fact label={t.analytics.capitalGainPct}>
              <span className={signClass(net.pct)}>{f.pct(net.pct)}</span>
            </Fact>
          </RecordCard>
          <div className="px-1 text-[11.5px] text-muted">{t.analytics.prose.capitalGainNote}</div>
        </div>
      )}

      {/* ONE render site, reached by both shells because it sits after the branch —
          and it is why the header keeps its control on an empty portfolio. */}
      {editing && (
        <div className="mb-3.5 animate-in duration-300 fade-in slide-in-from-bottom-1">
          <Button variant="outline" onClick={assetDialogs.openCreate}>
            <Plus size={13} strokeWidth={2.75} />
            {t.assets.add}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        {best ? (
          <KpiCard
            className="animate-in duration-300 fade-in"
            valueSize="sm"
            label={t.analytics.portfolio.bestPerformer}
            value={highlightLabel(best.asset)}
            sub={
              bestWeeks !== undefined ? (
                <span className="font-bold text-pos">
                  {t.analytics.prose.inWeeks(f.pct(best.yield), bestWeeks)}
                </span>
              ) : undefined
            }
          />
        ) : (
          <Card radius={24} className="animate-in px-[22px] py-5 duration-300 fade-in">
            <div className="mb-1 text-[10px] tracking-[.12em] text-muted uppercase">
              {t.analytics.portfolio.bestPerformer}
            </div>
            <EmptyState message={t.analytics.portfolio.noQuotes} height={40} />
          </Card>
        )}
        {worst ? (
          <KpiCard
            className="animate-in delay-75 duration-300 fade-in"
            valueSize="sm"
            label={t.analytics.portfolio.laggard}
            value={highlightLabel(worst.asset)}
            sub={t.analytics.prose.watchVsExpected(
              f.pct(worst.yield),
              f.pctPlain(worst.asset.expectedPct),
            )}
          />
        ) : (
          <Card radius={24} className="animate-in px-[22px] py-5 duration-300 fade-in">
            <div className="mb-1 text-[10px] tracking-[.12em] text-muted uppercase">
              {t.analytics.portfolio.laggard}
            </div>
            <EmptyState message={t.analytics.portfolio.noQuotes} height={40} />
          </Card>
        )}
        <KpiCard
          tone="tint"
          className="animate-in delay-150 duration-300 fade-in"
          valueSize="sm"
          label={t.analytics.portfolio.incomeEngine}
          value={engine ? highlightLabel(engine.asset) : '—'}
          sub={
            engine
              ? (() => {
                  const isDividends = engine.dividends >= engine.coupons;
                  const amount = isDividends ? engine.dividends : engine.coupons;
                  const kind = isDividends
                    ? t.analytics.portfolio.dividendsWord
                    : t.analytics.portfolio.couponsWord;
                  const reinvestedNote =
                    (reinvested[engine.asset.id] ?? 0) > 0
                      ? t.analytics.portfolio.autoReinvested
                      : '';
                  return `${f.moneyWhole(amount)} ${kind}${reinvestedNote}`;
                })()
              : undefined
          }
          subClassName="text-pos-tint-text"
        />
      </div>
      <AssetDialogs ctl={assetDialogs} />
    </div>
  );
}
