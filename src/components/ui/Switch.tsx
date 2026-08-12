import { Switch as RadixSwitch } from 'radix-ui';

// The app's one switch anatomy (P2 asset-form.dc.html "Link to Inzhur" toggle,
// reused verbatim by the P3 Settings→Automation rows, automation.dc.html S8):
// track 40 × 22 radius 999 — off `hairline` fill + `panel-border` edge, on
// `ink`; 16px `card` thumb with the card shadow.
// D7: thumb transform + track colour 220ms soft (the `transition` default),
// press scale .97; the global prefers-reduced-motion kill-switch collapses both.
export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  /** Accessible name — switches never carry a visible label of their own. */
  label: string;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={`h-[22px] w-10 flex-none cursor-pointer rounded-[6px] border p-[2px] transition active:scale-[.97] ${
        checked ? 'border-ink bg-ink' : 'border-panel-border bg-hairline'
      }`}
    >
      <RadixSwitch.Thumb
        className={`bg-card block size-4 rounded-[4px] shadow-[0_1px_3px_rgba(38,38,42,.06)] transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </RadixSwitch.Root>
  );
}
