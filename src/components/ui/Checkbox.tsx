import { Check } from 'lucide-react';

// The app's one checkbox (controls-and-overlays.md § Signed, K2). A native input with its look
// removed, so Space, the wrapping label and the announced state stay the platform's. The radius
// is the Shape system's round(16 × .26) = 4, not K2's r5.
export function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span className="relative mt-px flex size-4 flex-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className={`size-4 cursor-pointer appearance-none rounded-[4px] border transition-control active:scale-[.97] disabled:cursor-default ${
          checked ? 'border-accent bg-accent' : 'border-field-border bg-page'
        }`}
      />
      <Check
        size={10}
        strokeWidth={3.5}
        aria-hidden
        className={`pointer-events-none absolute inset-0 m-auto text-accent-fg transition-opacity ${
          checked ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </span>
  );
}
