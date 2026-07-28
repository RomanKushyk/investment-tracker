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
    'absolute left-1 top-1 grid size-7 place-items-center rounded-full transition hover:bg-page active:scale-[.97]',
  button_next:
    'absolute right-1 top-1 grid size-7 place-items-center rounded-full transition hover:bg-page active:scale-[.97]',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-8 text-center text-[10px] tracking-[.08em] text-muted uppercase',
  week: 'flex',
  day: 'p-0.5 text-center',
  day_button:
    'grid size-8 place-items-center rounded-full text-[13px] transition hover:bg-page active:scale-[.97]',
  selected: '[&>button]:bg-ink [&>button]:text-white',
  today: '[&>button]:font-bold',
  outside: 'text-faint',
};

export function DatePicker({
  value,
  onChange,
  className = 'w-[130px] text-right',
  id,
}: {
  value: string; // ISO yyyy-MM-dd
  onChange: (iso: string) => void;
  className?: string; // width/alignment override for the trigger button
  id?: string; // lets a sibling <label htmlFor> associate with the trigger
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={`Date: ${fmtDate(value)}`}
          className={`border-hairline font-body text-ink hover:border-ink bg-card h-9 rounded-[10px] border px-3 text-[13px] transition active:scale-[.97] ${className}`}
        >
          {fmtDate(value)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="border-hairline bg-card animate-in fade-in zoom-in-95 z-50 rounded-2xl border p-2 shadow-[0_4px_16px_rgba(38,38,42,.12)] duration-200"
        >
          <DayPicker
            mode="single"
            selected={isoToDate(value)}
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
