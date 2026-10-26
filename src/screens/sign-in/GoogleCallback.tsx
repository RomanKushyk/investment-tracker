import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { session, tabStorage } from '../../auth/app';
import {
  GOOGLE_FAILED,
  REAUTHENTICATED,
  REAUTHENTICATION_REFUSED,
  completeGoogle,
  forgetReauthentication,
  reauthenticating,
} from '../../auth/google';
import { useT } from '../../i18n/useT';
import { FocusedTitle } from './parts';
import { SignIn } from './SignIn';

/** Where Cognito sends Google's code: the card with Google busy while the relay redeems it, then
 *  `/` (SignIn's own redirect) or `/sign-in` saying so — this entry replaced, the code with it. A
 *  re-authentication this tab began holds its own card and lands on `/profile` either way. */
export function GoogleCallback() {
  const { search } = useLocation();
  const navigate = useNavigate();
  // Read, not taken, at mount: forgotten once the outcome lands, so a pasted callback is a sign-in's.
  const [again] = useState(() => reauthenticating(tabStorage()));

  useEffect(() => {
    let current = true;
    void completeGoogle(search, session).then((signedIn) => {
      if (!current) return;
      if (again) {
        forgetReauthentication(tabStorage());
        const state = signedIn ? REAUTHENTICATED : REAUTHENTICATION_REFUSED;
        void navigate('/profile', { replace: true, state });
      } else if (!signedIn) void navigate('/sign-in', { replace: true, state: GOOGLE_FAILED });
    });
    return () => {
      current = false;
    };
  }, [search, navigate, again]);

  return again ? <Confirming /> : <SignIn completing />;
}

/** `re-authentication.dc.html` T5: the tab is signed in, so the card is no sign-in's form. */
function Confirming() {
  const t = useT();
  return (
    <SignedOutShell>
      <FocusedTitle>{t.auth.signIn.checking}</FocusedTitle>
      <p className="text-[13px] leading-[19.5px] text-muted">{t.reauth.google.completing}</p>
    </SignedOutShell>
  );
}
