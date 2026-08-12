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
        <Toaster />
      </QueryClientProvider>
    </StrictMode>,
  );
});
