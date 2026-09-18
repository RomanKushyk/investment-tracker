import { Check, RefreshCw } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { kyivDateIso, kyivTimeHm } from '../../core/dates';
import type { FeedFreshness, FetchButtonState } from './fetch-quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

// The headline control: an outline pill one notch shorter than the md button, so
// it reads as part of the ritual header beside the Date field.
// Five machine states — idle, loading, success flash, error (a TOAST, never a
// red button) and stale-cache — plus the gating ones. Their copy lives in the
// dictionary: a module constant could not follow a language that switches
// without a reload.

export function FetchQuotesButton({
  state,
  freshness,
  flashAt,
  onFetch,
}: {
  state: FetchButtonState;
  freshness: FeedFreshness | undefined;
  flashAt: string | undefined;
  onFetch: () => void;
}) {
  const f = useFormat();
  const t = useT();
  const gated = state === 'demo' || state === 'unlinked';
  const disabled = gated || state === 'loading';
  const success = state === 'success' && flashAt !== undefined;
  const title =
    state === 'demo'
      ? t.dailyQuotes.fetch.demo
      : state === 'unlinked'
        ? t.dailyQuotes.fetch.unlinked
        : undefined;

  const button = (
    <Button
      variant="outline"
      size="header"
      // The gating states read fainter than the in-flight one: "you can't press this"
      // and "it is working" must not look the same.
      disabledTone={gated ? 'gated' : 'busy'}
      onClick={onFetch}
      disabled={disabled}
      title={title}
      // No aria-label: the button has visible text and a fixed label would override
      // it, where the accessible name has to follow the state (WCAG 2.5.3).
      className={success ? 'border-pos text-pos' : undefined}
    >
      {success ? (
        <Check size={13} strokeWidth={2.75} />
      ) : (
        <RefreshCw
          size={13}
          strokeWidth={2.75}
          className={state === 'loading' ? 'animate-spin' : undefined}
        />
      )}
      {/* Re-keyed so every label change crossfades instead of swapping. */}
      <span key={state} className="animate-in duration-200 fade-in">
        {state === 'loading'
          ? t.dailyQuotes.fetch.loading
          : success
            ? t.dailyQuotes.fetch.fetchedAt(kyivTimeHm(new Date(flashAt)))
            : t.dailyQuotes.fetch.idle}
      </span>
      {state === 'demo' && (
        <span className="rounded-[5px] bg-warn-tint px-[7px] py-[2px] font-body text-[10px] font-bold tracking-[.08em] text-warn-tint-text uppercase">
          {t.sidebar.demoBadge}
        </span>
      )}
    </Button>
  );

  return (
    <>
      {/* A disabled button is un-hittable, so its OWN native tooltip can never fire —
          and in the gating states the `title` is the only explanation there is. The
          wrapper is hit-testable; the button keeps the attribute so the accessible
          description survives. */}
      {title === undefined ? (
        button
      ) : (
        <span title={title} className="inline-flex">
          {button}
        </span>
      )}
      {freshness !== undefined && (
        <span
          key={freshness.state}
          className={`animate-in text-[11px] duration-200 fade-in ${
            freshness.state === 'stale' ? 'text-warn' : 'text-muted'
          }`}
        >
          {freshness.state === 'stale'
            ? t.dailyQuotes.fetch.feedAsOf(f.dateShort(kyivDateIso(new Date(freshness.at))))
            : t.dailyQuotes.fetch.feedAt(kyivTimeHm(new Date(freshness.at)))}
        </span>
      )}
    </>
  );
}
