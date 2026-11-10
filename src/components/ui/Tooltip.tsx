import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/**
 * The first floating surface the app opens on hover
 * (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md` § Signed).
 * THE STROKE IS NOT DECORATION: the dark block zeroes `--shadow-popover`, and the
 * fill barely steps off the wall, so in dark the stroke is the whole of its
 * boundary. Its radius is 8, as the derived table gives it.
 *
 * PORTALLED, which is not a default worth losing: the rail's `<aside>` is
 * `overflow-hidden` so it can animate its width, and a tooltip clipped by the
 * wall it labels would be worse than none.
 *
 * IT DOES NOT NAME ANYTHING. Radix puts `aria-describedby` on the trigger and
 * `role="tooltip"` on the content, so a control whose only text is a tooltip has
 * NO accessible name — a screen reader says "link". The caller carries
 * `aria-label` itself and passes the same string here, or a part of it, as the
 * profile's address is of «Профіль: <address>», WHICH IS WHY THE TEXT IS
 * WRAPPED IN AN `aria-hidden` SPAN: left bare the description repeats the
 * name. Accessible-name computation includes a node referenced by `aria-describedby` even when hidden, but skips its
 * `aria-hidden` descendants, so the reference resolves to nothing.
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
          // 16 from the item, which lands the tooltip clear of the shell's own edge
          // (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md`
          // § Settled by the brief).
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
 * Mounted once around the rail rather than in `main.tsx`: `skipDelayDuration`
 * stops a pointer moving down the items from re-paying the open delay at every
 * one, and it groups only within a single provider. A second consumer elsewhere
 * brings its own.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}
