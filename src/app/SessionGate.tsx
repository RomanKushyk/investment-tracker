import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import {
  hasAuthEnvironment,
  session,
  useSessionSigningOut,
  useSessionStatus,
  useSessionUnanswered,
} from '../auth/app';
import { sentToSignIn } from '../auth/return-to';
import { pageLeaving, subscribeToLeaving } from '../hooks/useSignOut';

/** Above the portfolio shell: nothing until the relay answers, then the shell, or `/sign-in` in this
 *  entry's place once it says nobody is signed in (*Two shells, one breakpoint*). */
export function SessionGate() {
  const { pathname, search, hash } = useLocation();
  const status = useSessionStatus();
  const unanswered = useSessionUnanswered();
  const signingOut = useSessionSigningOut();
  const leaving = useSyncExternalStore(subscribeToLeaving, pageLeaving);
  // A SIGN-OUT BEGUN UNDER THIS SHELL LANDS ITSELF, with its own line, whatever route it is on by
  // then; a Stop on Cognito's logout leaves its page standing. A shell mounted after one redirects.
  const [begun] = useState(() => session.signOuts());

  // Asked on every load, the session being the browser's, and again on each route until the relay
  // answers: once it has, `restore` asks nothing.
  useEffect(() => {
    void session.restore();
  }, [pathname]);

  const ended = status === 'signedOut' && session.ended();
  const from = `${pathname}${search}${hash}`;
  const state = useMemo(() => sentToSignIn(from, ended), [from, ended]);

  if (!hasAuthEnvironment) return <Outlet />;
  if (status === 'unknown') return null;
  const away =
    status === 'signedOut' &&
    !unanswered &&
    !signingOut &&
    !leaving &&
    (ended || session.signOuts() === begun);
  return away ? <Navigate to="/sign-in" replace state={state} /> : <Outlet />;
}
