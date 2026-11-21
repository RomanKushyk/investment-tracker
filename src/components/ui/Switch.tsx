import { Check } from 'lucide-react';
import { Switch as RadixSwitch } from 'radix-ui';

import { TAP_44 } from './tap-target';

// The app's one switch anatomy (controls.md § Signed, S2 with D2's knob): on, an `accent` track
// with a check in the knob, so the state is never colour alone; off, the glass well. The knob is
// the tinted glass knob in both states.
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
  disabled = false,
  busy = false,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  /** Accessible name — switches never carry a visible label of their own. */
  label: string;
  disabled?: boolean;
  /** Pending: refuses a press like `disabled`, but reads 70 % — it is not one you may never press. */
  busy?: boolean;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled || busy}
      aria-label={label}
      // 40 × 22 drawn, 44 × 44 pressable below the breakpoint. The two radii
      // above are keyed to the DRAWN height, so growing the box would move them
      // both — which is exactly what `TAP_44` exists to avoid.
      className={`h-[22px] w-10 flex-none rounded-[6px] border p-[2px] transition-control active:scale-[.97] disabled:pointer-events-none ${
        busy && !disabled ? 'disabled:opacity-70' : 'disabled:opacity-50'
      } ${TAP_44} ${checked ? 'border-accent switch-on' : 'border-field-border switch-well'}`}
    >
      <RadixSwitch.Thumb
        className={`flex size-4 items-center justify-center rounded-[4px] switch-knob transition-transform ease-soft ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      >
        <Check
          size={10}
          strokeWidth={3}
          aria-hidden
          className={`text-accent transition-opacity ${checked ? 'opacity-100' : 'opacity-0'}`}
        />
      </RadixSwitch.Thumb>
    </RadixSwitch.Root>
  );
}
