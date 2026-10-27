import { CircleCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import {
  cancelPasskey,
  passkeyDeps,
  session,
  signInDeps,
  startGoogle,
  tabStorage,
  useGoogle,
  useSessionStatus,
} from '../../auth/app';
import { addressRefusal } from '../../auth/apply';
import { arrivedGoogleFailed, belowTheForm, forgetReauthentication } from '../../auth/google';
import { addPasskey } from '../../auth/passkey';
import {
  type HeldChallenge,
  type SignInDeps,
  setNewPassword,
  signInWithAddress,
  signInWithPassword,
} from '../../auth/sign-in';
import {
  arrivedSignedOut,
  forgetSignedOut,
  returnedSignedOut,
  usedUp,
} from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { BotCheck } from './BotCheck';
import { OrGoogle } from './GoogleButton';
import {
  EmailInput,
  Field,
  FocusedTitle,
  Foot,
  LINK,
  PasskeyMark,
  PasswordInput,
  RuleField,
  SignedOutNote,
  StepAlert,
  Title,
} from './parts';
import { ON_THE_FIELD, ON_THE_RULE, type Reason } from './refusals';
import { type BotCheckOf, afterPass, useBotCheck } from './useBotCheck';
import { useSelfXssWarning } from './useSelfXssWarning';

type Step =
  | { name: 'address' }
  | { name: 'passkey'; email: string }
  | { name: 'password'; email: string }
  // The challenge the temporary password opened, which the new password answers.
  | { name: 'newPassword'; email: string; held: HeldChallenge }
  | { name: 'offer' }
  | { name: 'created' };

// BUSY WITHOUT `disabled`, which would drop focus to the page: announced as unavailable, drawn as
// the password step's busy, and every handler returns while it holds.
const BUSY = 'aria-disabled:pointer-events-none aria-disabled:opacity-70';

/** A refusal, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: Reason; n: number };

function sentence(t: Dict, reason: Reason): string {
  return {
    emailMissing: t.auth.emailMissing,
    emailInvalid: t.auth.emailInvalid,
    passwordMissing: t.auth.password.missing,
    wrong: t.auth.password.wrong,
    notFinished: t.auth.passkey.notFinished,
    rule: t.auth.setPassword.rule,
    reused: t.auth.setPassword.reused,
    expired: t.auth.setPassword.expired,
    pending: t.auth.botCheck.pending,
    botCheck: t.auth.botCheck.failed,
    botCheckFailed: t.auth.botCheck.failed,
    botCheckUnavailable: t.auth.botCheck.unavailable,
    tooMany: t.auth.tooMany,
    offline: t.auth.offline,
    failed: t.auth.failed,
    notCreated: t.auth.addPasskey.notCreated,
    passkeyFailed: t.auth.addPasskey.failed,
    googleFailed: t.auth.google.failed,
  }[reason];
}

export function SignIn() {
  const t = useT();
  const status = useSessionStatus();
  const google = useGoogle();
  const [step, setStep] = useState<Step>({ name: 'address' });
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // The passkey sheet has answered and the relay is verifying it (`account-way-in-and-out.dc.html` T6).
  const [verifying, setVerifying] = useState(false);
  const [said, setSaid] = useState<Said>();
  // The passkey retry's own check, said under its link (`bot-check-steps.dc.html` T2).
  const [retrySaid, setRetrySaid] = useState<Said>();
  // The new password an expired session sent back, filled in when its step returns (WCAG 2.2.5).
  const kept = useRef('');
  const addressRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [changed, setChanged] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // Read at mount, so the visit keeps what it read after the entry is used up; held once submitted.
  // A sign-out through Cognito's logout arrives by a load, the page's first location, carrying the
  // fact in this tab instead; a visit from within the app is a plain one.
  const [note, setNote] = useState<'said' | 'held' | undefined>(() =>
    arrivedSignedOut(location.state) ||
    (location.key === 'default' && returnedSignedOut(tabStorage()))
      ? 'said'
      : undefined,
  );
  // Busy from the press until the page leaves for Google.
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleSaid, setGoogleSaid] = useState<Said | undefined>(() =>
    arrivedGoogleFailed(location.state) ? { reason: 'googleFailed', n: 1 } : undefined,
  );
  // Each submit and each step change is a new run; an answer for an older one lands nowhere, so a
  // step the user has left never shows its sentence.
  const run = useRef(0);

  // Asked here and by the portfolio shell; `restore` reaches the relay until it has answered.
  useEffect(() => {
    void session.restore();
  }, []);
  // A reload or Back/Forward hands `history.state` back, so a sign-out's arrival replaces it.
  useEffect(() => {
    if (arrivedSignedOut(location.state)) void navigate(...usedUp(location));
  }, [location, navigate]);
  useEffect(() => {
    if (arrivedGoogleFailed(location.state)) void navigate(...usedUp(location));
  }, [location, navigate]);
  // Forgotten once read, so a reload or Back says nothing.
  useEffect(() => forgetSignedOut(tabStorage()), []);
  // BACK FROM GOOGLE'S CHOOSER can restore this page from the back/forward cache, busy as it left.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGoogleBusy(false);
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, []);
  // Leaving ends the run, or an answer still in flight would open the sheet over the next page;
  // a sheet already open outlives the page unless closed.
  useEffect(
    () => () => {
      run.current++;
      cancelPasskey();
    },
    [],
  );
  // After the commit, so the field already carries `aria-invalid` and its sentence when focused.
  useEffect(() => {
    if (said?.reason === 'passwordMissing' || (said && ON_THE_RULE.includes(said.reason))) {
      passwordRef.current?.focus();
    } else if (said?.reason === 'emailMissing' || said?.reason === 'emailInvalid') {
      addressRef.current?.focus();
    }
  }, [said]);

  const say = (reason: Reason) => setSaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));
  const sayRetry = (reason: Reason) =>
    setRetrySaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));
  // EACH START TAKES A FRESH TOKEN from the widget of the step that sends it.
  const stepCheck = {
    saying: said?.reason,
    say,
    passed: () => setSaid(afterPass),
    released: () => setBusy(false),
  };
  const addressCheck = useBotCheck(stepCheck);
  const passwordCheck = useBotCheck(stepCheck);
  const retryCheck = useBotCheck({
    saying: retrySaid?.reason,
    say: sayRetry,
    passed: () => setRetrySaid(afterPass),
    released: () => {},
  });

  // A completed sign-in leaves, but not for the offer or its outcome: a password's tokens land
  // before its outcome says whether the offer follows, so the page holds while that submit runs.
  const holds =
    step.name === 'offer' ||
    step.name === 'created' ||
    (busy && (step.name === 'password' || step.name === 'newPassword'));
  const leaves = status === 'signedIn' && !holds;
  useSelfXssWarning(!leaves);
  if (leaves) return <Navigate to="/" replace />;

  function begin() {
    const mine = ++run.current;
    setSaid(undefined);
    setRetrySaid(undefined);
    setGoogleSaid(undefined);
    return () => mine === run.current;
  }

  function go(next: Step) {
    run.current++;
    cancelPasskey();
    for (const check of [addressCheck, passwordCheck, retryCheck]) check.forget();
    setBusy(false);
    setVerifying(false);
    setSaid(undefined);
    setRetrySaid(undefined);
    setGoogleSaid(undefined);
    setNote(undefined);
    setPassword('');
    setStep(next);
  }

  /** The sheet's answer turns the step to verifying, until the outcome lands. */
  const depsFor = (current: () => boolean): SignInDeps => ({
    ...signInDeps,
    authenticate: async (options) => {
      const answered = await signInDeps.authenticate(options);
      if (current()) setVerifying(true);
      return answered;
    },
  });

  /** THE START IS THE PRESS'S FIRST WAIT, its token already in hand: Safari before 17.4 opens the
   *  passkey sheet only after one fetch and no other wait. */
  async function passkeyFirst(
    typed: string,
    token: string,
    check: BotCheckOf,
    refusedAs: (reason: Reason) => void,
  ) {
    const current = begin();
    const outcome = await signInWithAddress(typed, token, depsFor(current), (email) => {
      if (!current()) return false;
      setBusy(false);
      setStep({ name: 'passkey', email });
    });
    if (!current()) return;
    check.spent();
    setBusy(false);
    setVerifying(false);
    if (outcome.kind === 'password') {
      setPassword('');
      setStep({ name: 'password', email: outcome.email });
    } else if (outcome.kind === 'refused') {
      refusedAs(outcome.reason);
    }
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setNote((before) => before && 'held');
    // THE FIELD FIRST: a refused address waits for no token.
    const wrong = addressRefusal(address);
    if (wrong) {
      begin();
      return say(wrong);
    }
    const pressed = addressCheck.press('refuse', (token) => {
      setBusy(true);
      void passkeyFirst(address, token, addressCheck, say);
    });
    if (pressed === 'pending' || pressed === 'unavailable') {
      begin();
      say(pressed === 'pending' ? 'pending' : 'botCheckUnavailable');
    }
  }

  function retryPasskey(email: string) {
    const pressed = retryCheck.press('refuse', (token) => {
      // The check's own refusal stays with the check, under the link.
      void passkeyFirst(email, token, retryCheck, (reason) =>
        reason === 'botCheck' ? sayRetry(reason) : say(reason),
      );
    });
    if (pressed === 'pending') sayRetry('pending');
    else if (pressed === 'unavailable') sayRetry('botCheckUnavailable');
  }

  async function signInWith(email: string, typed: string, token: string) {
    const current = begin();
    setBusy(true);
    const outcome = await signInWithPassword(email, typed, token, signInDeps);
    if (!current()) return;
    passwordCheck.spent();
    setBusy(false);
    if (outcome.kind === 'refused') {
      say(outcome.reason);
    } else if (outcome.kind === 'newPassword') {
      go({ name: 'newPassword', email, held: outcome.held });
      if (kept.current) setPassword(kept.current);
    } else if (outcome.kind === 'signedIn' && outcome.offerPasskey) {
      go({ name: 'offer' });
    }
  }

  function submitPassword(event: FormEvent, email: string) {
    event.preventDefault();
    if (busy) return;
    // THE FIELD FIRST: an empty password waits for no token.
    if (!password) {
      begin();
      return say('passwordMissing');
    }
    const typed = password;
    const pressed = passwordCheck.press('wait', (token) => void signInWith(email, typed, token));
    if (pressed === 'unavailable') {
      begin();
      return say('botCheckUnavailable');
    }
    if (pressed === 'interactive') return;
    setSaid(undefined);
    setBusy(true);
  }

  async function submitNewPassword(event: FormEvent, email: string, held: HeldChallenge) {
    event.preventDefault();
    if (busy) return;
    const current = begin();
    setBusy(true);
    const typed = password;
    const outcome = await setNewPassword(held, typed, signInDeps);
    if (!current()) return;
    setBusy(false);
    if (outcome.kind === 'refused' && outcome.reason === 'expired') {
      // THE SESSION RAN OUT: back to the temporary password, the new one kept for the way back.
      go({ name: 'password', email });
      kept.current = typed;
      say('expired');
    } else if (outcome.kind === 'refused') {
      say(outcome.reason);
    } else if (outcome.kind === 'signedIn') {
      go({ name: 'offer' });
    }
  }

  // THE PAGE LEAVES FOR GOOGLE and stays busy until it has gone; the relay keeps the flow's pair.
  async function continueWithGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setGoogleSaid(undefined);
    const begun = await startGoogle();
    if ('url' in begun) {
      // A sign-in's return is no re-authentication's, whatever an abandoned one left in the tab.
      forgetReauthentication(tabStorage());
      window.location.assign(begun.url);
      return;
    }
    setGoogleBusy(false);
    const reason = begun.refused === 'offline' ? 'offline' : 'googleFailed';
    setGoogleSaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));
  }

  async function createPasskey() {
    if (busy) return;
    const current = begin();
    setBusy(true);
    const made = await addPasskey(passkeyDeps, current);
    if (!current()) return;
    setBusy(false);
    if (made === 'created') go({ name: 'created' });
    else say(made === 'failed' ? 'passkeyFailed' : made);
  }

  // The run ends at the press: the router commits in a transition, and the step renders once more.
  const toTheApp = () => {
    run.current++;
    void navigate('/', { replace: true });
  };

  const change = () => {
    kept.current = '';
    go({ name: 'address' });
    setChanged(true);
  };

  const below = belowTheForm(status, google, googleSaid !== undefined);
  const fieldError = said && ON_THE_FIELD.includes(said.reason) ? said : undefined;
  const stepError = said && !ON_THE_FIELD.includes(said.reason) ? said : undefined;
  const ruleError = said && ON_THE_RULE.includes(said.reason) ? said : undefined;

  return (
    <SignedOutShell>
      <div
        key={step.name}
        className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1"
      >
        {step.name === 'address' && (
          <>
            {note && <SignedOutNote held={note === 'held'}>{t.auth.signedOut}</SignedOutNote>}
            <Title>{t.auth.signIn.title}</Title>
            <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">
              {t.auth.signIn.lead}
            </p>
            <form noValidate onSubmit={submitAddress} className="flex flex-col">
              <Field label={t.auth.email} error={fieldError && sentence(t, fieldError.reason)}>
                {(id, describedBy) => (
                  <EmailInput
                    id={id}
                    inputRef={addressRef}
                    name="username"
                    autoComplete="username"
                    autoFocus={changed}
                    value={address}
                    busy={busy}
                    invalid={Boolean(fieldError)}
                    describedBy={describedBy}
                    onChange={setAddress}
                  />
                )}
              </Field>
              {addressCheck.props && <BotCheck {...addressCheck.props} action="sign-in" />}
              <Button type="submit" className="mt-2 w-full" disabled={busy} disabledTone="busy">
                {busy ? t.auth.signIn.checking : t.auth.signIn.continue}
              </Button>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </form>
            {/* Held until the relay has answered, then faded in whole (*Interaction rules*); a flag
                arriving after an unanswered load fades the pair in alone. */}
            {below.link && (
              <div className="animate-in duration-300 ease-soft fade-in">
                <OrGoogle
                  on={below.google}
                  busy={googleBusy}
                  copy={t.auth.google}
                  onClick={() => void continueWithGoogle()}
                >
                  {googleSaid && (
                    <StepAlert n={googleSaid.n}>{sentence(t, googleSaid.reason)}</StepAlert>
                  )}
                </OrGoogle>
                <Foot prompt={t.auth.signIn.applyPrompt} to="/apply">
                  {t.auth.signIn.applyLink}
                </Foot>
              </div>
            )}
          </>
        )}

        {step.name === 'passkey' && (
          <>
            <FocusedTitle>{t.auth.passkey.title}</FocusedTitle>
            <AddressRow email={step.email} busy={verifying} onChange={change} />
            {/* The status is present and silent since the step appeared, so only «Входимо…» is
                announced; the lead held beneath keeps the line's height under the pointer. */}
            <p className="mb-[22px] grid text-[13px] leading-[19.5px] text-muted">
              <span
                aria-hidden={verifying || undefined}
                className={`col-start-1 row-start-1 ${verifying ? 'invisible' : ''}`}
              >
                {t.auth.passkey.lead}
              </span>
              <span role="status" className="col-start-1 row-start-1">
                {verifying && (
                  <span className="animate-in duration-300 ease-soft fade-in">
                    {t.auth.signingIn}
                  </span>
                )}
              </span>
            </p>
            <Button
              variant="outline"
              className={`w-full ${BUSY}`}
              aria-disabled={verifying || undefined}
              onClick={() => !verifying && go({ name: 'password', email: step.email })}
            >
              {t.auth.passkey.usePassword}
            </Button>
            {/* The retry's widget enters with the sentence, and all three leave at a press that
                sends (`bot-check-steps.dc.html` T1, T2). */}
            {(stepError || retrySaid) && (
              <>
                {stepError && (
                  <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>
                )}
                {retryCheck.props && (
                  <div className="mt-3">
                    <BotCheck {...retryCheck.props} action="sign-in" />
                  </div>
                )}
                <p className="mt-4 text-[13px] leading-[19.5px]">
                  <button type="button" className={LINK} onClick={() => retryPasskey(step.email)}>
                    {t.auth.retry}
                  </button>
                </p>
                {retrySaid && (
                  <StepAlert n={retrySaid.n}>{sentence(t, retrySaid.reason)}</StepAlert>
                )}
              </>
            )}
          </>
        )}

        {step.name === 'password' && (
          <>
            <Title>{t.auth.password.title}</Title>
            <AddressRow email={step.email} onChange={change} />
            <form
              noValidate
              onSubmit={(event) => void submitPassword(event, step.email)}
              className="flex flex-col"
            >
              {/* The address rides along for the password manager: `display:none`, never
                  `type="hidden"`, which it does not read. */}
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={step.email}
                readOnly
                className="hidden"
              />
              <Field
                label={t.auth.password.label}
                error={fieldError && sentence(t, fieldError.reason)}
              >
                {(id, describedBy) => (
                  <PasswordInput
                    id={id}
                    inputRef={passwordRef}
                    autoComplete="current-password"
                    value={password}
                    busy={busy}
                    invalid={Boolean(fieldError)}
                    describedBy={describedBy}
                    onChange={setPassword}
                  />
                )}
              </Field>
              {passwordCheck.props && <BotCheck {...passwordCheck.props} action="sign-in" />}
              <Button type="submit" className="mt-2 w-full" disabled={busy} disabledTone="busy">
                {busy ? t.auth.password.busy : t.auth.password.submit}
              </Button>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </form>
          </>
        )}

        {step.name === 'newPassword' && (
          <>
            <Title>{t.auth.setPassword.title}</Title>
            <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">
              {t.auth.setPassword.lead}
            </p>
            <form
              noValidate
              onSubmit={(event) => void submitNewPassword(event, step.email, step.held)}
              className="flex flex-col"
            >
              {/* The account a password manager saves the new password against. */}
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={step.email}
                readOnly
                className="hidden"
              />
              <RuleField
                label={t.auth.setPassword.label}
                rule={t.auth.setPassword.rule}
                refusal={ruleError && { n: ruleError.n, sentence: sentence(t, ruleError.reason) }}
              >
                {(id, describedBy) => (
                  <PasswordInput
                    id={id}
                    inputRef={passwordRef}
                    autoComplete="new-password"
                    value={password}
                    busy={busy}
                    invalid={Boolean(ruleError)}
                    describedBy={describedBy}
                    onChange={setPassword}
                  />
                )}
              </RuleField>
              <Button type="submit" className="mt-2 w-full" disabled={busy} disabledTone="busy">
                {busy ? t.auth.setPassword.busy : t.auth.setPassword.submit}
              </Button>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </form>
          </>
        )}

        {step.name === 'offer' && (
          <>
            <FocusedTitle>{t.auth.addPasskey.title}</FocusedTitle>
            <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">
              {t.auth.addPasskey.lead}
            </p>
            <div className="flex flex-col gap-[10px]">
              <Button
                className="w-full"
                disabled={busy}
                disabledTone="busy"
                onClick={() => void createPasskey()}
              >
                <PasskeyMark />
                {t.auth.addPasskey.create}
              </Button>
              <Button variant="ghost" className="w-full" onClick={toTheApp}>
                {t.auth.addPasskey.later}
              </Button>
            </div>
            {/* Under both buttons, so the OS dialog's closing moves neither. */}
            {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
          </>
        )}

        {step.name === 'created' && (
          <>
            <CircleCheck aria-hidden className="mb-4 size-6 flex-none text-muted" strokeWidth={2} />
            <FocusedTitle>{t.auth.addPasskey.createdTitle}</FocusedTitle>
            <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">
              {t.auth.addPasskey.createdLead}
            </p>
            <Button className="w-full" onClick={toTheApp}>
              {t.auth.addPasskey.continue}
            </Button>
          </>
        )}
      </div>
    </SignedOutShell>
  );
}

function AddressRow({
  email,
  busy = false,
  onChange,
}: {
  email: string;
  busy?: boolean;
  onChange: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-[22px] flex items-baseline gap-3 text-[13px] leading-[19.5px]">
      <span className="min-w-0 flex-1 truncate text-ink">{email}</span>
      <button
        type="button"
        aria-label={t.auth.changeLabel}
        aria-disabled={busy || undefined}
        onClick={() => !busy && onChange()}
        className={`flex-none transition ${LINK} ${BUSY}`}
      >
        {t.auth.change}
      </button>
    </div>
  );
}
