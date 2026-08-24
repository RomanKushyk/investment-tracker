import { Dialog as RadixDialog, Popover } from 'radix-ui';
import { useState } from 'react';
// Locales come from react-day-picker's OWN subpath, not from a direct
// date-fns dependency: the calendar already depends on date-fns and
// re-exports these, so a second declared range on the same package is a
// second constraint that can drift out of overlap — and two installed copies
// mean the calendar and the app read different locale objects.
import { enUS, uk } from 'react-day-picker/locale';
import { DayPicker } from 'react-day-picker';

import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import { Scroller } from './Scroller';
import { TAP_44 } from './tap-target';
import { useSettings } from '../../state/settings';

// The calendar's own words — month and weekday names — come from date-fns
// rather than the app dictionary: they are a locale's data, not this app's
// copy, and react-day-picker already speaks that format.
//
// `weekStartsOn` is the part that is NOT cosmetic. The locale carries it (uk
// starts Monday, en-US Sunday) and getting it wrong shifts every column by one
// — a calendar that looks fine and is read wrong.
const LOCALE = { uk, en: enUS } as const;

// ISO 'yyyy-MM-dd' <-> local Date, avoiding UTC-shift surprises.
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Below the breakpoint every cell stops being 32px wide and takes an equal
// share of the sheet instead, so the seven columns fill it and each day is a
// 44px-tall target. `flex-1` on the cell and `w-full` on the button, because the
// pressable thing is the BUTTON — a wide cell holding a narrow button is a wide
// column of dead space with a small target in the middle of it.
const calendarClassNames = {
  months: 'flex flex-col',
  month: 'flex flex-col gap-2',
  month_caption: 'flex items-center justify-center py-1 font-display text-[13px] font-semibold',
  nav: 'flex items-center justify-between',
  button_previous:
    'absolute left-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  button_next:
    'absolute right-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday:
    'w-8 text-center text-[10px] tracking-[.08em] text-muted uppercase max-md:w-auto max-md:flex-1',
  week: 'flex',
  // `p-px` below the breakpoint, not `p-0.5`: the cell's own padding is dead
  // space between two day targets, and halving it to the 2px gutter the
  // reference draws hands the difference back to the button. Measured at 360 the
  // day is then 42.3 x 44 — under the 44 x 44 platform guidance on the short
  // axis and well over WCAG 2.5.8's 24, and the only way to reach 44 wide is to
  // remove the gutter entirely, which puts two tap targets flush against each
  // other on the one control where hitting the neighbour saves the wrong date.
  day: 'p-0.5 text-center max-md:flex-1 max-md:p-px',
  day_button:
    'grid h-8 w-8 place-items-center rounded-[8px] text-[13px] transition hover:bg-page active:scale-[.97] max-md:h-11 max-md:w-full',
  // Filled emphasis, so the fill stays `ink` and the text becomes `page` —
  // see the note in button-variants.ts (FINDING 3).
  selected: '[&>button]:bg-ink [&>button]:text-page',
  today: '[&>button]:font-bold',
  outside: 'text-faint',
};

