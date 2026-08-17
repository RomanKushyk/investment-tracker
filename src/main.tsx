// Cyrillic-capable, and that is why they are these two. Space Grotesk and
// Spline Sans Mono carry 1 of the 67 characters Ukrainian needs — the one being
// the apostrophe — so making Ukrainian the default language (D54) dropped the
// whole app into a system fallback. Each fontsource stylesheet below declares
// every subset behind its own `unicode-range`, so the browser fetches Cyrillic
// only for the pages that use it.
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
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

import { ensureSeeded } from './lib/repository';
import { router } from './routes';

const queryClient = new QueryClient();

void ensureSeeded().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* sonner ships its own look and we had never overridden it, so every
            toast in the app was drawn outside the design system: radius 8, a
            `ui-sans-serif` system stack, and a pure-black shadow. All three are
            set here rather than in CSS because sonner styles by attribute
            (`[data-sonner-toast][data-styled=true]`), which outranks a class —
            an inline style is the one thing that reliably wins.
            Radius 13 is the rule on the toast's measured 51.5px height, the
            same value the sidebar's currency toggle lands on. */}
        <Toaster
          // BELOW 600px sonner swaps to this offset instead of its 24px default
          // (its own breakpoint, not the app's — sonner owns its layout). 12 a
          // side is the drawing's. The bottom is `max(14px, env(...))` — 14 and
          // not 12, because a toast is the one surface with nothing below it to
          // borrow from — and it pays back `env(safe-area-inset-bottom)` whenever
          // that is larger, so it never sits under the home indicator now that
          // `viewport-fit=cover` extends the page there.
          // The position stays sonner's default, bottom-right: at these widths
          // the two offsets make it span the width anyway, and moving it would
          // change the desktop app for no reason.
          mobileOffset={{
            left: '12px',
            right: '12px',
            bottom: 'max(14px, env(safe-area-inset-bottom))',
          }}
          toastOptions={{
            style: {
              borderRadius: '13px',
              fontFamily: 'var(--font-body)',
              // Same token as the popovers, so the toast loses its shadow in
              // dark with everything else rather than keeping a lone halo.
              boxShadow: 'var(--shadow-popover)',
              // sonner paints from its own `theme` prop, which defaults to
              // light — so in the dark app it drew a #ffffff card with an
              // #ededed edge, the one surface that never turned. Painting it
              // from the palette instead makes it follow the theme through the
              // same tokens as everything else, with no second source of truth
              // for which theme is on. `panel-border` is also the edge the dark
              // theme needs once --shadow-popover is zeroed.
              background: 'var(--color-card)',
              color: 'var(--color-ink)',
              // `panel-border`, not `surface-edge`: the toast HAD an edge in
              // light already (sonner's own #ededed), so the light value must
              // stay visible — and surface-edge is transparent there by
              // definition, for surfaces that carry a shadow instead.
              border: '1px solid var(--color-panel-border)',
            },
          }}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
});
