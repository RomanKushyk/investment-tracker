// The portfolio does not outlive its account on a shared browser (*Auth model*). Nothing persists the
// view: the figures live in the query cache, the tag in the repository, and the quote draft in the
// browser's storage, which OWASP says to assume gives no confidentiality.
import type { QueryClient } from '@tanstack/react-query';

import type { Session } from '../auth/session';
import { DRAFT_SAVE_KEY, quotesUnsaved, useDraft } from '../state/draft';
import { useSettings } from '../state/settings';
import { takeUnsaved } from '../state/unsaved';

/** Every figure held in memory, the tag a write goes under, a settings change not yet sent, and the
 *  draft with its stored keys. */
export function forgetAccount(client: QueryClient, repo: { forget(): void }): void {
  // Before the reset, which unmounts the screens and their unsaved work with them. The quote draft
  // outlives `/`; a save of it in flight may already have landed, so the draft is compared with it.
  const draft = useDraft.getState();
  const sent = client
    .getMutationCache()
    .findAll({ mutationKey: DRAFT_SAVE_KEY, status: 'pending' })
    .map((m) => m.state.variables as { date: string; quotes: Record<string, number> })
    .filter((v) => v.date === draft.date)
    .at(-1);
  takeUnsaved(
    quotesUnsaved(
      draft.quotes,
      draft.baseline.ids,
      sent?.quotes ?? draft.baseline.recorded,
      useSettings.getState().language,
    ),
  );
  // Then: the reset starts the screens' reads at once, and they are the next account's.
  repo.forget();
  // Reset, not clear: a query removed from the cache leaves its mounted observers on its last
  // state, so its figures stay on screen and a read in flight never settles. A reset tells them.
  void client.resetQueries();
  client.getMutationCache().clear();
  useDraft.getState().setDate('');
  useDraft.persist.clearStorage();
}

/** Calls `forget` once for each sign-out the relay has answered, and once for each time the cookie
 *  another tab replaced made the session answer for another account. A load that went unanswered
 *  says nothing of the account, and a draft is not dropped for a network that was down. */
export function forgetOnAccountEnd(
  session: Pick<Session, 'subscribe' | 'status' | 'unanswered' | 'accountChanges'>,
  forget: () => void,
): () => void {
  const signedOut = () => session.status() === 'signedOut' && !session.unanswered();
  let was = signedOut();
  let changes = session.accountChanges();
  return session.subscribe(() => {
    const now = signedOut();
    const moved = session.accountChanges() !== changes;
    changes = session.accountChanges();
    if ((now && !was) || moved) forget();
    was = now;
  });
}
