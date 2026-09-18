import type { ReactNode } from 'react';

/**
 * The title block every analytics screen opens with, and the one place a
 * screen-level action can sit.
 *
 * TWO BRANCHES, AND THE ACTIONLESS ONE EMITS NO WRAPPER — it returns exactly the
 * markup it always returned, so every actionless caller renders byte-identically
 * rather than approximately so. The `mb-1` moves from the `<h2>` to the row, so
 * the gap below the title is the same in both branches.
 *
 * THE SLOT IS ONE FLEX BOX, NOT TWO SIBLINGS OF THE TITLE. As siblings,
 * `flex-wrap` breaks `Cancel` and `Save` one at a time; wrapped together they
 * drop as a pair.
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
