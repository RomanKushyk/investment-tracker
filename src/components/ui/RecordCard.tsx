import type { ReactNode } from 'react';

import { Card } from './Card';

// A <div>-wrapped dt/dd pair is valid dl content (HTML5's content model allows
// grouping dt+dd in a <div> child of <dl>) — keeps each fact as one grid cell
// (README §6.6's "2-col <dl>") while giving dt/dd their proper semantics.
// `m-0` neutralizes the default UA margin-inline-start on <dd> (Tailwind's
// preflight already zeroes it, but this keeps the layout explicit/robust).
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted text-[10.5px] tracking-[.08em] uppercase">{label}</dt>
      <dd className="m-0 text-[12.5px] font-bold">{children}</dd>
    </div>
  );
}

/**
 * S3 — THE RECORD CARD, and it invents nothing. This is the `/attributes` asset
 * card, lifted out of that screen unchanged so the four tables can become the
 * same thing rather than four near-copies of it: `Card radius={24}`, `p-[22px]`,
 * a header row of avatar + 17 px title + tag, then a two-column `<dl>` of
 * `Fact` pairs.
 *
 * A table row becomes a card whose HEADER is the row's identity and whose BODY
 * is a `dl` of the remaining columns. Every column header becomes a `dt`
 * VERBATIM — no re-wording, no abbreviation, units where the table puts them —
 * because the two forms are one screen seen at two widths, and a reader who
 * learns a column name on a laptop must find it again on a phone.
 *
 * WHY CARDS AND NOT A SCROLLING TABLE: Balances is `3 + N assets` columns wide,
 * so it GROWS with the portfolio — a horizontal scroll fixed at 684 px today is
 * a different number next year. A card grows in HEIGHT instead, which the page
 * already scrolls.
 *
 * A3/E3 CLOSE HERE. `/attributes` overflowed 360 px by 27 px because an
 * `ml-auto` tag shared a row with a long asset name and neither would give. The
 * title now takes `min-w-0 flex-1` and truncates; the tag keeps its width.
 */
export function RecordCard({
  index = 0,
  avatar,
  eyebrow,
  title,
  tag,
  className = '',
  children,
}: {
  /** Position in the list — drives the stagger only (`60 ms × (i mod 4)`). */
  index?: number;
  avatar?: ReactNode;
  /** A line above the title: Payouts puts the date there, the others nothing. */
  eyebrow?: ReactNode;
  title: ReactNode;
  tag?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      radius={24}
      className={`animate-in fade-in p-[22px] duration-300 ${className}`}
      // The stagger `/attributes` already uses, reused rather than a second
      // cadence minted beside it.
      style={{ animationDelay: `${(index % 4) * 60}ms` }}
    >
      <div className="mb-3.5 flex items-center gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && <div className="text-muted text-[10.5px]">{eyebrow}</div>}
          {/* `max-md:truncate`, not `truncate`. A3/E3 is a 360px overflow, so
              the ellipsis belongs at 360; unconditional `white-space: nowrap`
              would also cut a long name on a 430px-wide desktop card where it
              used to wrap onto a second line, with nothing to recover it. */}
          <h3 className="m-0 text-[17px] max-md:truncate">{title}</h3>
        </div>
        {tag !== undefined && <span className="flex-none">{tag}</span>}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2.5">{children}</dl>
    </Card>
  );
}
