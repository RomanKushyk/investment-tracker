import { ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import type { ReactNode } from 'react';

// Styled to match the app's `.input` shape (README §4) — radius 10, white bg,
// hairline border. Generic string-value select; Controller-friendly.
// `borderColor`/`bg` are explicit variants (not className overrides) so
// callers can't end up with two same-property utilities fighting over
// generated-CSS order.
export interface SelectOption {
  value: string;
  label: string;
  // Muted secondary text after the label ("Inzhur REIT · inzhur-reit", P3 S7).
  // It sits OUTSIDE Radix's ItemText on purpose: the trigger shows the
  // selected item's ItemText only, so a picked option reads as its label alone.
  hint?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className = '',
  borderColor = 'hairline',
  bg = 'white',
  onOpenChange,
  status,
  scrollList = false,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  borderColor?: 'hairline' | 'faint';
  bg?: 'white' | 'page';
  // Fires on open/close — the P3 Inzhur picker fetches its list on first open.
  onOpenChange?: (open: boolean) => void;
  // Non-selectable row(s) rendered after the options: the picker's loading and
  // empty rows and its "as of 25.07" stale footer (S7).
  status?: ReactNode;
  // Cap the list at ~240px and scroll inside it — an explicit opt-in (not a
  // className override) so the existing short selects keep their exact
  // unbounded height; the S7 picker lists a whole feed and needs the cap.
  scrollList?: boolean;
}) {
  const borderClass = borderColor === 'faint' ? 'border-faint' : 'border-hairline';
  const bgClass = bg === 'page' ? 'bg-page' : 'bg-white';
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} onOpenChange={onOpenChange}>
      <RadixSelect.Trigger
        className={`${borderClass} font-body text-ink hover:border-ink flex h-9 w-full items-center justify-between gap-2 rounded-[9px] border ${bgClass} px-3 text-[13px] transition active:scale-[.97] ${className}`}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={14} strokeWidth={2.5} className="text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          // 14, not the 16 a surface would take: the items sit in this
          // popover's corners at a uniform 5px inset (4px viewport padding +
          // the 1px border), so this is the concentric case — 9 + 5. The
          // DatePicker next door keeps 16 because its only corner-adjacent
          // child is an absolutely-placed arrow, not a box that hugs all four.
          className="border-hairline bg-card animate-in fade-in zoom-in-95 z-50 overflow-hidden rounded-[14px] border shadow-[0_4px_16px_rgba(38,38,42,.12)] duration-200"
          style={{ width: 'var(--radix-select-trigger-width)' }}
        >
          <RadixSelect.Viewport className={scrollList ? 'max-h-60 overflow-y-auto p-1' : 'p-1'}>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="data-[highlighted]:bg-page cursor-pointer rounded-[9px] px-3 py-2 text-[13px] transition outline-none"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                {o.hint !== undefined && <span className="text-muted"> · {o.hint}</span>}
              </RadixSelect.Item>
            ))}
            {status}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
