import { useId } from 'react';

import { PERIOD_OPTIONS, resolveWindow, type PeriodOption } from '../../core/period';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';
import { Select } from './Select';

/**
 * The period control — one window, three screens (A38, extension § S1).
 *
 * IT LIVES IN `ScreenHeader`'s ACTION SLOT, and the argument that decided it is
 * the SECOND SHELL (D-1). The alternative was the sidebar, beside the currency
 * toggle: one control, plainly global, next to the other thing that reframes
 * every figure. Below `md` that sidebar is a Radix `Dialog` behind a scrim, so a
 * control that reframes what you are looking at sits ON TOP of what you are
 * looking at — press «3 місяці», see nothing, close the drawer, then see it. The
 * currency toggle survives that only because the drawer carries its own readout
 * ten pixels below it; a period has none and cannot be given one, because the
 * figures it moves are three routes away. It is also not global: it acts on
 * three of eleven routes, which are the 1st, 4th and 6th of an eight-item
 * group, so a sidebar control would be visible and inert on the other eight.
 *
 * A `Select`, NOT A SEGMENTED TRACK, and that is measured rather than assumed:
 * six Ukrainian labels at the currency toggle's own `text-xs` need a 622 px
 * track against 336 px of content at 360.
 *
 * THE HINT IS THE RESOLVED START DATE, not a sentence — `f.dateShort(from)`, so
 * it is derived and needs no string. It also DRAWS the finding that matters
 * most about this control: on the demo seed four of the six options resolve to
 * the same 174-day window, so FOUR rows read the same date and "six labels,
 * three behaviours" is seen rather than explained. (Three is what a first draft
 * of this comment said, copying the one place the sheet slips too — the rows
 * are `Від початку`, `6 місяців`, `12 місяців` and `Від початку року`.) It stays
 * true as the history grows, with no rule to update.
 *
 * WIDTH IS 272, DERIVED THE WAY F-15 SAYS TO DERIVE IT — by the widest ROW, not
 * the widest label — and then MEASURED, because the derivation alone was wrong.
 * The sheet's 222 held while every hint was a date; the clamp mark makes
 * `Від початку року · уся історія` the longest. Measured in the browser rather
 * than counted: the text renders 234,0, the item pads 24, the viewport 8 and
 * the border 2, so the requirement is 268 EXACTLY — and at exactly 268 it
 * wrapped, because a row that needs its whole box has no room for subpixel
 * rounding. 272 is that measurement plus 4 px of slack, and the slack is the
 * point: F-15's failure mode is a wrapped hint row, and a width that only just
 * fits is one rounding away from it. At 360 it still fits — 336 of content
 * leaves 64 spare.
 *
 * IT IS FIXED AT EVERY WIDTH, and that is a deliberate divergence
 * from the drawing, taken under the sheet's own MERGE STATUS box. The sheet
 * draws a full-bleed 336 trigger at 360 via `w-full`; its item 2 records that
 * this cannot work, because `ScreenHeader` renders the slot inside an
 * `ml-auto flex` wrapper that is shrink-to-fit, so a percentage width resolves
 * against a parent sized by its own child. 222 is definite everywhere, needs no
 * change to a shared primitive, and is the width F-15 derived for the popover
 * — which Radix locks to the trigger, so getting it wrong wraps every hinted
 * row onto two lines.
 */
export function PeriodControl({
  from,
  to,
}: {
  from: string | undefined;
  to: string | undefined;
}) {
  const t = useT();
  const f = useFormat();
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  const lineId = `${id}-window`;
  const period = useSettings((s) => s.period);
  const setPeriod = useSettings((s) => s.setPeriod);

  // EMPTY IS ABSENT, NOT DISABLED — the same rule the edit affordance follows
  // on a page with nothing to edit. `resolveWindow` returns `undefined` when
  // there is no start or no end, which is exactly the no-data case: there is no
  // window over nothing, and every screen is already in its own empty state.
  // The hook calls above the guard, never below it — the rules of hooks are the
  // reason this reads in that order.
  // `resolved`, never `window`: a `const window` shadows the global for the
  // whole component body, so any later `window.matchMedia` would be a TDZ
  // ReferenceError rather than a lint error — no rule here catches it.
  const resolved = resolveWindow(period, from, to);
  if (resolved === undefined) return null;

  return (
    <div className="flex w-[272px] flex-col gap-1">
      {/* The purpose, for assistive tech only. It is a SIBLING and not an
          `aria-label`, so the trigger keeps the name it computes from its own
          contents and the two are read together. */}
      <span id={labelId} className="sr-only">
        {t.period.ariaLabel}
      </span>
      <Select
        id={triggerId}
        ariaLabelledBy={`${labelId} ${triggerId}`}
        ariaDescribedBy={lineId}
        value={period}
        onValueChange={(v) => setPeriod(v as PeriodOption)}
        options={PERIOD_OPTIONS.map((o) => {
          const w = resolveWindow(o, from, to);
          // THE CLAMP IS MARKED IN THE LIST, not only after the choice is made
          // (A38 review). The brief pins it: "options longer than the history —
          // absent, or present with the mark, never silently short", and the
          // mark has to be where the CHOICE happens. On the seed four rows show
          // `· 03.02` and three of them are clamped; without this they are
          // indistinguishable from the one that is not.
          // The mark REPLACES the date, it does not follow it — and that is
          // F-15's own rule applied to new content, not an exception to it. A
          // clamped option's start IS the portfolio start, so the date and the
          // words say the same thing; appending both made the three clamped
          // rows 63 px against 44 and wrapped every one of them, which is the
          // exact defect F-15 exists to prevent. Measured before and after.
          const hint = w === undefined ? undefined : w.clamped ? t.period.clampedHint : f.dateShort(w.from);
          return { value: o, label: t.period[o], hint };
        })}
      />
      {/* ONE ELEMENT IN EVERY STATE, which is the whole of D-3's chip-versus-line
          decision. A chip APPEARS, and an element that appears below a line
          that stays pushes the subtitle and the page down on the very press
          that produced it. This line is always here; clamped, it re-colours and
          gains a clause. Nothing moves that was not going to move anyway.

          `warn-tint-text`, not `warn` — F-14 measured `warn` at 4,46 : 1 on
          `page` and this is 11 px body text, so it fails 1.4.3 by 0,04. */}
      <div
        id={lineId}
        className={`text-[11px] transition-colors duration-150 ${
          resolved.clamped ? 'text-warn-tint-text' : 'text-muted'
        }`}
      >
        {/* FULL dates on the line, SHORT ones in the list, and the split is the
            two jobs. The line is the window stated once, so it takes the app's
            date format (`dd.MM.yyyy`, CLAUDE.md) and the drawing's own
            `03.02.2026 – 27.07.2026`. A hint repeats six times inside a 222 px
            row and only has to be comparable between rows, which the day and
            month give — that is what makes three identical `03.02` hints read
            as one window. */}
        {f.date(resolved.from)} – {f.date(resolved.to)}
        {resolved.clamped ? ` · ${t.period.clamped}` : ''}
      </div>
    </div>
  );
}
