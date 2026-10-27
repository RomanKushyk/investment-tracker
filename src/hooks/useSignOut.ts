import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { accountRows } from '../app/account-rows';
import {
  hasAuthEnvironment,
  leaveThroughLogout,
  session,
  useSessionSigningOut,
  useSessionStatus,
  useSessionUnanswered,
} from '../auth/app';
import { SIGNED_OUT } from '../auth/signed-out';
import { useT } from '../i18n/useT';

// A NEW ID PER FAILURE: sonner folds a toast into one still leaving under the same id, so a retry
// that failed as fast as the dismissal would show nothing.
let failures = 0;
const failedId = (n: number) => `sign-out-failed-${n}`;

// THE WAY OUT THROUGH COGNITO'S LOGOUT IS THE PAGE'S: the route it set out from, so a control mounted
// meanwhile, as by a collapse to the rail, is busy too.
let setOutFrom: string | undefined;
// The route the mounted controls last committed; the pressed one may be gone by the relay's answer.
let here: string | undefined;
const hearing = new Set<() => void>();
const hear = (listener: () => void) => {
  hearing.add(listener);
  return () => void hearing.delete(listener);
};

// Still here after a back/forward-cache restore, a Stop (`navigateerror`, which a route change fires
// too) or a traversal no control saw (`account-way-in-and-out.dc.html`, T4).
const restored = (event: PageTransitionEvent) => {
  if (event.persisted) setOut(undefined);
};
const stayed = () => setOut(undefined);

// THE LOAD OUTLIVES THE LATCH: a route change ends the latch, not the logout, which a traversal would
// cancel. A Stop fires `navigateerror` alone; a push, or a load replacing the logout, then its own
// `navigate`.
let departing = false;
let followed = false;
const departs = new Set<() => void>();
const navigated = () => {
  followed = true;
};
const halted = () => {
  followed = false;
  queueMicrotask(() => {
    if (!followed) depart(false);
  });
};
const arrived = (event: PageTransitionEvent) => {
  if (event.persisted) depart(false);
};
const traversed = () => depart(false);

function depart(next: boolean) {
  if (next === departing) return;
  departing = next;
  const navigation = (globalThis as { navigation?: EventTarget }).navigation;
  if (next) {
    addEventListener('pageshow', arrived);
    addEventListener('popstate', traversed);
    navigation?.addEventListener('navigateerror', halted);
    navigation?.addEventListener('navigate', navigated);
  } else {
    removeEventListener('pageshow', arrived);
    removeEventListener('popstate', traversed);
    navigation?.removeEventListener('navigateerror', halted);
    navigation?.removeEventListener('navigate', navigated);
  }
  for (const listener of departs) listener();
}

/** Whether the page is on its way out through Cognito's logout, which a history act would cancel or
 *  read as a Stop; the drawer makes none meanwhile. */
export const pageLeaving = () => departing;
export const subscribeToLeaving = (listener: () => void) => {
  departs.add(listener);
  return () => void departs.delete(listener);
};

function setOut(from: string | undefined) {
  if (from === setOutFrom) return;
  setOutFrom = from;
  const navigation = (globalThis as { navigation?: EventTarget }).navigation;
  if (from === undefined) {
    removeEventListener('pageshow', restored);
    removeEventListener('popstate', stayed);
    navigation?.removeEventListener('navigateerror', stayed);
  } else {
    addEventListener('pageshow', restored);
    addEventListener('popstate', stayed);
    navigation?.addEventListener('navigateerror', stayed);
  }
  for (const listener of hearing) listener();
}

/** Every «Вийти» is busy while a sign-out runs and while its page leaves, and a failure's one toast
 *  makes each the retry; `rows` is what the footer band draws. */
export function useSignOut() {
  const t = useT();
  const navigate = useNavigate();
  const { key: route } = useLocation();
  const status = useSessionStatus();
  const unanswered = useSessionUnanswered();
  const running = useSessionSigningOut();
  const [leaving, setLeaving] = useState(false);
  const latch = useSyncExternalStore(hear, () => setOutFrom);
  const busy = leaving || running || latch === route;

  // Set at commit, not in a passive effect, which can trail a transition's commit past the answer.
  useLayoutEffect(() => {
    here = route;
  }, [route]);

  // A route change finds the page still here, and forgets the route, so Back re-latches nothing.
  useLayoutEffect(() => {
    if (latch !== undefined && latch !== route) setOut(undefined);
  }, [latch, route]);

  async function leave() {
    // The stores read now, not the last render's: a press joins no sign-out and no way out.
    if (leaving || session.signingOut() || setOutFrom !== undefined) return;
    setLeaving(true);
    toast.dismiss(failedId(failures));
    const out = await session.signOut();
    if (!out) {
      setLeaving(false);
      toast.error(t.auth.signOutFailed, {
        id: failedId(++failures),
        duration: Infinity,
        closeButton: true,
      });
      return;
    }
    // Through Cognito's logout while Google is on; the latch holds every control's rows until the
    // page goes, or is found still here.
    if (leaveThroughLogout(out.logout, '/sign-in')) {
      depart(true);
      setOut(here);
      setLeaving(false);
      return;
    }
    // The session is signed out already; `leaving` keeps the rows up while the page leaves, and
    // `flushSync` commits that change at once rather than in a transition. `/sign-in` says so.
    await navigate('/sign-in', { flushSync: true, state: SIGNED_OUT });
    // Still mounted only where something held the way out: the page stays, signed out.
    setLeaving(false);
  }

  return { rows: accountRows(status, busy, unanswered, hasAuthEnvironment), leaving: busy, leave };
}
