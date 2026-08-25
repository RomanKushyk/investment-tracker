import { Dialog as RadixDialog, Popover } from 'radix-ui';
import { useRef, useState } from 'react';
// Locales come from react-day-picker's OWN subpath, not from a direct
// date-fns dependency: the calendar already depends on date-fns and
// re-exports these, so a second declared range on the same package is a
// second constraint that can drift out of overlap — and two installed copies
// mean the calendar and the app read different locale objects.
import { enUS, uk } from 'react-day-picker/locale';
import { Chevron, DayPicker } from 'react-day-picker';

import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import { YEARS_PER_PAGE, yearBounds, yearPage } from './date-picker-years';
import { Scroller } from './Scroller';
import { TAP_44 } from './tap-target';
import { useSettings } from '../../state/settings';

// The calendar's own words — the WEEKDAY names, and every month name rdp itself
// formats — come from date-fns rather than the app dictionary: they are a
// locale's data, not this app's copy, and react-day-picker already speaks that
// format. The caption is the exception and says why at `captionButtons`: it is
// the app's own control now, not rdp's.
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
// ONE BASE FOR EVERY CELL IN THIS CONTROL. The month and year cells replace the
// day cells in the same box, so `day_button` composes this string with a width
// and the grids take it as it is — three copied strings could drift, and the
// comment claiming they were identical could not stop them.
//
// The hover is NOT in the base, and that is a bug fix rather than a preference:
// `hover:bg-page` and `bg-ink` are both one class deep, `:hover` wins the tie,
// and the emphasised cell painted page-on-page under the pointer — its own label
// vanishing. States that cannot both apply are composed as alternatives instead.
const CELL_BASE =
  'grid h-8 place-items-center rounded-[8px] text-[13px] transition active:scale-[.97] max-md:h-11';
const CELL_IDLE = 'hover:bg-page';
// Filled emphasis for the month or year the calendar is SHOWING — the same
// treatment `selected` gives the chosen day, for the same reason.
const CELL_SHOWN = 'bg-ink text-page';

const calendarClassNames = {
  months: 'flex flex-col',
  month: 'flex flex-col gap-2',
  // HIDDEN, because the caption is rendered outside this tree — see `caption`
  // for why it is not a `components.MonthCaption` override. `Nav` is a sibling
  // of the month, not a child of the caption (DayPicker.js:247), so hiding this
  // keeps both chevrons.
  month_caption: 'hidden',
  nav: 'flex items-center justify-between',
  button_previous:
    'absolute left-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  button_next:
    'absolute right-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97] max-md:size-11',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  // 36, NOT 32: a day column is `w-8` plus `day`'s `p-0.5` either side, so a
  // 32px header cell drifts 4px per column and the last weekday sat 26px left of
  // the days it names. Pre-existing, and corrected here because this task's own
  // arithmetic (7 x 36 = 252) is the number that exposes it.
  weekday:
    'w-9 text-center text-[10px] tracking-[.08em] text-muted uppercase max-md:w-auto max-md:flex-1',
  week: 'flex',
  // `p-px` below the breakpoint, not `p-0.5`: the cell's own padding is dead
  // space between two day targets, and halving it to the 2px gutter the
  // reference draws hands the difference back to the button. Measured at 360 the
  // day is 41.3 x 44 — the figure here read 42.3 and was stale, from before the
  // sheet's scroll box took its own inset — under the 44 x 44 guidance on the short
  // axis and well over WCAG 2.5.8's 24, and the only way to reach 44 wide is to
  // remove the gutter entirely, which puts two tap targets flush against each
  // other on the one control where hitting the neighbour saves the wrong date.
  // `w-9` IS LOAD-BEARING ABOVE THE BREAKPOINT, and its absence was a wrong
  // calendar rather than an untidy one. `week` is a flex row, and rdp renders the
  // days before the 1st as EMPTY <td>s — with no button inside, `p-0.5` alone
  // made them 4px, so the whole first week slid left and 1 серпня 2026, a
  // Saturday, was drawn under «вт». Measured before the fix: day 1 at x=214.6
  // where its column starts at 374.6. Below the breakpoint `flex-1` already gave
  // every cell, empty ones included, an equal share.
  day: 'w-9 p-0.5 text-center max-md:w-auto max-md:flex-1 max-md:p-px',
  day_button: `${CELL_BASE} ${CELL_IDLE} w-8 max-md:w-full`,
  // Filled emphasis, so the fill stays `ink` and the text becomes `page` —
  // see the note in button-variants.ts (FINDING 3). The `:hover` guard is the
  // same specificity fix as `CELL_IDLE`: rdp puts the emphasis on the CELL and
  // the hover on the button inside it, so `.selected > button:hover` is the only
  // selector that outranks `hover:bg-page` and keeps the chosen day readable.
  selected: '[&>button]:bg-ink [&>button]:text-page [&>button:hover]:bg-ink',
  today: '[&>button]:font-bold',
  outside: 'text-faint',
  // rdp's chevron is a bare <svg><polygon> with no fill, and this app never
  // loads rdp's stylesheet — so unstyled it is BLACK, which is invisible on the
  // dark card. Every chevron in the control takes this, the year nav's included.
  chevron: 'fill-current',
};

