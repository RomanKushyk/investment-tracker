import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { accountRows } from '../app/account-rows';
import { session, useSessionStatus, useSessionUnanswered } from '../auth/app';
import { SIGNED_OUT } from '../auth/signed-out';
import { useT } from '../i18n/useT';

// A NEW ID PER FAILURE: sonner folds a toast into one still leaving under the same id, so a retry
// that failed as fast as the dismissal would show nothing.
let failures = 0;
const failedId = (n: number) => `sign-out-failed-${n}`;

/**
 * One press signs out. A sign-out the relay could not complete keeps both cookies, so the user is
 * still signed in: a toast that stays says so, and the control is the retry. After a success the
 * control stays busy until the route changes, as the answer screens' does. `rows` is what the
 * footer band draws for the account.
 */
export function useSignOut() {
  const t = useT();
  const navigate = useNavigate();
  const status = useSessionStatus();
  const unanswered = useSessionUnanswered();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    toast.dismiss(failedId(failures));
    if (!(await session.signOut())) {
      setLeaving(false);
      toast.error(t.auth.signOutFailed, {
        id: failedId(++failures),
        duration: Infinity,
        closeButton: true,
      });
      return;
    }
    // The session is signed out already; `leaving` keeps the rows up until the route changes, and
    // `flushSync` commits that change at once rather than in a transition. `/sign-in` says so.
    await navigate('/sign-in', { flushSync: true, state: SIGNED_OUT });
  }

  return { rows: accountRows(status, leaving, unanswered), leaving, leave };
}
