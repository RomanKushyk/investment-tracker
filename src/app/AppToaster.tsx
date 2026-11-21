import { Toaster } from 'sonner';

import { TAP_44 } from '../components/ui/tap-target';
import { useT } from '../i18n/useT';

/** The app's one toaster, mounted beside the router by `main.tsx`. A component only so the close
 *  button can be named in the language on screen, which sonner takes nowhere but here. */
export function AppToaster() {
  const t = useT();
  return (
    <>
      {/* Every value below is set here rather than in the stylesheet: sonner injects its CSS
          unlayered, which beats any layered utility, so the toast takes inline styles and its
          parts take `!` classes. */}
      <Toaster
        // Sonner focuses its list on its hotkey and hides the list's outline; the halo goes too.
        className="focus-ring-none"
        // Sonner swaps to this offset at its own breakpoint, not the app's.
        // The bottom pays back `env(safe-area-inset-bottom)` whenever that is larger, so
        // the toast never sits under the home indicator where `viewport-fit=cover`
        // extends the page.
        //
        // THE BOTTOM IS A `max()`, so a toast never covers the sticky action bar that raised
        // it, the control reached for next. `/` publishes the bar's measured height
        // while it is up, and `--keyboard-inset` is the strip iOS gives the keyboard
        // without shrinking the layout viewport. The open drawer publishes its footer
        // band's, for the same reason: «Вийти» is the control reached for next.
        //
        // `max()` and NOT a sum, which is the part worth reading twice: summed, the two
        // safe-area terms double-count — the bar already pads itself past the home
        // indicator — so the toast would float further above it on exactly the devices
        // where the gap is already largest. As a max, each term is a floor and the
        // tallest wins.
        mobileOffset={{
          left: '12px',
          right: '12px',
          bottom:
            'max(14px, env(safe-area-inset-bottom), calc(var(--keyboard-inset, 0px) + var(--action-bar-h, 0px) + 14px), calc(var(--drawer-band-h, 0px) + 14px))',
        }}
        // AND THE SAME FLOOR ON THE DESKTOP OFFSET: sonner's breakpoint and the app's `md` do
        // not line up, and in the band between them the action bar is on screen while sonner
        // still uses this offset. The other three sides are omitted on purpose: sonner fills
        // a missing key with its own default.
        offset={{
          bottom:
            'max(24px, calc(var(--keyboard-inset, 0px) + var(--action-bar-h, 0px) + 14px), calc(var(--drawer-band-h, 0px) + 14px))',
        }}
        // THE TOASTER TAKES ITS OWN PRESSES: an open dialog sets `pointer-events: none` on the
        // body, which the toast would inherit, passing its presses to whatever lies beneath.
        // No modal dialog closes for such a press (`keepOpenForToasts`).
        style={{ pointerEvents: 'auto' }}
        toastOptions={{
          closeButtonAriaLabel: t.toast.close,
          // The close sits INSIDE the trailing edge, so its tap overlay stays on the toast
          // (`docs/superpowers/specs/2026-11-05-layout-refresh/notices-and-toasts.md` § Signed).
          // Sonner gives its buttons the hand; only a link shows it (*Interaction rules*).
          classNames: {
            closeButton: `!relative !top-auto !right-auto !left-auto !order-last !ml-auto !size-7 !shrink-0 !transform-none not-data-[disabled=true]:!cursor-default !rounded-[7px] !border-field-border !bg-card !text-ink !transition-control hover:!bg-card-hover active:scale-[.97] ${TAP_44}`,
            actionButton: '!cursor-default',
            cancelButton: '!cursor-default',
            // The body role, over sonner's own line heights.
            title: '!text-body',
            description: '!text-body',
          },
          style: {
            borderRadius: '13px',
            fontFamily: 'var(--font-sans)',
            // Same token as the popovers, so the toast loses its shadow in dark with
            // everything else rather than keeping a lone halo.
            boxShadow: 'var(--shadow-popover)',
            // sonner paints from its own `theme` prop, light by default; the palette makes the
            // toast follow the app's theme, with no second source of truth for which is on.
            background: 'var(--color-card)',
            color: 'var(--color-ink)',
            // The palette's control-boundary rank (WCAG 1.4.11).
            border: '1px solid var(--color-field-border)',
          },
        }}
      />
    </>
  );
}
