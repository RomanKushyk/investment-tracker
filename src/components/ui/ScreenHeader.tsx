import type { ReactNode } from 'react';

/**
 * The title block every analytics screen opens with — and, since Phase 7, the
 * one place a screen-level action can sit (brief § G-1, extension § S1).
 *
 * TWO BRANCHES, AND THE EMPTY ONE EMITS NO WRAPPER. This was a fragment — an
 * `<h2>` and a `<p>` with no container — so "a button top right" had nothing to
 * attach to on every route but one. It could have grown a row unconditionally
 * and simply not filled it; instead the actionless branch returns exactly the
 * markup it always returned, which is what makes the brief's acceptance item
 * ("every actionless caller renders byte-identically") literally true rather
 * than
 * approximately true (extension F2).
 *
 * The row's arithmetic, measured on the drawing: `text-[26px]` renders a 39 px
 * `<h2>`, and a 40 px `Button size="md"` makes the row 40 — so the title block
 * grows by 1 px at and above `md`, and by 5 below it, where that button is 44.
 * `text-[26px]`, the `mb-1` and the subtitle's `mb-[22px]` do not move, which is
 * the whole of what G-1 pins. The `mb-1` moves from the `<h2>` to the row so the
 * gap below the title stays the same in both branches.
 *
 * THE SLOT IS ONE FLEX BOX, NOT TWO SIBLINGS OF THE TITLE. With `Cancel` and
 * `Save` as siblings of the `<h2>`, `flex-wrap` breaks them one at a time;
 * wrapped together they drop as a pair, which is the brief's "never one per
 * line". The layout is `/`'s own header row (`DailyQuotes.tsx`), copied rather
 * than invented — that screen has carried controls beside its title since
 * Phase 3.
 */
export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  /** Omit on a read-only screen — the row itself is then never rendered. */
  actions?: ReactNode;
}) {
  return (
    <>
      {actions === undefined ? (
        <h2 className="mb-1 text-[26px]">{title}</h2>
      ) : (
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-[26px]">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      )}
      <p className="mb-[22px] text-[13px] text-muted">{subtitle}</p>
    </>
  );
}
