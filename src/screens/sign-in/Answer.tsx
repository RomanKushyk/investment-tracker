import { Ban, Clock, FileQuestionMark, Lock, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import type { Answer } from '../../auth/access';
import { session, showAnswer, type HeldAnswer } from '../../auth/app';
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
  const [leaving, setLeaving] = useState<string>();
  const copy = t.auth[held.answer];
  const Glyph = GLYPH[held.answer];
  // `forbidden` names nobody: its causes include an address the rule refused.
  const email = held.answer === 'forbidden' ? undefined : held.email;

  async function leave(to: string) {
    if (leaving) return;
    setLeaving(to);
    // Not revoked keeps both cookies for a retry, so the answer stays and the button comes back.
    if (!(await session.signOut())) {
      setLeaving(undefined);
      return;
    }
    // The router commits in a transition and the store at once: cleared first, the route that asked
    // would render in the answer's place for a frame and run its effects signed out.
    await navigate(to, { flushSync: true });
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
            onClick={() => void leave('/sign-in')}
          >
            {t.auth.signOut}
          </Button>
        </div>
      </div>
    </SignedOutShell>
  );
}
