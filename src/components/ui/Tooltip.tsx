import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/**
 * The seventh Radix primitive, and the first floating surface the app opens on
 * hover. `design/extensions/parchment-sidebar.dc.html:84` and `:390` draw it:
 * `card` fill, a 1px `field-border` stroke, `ink` at 12px/500, padding 6/10,
 * `nowrap`, and `--shadow-popover` — which the dark block zeroes, so in dark the
 * stroke is the whole of its boundary. Its fill steps only 1.19 / 1.10 off the
 * wall, which is why the stroke is not decoration.
 *
 * RADIUS 8, NOT THE 7 THE `.tip` RULE DECLARES. The drawing contradicts itself
 * and settles it in its own precedence note: where a drawn literal and the
 * derived table disagree about a radius, the derivation wins — `round(32.59 ×
 * 0.26) = 8` off the tooltip's rendered short side.
 *
 * PORTALLED, and that is not a default worth losing: the rail's `<aside>` is
 * `overflow-hidden` so it can animate its width, and a tooltip clipped by the
 * wall it labels would be worse than none.
 *
 * IT DOES NOT NAME ANYTHING. Radix puts `aria-describedby` on the trigger and
 * `role="tooltip"` on the content, so a control whose only text is a tooltip has
 * NO accessible name — a screen reader says "link". The caller therefore carries
 * `aria-label` itself and passes the same string here; the label is the name and
 * the tooltip is the sighted-pointer affordance.
 *
 * WHICH IS WHY THE TEXT IS WRAPPED IN AN `aria-hidden` SPAN. Left bare, the
 * description Radix wires equals the name, and the item announces its label
 * twice. Accessible-name computation includes a node referenced directly by
 * `aria-describedby` even when hidden, but skips its `aria-hidden` descendants
 * — so the reference resolves to nothing and the name stands alone. The
 * duplicate is deliberate at the caller and cancelled here, in one place.
 *
 * ONE PLAIN CLASS STRING, deliberately: `floating-edges.test.ts` enrols every
 * line wearing `shadow-(--shadow-popover)` and then asserts `border-field-border`
 * on that same line and no `${…}` anywhere in it.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          // 16 from the item — the drawing's `left:56px`, measured off a 40px
          // item — which lands the tooltip 8 clear of the shell's own 56px edge.
          side="right"
          sideOffset={16}
          className="z-50 animate-in rounded-[8px] border border-field-border bg-card px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap text-ink shadow-(--shadow-popover) duration-150 zoom-in-95 fade-in"
        >
          <span aria-hidden>{label}</span>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/**
 * Mounted once around the rail rather than in `main.tsx`. `skipDelayDuration` is
 * what stops a pointer moving down eleven items from re-paying the open delay at
 * every one, and it only groups within a single provider — which is exactly the
 * rail. A second consumer elsewhere brings its own.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}
