// A7 — the last parse, said out loud.
//
// `parse.ts` has always returned `{entries, skipped}` and every caller threw
// `skipped` away, so a renamed provider field silently dropped an asset from
// the fetch and the only symptom was an unlinked row nobody could explain.
//
// NON-BLOCKING by construction: this reports, it never gates a fetch or a save.
// The tolerant-parse contract (D19) is that one bad entry costs that entry and
// nothing else — this is the part that makes the cost visible.
import { useState } from 'react';

import type { SkippedEntry } from '../../core/inzhur/parse';
import { useLastParse } from '../../hooks/useInzhurAssets';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

// Tokens live in core; the words live in the dictionary (D8).
function SkipLine({ skip }: { skip: SkippedEntry }) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted">
      <span className="font-semibold text-ink">{skip.ref}</span>
      <span>— {t.parse.reason[skip.reason]}</span>
      {skip.fields !== undefined && (
        // The load-bearing detail: WHICH field. A rename is the likeliest way
        // this feed breaks, and the path is the whole diagnosis.
        <span className="font-body text-faint">{skip.fields.join(', ')}</span>
      )}
    </li>
  );
}

export function ParseSkips({ className = '' }: { className?: string }) {
  const f = useFormat();
  const t = useT();
  const parse = useLastParse();
  const [open, setOpen] = useState(false);

  // Never fetched on this device — say nothing rather than invent a verdict.
  if (parse === undefined) return null;

  const count = parse.skipped.length;

  // The healthy state is REPORTED, not silent. "Nothing wrong as of 13:05" and
  // "nobody has looked" are different facts, and only one of them is evidence
  // that the feed still parses (D53).
  if (count === 0) {
    return (
      <p className={`text-[11px] text-faint ${className}`}>
        {t.parse.allClean(parse.entries, f.savedAt(parse.at))}
      </p>
    );
  }

  return (
    <div className={`animate-in duration-300 fade-in ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] text-warn underline underline-offset-2 transition duration-200 hover:text-warn-tint-text"
      >
        {t.parse.failed(count)}
        {' · '}
        {t.parse.readFine(parse.entries)} · {open ? t.parse.hide : t.parse.show}
      </button>
      {open && (
        <ul className="mt-1.5 flex animate-in flex-col gap-1 duration-200 fade-in slide-in-from-top-1">
          {parse.skipped.map((s) => (
            <SkipLine key={`${s.ref}:${s.reason}`} skip={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
