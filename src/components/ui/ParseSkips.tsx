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
import { fmtSavedAt } from '../../core/money';
import { useLastParse } from '../../hooks/useInzhurAssets';

/** Tokens live in core; the English lives here (D8). */
const REASON: Record<SkippedEntry['reason'], string> = {
  not_an_array: 'the response was not a list of assets',
  shape: 'unreadable fields',
  no_ref: 'no ISIN or slug to identify it',
};

function SkipLine({ skip }: { skip: SkippedEntry }) {
  return (
    <li className="text-muted flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
      <span className="text-ink font-semibold">{skip.ref}</span>
      <span>— {REASON[skip.reason]}</span>
      {skip.fields !== undefined && (
        // The load-bearing detail: WHICH field. A rename is the likeliest way
        // this feed breaks, and the path is the whole diagnosis.
        <span className="text-faint font-body">{skip.fields.join(', ')}</span>
      )}
    </li>
  );
}

export function ParseSkips({ className = '' }: { className?: string }) {
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
      <p className={`text-faint text-[11px] ${className}`}>
        All {parse.entries} feed entries read cleanly · {fmtSavedAt(parse.at)}
      </p>
    );
  }

  return (
    <div className={`animate-in fade-in duration-300 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-warn hover:text-warn-tint-text text-[11px] underline underline-offset-2 transition duration-200"
      >
        {count === 1 ? '1 feed entry could not be read' : `${count} feed entries could not be read`}
        {' · '}
        {parse.entries} read fine · {open ? 'hide' : 'show'}
      </button>
      {open && (
        <ul className="animate-in fade-in slide-in-from-top-1 mt-1.5 flex flex-col gap-1 duration-200">
          {parse.skipped.map((s) => (
            <SkipLine key={`${s.ref}:${s.reason}`} skip={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
