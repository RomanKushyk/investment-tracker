// A5 — the live NBU rate, offered beside the manual ₴/$ field.
//
// It PROPOSES (G5). Pressing "Fetch" never changes the stored rate; it shows
// what NBU published and offers to apply it. `usdRate` stays exactly what it
// was — a manual override the user owns — and the fetched value is additive,
// which is the contract A5 pinned.
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { fmtDate } from '../../core/money';
import { useNbuRate } from '../../hooks/useNbuRate';
import { useSettings } from '../../state/settings';

export interface NbuRateFetchProps {
  /**
   * Applies the fetched rate. Owned by the caller on purpose: the ₴/$ input
   * keeps a draft string beside the stored number, so anything that writes the
   * store without telling the field leaves the field showing a stale value —
   * measured in the browser, where the store read 44.866 and the input still
   * read 44.83. One owner for the value removes the class of bug rather than
   * synchronising around it.
   */
  onApply: (rate: number) => void;
}

export function NbuRateFetch({ onApply }: NbuRateFetchProps) {
  const { data, lastGood, isFetching, isError, disabled, fetchRate } = useNbuRate();
  const usdRate = useSettings((s) => s.usdRate);
  // A failed fetch falls back to the last rate that parsed, and says which it
  // is showing. Silently rendering a cached number as if it were fresh is the
  // one thing this must not do.
  const [tried, setTried] = useState(false);
  const shown = data ?? lastGood;
  const isStale = data === undefined && lastGood !== undefined;

  async function handleFetch() {
    setTried(true);
    const r = await fetchRate();
    if (r === undefined && !disabled) toast.error('Could not reach the NBU rate directory');
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="outline"
        onClick={handleFetch}
        disabled={disabled || isFetching}
        aria-label="Fetch the official NBU rate"
      >
        {isFetching ? 'Fetching…' : 'Fetch rate'}
      </Button>

      {disabled && (
        <span className="text-muted text-[11px]">Demo data — no requests leave the app.</span>
      )}

      {!disabled && shown !== undefined && (
        <div className="animate-in fade-in slide-in-from-top-1 flex items-center gap-2 text-[11px] duration-200">
          <span className={isStale ? 'text-muted' : 'text-pos-tint-text'}>
            NBU {shown.rate} for {fmtDate(shown.date)}
            {isStale && ' · last known, not refreshed'}
          </span>
          {shown.rate !== usdRate && (
            <button
              type="button"
              onClick={() => {
                onApply(shown.rate);
                toast.success(`Rate set to ${shown.rate}`);
              }}
              className="text-pos hover:text-pos-tint-text underline underline-offset-2 transition duration-200"
            >
              Use it
            </button>
          )}
        </div>
      )}

      {!disabled && tried && isError && shown === undefined && (
        <span className="text-neg animate-in fade-in text-[11px] duration-200">
          No rate available — the stored {usdRate} stays in effect.
        </span>
      )}
    </div>
  );
}
