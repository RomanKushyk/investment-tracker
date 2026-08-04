import { X } from 'lucide-react';

import { AssetAvatar } from '../../components/ui/AssetAvatar';
import { Card } from '../../components/ui/Card';
import { kyivDateIso, kyivTimeHm } from '../../core/dates';
import { yieldSinceStart } from '../../core/derive';
import { fmtDateShort, fmtPct, fmtProse, fmtTable } from '../../core/money';
import type { Asset } from '../../core/types';
import { quoteInputSchema } from '../../core/schemas';
import type { ProvenanceChip } from './fetch-quotes';
import type { QuoteOffer } from './useQuoteFetch';

// S2 — provenance of the row's CURRENT draft value: `auto` (a fetch filled
// it), `manual` (the user's own — a fetch never overwrites it) or the amber
// `as of dd.MM` stale chip when the value came from the last-good cache.
// Geometry is one pill for all three; only the paint tokens differ.
const CHIP_TITLE = {
  auto: 'Filled from Inzhur (units × sell price).',
  manual: 'Typed by hand — fetch never overwrites it.',
  stale: 'From the last successful fetch — Inzhur was unreachable.',
};

function ProvenanceChipPill({ chip }: { chip: ProvenanceChip }) {
  const paint =
    chip.chip === 'auto'
      ? 'bg-pos-tint text-pos-tint-text'
      : chip.chip === 'stale'
        ? 'bg-warn-tint text-warn-tint-text'
        : 'bg-panel text-muted';
  return (
    <>
      <span
        key={chip.chip}
        title={CHIP_TITLE[chip.chip]}
        className={`animate-in fade-in zoom-in-95 rounded-full px-2 py-[2px] text-[10px] font-bold tracking-[.08em] uppercase duration-150 ${paint}`}
      >
        {chip.chip === 'stale' ? `as of ${fmtDateShort(kyivDateIso(new Date(chip.at)))}` : chip.chip}
      </span>
      {chip.chip === 'auto' && (
        <span className="text-muted text-[10px]">
          fetched {kyivTimeHm(new Date(chip.at))}
        </span>
      )}
    </>
  );
}

// S3 — the no-silent-overwrite rule made visible: the fetched number is
// OFFERED under the input of a row the user typed, never applied. Dashed
// border = proposed (the phase's suggestion language); the stale variant swaps
// the stroke and label to `warn`.
function UseFetchedOffer({
  offer,
  onAccept,
  onDismiss,
}: {
  offer: QuoteOffer;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const value = fmtTable(offer.value);
  return (
    // The right gutter (delta column 52 + its 16 gap) aligns the pill under the
    // input column; below `sm` the row is already stacked, so the pill gets the
    // full width instead of wrapping inside a 68px-narrower box.
    <div className="animate-in fade-in slide-in-from-top-1 flex items-center justify-end gap-2 pr-0 duration-300 sm:pr-[68px]">
      <button
        type="button"
        onClick={onAccept}
        className={`cursor-pointer rounded-full border border-dashed px-3 py-1 text-[11px] transition active:scale-[.97] ${
          offer.stale
            ? 'border-warn text-warn hover:bg-page'
            : 'border-faint text-ink hover:border-muted hover:bg-page'
        }`}
      >
        {offer.stale
          ? `Use ${value} (as of ${fmtDateShort(kyivDateIso(new Date(offer.at)))})?`
          : `Use fetched ${value}?`}
      </button>
      <button
        type="button"
        aria-label="Keep my value"
        onClick={onDismiss}
        className="text-muted cursor-pointer p-1 opacity-85 transition hover:opacity-100 active:scale-[.97]"
      >
        <X size={11} strokeWidth={2.75} />
      </button>
    </div>
  );
}

export function QuoteRow({
  asset,
  raw,
  yesterday,
  chip,
  offer,
  onChange,
  onAcceptOffer,
  onDismissOffer,
}: {
  asset: Asset;
  raw: string | undefined; // undefined = untouched (not yet prefilled or typed)
  yesterday: number | undefined;
  chip: ProvenanceChip | undefined;
  offer: QuoteOffer | undefined;
  onChange: (v: string) => void;
  onAcceptOffer: () => void;
  onDismissOffer: () => void;
}) {
  const parsed = raw !== undefined ? quoteInputSchema.safeParse(raw) : undefined;
  const filled = parsed?.success === true;
  const delta =
    filled && yesterday !== undefined ? yieldSinceStart(parsed.data, yesterday) : undefined;

  return (
    <Card className="animate-in flex flex-col gap-2 fade-in px-5 py-3.5 duration-300 slide-in-from-bottom-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AssetAvatar code={asset.code} colorKey={asset.colorKey} />
        <div className="min-w-[110px] flex-1 break-words">
          <div className="text-sm font-semibold">{asset.name}</div>
          <div className="text-muted flex flex-wrap items-center gap-1.5 text-[11px]">
            <span>{yesterday !== undefined ? `${fmtProse(yesterday)} yesterday` : '—'}</span>
            {chip !== undefined && <ProvenanceChipPill chip={chip} />}
          </div>
        </div>
        <input
          id={`quote-${asset.id}`}
          name={`quote-${asset.id}`}
          className={
            'bg-card h-9 max-w-[160px] min-w-[90px] flex-1 rounded-[10px] border px-3 text-right font-body text-[13px] transition ' +
            (filled ? 'border-pos-border' : 'border-hairline')
          }
          value={raw ?? ''}
          placeholder={yesterday !== undefined ? fmtTable(yesterday) : undefined}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          aria-label={`${asset.name} quote`}
        />
        <span
          key={delta ?? 'empty'}
          className={
            'w-[52px] animate-in fade-in text-right text-xs font-bold zoom-in-95 duration-150 ' +
            (delta === undefined ? 'text-faint' : delta < 0 ? 'text-neg' : 'text-pos')
          }
        >
          {delta === undefined ? '—' : fmtPct(delta)}
        </span>
      </div>
      {offer !== undefined && (
        <UseFetchedOffer offer={offer} onAccept={onAcceptOffer} onDismiss={onDismissOffer} />
      )}
    </Card>
  );
}
