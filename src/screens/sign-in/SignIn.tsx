import { Eye, EyeOff } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Navigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { cancelPasskey, session, signInDeps, useSessionStatus } from '../../auth/app';
import { signInWithAddress, signInWithPassword, type SignInRefusal } from '../../auth/sign-in';
import { Button } from '../../components/ui/Button';
import { TAP_44 } from '../../components/ui/tap-target';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';

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

// `page` on `card`, as every field in the app; hover takes the edge to `ink`.
function fieldClass(invalid: boolean): string {
  return `block h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-field-border hover:border-ink'
  }`;
}

const LINK = `cursor-pointer text-accent underline underline-offset-2 ${TAP_44}`;

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
  // An open sheet outlives the page unless closed: Back, or a sign-in elsewhere, would leave it up.
  useEffect(() => cancelPasskey, []);
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
                  <input
                    ref={addressRef}
                    id={id}
                    type="email"
                    name="username"
                    autoComplete="username"
                    autoFocus={changed}
                    value={address}
                    readOnly={busy}
                    onChange={(event) => setAddress(event.target.value)}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={describedBy}
                    className={fieldClass(Boolean(fieldError))}
                  />
                )}
              </Field>
              <Button type="submit" className="mt-2 w-full" disabled={busy} disabledTone="busy">
                {busy ? t.auth.signIn.checking : t.auth.signIn.continue}
              </Button>
              <StepAlert said={stepError} />
            </form>
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
            <StepAlert said={stepError} />
            {stepError && (
              <p className="mt-2 text-[13px] leading-[19.5px]">
                <button
                  type="button"
                  className={LINK}
                  onClick={() => void passkeyFirst(step.email)}
                >
                  {t.auth.retry}
                </button>
              </p>
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
              <StepAlert said={stepError} />
            </form>
          </>
        )}
      </div>
    </SignedOutShell>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1 font-display text-[26px] leading-[39px] font-semibold text-ink">
      {children}
    </h2>
  );
}

/** The passkey step has no field: its heading takes focus, so the step is announced. */
function FocusedTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h2
      ref={ref}
      tabIndex={-1}
      className="mb-1 font-display text-[26px] leading-[39px] font-semibold text-ink outline-none"
    >
      {children}
    </h2>
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

/** Label, field and the line under it, reserved whether or not it holds a sentence. */
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error: string | undefined;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className="flex flex-col gap-1 text-[11px] leading-[16.5px] text-muted">
      <label htmlFor={id}>{label}</label>
      {children(id, error ? messageId : undefined)}
      {/* Polite, so a sentence is read even when focus was already in the field. */}
      <span id={messageId} aria-live="polite" className="min-h-[16.5px] text-neg">
        {error && (
          <span key={error} className="animate-in duration-200 fade-in">
            {error}
          </span>
        )}
      </span>
    </div>
  );
}

function PasswordInput({
  id,
  inputRef,
  value,
  busy,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  busy: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <span className="relative block">
      <input
        ref={inputRef}
        id={id}
        type={shown ? 'text' : 'password'}
        name="password"
        autoComplete="current-password"
        autoFocus
        value={value}
        readOnly={busy}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${fieldClass(invalid)} pr-9`}
      />
      {/* Outside the label, so its name does not join the field's; the wrapper is what sits in
          the corner, because the tap overlay needs the button itself to be `relative`. */}
      <span className="absolute top-0 right-0">
        <button
          type="button"
          aria-label={shown ? t.auth.password.hide : t.auth.password.show}
          aria-controls={id}
          onClick={() => setShown((was) => !was)}
          className={`grid size-9 cursor-pointer place-items-center text-muted ${TAP_44}`}
        >
          <Icon aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </span>
    </span>
  );
}

/** A sentence about the whole step, below its button; re-inserted on each refusal. */
function StepAlert({ said }: { said: Said | undefined }) {
  const t = useT();
  if (!said) return null;
  return (
    <div
      key={said.n}
      role="alert"
      className="mt-3 animate-in text-[11px] leading-[16.5px] text-neg duration-200 fade-in"
    >
      {sentence(t, said.reason)}
    </div>
  );
}
