import { ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import type { ReactNode } from 'react';

import { TAP_44 } from './tap-target';

// Styled to match the app's field shape — the `rounded-[9px]` recipe and the
// `field-border` edge. Generic string-value select; Controller-friendly.
// `bg` is an explicit variant (not a className override) so callers can't end
// up with two same-property utilities fighting over generated-CSS order.
// `borderColor` was a second variant until field-border.dc.html collapsed its
// two arms onto one token: a prop with one behaviour and two spellings is not
// a variant.
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
  invalid = false,
  bg = 'white',
  onOpenChange,
  status,
  scrollList = false,
  id,
  ariaLabelledBy,
  ariaDescribedBy,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  /**
   * The form-error idiom, the same one the inputs take: border `neg` plus
   * `aria-invalid`. A select had no way to say it was the field at fault, so a
   * form-level "check the highlighted fields" could name nothing (A47 review).
   */
  invalid?: boolean;
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
  /**
   * Accessible naming for a Select whose only visible label is the value it
   * displays — a picker in a header row has no `<label>` to point at (A38).
   *
   * `aria-labelledby`, NEVER `aria-label`, and the difference is the whole
   * point (A38 review). A trigger's accessible name is computed from its
   * CONTENTS, which here is the selected value; `aria-label` replaces that, so
   * the control announces its purpose and never what it is set to. Pass BOTH
   * ids — the hidden label's and the trigger's own — and the name is the
   * concatenation: "Період Від початку".
   */
  id?: string;
  ariaLabelledBy?: string;
  /** The element that explains the current selection — e.g. a resolved window. */
  ariaDescribedBy?: string;
}) {
  const borderClass = invalid ? 'border-neg' : 'border-field-border hover:border-ink';
  // `card`, not the literal white it replaces: a control surface has to invert
  // with the theme, and #ffffff cannot. The two are the same colour in light.
  const bgClass = bg === 'page' ? 'bg-page' : 'bg-card';
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} onOpenChange={onOpenChange}>
      <RadixSelect.Trigger
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        // `max-md:text-base` for the same reason the fields take 16 (G-4): this
        // trigger DISPLAYS a value, and a select reading 13px beside an input
        // reading 16 is the pair looking mismatched on the one screen where the
        // difference shows. It is a button, so it never triggers the iOS zoom
        // itself — this is the drawing's 16px, not the workaround.
        className={`${borderClass} flex h-9 w-full items-center justify-between gap-2 rounded-[9px] border font-body text-ink ${bgClass} px-3 text-[13px] transition active:scale-[.97] max-md:text-base ${TAP_44} ${className}`}
      >
        {/* THE VALUE TRUNCATES, and it has to. `Дивіденди + капіталізація` is
            25 characters; in the asset form's two-column row at 360 the trigger
            is ~135px, so the label ran outside the field's own border on both
            sides — wrapped to two lines inside a 36px box, with no rounded edge
            around it. `min-w-0` is the half that does the work: a flex item's
            floor is its content, so `truncate` alone cannot shrink it. */}
        <span className="min-w-0 truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
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
          className="z-50 animate-in overflow-hidden rounded-[14px] border border-hairline bg-card shadow-(--shadow-popover) duration-200 zoom-in-95 fade-in"
          style={{ width: 'var(--radix-select-trigger-width)' }}
        >
          <RadixSelect.Viewport className={scrollList ? 'max-h-60 overflow-y-auto p-1' : 'p-1'}>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                // `py-3` below the breakpoint takes the row from 35.5 to 43.5
                // — a list row's drawn box IS its highlight fill, so growing it
                // is the honest way here rather than an overlay that would make
                // adjacent rows fight over 9px of shared area. Its radius is
                // CONCENTRIC (14 − 5), not proportional, so the height does not
                // move it.
                className="cursor-pointer rounded-[9px] px-3 py-2 text-[13px] transition outline-none data-[highlighted]:bg-page max-md:py-3"
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
