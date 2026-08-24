import { X } from 'lucide-react';

import { AssetAvatar } from '../../components/ui/AssetAvatar';
import { TAP_44, TAP_44_BOX } from '../../components/ui/tap-target';
import { Card } from '../../components/ui/Card';
import { kyivDateIso, kyivTimeHm } from '../../core/dates';
import { yieldSinceStart } from '../../core/derive';
import type { QuoteVerdict } from '../../core/inzhur/dcf';
import type { Asset } from '../../core/types';
import { quoteInputSchema } from '../../core/schemas';
import type { ProvenanceChip } from './fetch-quotes';
import type { QuoteOffer } from './useQuoteFetch';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

// S2 — provenance of the row's CURRENT draft value: `auto` (a fetch filled
// it), `manual` (the user's own — a fetch never overwrites it) or the amber
// `as of dd.MM` stale chip when the value came from the last-good cache.
// Geometry is one pill for all three; only the paint tokens differ.
// The three titles, S2's accrual entry (S4 mints that microcopy) and the S4
// input tooltip all live in the dictionary now — `t.dailyQuotes.provenance`.

function ProvenanceChipPill({ chip }: { chip: ProvenanceChip }) {
  const f = useFormat();
  const t = useT();
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
    <div className="flex animate-in items-center justify-end gap-2 pr-0 duration-300 fade-in slide-in-from-top-1 sm:pr-[68px]">
      <button
        type="button"
        onClick={onAccept}
        className={`${TAP_44} cursor-pointer rounded-[7px] border border-dashed px-3 py-1 text-[11px] transition active:scale-[.97] ${
          stale
            ? 'border-warn text-warn hover:bg-page'
            : 'border-faint text-ink hover:border-muted hover:bg-page'
        }`}
      >
        {label}
      </button>
      {/* A REAL 44px box, not `TAP_44`. This ✕ draws no fill and no border —
          only the 11px glyph — so growing the box moves nothing visually, and
          it is what stops the two controls fighting. With the overlay it
          reached (44 − 19) / 2 = 12.5px to its left, across the 8px gap and
          4.5px onto the accept button; being later in DOM order at the same
          z-index it won, so a tap on the last 4.5px of "Use 68 702,10"
          DISCARDED the fetched quote. Measured, not theorised. A real box is
          laid out, so the gap holds. */}
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

  // Deliberately NOT phrased as "the yield was revised". No date in the window
  // explains this price, and the two readings — a re-priced bond or a quote
  // staler than a fortnight — cannot be told apart from a single price. The
  // number is offered; the conclusion is left to the reader.
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
  // reproduces this price — so it must not share a muted line with the two
  // benign reasons.
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
  const f = useFormat();
  const t = useT();
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
    <Card className="flex animate-in flex-col gap-2 px-5 py-3.5 duration-300 fade-in slide-in-from-bottom-1">
      {/* TWO LINES BELOW THE BREAKPOINT, as S4 draws it: [avatar][name] on the
          first, [input][delta] on the second. The single wrapping row is a
          desktop shape — at 360 it leaves the input about 100px, and a 16px
          value (G-4) needs 110 for `68 702,10` plus its padding, so the number
          the screen exists to type was being clipped by its own field.
          `basis-[calc(100%-60px)]` is the avatar (48) plus 12 — one more than
          the row's own `max-md:gap-x-2`, so the basis is 4px short and `flex-1`
          grows it back. Deliberately not exact: the line has to be FULL for the
          three that follow to wrap together, and rounding the basis down is what
          guarantees that on a sub-pixel width. */}
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
        {/* The input keeps its geometry; the ghost is real text rendered OVER
            its empty value (never a placeholder — a placeholder would vanish on
            focus and could never be told apart from yesterday's hint). */}
        <div className="relative flex max-w-[160px] min-w-[90px] flex-1 items-center max-md:max-w-none">
          <input
            id={`quote-${asset.id}`}
            name={`quote-${asset.id}`}
            title={ghost !== undefined ? t.dailyQuotes.provenance.ghost : undefined}
            // THE SECOND DELIBERATE G-2 EXCEPTION: 36 -> 44 below the
            // breakpoint, radius recomputed as round(44 × 0.26) = 11. This is
            // the control of the daily ritual, so a bigger target here is the
            // design rather than a concession. The row's avatar stays 48, which
            // keeps it inside the 60-70% block rule (README §4) as long as the
            // row's height does not shrink.
            // The 16px type comes from the G-4 rule in index.css, not from here.
            className={
              'h-9 w-full rounded-[9px] border bg-card px-3 text-right font-body text-[13px] transition max-md:h-11 max-md:rounded-[11px] ' +
              (filled
                ? 'border-pos-border'
                : ghost !== undefined
                  ? 'border-dashed border-faint hover:border-muted'
                  : 'border-hairline')
            }
            value={raw ?? ''}
            placeholder={
              ghost === undefined && yesterday !== undefined ? f.num(yesterday) : undefined
            }
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            aria-label={`${asset.name} quote`}
            aria-describedby={ghost !== undefined ? ghostId : undefined}
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
