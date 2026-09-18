import { Switch as RadixSwitch } from 'radix-ui';

import { TAP_44 } from './tap-target';

// The app's one switch anatomy. The drawings show the OFF fill as `hairline` and
// its edge as `panel-border`; both moved onto the switch tokens because that
// state read under 3 : 1 (*Design pipeline*, then #87).
//
// BOTH RADII ARE PROPORTIONAL AND DERIVED INDEPENDENTLY — round(22 × .26) = 6
// and round(16 × .26) = 4, never concentric. The thumb sits 3px in (2px padding
// + the 1px border), so a concentric reading would give the track 4 + 3 = 7 and
// be wrong: only a SEGMENTED control's track is concentric with its segment, and
// a switch is not one. *Shape system*
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
      // 40 × 22 drawn, 44 × 44 pressable below the breakpoint. The two radii
      // above are keyed to the DRAWN height, so growing the box would move them
      // both — which is exactly what `TAP_44` exists to avoid.
      className={`h-[22px] w-10 flex-none cursor-pointer rounded-[6px] border p-[2px] transition active:scale-[.97] ${TAP_44} ${
        checked ? 'border-ink bg-ink' : 'border-switch-border bg-switch-track'
      }`}
    >
      {/* ONE KNOB COLOUR IN BOTH STATES, and `--shadow-thumb` unconditionally
          with it: a knob that changes colour with the state makes the state look
          like two different controls. */}
      <RadixSwitch.Thumb
        className={`block size-4 rounded-[4px] bg-card shadow-(--shadow-thumb) transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </RadixSwitch.Root>
  );
}
