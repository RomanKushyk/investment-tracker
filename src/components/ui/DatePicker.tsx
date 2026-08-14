import { Popover } from 'radix-ui';
import { useState } from 'react';
// Locales come from react-day-picker's OWN subpath, not from a direct
// date-fns dependency: the calendar already depends on date-fns and
// re-exports these, so a second declared range on the same package is a
// second constraint that can drift out of overlap — and two installed copies
// mean the calendar and the app read different locale objects.
import { enUS, uk } from 'react-day-picker/locale';
import { DayPicker } from 'react-day-picker';

import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
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

const calendarClassNames = {
  months: 'flex flex-col',
  month: 'flex flex-col gap-2',
  month_caption:
    'flex items-center justify-center py-1 font-display text-[13px] font-semibold',
  nav: 'flex items-center justify-between',
  button_previous:
    'absolute left-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97]',
  button_next:
    'absolute right-1 top-1 grid size-7 place-items-center rounded-[7px] transition hover:bg-page active:scale-[.97]',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-8 text-center text-[10px] tracking-[.08em] text-muted uppercase',
  week: 'flex',
  day: 'p-0.5 text-center',
  day_button:
    'grid size-8 place-items-center rounded-[8px] text-[13px] transition hover:bg-page active:scale-[.97]',
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
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={value ? t.dates.selected(f.date(value)) : (placeholder ?? t.dates.pick)}
          aria-invalid={invalid || undefined}
          className={`${invalid ? 'border-neg' : 'border-hairline'} ${bg === 'page' ? 'bg-page' : 'bg-card'} font-body text-ink hover:border-ink h-9 rounded-[9px] border px-3 text-[13px] transition active:scale-[.97] ${className}`}
        >
          {value ? (
            f.date(value)
          ) : (
            <span className="text-muted">{placeholder ?? t.dates.pick}</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="border-hairline bg-card animate-in fade-in zoom-in-95 z-50 rounded-2xl border p-2 shadow-(--shadow-popover) duration-200"
        >
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
