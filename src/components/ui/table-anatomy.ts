// One anatomy for the app's tables (tables.md § Signed, wave 6). The band and the zebra are painted
// per cell, rounded at the row's ends: a radius on a `tr` paints nothing, and a pseudo-element on
// one becomes a cell of its own and shifts every column.

/** `border-separate`, because a collapsed border model drops the cells' radius. */
export const TABLE = 'w-full border-separate border-spacing-0';

/** The header stays at the top of the table's own box (`TableBox`). */
export const THEAD = 'sticky top-0 z-10';

/** 8 + 8 between columns, 12 at the row's ends (the row's inset), and the ends rounded. */
const CELL = 'px-2 first:pl-3 last:pr-3 first:rounded-l-[9px] last:rounded-r-[9px]';

// Cells meet at fractional x, where each covers part of the shared pixel and the glass shows
// through as a seam; each head's 1 px shadow fills that pixel with the band's own opaque colour.
const HEAD = `h-9 ${CELL} bg-table-band shadow-[1px_0_0_var(--color-table-band)] last:shadow-none text-label-caps uppercase whitespace-nowrap text-muted`;

/** A column head; a numeric one sits right, over its figures. */
export const TH = `${HEAD} text-left`;
export const TH_NUM = `${HEAD} text-right`;

/** Every row is a named group, so each of its cells takes the zebra and the veil together, and no
 *  `group` further up (the sidebar's, the ledger's rows) can tint them. */
export const TR = 'group/row';

/** 36 px rows that grow when the content needs more; every second one tinted, any one veiled on hover. */
export const TD = `h-9 ${CELL} transition-control-colors group-even/row:bg-ink/3 group-hover/row:bg-ink/5`;
