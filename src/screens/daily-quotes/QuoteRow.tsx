import { X } from 'lucide-react';

import { AssetAvatar } from '../../components/ui/AssetAvatar';
import { Card } from '../../components/ui/Card';
import { kyivDateIso, kyivTimeHm } from '../../core/dates';
import { yieldSinceStart } from '../../core/derive';
import type { QuoteVerdict } from '../../core/inzhur/dcf';
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

// S2's title vocabulary has no accrual entry (S4 mints the microcopy) — the
// pill's tooltip states the source in the same voice.
const ACCRUAL_CHIP_TITLE = 'Filled from coupon accrual — a suggestion you accepted.';

// S4 input tooltip, verbatim from the reference.
const GHOST_TITLE = 'Suggested from coupon accrual — accept or type your own.';

function ProvenanceChipPill({ chip }: { chip: ProvenanceChip }) {
  const paint =
    chip.chip === 'auto'
      ? 'bg-pos-tint text-pos-tint-text'
      : chip.chip === 'stale'
        ? 'bg-warn-tint text-warn-tint-text'
        : 'bg-panel text-muted';
  const accrual = chip.chip === 'auto' && chip.note === 'accrual';
  return (
    <>
      <span
        key={chip.chip}
        title={accrual ? ACCRUAL_CHIP_TITLE : CHIP_TITLE[chip.chip]}
        className={`animate-in fade-in zoom-in-95 rounded-full px-2 py-[2px] text-[10px] font-bold tracking-[.08em] uppercase duration-150 ${paint}`}
      >
        {chip.chip === 'stale' ? `as of ${fmtDateShort(kyivDateIso(new Date(chip.at)))}` : chip.chip}
      </span>
      {chip.chip === 'auto' && (
        <span className="text-muted text-[10px]">
          {accrual ? 'accrual' : `fetched ${kyivTimeHm(new Date(chip.at))}`}
        </span>
      )}
    </>
  );
}

// The shared "proposed value" line under an input — S3's fetched offer and S4's
// accrual suggestion are the same affordance: one DASHED ghost pill (dashed =
// proposed, the phase's binding visual rule) plus a dismiss ✕. The stale variant
// swaps the stroke and label to `warn`.
function OfferLine({
  label,
  dismissLabel,
  stale = false,
  onAccept,
  onDismiss,
}: {
  label: string;
  dismissLabel: string;
  stale?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    // The right gutter (delta column 52 + its 16 gap) aligns the pill under the
    // input column; below `sm` the row is already stacked, so the pill gets the
    // full width instead of wrapping inside a 68px-narrower box.
    <div className="animate-in fade-in slide-in-from-top-1 flex items-center justify-end gap-2 pr-0 duration-300 sm:pr-[68px]">
      <button
        type="button"
        onClick={onAccept}
        className={`cursor-pointer rounded-full border border-dashed px-3 py-1 text-[11px] transition active:scale-[.97] ${
          stale
            ? 'border-warn text-warn hover:bg-page'
            : 'border-faint text-ink hover:border-muted hover:bg-page'
        }`}
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="text-muted cursor-pointer p-1 opacity-85 transition hover:opacity-100 active:scale-[.97]"
      >
        <X size={11} strokeWidth={2.75} />
      </button>
    </div>
  );
}

// S3 — the no-silent-overwrite rule made visible: the fetched number is
// OFFERED under the input of a row the user typed, never applied.
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
    <OfferLine
      label={
        offer.stale
          ? `Use ${value} (as of ${fmtDateShort(kyivDateIso(new Date(offer.at)))})?`
          : `Use fetched ${value}?`
      }
      dismissLabel="Keep my value"
      stale={offer.stale}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}

/**
 * A6 — what the pricing model makes of the provider's own quote.
 *
 * Read-only, and it never touches the number: the provider's value stands as
 * the observed fact even when it is days old (G5/D31). This only says so out
 * loud, which a price alone can never do.
 *
 * `consistent` renders NOTHING. A line that appears on every healthy row is
 * noise, and noise is what stops anyone reading the one row that matters.
 */