export function DatePicker({
  value,
  onChange,
  className = 'w-[130px] text-right',
  id,
  placeholder,
  invalid = false,
  bg = 'card',
}: {
  value: string; // ISO yyyy-MM-dd; '' = unset (renders the placeholder)
  onChange: (iso: string) => void;
  className?: string; // width/alignment override for the trigger button
  id?: string; // lets a sibling <label htmlFor> associate with the trigger
  placeholder?: string; // shown muted while value is '' (optional dates, P2 AssetForm)
  invalid?: boolean; // error styling per the form-error idiom (border neg)
  bg?: 'card' | 'page'; // explicit variant, same rationale as Select's `bg`
}) {
  const f = useFormat();
  const t = useT();
  const language = useSettings((st) => st.language);
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      id={id}
      aria-label={value ? t.dates.selected(f.date(value)) : (placeholder ?? t.dates.pick)}
      aria-invalid={invalid || undefined}
      // 16px below the breakpoint for the same reason as `Select` — it shows
      // a value, and the drawing sets every value-bearing control on the
      // phone at 16.
      className={`${invalid ? 'border-neg' : 'border-hairline'} ${bg === 'page' ? 'bg-page' : 'bg-card'} h-9 rounded-[9px] border px-3 font-body text-[13px] text-ink transition hover:border-ink active:scale-[.97] max-md:text-base ${TAP_44} ${className}`}
    >
      {value ? f.date(value) : <span className="text-muted">{placeholder ?? t.dates.pick}</span>}
    </button>
  );

  const calendar = (
    <DayPicker
      locale={LOCALE[language]}
      mode="single"
      selected={value ? isoToDate(value) : undefined}
      defaultMonth={value ? isoToDate(value) : undefined}
      onSelect={(d) => {
        if (!d) return;
        onChange(dateToIso(d));
        setOpen(false);
      }}
      classNames={calendarClassNames}
    />
  );

  // DECISION D-c — THE PICKER STOPS ANCHORING BELOW THE BREAKPOINT and becomes a
  // centred sheet. A seven-column month grid anchored to a right-aligned field
  // cannot stay inside 360px, and collision handling that only flips or shifts
  // is answering a question the width has already lost.
  //
  // A Dialog rather than a Popover, because a sheet anchored to the VIEWPORT is
  // what a dialog is: it brings the scrim, the focus trap and the scroll lock
  // that a floating popover over a scrollable page does not have. Its overlay is
  // the app Dialog's `sidebar/40` and NOT `--color-scrim` (D-d): the drawer's
  // scrim is `ink`-based and would turn into a grey wash in dark, while
  // `sidebar` is an inverted plane in both themes.
  //
  // WIDTH IS 328, NOT THE DRAWING'S 312, and the arithmetic is why. 312 is
  // 360 − 2×24, and 312 ÷ 7 = 44.6 is where the drawing gets its ">44px cells" —
  // but the sheet also carries 8px of padding a side, so the real cell is
  // (312 − 18) ÷ 7 = 42.0 and the target the note claims is missed. At the app's
  // standard overlay margin — `calc(100vw − 32px)`, the same one `Dialog` uses —
  // a 360px viewport gives 328, and (328 − 18) ÷ 7 = 44.3. Same intent, and this
  // time it holds.
  if (!desktop) {
    return (
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-sidebar/40 data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=open]:fade-in" />
          {/* BOUNDED AND SCROLLABLE, because the sheet is taller than a
              landscape phone. 44px day cells make a six-week month 343.6px
              tall; measured at 568 x 320 (landscape iPhone SE) the sheet was
              clipped 11.8px at each end and DAY 31 WAS UNREACHABLE — it is
              `fixed`, so the page scroll cannot bring it back. The bound and the
              band are the app's own answer to that (D65, and `Dialog`'s three
              bands): a grid row rather than a flex child, because a percentage
              height under a `max-h`-clamped parent resolves to `auto`.
              `Scroller` WITHOUT a `radius`, on purpose — the 28px gutter is then
              reserved only while a rail is actually up, so a month that fits
              keeps its full 44.3px columns and only a clipped one narrows.
              `sr-only` is absolutely positioned, so the title takes no row. */}
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[328px] -translate-x-1/2 -translate-y-1/2 animate-in grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-hairline bg-card p-2 shadow-(--shadow-popover) duration-200 zoom-in-95 fade-in"
          >
            {/* The sheet shows a month caption, not a title, so the accessible
                name is given to screen readers only rather than drawn twice. */}
            <RadixDialog.Title className="sr-only">{placeholder ?? t.dates.pick}</RadixDialog.Title>
            <div className="min-h-0 min-w-0">
              <Scroller>{calendar}</Scroller>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 animate-in rounded-2xl border border-hairline bg-card p-2 shadow-(--shadow-popover) duration-200 zoom-in-95 fade-in"
        >
          {calendar}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
