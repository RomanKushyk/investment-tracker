import { Fragment, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { ColorDot } from '../../components/ui/ColorDot';
import { ShareBar } from '../../components/ui/ShareBar';
import { headlineTotal, latestQuotes, sharePct } from '../../core/derive';
import { useAssets, useSnapshots, useUpdateAsset } from '../../hooks/queries';
import { changedTargets, sumStatus, targetRowStates, targetsSum } from './targets';
import { useT } from '../../i18n/useT';
import { useFormat } from '../../hooks/useFormat';

// S4 — Settings→Portfolio targets editor (design/extensions/settings.dc.html):
// one row per asset (dot · name · muted current share · 72px %-input), a live
// preview ShareBar re-rendering the ENTERED targets, and the Σ pill — =100
// pos tint, ≠100 warn tint, recomputed on every keystroke and never a save
// blocker (brief S4). Explicit {t.targets.save} per the reference — per-asset
// useUpdateAsset patches for the rows that actually changed.
//
// Renders its own divider + "Targets" microlabel so the whole sub-section
// disappears behind the S2 Portfolio empty state (and while assets load).
export function TargetsEditor() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const updateAsset = useUpdateAsset();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (assets.length === 0) return null;

  const values = latestQuotes(snapshots);
  const total = headlineTotal(snapshots);

  const rows = targetRowStates(assets, drafts);
  const sum = targetsSum(rows);
  const status = sumStatus(sum);
  // Invalid input disables Save (there is no number to write) — distinct from
  // the Σ warn, which stays non-blocking.
  const invalid = rows.some((r) => r.value === null);

  function save() {
    Promise.all(
      changedTargets(rows).map((p) =>
        updateAsset.mutateAsync({ id: p.id, patch: { targetPct: p.targetPct } }),
      ),
    )
      .then(() => toast.success(t.targets.savedToast))
      .catch(() => toast.error(t.targets.saveFailed));
  }

  return (
    <div>
      <div className="bg-hairline my-4 h-px" />
      <div className="text-muted mb-3 text-[10px] tracking-[.12em] uppercase">{t.targets.title}</div>

      <div className="flex flex-col gap-0.5">
        {assets.map((a, i) => {
          const row = rows[i];
          const error = row.value === null;
          return (
            <Fragment key={a.id}>
              {/* flex-wrap + the name's 120px basis: same 360px wrap rule as
                  the asset-manager rows above (S2) */}
              <div className="hover:bg-page/60 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl px-3 py-1.5 transition">
                <ColorDot colorKey={a.colorKey} />
                <span className="min-w-0 flex-[1_1_120px] truncate text-[13.5px] font-semibold">
                  {a.name}
                </span>
                <span className="text-muted text-xs whitespace-nowrap">
                  {t.targets.now(f.pctPlain(sharePct(values[a.id] ?? 0, total)))}
                </span>
                <input
                  id={`target-${a.id}`}
                  name={`target-${a.id}`}
                  value={drafts[a.id] ?? String(a.targetPct)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`${a.name} target, %`}
                  aria-invalid={error}
                  className={`bg-page h-9 w-[72px] rounded-[9px] border px-2.5 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
                />
                <span className="text-muted text-xs">%</span>
              </div>
              {error && (
                <div className="text-neg animate-in fade-in slide-in-from-top-1 mx-3 text-right text-[11px] duration-200">
                  {t.targets.invalid}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* live preview: the ENTERED targets as ShareBar segments — an invalid
          row keeps its stored share (targets.ts `effective`), a Σ<100 entry
          simply leaves the bar short of full width */}
      <div className="mx-3 mt-3.5">
        <ShareBar
          segments={assets.map((a, i) => ({ colorKey: a.colorKey, pct: rows[i].effective }))}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        {/* keyed by Σ so every value change re-runs the entry animation (D7
            spec); the =100↔≠100 tint always rides the same remount, since the
            status can only flip when the sum itself changes */}
        <span
          key={sum}
          className={`animate-in fade-in zoom-in-95 rounded-[6px] px-3 py-1 text-xs font-semibold duration-150 ${
            status === 'ok' ? 'bg-pos-tint text-pos-tint-text' : 'bg-warn-tint text-warn-tint-text'
          }`}
        >
          {status === 'ok' ? `Σ ${sum}%` : `Σ ${sum}% — targets don't add up to 100%`}
        </span>
        <Button
          className="ml-auto"
          disabled={updateAsset.isPending || invalid}
          onClick={save}
        >
          {t.targets.save}
        </Button>
      </div>
    </div>
  );
}
