import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { apply } from '../../auth/app';
import { type ApplyRefusal, addressRefusal } from '../../auth/apply';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { rich } from '../../i18n/rich';
import { useT } from '../../i18n/useT';
import { BotCheck } from './BotCheck';
import { EmailInput, Field, FocusedTitle, Foot, StepAlert, Title } from './parts';
import { afterPass, useBotCheck } from './useBotCheck';
import { useSelfXssWarning } from './useSelfXssWarning';

/** The page's own two: `botCheckFailed` is the widget's failure, which its next pass clears, where
 *  the route's refusal (`botCheck`) stays until the next press; `botCheckUnavailable`, no widget. */
type Reason = ApplyRefusal | 'botCheckFailed' | 'botCheckUnavailable';

/** A refusal, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: Reason; n: number };

const ON_THE_FIELD: Reason[] = ['emailMissing', 'emailInvalid'];

function sentence(t: Dict, reason: Reason): string {
  return {
    emailMissing: t.auth.emailMissing,
    emailInvalid: t.auth.emailInvalid,
    botCheck: t.auth.botCheck.failed,
    botCheckFailed: t.auth.botCheck.failed,
    botCheckUnavailable: t.auth.botCheck.unavailable,
    throttled: t.auth.apply.busyServer,
    offline: t.auth.offline,
    failed: t.auth.apply.failed,
  }[reason];
}

const STEP = 'flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1';

/** The one-field application. The endpoint answers every address alike, so the recorded view
 *  promises no status and no email but the invitation. Turnstile stands between the field and the
 *  button; the button is never gated, and a press before the token waits for it
 *  (`bot-check.dc.html`). */
export function Apply() {
  const t = useT();
  useSelfXssWarning(true);
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>();
  const [recorded, setRecorded] = useState<string>();
  const addressRef = useRef<HTMLInputElement>(null);
  const refusals = useRef(0);

  // After the commit, so the field already carries `aria-invalid` and its sentence when focused.
  useEffect(() => {
    if (said && ON_THE_FIELD.includes(said.reason)) addressRef.current?.focus();
  }, [said]);

  const say = (reason: Reason) => setSaid({ reason, n: ++refusals.current });

  const check = useBotCheck({
    saying: said?.reason,
    say,
    passed: () => setSaid(afterPass),
    released: () => setBusy(false),
  });

  async function send(botCheck: string) {
    const outcome = await apply(address, botCheck);
    check.spent();
    setBusy(false);
    if (outcome.kind === 'recorded') setRecorded(outcome.email);
    else say(outcome.reason);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // THE FIELD FIRST: a refused address waits for no token.
    const wrong = addressRefusal(address);
    if (wrong) return say(wrong);
    const pressed = check.press('wait', (token) => void send(token));
    if (pressed === 'unavailable') return say('botCheckUnavailable');
    if (pressed === 'interactive') return;
    setSaid(undefined);
    setBusy(true);
  }

  const botCheck = check.props && <BotCheck {...check.props} action="apply" />;

  const fieldError = said && ON_THE_FIELD.includes(said.reason) ? said : undefined;
  const stepError = said && !ON_THE_FIELD.includes(said.reason) ? said : undefined;

  return (
    <SignedOutShell>
      {recorded === undefined ? (
        <div key="form" className={STEP}>
          <Title>{t.auth.apply.title}</Title>
          <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">{t.auth.apply.lead}</p>
          <form noValidate onSubmit={submit} className="flex flex-col">
            <Field label={t.auth.email} error={fieldError && sentence(t, fieldError.reason)}>
              {(id, describedBy) => (
                <EmailInput
                  id={id}
                  inputRef={addressRef}
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={address}
                  busy={busy}
                  invalid={Boolean(fieldError)}
                  describedBy={describedBy}
                  onChange={setAddress}
                />
              )}
            </Field>
            {botCheck}
            <Button type="submit" className="mt-2 w-full" disabled={busy} disabledTone="busy">
              {busy ? t.auth.apply.busy : t.auth.apply.submit}
            </Button>
            {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            {/* The notice's first layer, at collection (WP260 ¶36), asking for no agreement. Its
                link opens a new tab, as the widget's own do, so what was typed here stays. */}
            <p className="mt-3 text-[12px] leading-[18px] text-muted">
              {rich(t.privacy.firstLayer, (label, href, key) => (
                <Link
                  key={key}
                  to={href}
                  target="_blank"
                  rel="noopener"
                  className="text-accent underline underline-offset-2"
                >
                  {label}
                  <span className="sr-only"> {t.privacy.newTab}</span>
                </Link>
              ))}
            </p>
          </form>
          <Foot prompt={t.auth.apply.signInPrompt} to="/sign-in">
            {t.auth.apply.signInLink}
          </Foot>
        </div>
      ) : (
        <div key="recorded" className={STEP}>
          <FocusedTitle>{t.auth.apply.recordedTitle}</FocusedTitle>
          <p className="mb-[22px] text-[13px] leading-[19.5px] break-words text-muted">
            {t.auth.apply.recordedLead(recorded)}
          </p>
          <Button variant="outline" className="w-full" onClick={() => void navigate('/sign-in')}>
            {t.auth.apply.back}
          </Button>
        </div>
      )}
    </SignedOutShell>
  );
}