// 28 tall like the nav buttons it sits between, 44 below the breakpoint like
// every other target in the sheet. The radius stays 7 at both, which is what
// `button_previous` and `button_next` beside it already do — A45's row records
// that as a declined D56 deviation, and `CELL_BASE` inherits the same one from
// `day_button` on purpose: a cell that replaces the day cell has to match it.
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
  // THE SPAN IS DERIVED HERE, not frozen at import, and it WIDENS to hold the
  // field's own year. Two defects met at this line: a module constant keeps last
  // year's window in a tab left open across New Year, and a value outside the
  // span was clamped by rdp itself — silently, without calling `onMonthChange` —
  // so a `firstPurchase` of 1998 read «червень 1998» in the caption above a grid
  // showing January 2006, and a click there saved 2006.
  const { first: firstYear, last: lastYear } = yearBounds(
    new Date().getFullYear(),
    value ? isoToDate(value).getFullYear() : undefined,
  );

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [shown, setShown] = useState(() => (value ? isoToDate(value) : new Date()));
  // The year grid's page anchor, and deliberately NOT `shown`: paging must not
  // move the calendar. While it wrote `shown`, one press of "next years" carried
  // the day grid twelve years forward and drew the browsed year as if it were
  // chosen — someone who only looked could save a date in 2038.
  const [pageYear, setPageYear] = useState(() =>
    value ? isoToDate(value).getFullYear() : new Date().getFullYear(),
  );
  // A pressed cell unmounts under the pointer, and the desktop popover is NOT
  // modal: Radix restores focus only where it traps it, so without these the
  // next Tab starts from the top of the page instead of inside the calendar.
  const monthButton = useRef<HTMLButtonElement>(null);
  const yearButton = useRef<HTMLButtonElement>(null);

  // Opening resets all three. The month is CONTROLLED — the grids have to move
  // it — so `defaultMonth`'s "open on the month the field holds" happens here
  // instead, and neither a view nor a page left open at close survives.
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
      // 16px below the breakpoint for the same reason as `Select` — it shows
      // a value, and the drawing sets every value-bearing control on the
      // phone at 16.
      className={`${invalid ? 'border-neg' : 'border-hairline'} ${bg === 'page' ? 'bg-page' : 'bg-card'} h-9 rounded-[9px] border px-3 font-body text-[13px] text-ink transition hover:border-ink active:scale-[.97] max-md:text-base ${TAP_44} ${className}`}
    >
      {value ? f.date(value) : <span className="text-muted">{placeholder ?? t.dates.pick}</span>}
    </button>
  );

  // THE CAPTION IS THE NAVIGATION, in every view: the month word swaps the days
  // for a grid of months, the year swaps them for a grid of years, and pressing
  // the open one again goes back. A45 first shipped the library's own
  // `captionLayout="dropdown"`, and the owner refused it on looks the same day —
  // so the SHAPE is ours. The span it navigates is not, and did not change.
  //
  // IT IS RENDERED HERE, and rdp's own caption is hidden, rather than passed
  // through `components.MonthCaption`. That override was a fresh object holding
  // a fresh inline component on every render, and rdp lists `components` in the
  // memo that builds its `DateLib` — so a keystroke anywhere else in the form
  // rebuilt the whole month and remounted the caption, discarding focus inside
  // it. Rendering it outside also keeps both buttons MOUNTED across a view
  // change, which is what stops focus falling to <body> on the desktop.
  //
  // The month words come from the app dictionary while the weekdays stay the
  // locale's, and the split is deliberate: this caption is the app's own control
  // now, and `t.dates.monthFull` is the list every chart axis already reads.
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
        // The label CARRIES the visible word instead of replacing it: an
        // `aria-label` of «Виберіть місяць» alone took the month the calendar is
        // showing out of the accessible name entirely.
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
      {/* rdp's own caption carried `role="status" aria-live="polite"`, and
          hiding it took the announcement of every month step with it. */}
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
  // A step is one PAGE, and the page size comes from the module that pages.
  // Repeating 12 here let the two disagree the moment either changed, and a
  // press would then land mid-page.
  const stepPage = (pages: number) =>
    setPageYear(Math.min(Math.max(pageYear + pages * YEARS_PER_PAGE, firstYear), lastYear));
  const yearGrid = (
    // Four columns, not the months' three: a year is four glyphs and a month
    // name is up to nine, so the same twelve cells want a different split. The
    // emphasis marks the year the CALENDAR is on, never the page being browsed.
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

  // The page's own nav, in rdp's two absolute positions, so a chevron never moves
  // when the view does. At either end the button is DISABLED rather than removed,
  // because a chevron that vanishes drags the caption under the pointer.
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

  // ONE BOX FOR ALL THREE VIEWS, at the day grid's own width above the
  // breakpoint and the sheet's full width below it, so the popover never resizes
  // when the view changes. THE NUMBER IS 252, NOT 224: a day cell is 32 wide plus
  // the `p-0.5` gutter `day` carries either side, so the seven columns measure
  // 7 x 36. At 224 the popover was measured jumping 269.1 -> 241.1 on the first
  // press.
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
      <RadixDialog.Root open={open} onOpenChange={openChange}>
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
    <Popover.Root open={open} onOpenChange={openChange}>
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
