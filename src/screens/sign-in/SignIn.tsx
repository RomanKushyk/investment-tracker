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
import { arrivedGoogleFailed, belowTheForm } from '../../auth/google';
import { addPasskey } from '../../auth/passkey';
import { setNewPassword, signInWithAddress, signInWithPassword } from '../../auth/sign-in';
import {
  arrivedSignedOut,
  forgetSignedOut,
  returnedSignedOut,
  usedUp,
} from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
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

type Step =
  | { name: 'address' }
  | { name: 'passkey'; email: string }
  | { name: 'password'; email: string }
  // The temporary password, in memory for this step alone: each submit proves it afresh.
  | { name: 'newPassword'; email: string; temporary: string }
  | { name: 'offer' }
  | { name: 'created' };

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
    tooMany: t.auth.tooMany,
    offline: t.auth.offline,
    failed: t.auth.failed,
    notCreated: t.auth.addPasskey.notCreated,
    passkeyFailed: t.auth.addPasskey.failed,
    googleFailed: t.auth.google.failed,
  }[reason];
}

/** `completing`: back from Google on `/auth/callback`, the relay redeeming the code. */
export function SignIn({ completing = false }: { completing?: boolean }) {
  const t = useT();
  const status = useSessionStatus();
  const google = useGoogle();
  const [step, setStep] = useState<Step>({ name: 'address' });
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>();
  const addressRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [changed, setChanged] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // Read at mount, so the visit keeps what it read after the entry is used up; held once submitted.
  // A sign-out through Cognito's logout arrives by a load, carrying the fact in this tab instead.
  const [note, setNote] = useState<'said' | 'held' | undefined>(() =>
    arrivedSignedOut(location.state) || returnedSignedOut(tabStorage()) ? 'said' : undefined,
  );
  // Busy from the press until the page leaves for Google, and while the relay redeems its code.
  const [googleBusy, setGoogleBusy] = useState(completing);
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

  // A completed sign-in leaves, but not for the offer or its outcome: a password's tokens land
  // before its outcome says whether the offer follows, so the page holds while that submit runs.
  const holds =
    step.name === 'offer' ||
    step.name === 'created' ||
    (busy && (step.name === 'password' || step.name === 'newPassword'));
  if (status === 'signedIn' && !holds) return <Navigate to="/" replace />;

  const say = (reason: Reason) => setSaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));

  function begin() {
    const mine = ++run.current;
    setSaid(undefined);
    setGoogleSaid(undefined);
    return () => mine === run.current;
  }

  function go(next: Step) {
    run.current++;
    cancelPasskey();
    setBusy(false);
    setSaid(undefined);
    setGoogleSaid(undefined);
    setNote(undefined);
    setPassword('');
    setStep(next);
  }

  async function passkeyFirst(typed: string) {
    const current = begin();
    const outcome = await signInWithAddress(typed, signInDeps, (email) => {
      if (!current()) return false;
      setBusy(false);
      setStep({ name: 'passkey', email });
    });
    if (!current()) return;
    setBusy(false);
    if (outcome.kind === 'password') {
      setPassword('');
      setStep({ name: 'password', email: outcome.email });
    } else if (outcome.kind === 'refused') {
      say(outcome.reason);
    }
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setNote((before) => before && 'held');
    setBusy(true);
    void passkeyFirst(address);
  }

  async function submitPassword(event: FormEvent, email: string) {
    event.preventDefault();
    if (busy) return;
    const current = begin();
    setBusy(true);
    const outcome = await signInWithPassword(email, password, signInDeps);
    if (!current()) return;
    setBusy(false);
    if (outcome.kind === 'refused') {
      say(outcome.reason);
    } else if (outcome.kind === 'newPassword') {
      go({ name: 'newPassword', email, temporary: password });
    } else if (outcome.kind === 'signedIn' && outcome.offerPasskey) {
      go({ name: 'offer' });
    }
  }

  async function submitNewPassword(event: FormEvent, email: string, temporary: string) {
    event.preventDefault();
    if (busy) return;
    const current = begin();
    setBusy(true);
    const outcome = await setNewPassword(email, temporary, password, signInDeps);
    if (!current()) return;
    setBusy(false);
    if (outcome.kind === 'refused') say(outcome.reason);
    else if (outcome.kind === 'signedIn') go({ name: 'offer' });
  }

  // THE PAGE LEAVES FOR GOOGLE and stays busy until it has gone; the relay keeps the flow's pair.
  async function continueWithGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setGoogleSaid(undefined);
    const begun = await startGoogle();
    if ('url' in begun) {
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
    go({ name: 'address' });
    setChanged(true);
  };

  const below = belowTheForm(status, google, completing || googleSaid !== undefined);
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
            <AddressRow email={step.email} onChange={change} />
            <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">
              {t.auth.passkey.lead}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => go({ name: 'password', email: step.email })}
            >
              {t.auth.passkey.usePassword}
            </Button>
            {stepError && (
              <>
                <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>
                <p className="mt-2 text-[13px] leading-[19.5px]">
                  <button
                    type="button"
                    className={LINK}
                    onClick={() => void passkeyFirst(step.email)}
                  >
                    {t.auth.retry}
                  </button>
                </p>
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
              onSubmit={(event) => void submitNewPassword(event, step.email, step.temporary)}
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

function AddressRow({ email, onChange }: { email: string; onChange: () => void }) {
  const t = useT();
  return (
    <div className="mb-[22px] flex items-baseline gap-3 text-[13px] leading-[19.5px]">
      <span className="min-w-0 flex-1 truncate text-ink">{email}</span>
      <button
        type="button"
        aria-label={t.auth.changeLabel}
        onClick={onChange}
        className={`flex-none ${LINK}`}
      >
        {t.auth.change}
      </button>
    </div>
  );
}