function ModelNote({ verdict }: { verdict: QuoteVerdict }) {
  if (verdict.state === 'consistent' || verdict.state === 'not_applicable') return null;

  if (verdict.state === 'stale') {
    const { daysStale, date } = verdict.fit;
    return (
      <div className="text-muted animate-in fade-in text-[11px] duration-300">
        Provider price is {daysStale === 1 ? 'a day' : `${daysStale} days`} old — it still
        prices to {fmtDateShort(date)}.
      </div>
    );
  }

  if (verdict.state === 'revised') {
    return (
      <div className="text-warn animate-in fade-in text-[11px] duration-300">
        Yield looks revised: the price implies {verdict.impliedPct.toFixed(2)}%, the feed
        publishes {verdict.publishedPct}%.
      </div>
    );
  }

  return (
    <div className="text-faint animate-in fade-in text-[11px] duration-300">
      Too close to maturity to check the yield from the price.
    </div>
  );
}

export function QuoteRow({
  asset,
  raw,
  yesterday,
  chip,
  offer,
  verdict,
  suggestion,
  onChange,
  onAcceptOffer,
  onDismissOffer,
  onAcceptSuggestion,
  onDismissSuggestion,
}: {
  asset: Asset;
  raw: string | undefined; // undefined = untouched (not yet prefilled or typed)
  yesterday: number | undefined;
  chip: ProvenanceChip | undefined;
  offer: QuoteOffer | undefined;
  /** A6 model reading of the provider's quote; undefined = no check possible. */
  verdict: QuoteVerdict | undefined;
  /** S4 accrual ghost — already gated by the toggle/dismissal upstream. */
  suggestion: number | undefined;
  onChange: (v: string) => void;
  onAcceptOffer: () => void;
  onDismissOffer: () => void;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
}) {
  const parsed = raw !== undefined ? quoteInputSchema.safeParse(raw) : undefined;
  const filled = parsed?.success === true;
  const delta =
    filled && yesterday !== undefined ? yieldSinceStart(parsed.data, yesterday) : undefined;
  // S4: the ghost lives only while the row has NO draft of its own — the first
  // keystroke (and an accepted suggestion, which fills the draft) clears it. A
  // ghost is not a draft: it is never counted in "N of M filled", never shows a
  // delta and never saves.
  const ghost = raw === undefined || raw.trim() === '' ? suggestion : undefined;
  const ghostId = `quote-${asset.id}-suggested`;

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
        {ghost !== undefined && (
          <span className="text-faint animate-in fade-in flex-none text-[9px] tracking-[.12em] uppercase duration-300">
            suggested
          </span>
        )}
        {/* The input keeps its geometry; the ghost is real text rendered OVER
            its empty value (never a placeholder — a placeholder would vanish on
            focus and could never be told apart from yesterday's hint). */}
        <div className="relative flex max-w-[160px] min-w-[90px] flex-1 items-center">
          <input
            id={`quote-${asset.id}`}
            name={`quote-${asset.id}`}
            title={ghost !== undefined ? GHOST_TITLE : undefined}
            className={
              'bg-card h-9 w-full rounded-[10px] border px-3 text-right font-body text-[13px] transition ' +
              (filled
                ? 'border-pos-border'
                : ghost !== undefined
                  ? 'border-faint border-dashed hover:border-muted'
                  : 'border-hairline')
            }
            value={raw ?? ''}
            placeholder={
              ghost === undefined && yesterday !== undefined ? fmtTable(yesterday) : undefined
            }
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            aria-label={`${asset.name} quote`}
            aria-describedby={ghost !== undefined ? ghostId : undefined}
          />
          {ghost !== undefined && (
            <span
              id={ghostId}
              className="text-muted animate-in fade-in pointer-events-none absolute right-3 text-[13px] duration-300"
            >
              {fmtTable(ghost)}
            </span>
          )}
        </div>
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
      {verdict !== undefined && <ModelNote verdict={verdict} />}
      {offer !== undefined && (
        <UseFetchedOffer offer={offer} onAccept={onAcceptOffer} onDismiss={onDismissOffer} />
      )}
      {offer === undefined && ghost !== undefined && (
        <OfferLine
          label={`Use suggested ${fmtTable(ghost)}?`}
          dismissLabel="Dismiss suggestion"
          onAccept={onAcceptSuggestion}
          onDismiss={onDismissSuggestion}
        />
      )}
    </Card>
  );
}
