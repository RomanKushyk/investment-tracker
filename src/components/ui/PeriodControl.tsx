import { useId } from 'react';

import { PERIOD_OPTIONS, resolveWindow, type PeriodOption } from '@quirenote/core/period';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';
import { Select } from './Select';

/**
 * The period control — one window, three screens
 * (`design/extensions/period-and-analytics.dc.html`).
 *
 * IT LIVES IN `ScreenHeader`'s ACTION SLOT, not in the sidebar: below `md` that
 * sidebar is a Radix `Dialog` behind a scrim, so a control reframing what you are
 * looking at would sit ON TOP of it and give no feedback at the press. It is not
 * global either, acting on three of eleven routes.
 *
 * A `Select`, NOT A SEGMENTED TRACK, measured: six Ukrainian labels need nearly
 * twice the track that fits at 360.
 *
 * THE HINT IS THE RESOLVED START DATE, so it is derived and needs no string, and
 * it DRAWS the finding that matters most here — that several options resolve to
 * the SAME window — rather than explaining it.
 *
 * THE WIDTH IS FIXED AND DERIVED FROM THE WIDEST ROW, not the widest label, with
 * slack: Radix locks the popover to the trigger, so a trigger that only just
 * fits wraps every hinted row onto two lines. The drawing's full-bleed `w-full`
 * cannot work here — `ScreenHeader` renders the slot inside a shrink-to-fit
 * `ml-auto flex` wrapper, so a percentage resolves against a parent sized by its
 * own child.
 */
export function PeriodControl({ from, to }: { from: string | undefined; to: string | undefined }) {
  const t = useT();
  const f = useFormat();
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  const lineId = `${id}-window`;
  const period = useSettings((s) => s.period);
  const setPeriod = useSettings((s) => s.setPeriod);

  // EMPTY IS ABSENT, NOT DISABLED: `resolveWindow` returns `undefined` when
  // there is no start or no end, which is the no-data case, and every screen is
  // already in its own empty state. Every hook call sits above the guard, which
  // is the rules of hooks and not a preference.
  //
  // `resolved`, never `window`: a `const window` shadows the global for the whole
  // component body, so a later `window.matchMedia` would be a TDZ
  // ReferenceError rather than a lint error — no rule here catches it.
  const resolved = resolveWindow(period, from, to);
  if (resolved === undefined) return null;

  return (
    <div className="flex w-[272px] flex-col gap-1">
      {/* A SIBLING and not an `aria-label`, so the trigger keeps the name it
          computes from its own contents and the two are read together. */}
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
          // THE CLAMP IS MARKED IN THE LIST, not only after the choice is made:
          // an option longer than the history is absent, or present with the
          // mark, never silently short — and the mark has to be where the CHOICE
          // happens, or a clamped option is indistinguishable from an unclamped
          // one resolving to the same date. It REPLACES the date rather than
          // following it: a clamped option's start IS the portfolio start, so the
          // date and the words say the same thing, and appending both widens the
          // row enough to wrap it.
          const hint =
            w === undefined ? undefined : w.clamped ? t.period.clampedHint : f.dateShort(w.from);
          return { value: o, label: t.period[o], hint };
        })}
      />
      {/* ONE ELEMENT IN EVERY STATE, a line and not a chip: a chip APPEARS, and
          an element appearing below a line that stays pushes the subtitle and
          the page down on the very press that produced it. This line is always
          here; clamped, it re-colours and gains a clause.

          `warn-tint-text`, not `warn`, which is under 4,5 : 1 on `page` and so
          fails 1.4.3 at this 11 px body size. */}
      <div
        id={lineId}
        className={`text-[11px] transition-colors duration-150 ${
          resolved.clamped ? 'text-warn-tint-text' : 'text-muted'
        }`}
      >
        {/* FULL dates on the line, SHORT ones in the list, because the two do
            different jobs: the line states the window once, so it takes the
            app's `dd.MM.yyyy`, while a hint repeats per row and only has to be
            comparable BETWEEN rows — which is what makes identical short hints
            read as one window. */}
        {f.date(resolved.from)} – {f.date(resolved.to)}
        {resolved.clamped ? ` · ${t.period.clamped}` : ''}
      </div>
    </div>
  );
}
