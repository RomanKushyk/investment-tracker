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

import { AppToaster } from './app/AppToaster';
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
        <AppToaster />
      </QueryClientProvider>
    </StrictMode>,
  );
});
