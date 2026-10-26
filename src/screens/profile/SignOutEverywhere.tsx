import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

import { cancelPasskey, leaveThroughLogout, session, signInDeps } from '../../auth/app';
import { signInWithAddress, signInWithPassword, type SignInDeps } from '../../auth/sign-in';
import { SIGNED_OUT } from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogHeader,
} from '../../components/ui/Dialog';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { BotCheck } from '../sign-in/BotCheck';
import { Field, LINK, PasswordInput, StepAlert } from '../sign-in/parts';
import type { Reason as SignInReason } from '../sign-in/refusals';
import { type BotCheckOf, afterPass, useBotCheck } from '../sign-in/useBotCheck';

// «ВИЙТИ НА ВСІХ ПРИСТРОЯХ» (`re-authentication.dc.html` T1–T4): the confirmation, a fresh sign-in the
// relay requires, then every session ends; a failed action keeps the proof (T5, without its timer).

type Step =
  | { name: 'confirm' }
  | { name: 'first' }
  | { name: 'passkey' }
  | { name: 'password' }
  | { name: 'confirmed' };

type Reason = SignInReason | 'actionFailed';
/** A sentence, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: Reason; n: number };

function sentence(t: Dict, reason: Reason): string {
  const own: Partial<Record<Reason, string>> = {
    actionFailed: t.profile.signOutEverywhere.reauth.failed,
    // The account is the signed-in one, so the sentence names the password alone (T3).
    wrong: t.reauth.password.wrong,
    notFinished: t.reauth.passkey.notFinished,
    passwordMissing: t.auth.password.missing,
    pending: t.auth.botCheck.pending,
    botCheck: t.auth.botCheck.failed,
    botCheckFailed: t.auth.botCheck.failed,
    botCheckUnavailable: t.auth.botCheck.unavailable,
    tooMany: t.auth.tooMany,
    offline: t.auth.offline,
  };
  return own[reason] ?? t.auth.failed;
}

// BUSY WITHOUT `disabled`, which would drop focus to the page (T10): announced as unavailable,
// drawn as sign-in's busy, and every handler returns while it holds.
const BUSY = 'aria-disabled:pointer-events-none aria-disabled:opacity-70';
const WIDE = 'max-md:w-full';
// Dialog.tsx's gutter: a top-anchored panel's rail floats, so every band draws it.
const GUTTER = 'px-[28px]';

export function SignOutEverywhere({
  open,
  email,
  onClose,
}: {
  open: boolean;
  /** The signed-in account's, shown and sent: the address is not asked for again. */
  email: string;
  onClose: () => void;
}) {
  const t = useT();
  const s = t.profile.signOutEverywhere;
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ name: 'confirm' });
  const [password, setPassword] = useState('');
  // A proof on its way to the relay: the pressed button reads «Перевіряємо…», «Скасувати» stays live.
  const [proving, setProving] = useState(false);
  // The passkey sheet has answered and its assertion is being checked.
  const [checking, setChecking] = useState(false);
  // The sign-out sent: nothing can recall it, so every control is busy and nothing closes the dialog.
  const [acting, setActing] = useState(false);
  // The page set out for Cognito's logout, the sign-out done: a Stop leaves it here, signed out.
  const [left, setLeft] = useState(false);
  const held = acting && !left;
  // The proof is this account's: another one in the tab ends the dialog (`accountChanges`).
  const changes = useSyncExternalStore(session.subscribe, session.accountChanges);
  const [opened] = useState(changes);
  const [said, setSaid] = useState<Said>();
  const [retrySaid, setRetrySaid] = useState<Said>();
  const [expired, setExpired] = useState(0);
  const expiredRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Each press and each close is a new run; an answer for an older one lands nowhere.
  const run = useRef(0);

  const say = (reason: Reason) => setSaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));
  const sayRetry = (reason: Reason) =>
    setRetrySaid((before) => ({ reason, n: (before?.n ?? 0) + 1 }));
  const stepCheck = {
    saying: said?.reason,
    say,
    passed: () => setSaid(afterPass),
    released: () => setProving(false),
  };
  const firstCheck = useBotCheck(stepCheck);
  const passwordCheck = useBotCheck(stepCheck);
  const retryCheck = useBotCheck({
    saying: retrySaid?.reason,
    say: sayRetry,
    passed: () => setRetrySaid(afterPass),
    released: () => {},
  });

  // Every way out ends the run, so a proof still out lands nowhere and its sheet goes.
  const dismiss = () => {
    run.current++;
    cancelPasskey();
    onClose();
  };
  const leave = useEffectEvent(dismiss);

  // A sheet still open outlives the dialog unless closed.
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
  }, [said]);
  // T6: the sentence takes focus when focus was in the step that went.
  useEffect(() => {
    if (expired > 0) expiredRef.current?.focus();
  }, [expired]);
  useEffect(() => {
    if (changes !== opened) leave();
  }, [changes, opened]);
  // A halted logout (Stop, or a navigation that superseded it) fires `navigateerror`.
  useEffect(() => {
    const navigation = (globalThis as { navigation?: EventTarget }).navigation;
    if (!left || !navigation) return;
    const stayed = () => leave();
    navigation.addEventListener('navigateerror', stayed);
    return () => navigation.removeEventListener('navigateerror', stayed);
  }, [left]);
  // Back from Cognito's logout can restore this page, busy as it left; it is signed out by then.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted && left) leave();
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, [left]);

  function begin() {
    const mine = ++run.current;
    setSaid(undefined);
    setRetrySaid(undefined);
    return () => mine === run.current;
  }

  function go(next: Step) {
    run.current++;
    cancelPasskey();
    for (const check of [firstCheck, passwordCheck, retryCheck]) check.forget();
    setProving(false);
    setChecking(false);
    setSaid(undefined);
    setRetrySaid(undefined);
    setPassword('');
    setStep(next);
  }

  // In flight nothing closes it; once the page set out, nothing is left to send.
  function close() {
    if (!held) dismiss();
  }

  /** No passkey offer follows, so the list it reads is not asked for; the sheet's answer turns the
   *  lead into «Перевіряємо…». */
  const depsFor = (current: () => boolean): SignInDeps => ({
    ...signInDeps,
    hasPasskey: async () => undefined,
    authenticate: async (options) => {
      const answered = await signInDeps.authenticate(options);
      if (current()) setChecking(true);
      return answered;
    },
  });

  // RFC 9470 §3: the client repeats the request with the fresh sign-in, so no second press (T10).
  async function act() {
    const current = begin();
    setProving(false);
    setActing(true);
    const out = await session.signOutEverywhere();
    if (out.kind === 'signedOut') {
      // The page is signed out now and leaves as a sign-out does; the dialog stays busy meanwhile.
      if (leaveThroughLogout(out.logout, '/sign-in')) return setLeft(true);
      await navigate('/sign-in', { flushSync: true, state: SIGNED_OUT });
      return;
    }
    if (!current()) return;
    setActing(false);
    if (out.kind === 'reauthenticate') {
      go({ name: 'first' });
      setExpired((n) => n + 1);
    } else {
      setChecking(false);
      setStep({ name: 'confirmed' });
      say('actionFailed');
    }
  }

  /** THE START IS THE PRESS'S FIRST WAIT, its token in hand, as sign-in's: Safari before 17.4 opens
   *  the passkey sheet only after one fetch and no other wait. */
  async function proveByAddress(token: string, check: BotCheckOf, refusedAs: (r: Reason) => void) {
    const current = begin();
    const outcome = await signInWithAddress(email, token, depsFor(current), () => {
      if (!current()) return false;
      setProving(false);
      setStep({ name: 'passkey' });
    });
    if (!current()) return;
    check.spent();
    if (outcome.kind === 'signedIn') return void act();
    setProving(false);
    setChecking(false);
    if (outcome.kind === 'password') go({ name: 'password' });
    else refusedAs(outcome.kind === 'refused' ? outcome.reason : 'failed');
  }

  function confirmFirst() {
    if (proving || acting) return;
    setExpired(0);
    const pressed = firstCheck.press('refuse', (token) => {
      setProving(true);
      void proveByAddress(token, firstCheck, say);
    });
    if (pressed === 'pending' || pressed === 'unavailable') {
      begin();
      say(pressed === 'pending' ? 'pending' : 'botCheckUnavailable');
    }
  }

  function retryPasskey() {
    if (acting) return;
    const pressed = retryCheck.press('refuse', (token) => {
      // The check's own refusal stays with the check, under the link.
      void proveByAddress(token, retryCheck, (reason) =>
        reason === 'botCheck' ? sayRetry(reason) : say(reason),
      );
    });
    if (pressed === 'pending') sayRetry('pending');
    else if (pressed === 'unavailable') sayRetry('botCheckUnavailable');
  }

  async function proveByPassword(typed: string, token: string) {
    const current = begin();
    setProving(true);
    const outcome = await signInWithPassword(email, typed, token, depsFor(current));
    if (!current()) return;
    passwordCheck.spent();
    if (outcome.kind === 'signedIn') return void act();
    setProving(false);
    say(outcome.kind === 'refused' ? outcome.reason : 'failed');
  }

  function confirmPassword(event: FormEvent) {
    event.preventDefault();
    if (proving || acting) return;
    // THE FIELD FIRST: an empty password waits for no token.
    if (!password) {
      begin();
      return say('passwordMissing');
    }
    const typed = password;
    const pressed = passwordCheck.press('wait', (token) => void proveByPassword(typed, token));
    if (pressed === 'unavailable') {
      begin();
      return say('botCheckUnavailable');
    }
    if (pressed === 'interactive') return;
    setSaid(undefined);
    setProving(true);
  }

  // The one sentence said on the field; every other is said under the row.
  const fieldError = said?.reason === 'passwordMissing' ? said : undefined;
  const stepError = said && said.reason !== 'passwordMissing' ? said : undefined;

  const cancel = (
    <AlertDialogCancel asChild>
      <Button
        variant="outline"
        className={`${WIDE} ${BUSY}`}
        aria-disabled={held || undefined}
        onClick={(event) => held && event.preventDefault()}
      >
        {s.confirm.cancel}
      </Button>
    </AlertDialogCancel>
  );
  const pressedLabel = acting ? s.reauth.busy : proving ? t.auth.signIn.checking : undefined;

  return (
    <AlertDialog open={open} anchor="top" onOpenChange={(next) => !next && close()}>
      <div
        key={step.name}
        className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1"
      >
        {step.name === 'confirm' && (
          <>
            <Header title={<Title>{s.confirm.title}</Title>} lead={s.confirm.body} />
            <Footer>
              <Row cancel={cancel}>
                <Primary busy={false} onPress={() => setStep({ name: 'first' })}>
                  {s.confirm.continue}
                </Primary>
              </Row>
            </Footer>
          </>
        )}

        {step.name === 'first' && (
          <>
            <Header
              title={<Title focus={expired === 0}>{t.reauth.title}</Title>}
              lead={s.reauth.lead}
            />
            <div className={`${GUTTER} flex flex-col`}>
              <Address email={email} spaced />
              {firstCheck.props && <BotCheck {...firstCheck.props} action="sign-in" />}
            </div>
            <Footer>
              <Row cancel={cancel}>
                <Primary busy={proving || acting} onPress={confirmFirst}>
                  {pressedLabel ?? t.reauth.continue}
                </Primary>
              </Row>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </Footer>
          </>
        )}

        {step.name === 'passkey' && (
          <>
            <Header
              title={<Title focus>{t.auth.passkey.title}</Title>}
              lead={t.auth.passkey.lead}
              status={acting ? s.reauth.busy : checking ? t.auth.signIn.checking : ''}
            />
            <div className={`${GUTTER} flex flex-col`}>
              <Address email={email} />
            </div>
            <Footer>
              <Row cancel={cancel}>
                <Button
                  variant="outline"
                  className={`${WIDE} ${BUSY}`}
                  aria-disabled={checking || acting || undefined}
                  onClick={() => !checking && !acting && go({ name: 'password' })}
                >
                  {t.reauth.passkey.usePassword}
                </Button>
              </Row>
              {/* The retry's widget enters with the sentence, as on sign-in (T2). */}
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
                    <button type="button" className={LINK} onClick={retryPasskey}>
                      {t.auth.retry}
                    </button>
                  </p>
                  {retrySaid && (
                    <StepAlert n={retrySaid.n}>{sentence(t, retrySaid.reason)}</StepAlert>
                  )}
                </>
              )}
            </Footer>
          </>
        )}

        {step.name === 'password' && (
          <form noValidate onSubmit={confirmPassword}>
            <Header title={<Title>{t.auth.password.title}</Title>} />
            <div className={`${GUTTER} flex flex-col`}>
              <Address email={email} spaced />
              {/* The address rides along for the password manager, as on sign-in. */}
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={email}
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
                    busy={proving || acting}
                    invalid={Boolean(fieldError)}
                    describedBy={describedBy}
                    onChange={setPassword}
                  />
                )}
              </Field>
              {passwordCheck.props && <BotCheck {...passwordCheck.props} action="sign-in" />}
            </div>
            <Footer>
              <Row cancel={cancel}>
                <Primary busy={proving || acting}>{pressedLabel ?? t.reauth.continue}</Primary>
              </Row>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </Footer>
          </form>
        )}

        {step.name === 'confirmed' && (
          <>
            <Header
              title={<Title focus>{t.reauth.confirmed.title}</Title>}
              lead={s.reauth.confirmedLead}
            />
            <Footer>
              <Row cancel={cancel}>
                <Primary busy={acting} onPress={() => void act()}>
                  {pressedLabel ?? s.reauth.action}
                </Primary>
              </Row>
              {stepError && <StepAlert n={stepError.n}>{sentence(t, stepError.reason)}</StepAlert>}
            </Footer>
          </>
        )}
      </div>
      {/* In place before its words and across the steps, so T6's sentence is announced; the
          footer's foot is under it. */}
      <div className={`${GUTTER} pb-6`}>
        <div
          ref={expiredRef}
          role="status"
          tabIndex={-1}
          className="text-[11px] leading-[16.5px] text-neg outline-none"
        >
          {expired > 0 && step.name === 'first' && <p className="mt-3">{t.reauth.expired}</p>}
        </div>
      </div>
    </AlertDialog>
  );
}

