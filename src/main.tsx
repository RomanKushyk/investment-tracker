// Cyrillic-capable, which is the first thing asked of either face: Ukrainian is
// the default language, so a face without it drops the whole app into a system
// fallback (*Language, numbers, fonts*). Each stylesheet below is the aggregate
// for its weight, every `@font-face` behind its own `unicode-range`, so the
// browser fetches Cyrillic only for the pages that use it. 500 stays although
// every display site asks for 600 or 700: it is the face an unweighted element
// would match, and an unfetched declaration costs a reader nothing.
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';

import { publishKeyboardInset } from './app/keyboard-inset';
import { ensureSeeded } from './lib/repository';
import { router } from './routes';

const queryClient = new QueryClient();

// Before the first render, and outside it: `--keyboard-inset` is read by CSS on
// three surfaces and written by nothing else (app/keyboard-inset.ts).
publishKeyboardInset();

void ensureSeeded().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* Every value below is set here rather than in CSS, because sonner styles by
            attribute (`[data-sonner-toast][data-styled=true]`), which outranks a class —
            an inline style is the one thing that reliably wins. */}
        <Toaster
          // BELOW 600px sonner swaps to this offset — its own breakpoint, not the app's.
          // The bottom pays back `env(safe-area-inset-bottom)` whenever that is larger, so
          // the toast never sits under the home indicator now that `viewport-fit=cover`
          // extends the page there.
          //
          // THE BOTTOM IS A `max()` OF THREE: a toast raised by `Save snapshot` was
          // painted straight over the sticky action bar that raised it, so the one control
          // you reach for next sat under it for the toast's whole life. `/` publishes the
          // bar's measured height while it is up, and `--keyboard-inset` is the strip iOS
          // gives the keyboard without shrinking the layout viewport.
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
              'max(14px, env(safe-area-inset-bottom), calc(var(--keyboard-inset, 0px) + var(--action-bar-h, 0px) + 14px))',
          }}
          // AND THE SAME FLOOR ON THE DESKTOP OFFSET, because the two breakpoints do not
          // line up: sonner swaps to `mobileOffset` below 600 and the app swaps to the
          // mobile shell below `md`. In the band between them the action bar is on screen
          // while sonner is still using this offset, so fixing only the mobile one leaves
          // the defect alive exactly where a small laptop window lands. The other three
          // sides are omitted on purpose: sonner fills a missing key with its own default,
          // so naming them would only be a chance to disagree with it later.
          offset={{
            bottom: 'max(24px, calc(var(--keyboard-inset, 0px) + var(--action-bar-h, 0px) + 14px))',
          }}
          toastOptions={{
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
      </QueryClientProvider>
    </StrictMode>,
  );
});
