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
import { useSelfXssWarning } from './useSelfXssWarning';

/** Where Cognito sends Google's code: a status, no form, while the relay redeems it, then `/` or
 *  `/sign-in` saying so, this entry replaced; a re-authentication lands on `/profile` either way. */
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
      } else if (signedIn) void navigate('/', { replace: true });
      else void navigate('/sign-in', { replace: true, state: GOOGLE_FAILED });
    });
    return () => {
      current = false;
    };
  }, [search, navigate, again]);

  return again ? <Confirming /> : <SigningIn />;
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

/** `account-way-in-and-out.dc.html` T5: no form a second sign-in could race the redeem from. The
 *  heading takes focus, so the card is announced once; it enters with a step's own fade. */
function SigningIn() {
  const t = useT();
  useSelfXssWarning(true);
  return (
    <SignedOutShell>
      <div className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1">
        <FocusedTitle>{t.auth.signingIn}</FocusedTitle>
        <p className="text-[13px] leading-[19.5px] text-muted">{t.auth.google.completing}</p>
      </div>
    </SignedOutShell>
  );
}
