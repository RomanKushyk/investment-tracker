import { Check, RefreshCw } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { kyivDateIso, kyivTimeHm } from '../../core/dates';
import { fmtDateShort } from '../../core/money';
import type { FeedFreshness, FetchButtonState } from './fetch-quotes';

// S1 — the phase's headline control (design/extensions/daily-quotes-live.dc.html
// S1): an outline pill in the Daily-quotes header, one notch shorter than the
// md button (size="header": h 34, 13px) so it reads as part of the ritual
// header next to the 36px Date field.
//
// The 5 machine states: idle · loading (spinning icon, disabled) · success
// flash ("Fetched 13:05" in `pos`, ~2.5s) · error (a TOAST — never a red
// button) · stale-cache (the microcopy beside it turns warn). Gating adds
// `demo` (in-button DEMO tag) and `unlinked` (nothing to fetch).
const COPY = {
  idle: 'Fetch quotes',
  loading: 'Fetching…',
  unlinked: 'No Inzhur-linked assets yet — link one in Settings → Portfolio.',
  demo: 'Fetching is disabled in the demo dataset — switch to Live in Settings → Data.',
};

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
  const disabled = state === 'demo' || state === 'unlinked' || state === 'loading';
  const success = state === 'success' && flashAt !== undefined;
  const title = state === 'demo' ? COPY.demo : state === 'unlinked' ? COPY.unlinked : undefined;

  return (
    <>
      <Button
        variant="outline"
        size="header"
        onClick={onFetch}
        disabled={disabled}
        title={title}
        aria-label={COPY.idle}
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
        {/* Re-keyed so every label change crossfades instead of swapping (D7). */}
        <span key={state} className="animate-in fade-in duration-200">
          {state === 'loading'
            ? COPY.loading
            : success
              ? `Fetched ${kyivTimeHm(new Date(flashAt))}`
              : COPY.idle}
        </span>
        {state === 'demo' && (
          <span className="bg-warn-tint text-warn-tint-text rounded-full px-[7px] py-[2px] font-body text-[10px] font-bold tracking-[.08em] uppercase">
            DEMO
          </span>
        )}
      </Button>
      {freshness !== undefined && (
        <span
          key={freshness.state}
          className={`animate-in fade-in text-[11px] duration-200 ${
            freshness.state === 'stale' ? 'text-warn' : 'text-muted'
          }`}
        >
          {freshness.state === 'stale'
            ? `Inzhur as of ${fmtDateShort(kyivDateIso(new Date(freshness.at)))}`
            : `Inzhur ${kyivTimeHm(new Date(freshness.at))}`}
        </span>
      )}
    </>
  );
}
