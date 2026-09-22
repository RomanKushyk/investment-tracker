import { X } from 'lucide-react';

import { AssetAvatar } from '../../components/ui/AssetAvatar';
import { NumberField } from '../../components/ui/NumberField';
import { TAP_44, TAP_44_BOX } from '../../components/ui/tap-target';
import { Card } from '../../components/ui/Card';
import { kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';
import { yieldSinceStart } from '@quirenote/core/derive';
import type { QuoteVerdict } from '@quirenote/core/inzhur/dcf';
import type { Asset } from '@quirenote/core/types';
import { amountInputSchema } from '@quirenote/core/schemas';
import type { ProvenanceChip } from './fetch-quotes';
import type { QuoteOffer } from './useQuoteFetch';
import { useFormat } from '../../hooks/useFormat';
import { useSettings } from '../../state/settings';
import { useT } from '../../i18n/useT';

// Provenance of the row's CURRENT draft value: `auto` (a fetch filled it),
// `manual` (the user's own — a fetch never overwrites it) or the amber stale
// chip when the value came from the last-good cache. One geometry for all three;
// only the paint differs. `auto` is the INFO family and not the gain one — a
// fetched value is a provenance, not a gain.

function ProvenanceChipPill({ chip }: { chip: ProvenanceChip }) {
  const f = useFormat();
  const t = useT();
  const paint =
    chip.chip === 'auto'
      ? 'bg-info-tint text-info-tint-text'
      : chip.chip === 'stale'
        ? 'bg-warn-tint text-warn-tint-text'
        : 'bg-panel text-muted';
  const accrual = chip.chip === 'auto' && chip.note === 'accrual';
  return (
    <>
      <span
        key={chip.chip}
        title={accrual ? t.dailyQuotes.provenance.accrual : t.dailyQuotes.provenance[chip.chip]}
        className={`animate-in rounded-[5px] px-2 py-[2px] text-[10px] font-bold tracking-[.08em] uppercase duration-150 zoom-in-95 fade-in ${paint}`}
      >
        {chip.chip === 'stale'
          ? t.dailyQuotes.chip.asOf(f.dateShort(kyivDateIso(new Date(chip.at))))
          : t.dailyQuotes.chip[chip.chip]}
      </span>
      {chip.chip === 'auto' && (
        <span className="text-[10px] text-muted">
          {accrual
            ? t.dailyQuotes.chip.accrual
            : t.dailyQuotes.chip.fetched(kyivTimeHm(new Date(chip.at)))}
        </span>
      )}
    </>
  );
}

// The shared "proposed value" line under an input: one DASHED ghost pill —
// dashed = proposed, the phase's binding visual rule — plus a dismiss ✕.
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
    // The right gutter aligns the pill under the input column; below `sm` the row is
    // already stacked, so the pill takes the full width instead of wrapping inside a
    // narrower box.
    <div className="flex animate-in items-center justify-end gap-2 pr-0 duration-300 fade-in slide-in-from-top-1 sm:pr-[68px]">
      <button
        type="button"
        onClick={onAccept}
        className={`${TAP_44} cursor-pointer rounded-[7px] border border-dashed px-3 py-1 text-[11px] transition active:scale-[.97] ${
          stale
            ? 'border-warn text-warn hover:bg-page'
            : 'border-field-border text-ink hover:border-ink hover:bg-page'
        }`}
      >
        {label}
      </button>
      {/* A REAL 44px box, not `TAP_44`. This ✕ draws no fill and no border, so growing
          the box moves nothing visually — and it is what stops the two controls
          fighting. With the overlay it reached across the gap and onto the accept
          button; being later in DOM order at the same z-index it won, so a tap on the
          accept button's own edge DISCARDED the fetched quote. A real box is laid out,
          so the gap holds. */}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className={`${TAP_44_BOX} cursor-pointer p-1 text-muted opacity-85 transition hover:opacity-100 active:scale-[.97]`}
      >
        <X size={11} strokeWidth={2.75} />
      </button>
    </div>
  );
}

