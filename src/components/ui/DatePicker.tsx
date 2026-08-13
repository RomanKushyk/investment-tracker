import { Popover } from 'radix-ui';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';

import { fmtDate } from '../../core/money';

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
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={value ? `Date: ${fmtDate(value)}` : (placeholder ?? 'Pick a date')}
          aria-invalid={invalid || undefined}
          className={`${invalid ? 'border-neg' : 'border-hairline'} ${bg === 'page' ? 'bg-page' : 'bg-card'} font-body text-ink hover:border-ink h-9 rounded-[9px] border px-3 text-[13px] transition active:scale-[.97] ${className}`}
        >
          {value ? (
            fmtDate(value)
          ) : (
            <span className="text-muted">{placeholder ?? 'Pick a date'}</span>
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
