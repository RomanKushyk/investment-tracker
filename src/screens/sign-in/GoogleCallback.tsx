import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { session } from '../../auth/app';
import { GOOGLE_FAILED, completeGoogle } from '../../auth/google';
import { SignIn } from './SignIn';

/** Where Cognito sends Google's code: the card with Google busy while the relay redeems it, then
 *  `/` (SignIn's own redirect) or `/sign-in` saying so — this entry replaced, the code with it. */
export function GoogleCallback() {
  const { search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let current = true;
    void completeGoogle(search, session).then((signedIn) => {
      if (!signedIn && current) void navigate('/sign-in', { replace: true, state: GOOGLE_FAILED });
    });
    return () => {
      current = false;
    };
  }, [search, navigate]);

  return <SignIn completing />;
}