// The no-silent-overwrite rule made visible: the fetched number is OFFERED under
// the input of a row the user typed, never applied.
function UseFetchedOffer({
  offer,
  onAccept,
  onDismiss,
}: {
  offer: QuoteOffer;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const f = useFormat();
  const t = useT();
  const value = f.num(offer.value);
  return (
    <OfferLine
      label={
        offer.stale
          ? t.dailyQuotes.useCached(value, f.dateShort(kyivDateIso(new Date(offer.at))))
          : t.dailyQuotes.useFetched(value)
      }
      dismissLabel={t.dailyQuotes.keepMyValue}
      stale={offer.stale}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}

/**
 * What the pricing model makes of the provider's own quote.
 *
 * Read-only, and it never touches the number: the provider's value stands as the
 * observed fact even when it is days old. This only says so out loud.
 *
 * `consistent` renders NOTHING. A line that appears on every healthy row is
 * noise, and noise is what stops anyone reading the one row that matters.
 */
function ModelNote({ verdict }: { verdict: QuoteVerdict }) {
  const t = useT();
  const f = useFormat();
  if (verdict.state === 'consistent' || verdict.state === 'not_applicable') return null;

  if (verdict.state === 'stale') {
    const { daysStale, date, atWindowEdge } = verdict.fit;
    return (
      <div className="animate-in text-[11px] text-muted duration-300 fade-in">
        {t.dailyQuotes.model.stale(daysStale, atWindowEdge, f.dateShort(date))}
      </div>
    );
  }

  // Deliberately NOT phrased as "the yield was revised". The two readings — a
  // re-priced bond or a quote staler than a fortnight — cannot be told apart from
  // a single price, so the number is offered and the conclusion left to the reader.
  if (verdict.state === 'revised') {
    return (
      <div className="animate-in text-[11px] text-warn duration-300 fade-in">
        {t.dailyQuotes.priceDoesNotFit(
          f.pctPlain(verdict.publishedPct, 2),
          f.pctPlain(verdict.impliedPct, 2),
        )}
      </div>
    );
  }

  // `unexplained` is the loudest thing the model can say — no yield at all
  // reproduces this price — so it must not share a muted line with the two benign
  // reasons.
  if (verdict.reason === 'unexplained') {
    return (
      <div className="animate-in text-[11px] text-neg duration-300 fade-in">
        {t.dailyQuotes.model.unexplained}
      </div>
    );
  }

  return (
    <div className="animate-in text-[11px] text-faint duration-300 fade-in">
      {t.dailyQuotes.model.tooCloseToMaturity}
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
  /** Model reading of the provider's quote; undefined = no check possible. */
  verdict: QuoteVerdict | undefined;
  /** Accrual ghost — already gated by the toggle and the dismissal upstream. */
  suggestion: number | undefined;
  onChange: (v: string) => void;
  onAcceptOffer: () => void;
  onDismissOffer: () => void;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
}) {
  const f = useFormat();
  const t = useT();
  const language = useSettings((s) => s.language);
  const parsed = raw !== undefined ? amountInputSchema(language).safeParse(raw) : undefined;
  const filled = parsed?.success === true;
  const delta =
    filled && yesterday !== undefined ? yieldSinceStart(parsed.data, yesterday) : undefined;
  // The ghost lives only while the row has NO draft of its own. A ghost is not a
  // draft: it is never counted in "N of M filled", never shows a delta and never
  // saves.
  const ghost = raw === undefined || raw.trim() === '' ? suggestion : undefined;
  const ghostId = `quote-${asset.id}-suggested`;
  // A non-empty draft the schema refuses. Named here so the row says so, instead
  // of the value silently vanishing from the saved day. A blank is not one.
  const unreadable = raw !== undefined && raw.trim() !== '' && parsed?.success === false;
  const errorId = `quote-${asset.id}-error`;

  return (
    <Card className="flex animate-in flex-col gap-2 px-5 py-3.5 duration-300 fade-in slide-in-from-bottom-1">
      {/* TWO LINES BELOW THE BREAKPOINT: the single wrapping row is a desktop shape —
          at 360 it left the input too little for a 16px value, so the number the
          screen exists to type was being clipped by its own field.
          `basis-[calc(100%-60px)]` is deliberately a few pixels short with `flex-1`
          growing it back: the line has to be FULL for the three that follow to wrap
          together, and rounding down is what guarantees that on a sub-pixel width. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-md:gap-x-2">
        <AssetAvatar code={asset.code} colorKey={asset.colorKey} size={48} />
        <div className="min-w-[110px] flex-1 break-words max-md:basis-[calc(100%-60px)]">
          <div className="text-sm font-semibold">{asset.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span>
              {yesterday !== undefined ? t.dailyQuotes.yesterdayValue(f.money(yesterday)) : '—'}
            </span>
            {chip !== undefined && <ProvenanceChipPill chip={chip} />}
          </div>
        </div>
        {ghost !== undefined && (
          <span className="flex-none animate-in text-[9px] tracking-[.12em] text-faint uppercase duration-300 fade-in">
            {t.dailyQuotes.chip.suggested}
          </span>
        )}
        {/* The ghost is real text rendered OVER the input's empty value, never a
            placeholder — a placeholder vanishes on focus and could never be told apart
            from yesterday's hint. */}
        <div className="relative flex max-w-[160px] min-w-[90px] flex-1 items-center max-md:max-w-none">
          <NumberField
            id={`quote-${asset.id}`}
            name={`quote-${asset.id}`}
            title={ghost !== undefined ? t.dailyQuotes.provenance.ghost : undefined}
            // A DELIBERATE GEOMETRY EXCEPTION below the breakpoint, radius recomputed from
            // the new box. This is the control of the daily ritual, so a bigger target here
            // is the design rather than a concession.
            className={
              'h-9 w-full rounded-[9px] border bg-card px-3 text-right font-body text-[13px] transition max-md:h-11 max-md:rounded-[11px] ' +
              (unreadable
                ? 'border-neg'
                : filled
                  ? 'border-pos-border'
                  : ghost !== undefined
                    ? 'border-dashed border-field-border hover:border-ink'
                    : 'border-field-border')
            }
            value={raw ?? ''}
            placeholder={
              ghost === undefined && yesterday !== undefined ? f.num(yesterday) : undefined
            }
            onChange={onChange}
            aria-label={`${asset.name} quote`}
            aria-invalid={unreadable || undefined}
            aria-describedby={unreadable ? errorId : ghost !== undefined ? ghostId : undefined}
          />
          {ghost !== undefined && (
            <span
              id={ghostId}
              className="pointer-events-none absolute right-3 animate-in text-[13px] text-muted duration-300 fade-in"
            >
              {f.num(ghost)}
            </span>
          )}
        </div>
        <span
          key={delta ?? 'empty'}
          className={
            'w-[52px] animate-in text-right text-xs font-bold duration-150 zoom-in-95 fade-in ' +
            (delta === undefined ? 'text-faint' : delta < 0 ? 'text-neg' : 'text-pos')
          }
        >
          {delta === undefined ? '—' : f.pct(delta)}
        </span>
      </div>
      {unreadable && (
        <span
          id={errorId}
          className="animate-in text-right text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
        >
          {t.dailyQuotes.unreadable}
        </span>
      )}
      {verdict !== undefined && <ModelNote verdict={verdict} />}
      {offer !== undefined && (
        <UseFetchedOffer offer={offer} onAccept={onAcceptOffer} onDismiss={onDismissOffer} />
      )}
      {offer === undefined && ghost !== undefined && (
        <OfferLine
          label={t.dailyQuotes.useSuggested(f.num(ghost))}
          dismissLabel={t.dailyQuotes.dismissSuggestion}
          onAccept={onAcceptSuggestion}
          onDismiss={onDismissSuggestion}
        />
      )}
    </Card>
  );
}
