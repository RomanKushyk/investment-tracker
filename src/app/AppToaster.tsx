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
          unlayered, which beats any layered utility, so the toast takes inline styles and the
          close button, which takes no style object, takes `!` classes. */}
      <Toaster
        // BELOW 600px sonner swaps to this offset — its own breakpoint, not the app's.
        // The bottom pays back `env(safe-area-inset-bottom)` whenever that is larger, so
        // the toast never sits under the home indicator now that `viewport-fit=cover`
        // extends the page there.
        //
        // THE BOTTOM IS A `max()`: a toast raised by `Save snapshot` was painted straight
        // over the sticky action bar that raised it, so the one control you reach for next
        // sat under it for the toast's whole life. `/` publishes the bar's measured height
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
        // AND THE SAME FLOOR ON THE DESKTOP OFFSET, because the two breakpoints do not
        // line up: sonner swaps to `mobileOffset` below 600 and the app swaps to the
        // mobile shell below `md`. In the band between them the action bar is on screen
        // while sonner is still using this offset, so fixing only the mobile one leaves
        // the defect alive exactly where a small laptop window lands. The other three
        // sides are omitted on purpose: sonner fills a missing key with its own default,
        // so naming them would only be a chance to disagree with it later.
        offset={{
          bottom:
            'max(24px, calc(var(--keyboard-inset, 0px) + var(--action-bar-h, 0px) + 14px), calc(var(--drawer-band-h, 0px) + 14px))',
        }}
        // THE TOASTER TAKES ITS OWN PRESSES: an open dialog sets `pointer-events: none` on the
        // body and the toast inherits it, so a press on a toast reached whatever lay beneath.
        // No modal dialog closes for such a press (`keepOpenForToasts`).
        style={{ pointerEvents: 'auto' }}
        toastOptions={{
          closeButtonAriaLabel: t.toast.close,
          // Sonner draws it as a 20px circle astride the corner; the drawing puts it INSIDE the
          // trailing edge at 28, r7, so its 44 overlay stays on the toast. `!` because sonner's
          // CSS is unlayered, which beats any layered utility, and it takes no style object.
          classNames: {
            closeButton: `!relative !top-auto !right-auto !left-auto !order-last !ml-auto !size-7 !shrink-0 !transform-none !rounded-[7px] !border-field-border !bg-card !text-ink !transition hover:opacity-85 active:scale-[.97] ${TAP_44}`,
          },
          style: {
            borderRadius: '13px',
            fontFamily: 'var(--font-body)',
            // Same token as the popovers, so the toast loses its shadow in dark with
            // everything else rather than keeping a lone halo.
            boxShadow: 'var(--shadow-popover)',
            // sonner paints from its own `theme` prop, which defaults to light, so in the
            // dark app the toast was the one surface that never turned. Painting it from the
            // palette makes it follow the theme through the same tokens as everything else,
            // with no second source of truth for which theme is on.
            background: 'var(--color-card)',
            color: 'var(--color-ink)',
            // The palette's control-boundary rank: sonner's default and the `panel-border`
            // that replaced it both left this `card`-on-`page` surface under 1.4.11.
            border: '1px solid var(--color-field-border)',
          },
        }}
      />
    </>
  );
}
