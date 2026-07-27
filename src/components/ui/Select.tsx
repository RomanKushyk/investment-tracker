import { ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';

// Styled to match the app's `.input` shape (README §4) — radius 10, white bg,
// hairline border. Generic string-value select; Controller-friendly.
// `borderColor`/`bg` are explicit variants (not className overrides) so
// callers can't end up with two same-property utilities fighting over
// generated-CSS order.
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className = '',
  borderColor = 'hairline',
  bg = 'white',
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  borderColor?: 'hairline' | 'faint';
  bg?: 'white' | 'page';
}) {
  const borderClass = borderColor === 'faint' ? 'border-faint' : 'border-hairline';
  const bgClass = bg === 'page' ? 'bg-page' : 'bg-white';
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        className={`${borderClass} font-body text-ink hover:border-ink flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border ${bgClass} px-3 text-[13px] transition active:scale-[.97] ${className}`}
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
          className="border-hairline bg-card animate-in fade-in zoom-in-95 z-50 overflow-hidden rounded-2xl border shadow-[0_4px_16px_rgba(38,38,42,.12)] duration-200"
          style={{ width: 'var(--radix-select-trigger-width)' }}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="data-[highlighted]:bg-page cursor-pointer rounded-lg px-3 py-2 text-[13px] transition outline-none"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
