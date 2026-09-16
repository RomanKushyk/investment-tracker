import { Dialog as RadixDialog, Popover } from 'radix-ui';
import { useRef, useState } from 'react';
// Locales come from react-day-picker's OWN subpath, not a direct date-fns dependency:
// two installed copies mean the calendar and the app read different locale objects.
import { enUS, uk } from 'react-day-picker/locale';
import { Chevron, DayPicker } from 'react-day-picker';

import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import { YEARS_PER_PAGE, yearBounds, yearPage } from './date-picker-years';
import { Scroller } from './Scroller';
import { TAP_44 } from './tap-target';
import { useSettings } from '../../state/settings';

// The WEEKDAY names come from date-fns, not the app dictionary: they are a locale's
// data. `weekStartsOn` is the part that is NOT cosmetic — the locale carries it and
// getting it wrong shifts every column by one, for a calendar that reads wrong.
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

// `w-full` on the button, because the pressable thing is the BUTTON. ONE BASE FOR
// EVERY CELL, because the month and year cells replace the day cells in the same box.
// The hover is NOT in it: the hover and the emphasis fill are both one class deep,
// `:hover` wins the tie, and the emphasised cell paints page-on-page under the pointer.
const CELL_BASE =
  'grid h-8 place-items-center rounded-[8px] text-[13px] transition active:scale-[.97] max-md:h-11';
const CELL_IDLE = 'hover:bg-page';
const CELL_SHOWN = 'bg-ink text-page';

const calendarClassNames = {
  months: 'flex flex-col',
  month: 'flex flex-col gap-2',
  // HIDDEN, because the caption is rendered outside this tree. `Nav` is a sibling of
  // the month rather than a child of the caption, so hiding this keeps both chevrons.
  month_caption: 'hidden',
  nav: 'flex items-center justify-between',
  button_previous:
    'absolute left-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  button_next:
    'absolute right-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  // Matches the day column INCLUDING its gutter, or it drifts per column and the last
  // weekday sits left of the days it names.
  weekday:
    'w-9 text-center text-[10px] tracking-[.08em] text-muted uppercase max-md:w-auto max-md:flex-1',
  week: 'flex',
  // The cell's padding cannot go to zero: that puts two tap targets flush on the one
  // control where hitting the neighbour saves the wrong date.
  //
  // `w-9` IS LOAD-BEARING ABOVE THE BREAKPOINT: `week` is a flex row and rdp renders
  // the days before the 1st as EMPTY <td>s, so with no button inside them the padding
  // alone sized those cells and the first week slid left, drawing every day under the
  // wrong weekday. Below the breakpoint `flex-1` gives every cell an equal share.
  day: 'w-9 p-0.5 text-center max-md:w-auto max-md:flex-1 max-md:p-px',
  day_button: `${CELL_BASE} ${CELL_IDLE} w-8 max-md:w-full`,
  // The `:hover` guard is the same specificity fix as `CELL_IDLE`: rdp puts the
  // emphasis on the CELL and the hover on the button inside it.
  selected: '[&>button]:bg-ink [&>button]:text-page [&>button:hover]:bg-ink',
  today: '[&>button]:font-bold',
  outside: 'text-faint',
  // rdp's chevron is a bare polygon with no fill and this app never loads rdp's
  // stylesheet, so unstyled it is BLACK. Every chevron in the control takes this.
  chevron: 'fill-current',
};

// The radius stays constant across both heights, matching the nav buttons beside it: a
// declared exception, which `CELL_BASE` inherits on purpose. *Shape system*
const CAPTION_BUTTON =
  'grid h-7 place-items-center rounded-[7px] px-2 font-display text-[13px] font-semibold transition hover:bg-page active:scale-[.97] max-md:h-11 max-md:px-2.5 max-md:text-base';
