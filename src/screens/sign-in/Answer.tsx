import { Ban, Clock, FileQuestionMark, Lock, ScrollText, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import type { Answer } from '../../auth/access';
import { leaveThroughLogout, session, showAnswer, type HeldAnswer } from '../../auth/app';
import { SIGNED_OUT } from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import { useAcceptTerms, type TermsOutcome } from '../../hooks/queries';
import type { Dict } from '../../i18n/messages';
import { rich } from '../../i18n/rich';
import { useT } from '../../i18n/useT';
import { FocusedTitle, NewTabLink, StepAlert } from './parts';

// A glyph in `muted` tells the five apart, so none is told by colour and none takes `neg`: nothing
// here is a mistake the reader made.
const GLYPH: Record<Answer, LucideIcon> = {
  pending: Clock,
  rejected: Ban,
  noApplication: FileQuestionMark,
  forbidden: Lock,
  terms: ScrollText,
};

type Refused = Exclude<TermsOutcome, 'accepted'>;

const sentence = (t: Dict, outcome: Refused) =>
  ({
    outdated: t.terms.step.outdated,
    throttled: t.auth.apply.busyServer,
    failed: t.terms.step.failed,
  })[outcome];

/** What a signed-in caller sees when the API refuses them. Each way out it offers is a sign-out,
 *  never a sign-in, which would succeed and change nothing. */
export function AnswerScreen({ held }: { held: HeldAnswer }) {
  const t = useT();
  const navigate = useNavigate();
  const acceptTerms = useAcceptTerms();
  const { key: route } = useLocation();
  const [leaving, setLeaving] = useState<string>();
  const [accepting, setAccepting] = useState(false);
  // A refusal, and a count that re-inserts its alert so a repeat is announced again.
  const [refused, setRefused] = useState<{ outcome: Refused; n: number }>();
  const refusals = useRef(0);
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
  // A session signed out by then drops the answer: "Signed in as" would misstate it.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (session.status() === 'signedOut') showAnswer(undefined);
      else {
        setLeftFrom(undefined);
        setLeaving(undefined);
      }
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, []);

  // Only the sign-out that lands on `/sign-in` hands it the fact; `/apply` is about applying.
  async function leave(to: '/sign-in' | '/apply', state?: typeof SIGNED_OUT) {
    if (leaving || accepting) return;
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

  async function accept() {
    if (leaving || accepting) return;
    setAccepting(true);
    const outcome = await acceptTerms();
    if (outcome !== 'accepted') {
      setAccepting(false);
      setRefused({ outcome, n: ++refusals.current });
      return;
    }
    showAnswer(undefined);
  }

  const newTab = (label: string, href: string, key: number) => (
    <NewTabLink key={key} label={label} href={href} />
  );
  const terms = held.answer === 'terms';

  // The sign-out above may still be running, and leaving would lose its outcome (*Legal documents*).
  return (
    <SignedOutShell notice="tab">
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
        {/* Acceptance by pressing the button it names, directly above it (*Legal documents*). */}
        {terms && (
          <p className="mb-2 text-[12px] leading-[18px] text-muted">
            {rich(t.terms.step.accept, newTab)}
          </p>
        )}
        <div className="flex flex-col gap-[10px]">
          {terms && (
            <Button
              className="w-full"
              disabled={accepting}
              disabledTone="busy"
              onClick={() => void accept()}
            >
              {accepting ? t.terms.step.busy : t.terms.step.submit}
            </Button>
          )}
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
            {terms ? t.terms.step.decline : t.auth.signOut}
          </Button>
        </div>
        {refused && <StepAlert n={refused.n}>{sentence(t, refused.outcome)}</StepAlert>}
        {/* The privacy first layer, a paragraph of its own apart from the terms' line (WP260 ¶8). */}
        {terms && (
          <p className="mt-3 text-[12px] leading-[18px] text-muted">
            {rich(t.terms.step.firstLayer, newTab)}
          </p>
        )}
      </div>
    </SignedOutShell>
  );
}
