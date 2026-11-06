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
  reauthenticationFor,
} from '../../auth/google';
import { forgetReturn, returnedTarget } from '../../auth/return-to';
import { useT } from '../../i18n/useT';
import { FocusedTitle } from './parts';
import { useSelfXssWarning } from './useSelfXssWarning';

/** Where Cognito sends Google's code: a status while the relay redeems it, then the carried place
 *  (or `/`) or `/sign-in` saying so, entry replaced; a re-authentication lands on `/profile`. */
export function GoogleCallback() {
  const { search } = useLocation();
  const navigate = useNavigate();
  // Read, not taken, at mount: forgotten once the outcome lands, so a pasted callback is a sign-in's.
  const [again] = useState(() => reauthenticationFor(tabStorage()));
  // Read at mount, as the re-authentication is, and forgotten once the outcome lands.
  const [target] = useState(() => returnedTarget(tabStorage(), window.location.origin));

  useEffect(() => {
    let current = true;
    void completeGoogle(search, session).then((signedIn) => {
      if (!current) return;
      forgetReturn(tabStorage());
      if (again) {
        forgetReauthentication(tabStorage());
        const state = signedIn ? REAUTHENTICATED : REAUTHENTICATION_REFUSED;
        void navigate('/profile', { replace: true, state: { ...state, purpose: again } });
      } else if (signedIn) void navigate(target, { replace: true });
      // The place goes back with the refusal, for the next try from `/sign-in`.
      else void navigate('/sign-in', { replace: true, state: { ...GOOGLE_FAILED, from: target } });
    });
    return () => {
      current = false;
    };
  }, [search, navigate, again, target]);

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
