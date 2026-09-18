import type { ReactNode } from 'react';

import { Card } from './Card';

// The <div> wrapper is valid <dl> content — HTML5 allows grouping a dt+dd pair
// in a <div> child — and it is what makes each fact ONE grid cell while dt and
// dd keep their semantics.
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] tracking-[.08em] text-muted uppercase">{label}</dt>
      <dd className="m-0 text-[12.5px] font-bold">{children}</dd>
    </div>
  );
}

/**
 * A table row as a card: the HEADER is the row's identity, the BODY a `dl` of
 * the remaining columns.
 *
 * EVERY COLUMN HEADER BECOMES A `dt` VERBATIM — no re-wording, no abbreviation,
 * units where the table puts them. The two forms are one screen seen at two
 * widths, and a reader who learns a column name on a laptop must find it again
 * on a phone.
 *
 * CARDS AND NOT A SCROLLING TABLE because Balances is `3 + N assets` columns
 * wide, so it GROWS with the portfolio and any fixed scroll width is a different
 * number next year. A card grows in HEIGHT, which the page already scrolls.
 */
export function RecordCard({
  index = 0,
  avatar,
  eyebrow,
  title,
  tag,
  className = '',
  children,
  footer,
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
  /**
   * A band BELOW the facts, separated by a hairline — never the header row,
   * which is where a 360 px overflow was closed and where hanging two buttons
   * would re-open it.
   */
  footer?: ReactNode;
}) {
  return (
    <Card
      radius={24}
      className={`animate-in p-[22px] duration-300 fade-in ${className}`}
      style={{ animationDelay: `${(index % 4) * 60}ms` }}
    >
      <div className="mb-3.5 flex items-center gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && <div className="text-[10.5px] text-muted">{eyebrow}</div>}
          {/* `max-md:truncate`, not `truncate`: the overflow it answers is at
              360, and unconditional `nowrap` would also cut a long name on a
              wide desktop card where it used to wrap, with nothing to recover
              it. */}
          <h3 className="m-0 text-[17px] max-md:truncate">{title}</h3>
        </div>
        {tag !== undefined && <span className="flex-none">{tag}</span>}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2.5">{children}</dl>
      {footer !== undefined && (
        <>
          <div className="mt-3.5 h-px bg-hairline" />
          {/* `gap-2.5` does NOT separate the tap targets: `TAP_44` reaches
              (44 − 30) / 2 = 7 px past each edge, so two neighbours would need
              ≥ 14. What saves it is WIDTH — the overlay is `min-w-full` and both
              labels render wider than 44, so the regions never meet. An
              icon-only action here would need the gap re-derived. */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">{footer}</div>
        </>
      )}
    </Card>
  );
}
