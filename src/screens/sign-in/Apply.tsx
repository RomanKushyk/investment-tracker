import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { apply, botCheckSitekey } from '../../auth/app';
import { type ApplyRefusal, addressRefusal } from '../../auth/apply';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { BotCheck } from './BotCheck';
import { EmailInput, Field, FocusedTitle, Foot, StepAlert, Title } from './parts';
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
  const [unavailable, setUnavailable] = useState(false);
  const [reset, setReset] = useState(0);
  const token = useRef<string>(undefined);
  /** A press that came before the token, sent when the token comes. */
  const waiting = useRef(false);
  /** Managed shows its checkbox: the press asked for is the checkbox's. */
  const interactive = useRef(false);
  /** The widget's last word was a failure, after which it may never call again. An expiry renews
   *  itself (`refresh-expired: auto`). */
  const resting = useRef(false);

  // After the commit, so the field already carries `aria-invalid` and its sentence when focused.
  useEffect(() => {
    if (said && ON_THE_FIELD.includes(said.reason)) addressRef.current?.focus();
  }, [said]);

  const say = (reason: Reason) => setSaid({ reason, n: ++refusals.current });

  /** Ends a press still waiting for a token the widget will not give. */
  const giveUp = () => {
    if (!waiting.current) return false;
    waiting.current = false;
    setBusy(false);
    return true;
  };

  async function send() {
    const botCheck = token.current ?? '';
    token.current = undefined;
    interactive.current = false;
    resting.current = false;
    const outcome = await apply(address, botCheck);
    // EVERY ANSWER SPENDS THE TOKEN, a refusal's as much as a record's.
    setReset((n) => n + 1);
    setBusy(false);
    if (outcome.kind === 'recorded') setRecorded(outcome.email);
    else say(outcome.reason);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // THE FIELD FIRST: a refused address waits for no token.
    const wrong = addressRefusal(address);
    if (wrong) return say(wrong);
    if (botCheckSitekey !== undefined) {
      if (unavailable) return say('botCheckUnavailable');
      if (token.current === undefined) {
        if (interactive.current) return;
        setSaid(undefined);
        setBusy(true);
        waiting.current = true;
        // A RESTING WIDGET IS ASKED AGAIN, so the wait always has an answer coming.
        if (resting.current) {
          resting.current = false;
          setReset((n) => n + 1);
        }
        return;
      }
    }
    setBusy(true);
    setSaid(undefined);
    await send();
  }

  const botCheck = botCheckSitekey !== undefined && (
    <BotCheck
      sitekey={botCheckSitekey}
      action="apply"
      reset={reset}
      onToken={(value) => {
        token.current = value;
        interactive.current = false;
        resting.current = false;
        // The widget's next pass clears its own failure, never the route's refusal.
        setSaid((s) => (s?.reason === 'botCheckFailed' ? undefined : s));
        if (waiting.current) {
          waiting.current = false;
          void send();
        }
      }}
      onExpired={() => {
        token.current = undefined;
        interactive.current = false;
      }}
      onFailed={() => {
        token.current = undefined;
        interactive.current = false;
        resting.current = true;
        // EVERY FAILURE ENDS A WAIT; the sentence is said once across the widget's retries.
        const waited = giveUp();
        if (waited || said?.reason !== 'botCheckFailed') say('botCheckFailed');
      }}
      onInteractive={() => {
        token.current = undefined;
        interactive.current = true;
        resting.current = false;
        giveUp();
      }}
      onUnavailable={() => {
        token.current = undefined;
        setUnavailable(true);
        if (giveUp()) say('botCheckUnavailable');
      }}
    />
  );

  const fieldError = said && ON_THE_FIELD.includes(said.reason) ? said : undefined;
  const stepError = said && !ON_THE_FIELD.includes(said.reason) ? said : undefined;

  return (
    <SignedOutShell>
      {recorded === undefined ? (
        <div key="form" className={STEP}>
          <Title>{t.auth.apply.title}</Title>
          <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">{t.auth.apply.lead}</p>
          <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col">
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
