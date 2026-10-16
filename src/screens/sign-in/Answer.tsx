import { Ban, Clock, FileQuestionMark, Lock, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import type { Answer } from '../../auth/access';
import { leaveThroughLogout, session, showAnswer, type HeldAnswer } from '../../auth/app';
import { SIGNED_OUT } from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import { useT } from '../../i18n/useT';
import { FocusedTitle } from './parts';

// A glyph in `muted` tells the four apart, so none is told by colour and none takes `neg`: nothing
// here is a mistake the reader made.
const GLYPH: Record<Answer, LucideIcon> = {
  pending: Clock,
  rejected: Ban,
  noApplication: FileQuestionMark,
  forbidden: Lock,
};

/** What a signed-in caller sees when the API refuses them. Each way out it offers is a sign-out,
 *  never a sign-in, which would succeed and change nothing. */
export function AnswerScreen({ held }: { held: HeldAnswer }) {
  const t = useT();
  const navigate = useNavigate();
  const { key: route } = useLocation();
  const [leaving, setLeaving] = useState<string>();
  // The route the redirect to Cognito's logout set out from, while `leaving` holds for it.
  const [leftFrom, setLeftFrom] = useState<string>();
  const copy = t.auth[held.answer];
  const Glyph = GLYPH[held.answer];
  // `forbidden` names nobody: its causes include an address the rule refused.
  const email = held.answer === 'forbidden' ? undefined : held.email;

  // The route at the redirect, not the press's render, which a move mid-run makes stale. Set at
  // commit: a passive effect can trail a transition's commit past the relay's answer.
  const here = useRef(route);
  useLayoutEffect(() => {
    here.current = route;
  }, [route]);

  // A Stop while the logout loads leaves the page here, the session ended: the next route change
  // drops the answer (`account-way-in-and-out.dc.html`, T4), before paint.
  useLayoutEffect(() => {
    if (leftFrom !== undefined && leftFrom !== route) showAnswer(undefined);
  }, [leftFrom, route]);

  // Back from Cognito's logout can restore this page from the back/forward cache, `leaving` and all.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setLeftFrom(undefined);
        setLeaving(undefined);
      }
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, []);

  // Only the sign-out that lands on `/sign-in` hands it the fact; `/apply` is about applying.
  async function leave(to: '/sign-in' | '/apply', state?: typeof SIGNED_OUT) {
    if (leaving) return;
    setLeaving(to);
    // Not revoked keeps both cookies for a retry, so the answer stays and the button comes back.
    const out = await session.signOut();
    if (!out) {
      setLeaving(undefined);
      return;
    }
    // Through Cognito's logout while Google is on, landing on `to` itself; the page goes, or the
    // next route change finds it still here.
    if (leaveThroughLogout(out.logout, to)) {
      setLeftFrom(here.current);
      return;
    }
    // The router commits in a transition and the store at once: cleared first, the route that asked
    // would render in the answer's place for a frame and run its effects signed out.
    await navigate(to, { flushSync: true, state });
    showAnswer(undefined);
  }

  return (
    <SignedOutShell>
      <div
        key={held.answer}
        className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1"
      >
        <Glyph aria-hidden className="mb-4 size-6 flex-none text-muted" strokeWidth={2} />
        <FocusedTitle>{copy.title}</FocusedTitle>
        <p className={`${email ? 'mb-4' : 'mb-[22px]'} text-[13px] leading-[19.5px] text-muted`}>
          {copy.lead}
        </p>
        {email && (
          <p className="mb-[22px] text-[13px] leading-[19.5px] break-words text-muted">
            {t.auth.signedInAs(email)}
          </p>
        )}
        <div className="flex flex-col gap-[10px]">
          {held.answer === 'noApplication' && (
            <Button
              className="w-full"
              disabled={leaving === '/apply'}
              disabledTone="busy"
              onClick={() => void leave('/apply')}
            >
              {t.auth.noApplication.apply}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full"
            disabled={leaving === '/sign-in'}
            disabledTone="busy"
            onClick={() => void leave('/sign-in', SIGNED_OUT)}
          >
            {t.auth.signOut}
          </Button>
        </div>
      </div>
    </SignedOutShell>
  );
}
