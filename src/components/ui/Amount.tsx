import type { MoneyPart } from '@quirenote/core/money';

// K2 (`type.md`): the unit at 70 % in `muted`, .18em from the digits, which keep the parent's
// sign colour. The NBSP stays in the text, so a copy and a screen reader get the one string.
const UNIT = 'text-unit text-muted';
// Word-spacing applies to the NBSP (CSS Text 3 §7.1) and narrows Manrope's to the signed .18em.
const TRAILING = `${UNIT} [word-spacing:-.02em]`;
const LEADING = `${UNIT} me-[.18em]`;

/** A kpi or display figure, its unit apart. Tables and inline amounts keep one string. */
export function Amount({ parts }: { parts: MoneyPart[] }) {
  return parts.map((p, i) => {
    const next = parts[i + 1];
    if (p.type === 'figure') return p.value;
    // The one literal is the NBSP before a trailing unit, drawn inside the unit's span.
    if (p.type === 'literal') return null;
    if (next?.type === 'figure') {
      return (
        <span key={i} className={LEADING}>
          {p.value}
        </span>
      );
    }
    const before = parts[i - 1];
    return (
      <span key={i} className={TRAILING}>
        {before?.type === 'literal' ? before.value : ''}
        {p.value}
      </span>
    );
  });
}
