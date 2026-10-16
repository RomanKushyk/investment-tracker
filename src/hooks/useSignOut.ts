import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * Busy is the session's while a sign-out runs, so a «Вийти» mounted meanwhile is busy too; a failure
 * keeps the user signed in, so one toast says so and every control is the retry. After a success
 * the pressed control stays busy while the page leaves, and a page still here at the next route
 * change answers signed out. `rows` is what the footer band draws.
 */
export function useSignOut() {
  const t = useT();
  const navigate = useNavigate();
  const { key: route } = useLocation();
  const status = useSessionStatus();
  const unanswered = useSessionUnanswered();
  const running = useSessionSigningOut();
  const [leaving, setLeaving] = useState(false);
  // The route the redirect to Cognito's logout set out from, while `leaving` holds for it.
  const [leftFrom, setLeftFrom] = useState<string>();
  const busy = leaving || running;

  // The route at the redirect, not the press's render, which a move mid-run makes stale. Set at
  // commit: a passive effect can trail a transition's commit past the relay's answer.
  const here = useRef(route);
  useLayoutEffect(() => {
    here.current = route;
  }, [route]);

  // A Stop while the logout loads leaves the page here, latched: the next route change ends it
  // (`account-way-in-and-out.dc.html`, T4), and forgets the route, so Back re-latches nothing.
  if (leftFrom !== undefined && leftFrom !== route) {
    setLeftFrom(undefined);
    setLeaving(false);
  }

  // Back from Cognito's logout can restore this page from the back/forward cache, `leaving` and all.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setLeftFrom(undefined);
        setLeaving(false);
      }
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, []);

  async function leave() {
    // The store read now, not the last render's: a press never joins a running sign-out.
    if (leaving || session.signingOut()) return;
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
    // Through Cognito's logout while Google is on; `leaving` holds the rows until the page goes,
    // or the next route change finds it still here.
    if (leaveThroughLogout(out.logout, '/sign-in')) {
      setLeftFrom(here.current);
      return;
    }
    // The session is signed out already; `leaving` keeps the rows up while the page leaves, and
    // `flushSync` commits that change at once rather than in a transition. `/sign-in` says so.
    await navigate('/sign-in', { flushSync: true, state: SIGNED_OUT });
    // Still mounted only when unsaved work held the way out: the page stays, signed out.
    setLeaving(false);
  }

  return { rows: accountRows(status, busy, unanswered, hasAuthEnvironment), leaving: busy, leave };
}
