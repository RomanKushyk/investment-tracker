import { Children, createContext, useContext, type ReactNode } from 'react';

import { Card } from './Card';

const InList = createContext(false);

/** The narrow records in ONE glass card (tables.md § Signed, R2); the RecordCards inside read
 *  the context, so none can stay a card of its own. No records, no card. */
export function RecordList({ children }: { children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <Card radius={24} className="flex animate-in flex-col p-1.5 duration-300 fade-in">
      <InList value>{children}</InList>
    </Card>
  );
}

/** One record nested in its list's card: r18 inside the r24 card's 6 px, every second tinted. */
export const RECORD = 'rounded-[18px] p-4 even:bg-ink/3';

/** R2 inside a card that already holds a head: the records bleed over its 22 px padding to sit
 *  6 px in, as RecordList's do, their content level with the head. */
export const RECORD_ROWS = '-mx-4 flex flex-col last:-mb-4';

/** RecordCards as R2 records inside a card of the caller's own. */
export function RecordRows({ children }: { children: ReactNode }) {
  return (
    <div className={RECORD_ROWS}>
      <InList value>{children}</InList>
    </div>
  );
}

// The <div> wrapper is valid <dl> content — HTML5 allows grouping a dt+dd pair
// in a <div> child — and it is what makes each fact ONE grid cell while dt and
// dd keep their semantics.
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label-caps text-muted uppercase">{label}</dt>
      <dd className="m-0 font-mono text-table font-bold">{children}</dd>
    </div>
  );
}

/**
 * A table row as a record: the HEADER is the row's identity, the BODY a `dl` of
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
  children,
  footer,
  ruled = false,
}: {
  /** Position in the list — drives the stagger only (`60 ms × (i mod 4)`). */
  index?: number;
  avatar?: ReactNode;
  /** A line above the title: Payouts puts the date there, the others nothing. */
  eyebrow?: ReactNode;
  title: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  /**
   * A band BELOW the facts, separated by a hairline — never the header row,
   * which is where a 360 px overflow was closed and where hanging two buttons
   * would re-open it.
   */
  footer?: ReactNode;
  /** A sum in a RecordList: ruled above, and out of the zebra, as the desktop total. A drawn
   *  line, not `border-top`, which bends into the rounded corners. */
  ruled?: boolean;
}) {
  const nested = useContext(InList);
  const body = (
    <>
      {ruled && (
        <div aria-hidden data-rule className="absolute inset-x-4 top-0 h-0.5 bg-panel-border" />
      )}
      <div className="mb-3.5 flex items-center gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && <div className="text-label text-muted">{eyebrow}</div>}
          {/* `max-md:truncate`, not `truncate`: the overflow it answers is at
              360, and unconditional `nowrap` would also cut a long name on a
              wide desktop card where it used to wrap, with nothing to recover
              it. */}
          <h3 className="m-0 text-h3 max-md:truncate">{title}</h3>
        </div>
        {tag !== undefined && <span className="flex-none">{tag}</span>}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2.5">{children}</dl>
      {footer !== undefined && (
        <>
          <div className="mt-3.5 h-px bg-hairline" />
          {/* The labels' width, not the gap, parts the tap targets. `ml-auto` on the first bare
              button pushes the actions right; a chip stays left. */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5 [&>button:first-of-type]:ml-auto">
            {footer}
          </div>
        </>
      )}
    </>
  );
  const enter = `animate-in duration-300 fade-in${ruled ? ' relative' : ''}`;
  const style = { animationDelay: `${(index % 4) * 60}ms` };
  return nested ? (
    <div className={`${enter} ${ruled ? 'rounded-[18px] p-4' : RECORD}`} style={style}>
      {body}
    </div>
  ) : (
    <Card radius={24} className={`${enter} p-[22px]`} style={style}>
      {body}
    </Card>
  );
}
