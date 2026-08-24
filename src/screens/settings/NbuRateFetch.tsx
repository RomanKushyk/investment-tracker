// A5 — the live NBU rate, offered beside the manual ₴/$ field.
//
// It PROPOSES (G5). Pressing "Fetch" never changes the stored rate; it shows
// what NBU published and offers to apply it. `usdRate` stays exactly what it
// was — a manual override the user owns — and the fetched value is additive,
// which is the contract A5 pinned.
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { useNbuRate } from '../../hooks/useNbuRate';
import { useSettings } from '../../state/settings';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

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
  /**
   * The manual ₴/$ input, rendered on the SAME line as the button. It lives
   * here rather than beside this component because the status line below is
   * wider than the button: as a sibling it stretched the shared row and left
   * the input stranded 238px from the button it belongs to (measured), and
   * before that it made the block three rows tall, which pushed SettingRow's
   * vertically-centred label in BETWEEN the input and the button.
   */
  children: ReactNode;
}

export function NbuRateFetch({ onApply, children }: NbuRateFetchProps) {
  const t = useT();
  const f = useFormat();
  const { data, lastGood, isFetching, isError, disabled, fetchRate } = useNbuRate();
  const usdRate = useSettings((s) => s.usdRate);
  // A failed fetch falls back to the last rate that parsed, and says which it
  // is showing. Silently rendering a cached number as if it were fresh is the
  // one thing this must not do.
  const [tried, setTried] = useState(false);
  const shown = data ?? lastGood;
  // `isError` counts, not just a missing `data`. TanStack keeps the PREVIOUS
  // success on an errored query, so after a failed press the old number is
  // still here — and rendering it without the label would present the result of
  // a failed fetch as the current rate. The toast alone is not enough: it is
  // gone in four seconds and the line stays on screen.
  const isStale = isError || (data === undefined && lastGood !== undefined);

  async function handleFetch() {
    setTried(true);
    const r = await fetchRate();
    if (r === undefined && !disabled) toast.error(t.nbu.failed);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {children}
        {/* No aria-label: it would REPLACE the visible text, so "Fetch rate" —
            the words on screen — stops being part of the accessible name and a
            voice-control user saying them hits nothing (WCAG 2.5.3). It also hid
            the "Fetching…" state from screen readers. `title` adds the longer
            wording without taking the name away. */}
        <Button
          variant="outline"
          onClick={handleFetch}
          disabled={disabled || isFetching}
          title={t.nbu.title}
        >
          {isFetching ? t.nbu.fetching : t.nbu.fetch}
        </Button>
      </div>

      {disabled && <span className="text-[11px] text-muted">{t.nbu.demoDisabled}</span>}

      {!disabled && shown !== undefined && (
        <div className="flex animate-in items-center gap-2 text-[11px] duration-200 fade-in slide-in-from-top-1">
          <span className={isStale ? 'text-muted' : 'text-pos-tint-text'}>
            {t.nbu.shown(f.units(shown.rate), f.date(shown.date))}
            {isStale && t.nbu.stale}
          </span>
          {shown.rate !== usdRate && (
            <button
              type="button"
              onClick={() => {
                onApply(shown.rate);
                // f.units, not String(): the line right above already reads
                // "44,6988" in Ukrainian, and a toast saying 44.6988 makes the
                // same number look like a different one (Contract 0).
                toast.success(t.nbu.applied(f.units(shown.rate)));
              }}
              className="text-pos underline underline-offset-2 transition duration-200 hover:text-pos-tint-text"
            >
              {t.nbu.useIt}
            </button>
          )}
        </div>
      )}

      {!disabled && tried && isError && shown === undefined && (
        <span className="animate-in text-[11px] text-neg duration-200 fade-in">
          {t.nbu.none(f.units(usdRate))}
        </span>
      )}
    </div>
  );
}
