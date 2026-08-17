import { Switch as RadixSwitch } from 'radix-ui';

import { TAP_44 } from './tap-target';

// The app's one switch anatomy (P2 asset-form.dc.html "Link to Inzhur" toggle,
// reused verbatim by the P3 Settings→Automation rows, automation.dc.html S8):
// track 40 × 22 radius 6 — off `hairline` fill + `panel-border` edge, on
// `ink`; 16px `card` thumb, radius 4, with the card shadow.
// Both radii are D56 PROPORTIONAL and derived independently — round(22 × .26)
// = 6 and round(16 × .26) = 4 — not concentric. The thumb sits 3px in (2px
// padding + the 1px border), so a concentric reading would give 4 + 3 = 7 for
// the track and be wrong: only a SEGMENTED control's track is concentric with
// its segment, and a switch is not one.
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
      // 40 x 22 drawn, 44 x 44 pressable below the breakpoint (G-2). The two
      // radii above are keyed to the DRAWN height, so growing the box would move
      // them both — which is exactly what `TAP_44` exists to avoid.
      className={`h-[22px] w-10 flex-none cursor-pointer rounded-[6px] border p-[2px] transition active:scale-[.97] ${TAP_44} ${
        checked ? 'border-ink bg-ink' : 'border-panel-border bg-hairline'
      }`}
    >
      <RadixSwitch.Thumb
        className={`bg-card block size-4 rounded-[4px] shadow-(--shadow-thumb) transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </RadixSwitch.Root>
  );
}
