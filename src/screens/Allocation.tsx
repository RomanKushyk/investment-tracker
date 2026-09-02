import { useState } from 'react';
import { toast } from 'sonner';

import { AllocationDonut } from '../components/charts/AllocationDonut';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EditActions } from '../components/ui/EditActions';
import { useEditMode } from '../hooks/useEditMode';
import { useAssets, useSnapshots, useUpdateAsset } from '../hooks/queries';
import { changedTargets, sumStatus, targetRowStates, targetsSum } from './allocation/targets';
import { useSettings } from '../state/settings';
import { severityOf } from './allocation/allocation';
import { headlineTotal, latestQuotes, sharePct } from '../core/derive';
import type { Asset, ColorKey } from '../core/types';
import { allocationRows, rebalancePlan } from './allocation/allocation';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

const BAR_BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

// Rebalance plan bond label: "OVDP …8976" (abbreviated); other assets keep
// their full name — matches Portfolio's highlight-card convention.
function planLabel(asset: Asset): string {
  return asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : asset.name;
}

export function Allocation() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];

  const updateAsset = useUpdateAsset();
  // A30 — the drafts the editor edits. Keyed by asset id and raw, exactly as
  // the Settings editor kept them: `targetRowStates` owns the parsing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const values = latestQuotes(snapshots);
  const total = headlineTotal(snapshots);

  const slices = assets.map((a) => ({ asset: a, value: values[a.id] ?? 0 }));
  const rows = allocationRows(assets, values, total);
  const { actions, withinRange } = rebalancePlan(assets, values, total);

  // ── the targets editor, rehoused from Settings (A30, brief S2) ───────────
  // THE LANGUAGE, because the grammar is a language rule: under Ukrainian
  // `17,500` is 17.5, and this editor used to read it as 17500 while the asset
  // form beside it read 17.5 — one field, two doors, two answers.
  const targetLang = useSettings((state) => state.language);
  const targetRows = targetRowStates(assets, drafts, targetLang);
  const sum = targetsSum(targetRows);
  const status = sumStatus(sum);
  // Σ ≠ 100 warns and never blocks; an unparseable entry is the one thing that
  // does, because there is no number to write. Both rules are the Settings
  // editor's, moved unchanged.
  const invalid = targetRows.some((r) => r.value === null);
  const pending = changedTargets(targetRows);
  const dirty = pending.length > 0 || invalid;
  const mode = useEditMode(dirty);
  // BUG 3, found in review: Cancel was live while a save was in flight, so
  // discarding mid-save still persisted the values and then congratulated the
  // user on a page they had explicitly abandoned. A save cannot be un-issued;
  // the honest answer is that it cannot be abandoned either.
  //
  // LOCAL STATE, NOT `updateAsset.isPending` (1.7.0 release review): a TanStack
  // mutation observer holds ONE current mutation, so each `mutateAsync` replaces
  // the last and `isPending` reports only the most recently STARTED write. With
  // four targets edited it went false the moment the fourth settled — which is
  // not the moment the batch is done, because four independent IndexedDB
  // requests have no ordering guarantee. The lockout lifted mid-batch and BUG 3
  // was open again through a different door.
  const [saving, setSaving] = useState(false);

  // `allSettled`, NOT `all`, and the difference is what the user is told. `all`
  // rejects on the FIRST failure while the other writes are already committed,
  // so a partial save reported itself as a total failure: the user read "could
  // not save", left, and three of four targets had silently changed. Nothing
  // here can be a transaction — `updateAsset` is one row per call — so the
  // honest move is to count what landed and say so.
  function saveTargets() {
    setSaving(true);
    void Promise.allSettled(
      pending.map((patch) =>
        updateAsset.mutateAsync({ id: patch.id, patch: { targetPct: patch.targetPct } }),
      ),
    ).then((results) => {
      setSaving(false);
      const written = results.filter((r) => r.status === 'fulfilled').length;
      if (written === results.length) {
        setDrafts({});
        mode.exit();
        toast.success(t.targets.savedToast);
        return;
      }
      // EDIT MODE STAYS OPEN and the drafts stay put. The rows that DID land
      // stop differing from stored once the query invalidates, so they drop out
      // of `pending` on their own and the editor is left holding exactly the
      // ones still to write. Nothing to reconcile by hand.
      toast.error(
        written === 0 ? t.targets.saveFailed : t.targets.savePartial(written, results.length),
      );
    });
  }

  // Leaving edit mode by any path drops the drafts — the stored targets are
  // what the read-only card must show the instant it comes back.
  const editing = mode.editing;
  if (!editing && Object.keys(drafts).length > 0) setDrafts({});

  /**
   * F5 — THE LIVE PREVIEW IS THE TARGET TICK, NOT A ShareBar.
   *
   * The brief specified `ShareBar` widths; there is no `ShareBar` on this
   * screen, and the card already draws the thing the editor changes. So the
   * TICK moves to the drafted target and the pp delta re-derives against it,
   * while the FILL — the current share — never moves: an entered target cannot
   * change what you own. The bar's own `transition-[width]` 500 ms carries it;
   * no duration is minted.
   */
  const shownTarget = (i: number) => (editing ? targetRows[i].effective : rows[i].target);

  return (
    <div>
      <ScreenHeader
        title={t.screen.allocation.title}
        subtitle={t.screen.allocation.subtitle}
        // No assets → nothing to edit, so no control at all rather than a
        // disabled one (brief's rule, and TargetsEditor's own `return null`).
        actions={
          assets.length === 0 ? undefined : (
            <EditActions
              mode={mode}
              variant="batch"
              onSave={saveTargets}
              // BUG 9: with nothing changed, Save ran an empty `Promise.all`
              // and reported "Цілі збережено" for zero writes. A confirmation
              // of nothing is worse than no confirmation.
              saveDisabled={invalid || saving || pending.length === 0}
              busy={saving}
            />
          )
        }
      />

      <div className="grid grid-cols-[340px_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card
          radius={24}
          className="flex animate-in flex-col items-center p-[22px] duration-300 fade-in"
        >
          {total === 0 ? (
            <EmptyState message={t.analytics.empty.allocation} height={220} />
          ) : (
            <AllocationDonut
              slices={slices}
              centerTop={t.analytics.allocation.centerTotal(Math.round(total / 1000))}
              centerSub={t.analytics.allocation.assetsPlusCash(assets.length)}
            />
          )}
          <div className="mt-2.5 flex w-full flex-col gap-1.5 text-xs">
            {assets.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <ColorDot colorKey={a.colorKey} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="font-bold">{f.pctPlain(sharePct(values[a.id] ?? 0, total))}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card radius={24} className="animate-in p-[22px] duration-300 fade-in">
            <div className="mb-3.5 flex items-center gap-2.5 text-[10px] tracking-[.12em] text-muted uppercase">
              {t.analytics.allocation.currentVsTarget}
              {editing && <span className="ml-auto">{t.targets.title}</span>}
            </div>
            <div className="flex flex-col gap-3.5">
              {rows.map((r, i) => {
                const target = shownTarget(i);
                const deltaPp = r.share - target;
                const off = severityOf(deltaPp) === 'off';
                const error = editing && targetRows[i].value === null;
                return (
                  <div key={r.asset.id}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
                      <span className="min-w-0 flex-[1_1_120px] truncate font-semibold">
                        {r.asset.name}
                      </span>
                      {editing ? (
                        <>
                          <span className="whitespace-nowrap text-muted">
                            {f.pctPlain(r.share)}
                          </span>
                          <span className="text-muted">/</span>
                          <input
                            id={`target-${r.asset.id}`}
                            name={`target-${r.asset.id}`}
                            value={drafts[r.asset.id] ?? f.input(r.asset.targetPct)}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [r.asset.id]: e.target.value }))
                            }
                            inputMode="decimal"
                            aria-label={t.targets.fieldAria(r.asset.name)}
                            aria-invalid={error}
                            className={`h-9 w-[72px] rounded-[9px] border bg-page px-2.5 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
                          />
                          <span className="text-muted">%</span>
                        </>
                      ) : (
                        <span className="ml-auto">
                          {f.pctPlain(r.share)} /{' '}
                          {f.pctPlain(target, Number.isInteger(target) ? 0 : 1)}{' '}
                          <strong className={off ? 'text-neg' : 'text-pos'}>{f.pp(deltaPp)}</strong>
                        </span>
                      )}
                    </div>
                    {error && (
                      <div className="mb-1.5 animate-in text-right text-[11px] text-neg duration-200 fade-in slide-in-from-top-1">
                        {t.targets.invalid}
                      </div>
                    )}
                    <div className="relative h-2.5 rounded-[3px] bg-hairline">
                      <div
                        className={`h-full rounded-[3px] transition-[width] duration-500 ease-soft ${BAR_BG[r.asset.colorKey]}`}
                        style={{ width: `${r.share}%` }}
                      />
                      {/* F5: the tick follows the DRAFT, the fill never does. */}
                      <div
                        className="absolute -top-[3px] h-4 w-0.5 bg-ink transition-[left] duration-500 ease-soft"
                        style={{ left: `${target}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {editing && (
              /* Keyed by Σ so every value change re-runs the entry animation
                 (D7), exactly as the Settings editor did. */
              <div className="mt-3.5">
                <span
                  key={sum}
                  className={`inline-block animate-in rounded-[6px] px-3 py-1 text-xs font-semibold duration-150 zoom-in-95 fade-in ${
                    status === 'ok'
                      ? 'bg-pos-tint text-pos-tint-text'
                      : 'bg-warn-tint text-warn-tint-text'
                  }`}
                >
                  {status === 'ok'
                    ? t.targets.sumOk(f.pctPlain(sum, Number.isInteger(sum) ? 0 : 1))
                    : t.targets.sumOff(f.pctPlain(sum, Number.isInteger(sum) ? 0 : 1))}
                </span>
              </div>
            )}
          </Card>

          <div className="animate-in rounded-3xl border border-panel-border bg-panel px-[22px] py-5 duration-300 fade-in">
            <div className="mb-2 text-[10px] tracking-[.12em] text-muted uppercase">
              {t.analytics.allocation.rebalancePlan}
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
              {actions.map((a, i) => (
                <div key={a.asset.id} className="flex justify-between gap-2.5">
                  <span>
                    {i + 1} ·{' '}
                    {a.kind === 'buy' ? t.analytics.allocation.buy : t.analytics.allocation.trim}{' '}
                    {planLabel(a.asset)}
                  </span>
                  <strong className="whitespace-nowrap">
                    {a.kind === 'buy' ? '+' : '−'}
                    {f.moneyWhole(a.amount)}
                  </strong>
                </div>
              ))}
              {withinRange.length > 0 && (
                <div className="flex justify-between gap-2.5 text-muted">
                  <span>{withinRange.map((a) => shortLabel(a)).join(' & ')}</span>
                  <span>{t.analytics.allocation.withinRange}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