/** The confirmation's own type, so the flow reads as one dialog (T1). */
function Title({ focus = false, children }: { focus?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // As the step arrives, never later: focus then stays on a press (T10).
  const [onArrival] = useState(focus);
  useEffect(() => {
    if (onArrival) ref.current?.focus();
  }, [onArrival]);
  return (
    <AlertDialogTitle asChild>
      <h2
        ref={ref}
        tabIndex={-1}
        className="m-0 font-display text-[18px] leading-6 font-semibold text-ink outline-none"
      >
        {children}
      </h2>
    </AlertDialogTitle>
  );
}

/** `status` stands over the lead in its own line, the lead keeping the line's height (T2). */
function Header({ title, lead, status }: { title: ReactNode; lead?: string; status?: string }) {
  return (
    <DialogHeader>
      {title}
      {lead !== undefined && (
        <AlertDialogDescription asChild>
          <div className="mt-[3px] grid text-[12px] leading-[18px] text-muted">
            <span
              aria-hidden={status ? true : undefined}
              className={`col-start-1 row-start-1 ${status ? 'invisible' : ''}`}
            >
              {lead}
            </span>
            {status !== undefined && (
              <span role="status" className="col-start-1 row-start-1">
                {status}
              </span>
            )}
          </div>
        </AlertDialogDescription>
      )}
    </DialogHeader>
  );
}

function Address({ email, spaced = false }: { email: string; spaced?: boolean }) {
  return (
    <p className={`truncate text-[13px] leading-[19.5px] text-ink ${spaced ? 'mb-4' : ''}`}>
      {email}
    </p>
  );
}

/** The step's filled action; with no `onPress` it submits the step's form. */
function Primary({
  busy,
  onPress,
  children,
}: {
  busy: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type={onPress ? 'button' : 'submit'}
      className={`${WIDE} ${BUSY}`}
      aria-disabled={busy || undefined}
      onClick={onPress && (() => !busy && onPress())}
    >
      {children}
    </Button>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-4`}>{children}</div>;
}

/** The drawn order is the focus order (WCAG 2.4.3): below md the action stacks first (T1). */
function Row({ cancel, children }: { cancel: ReactNode; children: ReactNode }) {
  const desktop = useIsDesktop();
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:justify-end">
      {desktop ? (
        <>
          {cancel}
          {children}
        </>
      ) : (
        <>
          {children}
          {cancel}
        </>
      )}
    </div>
  );
}