const CAPTION_BUTTON_OPEN = 'bg-page';

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
  // THE SPAN IS DERIVED HERE and WIDENS to hold the field's own year. Two defects meet
  // at this line: a module constant keeps last year's window in a tab left open across
  // New Year, and rdp CLAMPS a value outside the span WITHOUT calling `onMonthChange`,
  // so the caption names one year over a grid showing another and a click saves the
  // grid's.
  const { first: firstYear, last: lastYear } = yearBounds(
    new Date().getFullYear(),
    value ? isoToDate(value).getFullYear() : undefined,
  );

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [shown, setShown] = useState(() => (value ? isoToDate(value) : new Date()));
  // Deliberately NOT `shown`: paging must not move the calendar, or one press carries
  // the day grid a page forward and draws the browsed year as if it were chosen.
  const [pageYear, setPageYear] = useState(() =>
    value ? isoToDate(value).getFullYear() : new Date().getFullYear(),
  );
  // A pressed cell unmounts under the pointer and the desktop popover is NOT modal, so
  // Radix restores no focus and the next Tab starts from the top of the page.
  const monthButton = useRef<HTMLButtonElement>(null);
  const yearButton = useRef<HTMLButtonElement>(null);

  // The month is CONTROLLED, because the grids move it, so `defaultMonth` is unavailable
  // and opening resets all three here — view, month and year page.
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const at = value ? isoToDate(value) : new Date();
    setView('days');
    setShown(at);
    setPageYear(at.getFullYear());
  };

  const trigger = (
    <button
      type="button"
      id={id}
      aria-label={value ? t.dates.selected(f.date(value)) : (placeholder ?? t.dates.pick)}
      aria-invalid={invalid || undefined}
      className={`${invalid ? 'border-neg' : 'border-field-border hover:border-ink'} ${bg === 'page' ? 'bg-page' : 'bg-card'} h-9 rounded-[9px] border px-3 font-body text-[13px] text-ink transition active:scale-[.97] max-md:text-base ${TAP_44} ${className}`}
    >
      {value ? f.date(value) : <span className="text-muted">{placeholder ?? t.dates.pick}</span>}
    </button>
  );

  // THE CAPTION IS THE NAVIGATION: the month word swaps the days for a grid of months,
  // the year for a grid of years, and pressing the open one again goes back.
  //
  // IT IS RENDERED HERE, with rdp's own caption hidden, rather than passed through
  // `components.MonthCaption`. That override is a fresh inline component on every
  // render, and rdp lists `components` in the memo that builds its `DateLib`, so a
  // keystroke anywhere else in the form remounts the caption and discards focus inside
  // it. Rendering it outside also keeps both buttons MOUNTED across a view change,
  // which is what stops focus falling to <body>.
  const monthName = t.dates.monthFull[shown.getMonth()];
  const toggle = (next: 'months' | 'years') => {
    if (next === 'years') setPageYear(shown.getFullYear());
    setView(view === next ? 'days' : next);
  };
  const caption = (
    <div className="flex items-center justify-center gap-1.5 py-1">
      <button
        ref={monthButton}
        type="button"
        // The label CARRIES the visible word rather than replacing it, or the month
        // shown leaves the accessible name entirely.
        aria-label={`${t.dates.pickMonth}: ${monthName}`}
        aria-expanded={view === 'months'}
        onClick={() => toggle('months')}
        className={`${CAPTION_BUTTON} ${view === 'months' ? CAPTION_BUTTON_OPEN : ''}`}
      >
        {monthName}
      </button>
      <button
        ref={yearButton}
        type="button"
        aria-label={`${t.dates.pickYear}: ${shown.getFullYear()}`}
        aria-expanded={view === 'years'}
        onClick={() => toggle('years')}
        className={`${CAPTION_BUTTON} ${view === 'years' ? CAPTION_BUTTON_OPEN : ''}`}
      >
        {shown.getFullYear()}
      </button>
      {/* Hiding rdp's own caption took its `aria-live` announcement of every month
          step with it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {monthName} {shown.getFullYear()}
      </span>
    </div>
  );

  const cell = (isShown: boolean) => `${CELL_BASE} ${isShown ? CELL_SHOWN : CELL_IDLE}`;

  const monthGrid = (
    <div className="grid grid-cols-3 gap-1">
      {t.dates.monthFull.map((name, i) => (
        <button
          key={name}
          type="button"
          aria-current={i === shown.getMonth() ? 'true' : undefined}
          onClick={() => {
            setShown(new Date(shown.getFullYear(), i));
            setView('days');
            monthButton.current?.focus();
          }}
          className={cell(i === shown.getMonth())}
        >
          {name}
        </button>
      ))}
    </div>
  );

  const years = yearPage(pageYear, firstYear, lastYear);
  // The page size comes from the module that pages, or a press lands mid-page.
  const stepPage = (pages: number) =>
    setPageYear(Math.min(Math.max(pageYear + pages * YEARS_PER_PAGE, firstYear), lastYear));
  const yearGrid = (
    // Four columns, not the months' three: a year is four glyphs, a month name nine.
    // The emphasis marks the year the CALENDAR is on, never the page being browsed.
    <div className="grid grid-cols-4 gap-1">
      {years.map((y) => (
        <button
          key={y}
          type="button"
          aria-current={y === shown.getFullYear() ? 'true' : undefined}
          onClick={() => {
            setShown(new Date(y, shown.getMonth()));
            setView('months');
            yearButton.current?.focus();
          }}
          className={cell(y === shown.getFullYear())}
        >
          {y}
        </button>
      ))}
    </div>
  );

  // In rdp's two absolute positions, so a chevron never moves when the view does, and
  // DISABLED rather than removed at either end: a vanishing one drags the caption.
  const yearNav = (
    <>
      <button
        type="button"
        aria-label={t.dates.prevYears}
        disabled={years[0] === firstYear}
        onClick={() => stepPage(-1)}
        className={`${calendarClassNames.button_previous} disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        <Chevron orientation="left" className={calendarClassNames.chevron} />
      </button>
      <button
        type="button"
        aria-label={t.dates.nextYears}
        disabled={years[years.length - 1] === lastYear}
        onClick={() => stepPage(1)}
        className={`${calendarClassNames.button_next} disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        <Chevron orientation="right" className={calendarClassNames.chevron} />
      </button>
    </>
  );

  // ONE BOX FOR ALL THREE VIEWS, at the day grid's width, so the popover never resizes
  // when the view changes — seven columns INCLUDING each cell's gutter, or it jumps.
  const calendar = (
    <div className="flex flex-col gap-2">
      {caption}
      {view === 'years' ? yearNav : null}
      <div className="w-[252px] animate-in duration-200 fade-in max-md:w-full">
        {view === 'days' ? (
          <DayPicker
            locale={LOCALE[language]}
            mode="single"
            month={shown}
            onMonthChange={setShown}
            startMonth={new Date(firstYear, 0)}
            endMonth={new Date(lastYear, 11)}
            selected={value ? isoToDate(value) : undefined}
            onSelect={(d) => {
              if (!d) return;
              onChange(dateToIso(d));
              setOpen(false);
            }}
            classNames={calendarClassNames}
          />
        ) : view === 'months' ? (
          monthGrid
        ) : (
          yearGrid
        )}
      </div>
    </div>
  );

  // THE PICKER STOPS ANCHORING BELOW THE BREAKPOINT and becomes a centred sheet: a
  // seven-column grid anchored to a right-aligned field cannot stay inside the phone.
  // A Dialog rather than a Popover, because a sheet anchored to the VIEWPORT is what a
  // dialog is — it brings the scrim, the focus trap and the scroll lock a floating
  // popover does not. Its width is the app's standard overlay margin and not the
  // drawing's, which does not account for the sheet's own padding.
  if (!desktop) {
    return (
      <RadixDialog.Root open={open} onOpenChange={openChange}>
        <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=open]:fade-in" />
          {/* BOUNDED AND SCROLLABLE, because a six-week month is taller than a
              landscape phone and the sheet is `fixed`, so the page scroll cannot
              bring a clipped last row back. A grid row rather than a flex child,
              because a percentage height under a `max-h`-clamped parent resolves to
              `auto` — and the `sr-only` title beside it is absolutely positioned, so
              it takes no row of that one-row template. `Scroller` WITHOUT a `radius`:
              the gutter is then reserved only while a rail is up. *Scrolling* */}
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[328px] -translate-x-1/2 -translate-y-1/2 animate-in grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-field-border bg-card p-2 shadow-(--shadow-popover) duration-200 zoom-in-95 fade-in"
          >
            {/* The sheet draws a month caption, so the title is screen-reader only. */}
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
    <Popover.Root open={open} onOpenChange={openChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 animate-in rounded-2xl border border-field-border bg-card p-2 shadow-(--shadow-popover) duration-200 zoom-in-95 fade-in"
        >
          {calendar}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
