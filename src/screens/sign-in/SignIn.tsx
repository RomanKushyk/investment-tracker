import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { cancelPasskey, session, signInDeps, useSessionStatus } from '../../auth/app';
import { signInWithAddress, signInWithPassword, type SignInRefusal } from '../../auth/sign-in';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import {
  EmailInput,
  Field,
  FocusedTitle,
  Foot,
  LINK,
  PasswordInput,
  StepAlert,
  Title,
} from './parts';

type Step =
  { name: 'address' } | { name: 'passkey'; email: string } | { name: 'password'; email: string };

/** A refusal, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: SignInRefusal; n: number };

const ON_THE_FIELD: SignInRefusal[] = ['emailMissing', 'emailInvalid', 'passwordMissing'];

function sentence(t: Dict, reason: SignInRefusal): string {
  return {
    emailMissing: t.auth.emailMissing,
    emailInvalid: t.auth.emailInvalid,
    passwordMissing: t.auth.password.missing,
    wrong: t.auth.password.wrong,
    notFinished: t.auth.passkey.notFinished,
    tooMany: t.auth.tooMany,
    offline: t.auth.offline,
    failed: t.auth.failed,
  }[reason];
}

export function SignIn() {
  const t = useT();
  const status = useSessionStatus();
  const [step, setStep] = useState<Step>({ name: 'address' });
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>();
  const addressRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [changed, setChanged] = useState(false);
  // Each submit and each step change is a new run; an answer for an older one lands nowhere, so a
  // step the user has left never shows its sentence.
  const run = useRef(0);

  // Asked here and not on every load: nothing else needs the session yet, and the demo sends no
  // request anywhere.
  useEffect(() => {
    if (session.status() === 'unknown') void session.restore();
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
    if (said?.reason === 'passwordMissing') passwordRef.current?.focus();
    else if (said?.reason === 'emailMissing' || said?.reason === 'emailInvalid') {
      addressRef.current?.focus();
    }
  }, [said]);

  // A completed sign-in lands here too: the session turns signed in, and the page leaves.
  if (status === 'signedIn') return <Navigate to="/" replace />;

  const say = (reason: SignInRefusal) => setSaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));

  function begin() {
    const mine = ++run.current;
    setSaid(undefined);
    return () => mine === run.current;
  }

  function go(next: Step) {
    run.current++;
    cancelPasskey();
    setBusy(false);
    setSaid(undefined);
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
    if (outcome.kind === 'refused') say(outcome.reason);
  }

  const change = () => {
    go({ name: 'address' });
    setChanged(true);
  };

  const fieldError = said && ON_THE_FIELD.includes(said.reason) ? said : undefined;
  const stepError = said && !ON_THE_FIELD.includes(said.reason) ? said : undefined;

  return (
    <SignedOutShell>
      <div
        key={step.name}
        className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1"
      >
        {step.name === 'address' && (
          <>
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
            <Foot prompt={t.auth.signIn.applyPrompt} to="/apply">
              {t.auth.signIn.applyLink}
            </Foot>
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
