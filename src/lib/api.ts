// The app's one client of the user API, and the one query client its figures live in. Both are made
// here, with the session they act for, so that a sign-out reaches the cache and the tag by the same
// wire wherever it is begun (*Auth model*).
import { QueryClient } from '@tanstack/react-query';

import { session, showAnswer } from '../auth/app';
import { forgetAccount, forgetOnAccountEnd } from './account';
import { createRepository } from './repository';
import { createTransport } from './transport';

export const repo = createRepository(
  createTransport({
    hostname: location.hostname,
    // Looked up when called, so what a test or the page replaces on `globalThis` is what is used.
    fetch: (input, init) => fetch(input, init),
    session,
    showAnswer,
    derivationId: __DERIVATION_ID__,
  }),
);

export const queryClient = new QueryClient();

forgetOnAccountEnd(session, () => forgetAccount(queryClient, repo));
