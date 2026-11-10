import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  cancelPasskey,
  leaveFor,
  session,
  signInDeps,
  startGoogle,
  tabStorage,
} from '../../auth/app';
import {
  carryReauthentication,
  forgetReauthentication,
  type ReauthPurpose,
} from '../../auth/google';
import { signInWithAddress, signInWithPassword, type SignInDeps } from '../../auth/sign-in';
import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogHeader,
} from '../../components/ui/Dialog';
import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { BotCheck } from '../sign-in/BotCheck';
import { GoogleButton } from '../sign-in/GoogleButton';
import { Field, LINK, PasswordInput, StepAlert } from '../sign-in/parts';
import type { Reason as SignInReason } from '../sign-in/refusals';
import { type BotCheckOf, afterPass, useBotCheck } from '../sign-in/useBotCheck';

// THE RE-AUTHENTICATION STEP: the host's confirmation, a fresh sign-in, by a local credential or a
// round trip to Google, then the host's action; a failed action keeps the proof, and its window
// shows until it runs out. Sign-out everywhere and the deletion each bring their own lines and
// action.

/** The account's ways to prove it, from `GET /me/account` and the passkey list: Google is offered to an
 *  account with no password, alone or beside its passkey. */
export interface Ways {
  password: boolean;
  google: boolean;
  passkey: boolean;
}

/** The host's own lines around the shared step. */
export interface ReauthLines {
  lead: string;
  confirmedLead: string;
  action: string;
  busy: string;
  failed: string;
}

/** What the host's action came to: the page set out through Cognito's logout, or went its own way;
 *  a sign-in too old for it; or nothing done, which the same proof may ask again, said in the
 *  host's `failed` unless it names its own sentence. */
export type ActOutcome =
  | { kind: 'left' }
  | { kind: 'landed' }
  | { kind: 'reauthenticate' }
  | { kind: 'failed'; sentence?: string };

/** RE-AUTHENTICATION'S WINDOW, the API's and the relay's too: five minutes from the sign-in
 *  (*Auth model*). */
const WINDOW_S = 300;

type Step =
  | { name: 'confirm' }
  | { name: 'first' }
  | { name: 'passkey' }
  | { name: 'password' }
  | { name: 'confirmed' };

type Reason = SignInReason | 'actionFailed';
/** A sentence, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: Reason; n: number };

function sentence(t: Dict, reason: Reason, failed: string): string {
  const own: Partial<Record<Reason, string>> = {
    actionFailed: failed,
    googleFailed: t.reauth.google.failed,
    // The account is the signed-in one, so the sentence names the password alone.
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

// BUSY WITHOUT `disabled`, which would drop focus to the page: announced as unavailable,
// drawn as sign-in's busy, and every handler returns while it holds.
const BUSY = 'aria-disabled:pointer-events-none aria-disabled:opacity-70';
const WIDE = 'max-md:w-full';
// Dialog.tsx's gutter: a top-anchored panel's rail floats, so every band draws it.
const GUTTER = 'px-[28px]';

export function Reauthentication({
  open,
  email,
  ways,
  arrived,
  onClose,
  lines,
  purpose,
  act: action,
  confirm,
  onOpenAutoFocus,
}: {
  open: boolean;
  /** The signed-in account's, shown and sent: the address is not asked for again. */
  email: string;
  ways: Ways;
  /** Back from Google: the step confirmed, or refused there. */
  arrived?: 'confirmed' | 'refused';
  onClose: () => void;
  lines: ReauthLines;
  /** What a trip to Google is for, carried across it so the return reopens this host. */
  purpose: ReauthPurpose;
  /** The host's action, run on the fresh proof; it leaves the page itself when it is done. */
  act: () => Promise<ActOutcome>;
  /** The host's first state; `proceed` swaps in the proof's. */
  confirm: (proceed: () => void, cancel: ReactNode) => ReactNode;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(() =>
    arrived === 'confirmed'
      ? { name: 'confirmed' }
      : arrived === 'refused'
        ? { name: 'first' }
        : { name: 'confirm' },
  );
  // No local credential to ask for: the first state is Google's own button, with no check.
  const googleFirst = !ways.password && ways.google && !ways.passkey;
  const [password, setPassword] = useState('');
  // A proof on its way to the relay: the pressed button reads «Перевіряємо…», «Скасувати» stays live.
  const [proving, setProving] = useState(false);
  // The passkey sheet has answered and its assertion is being checked.
  const [checking, setChecking] = useState(false);
  // The action sent: nothing can recall it, so every control is busy and nothing closes the dialog.
  const [acting, setActing] = useState(false);
  // The page set out for Cognito's logout, the action done: a Stop leaves it here, signed out.
  const [left, setLeft] = useState(false);
  // From the press until the page has gone to Google, which nothing recalls either.
  const [bound, setBound] = useState(false);
  const held = (acting && !left) || bound;
  // The proof is this account's: another one in the tab ends the dialog (`accountChanges`).
  const changes = useSyncExternalStore(session.subscribe, session.accountChanges);
  const [opened] = useState(changes);
  const [said, setSaid] = useState<Said | undefined>(() =>
    arrived === 'refused' ? { reason: 'googleFailed', n: 1 } : undefined,
  );
  const [retrySaid, setRetrySaid] = useState<Said>();
  // A failed action's own sentence, where the host names one.
  const [failure, setFailure] = useState<string>();
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
  // The sentence takes focus when focus was in the step that went.
  useEffect(() => {
    if (expired > 0) expiredRef.current?.focus();
  }, [expired]);
  useEffect(() => {
    if (changes !== opened) leave();
  }, [changes, opened]);
  // A halted logout or trip to Google (Stop, or a navigation that superseded it) fires
  // `navigateerror`: signed out, the dialog goes; bound for Google, nothing went.
  useEffect(() => {
    const navigation = (globalThis as { navigation?: EventTarget }).navigation;
    if (!(left || bound) || !navigation) return;
    const stayed = () => {
      if (left) return leave();
      forgetReauthentication(tabStorage());
      setBound(false);
    };
    navigation.addEventListener('navigateerror', stayed);
    return () => navigation.removeEventListener('navigateerror', stayed);
  }, [left, bound]);
  // Back from Cognito's logout can restore this page, busy as it left; it is signed out by then.
  // Back from Google restores it bound, and nothing came back from there.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (left) leave();
      else if (bound) {
        forgetReauthentication(tabStorage());
        setBound(false);
      }
    };
    addEventListener('pageshow', restored);
    return () => removeEventListener('pageshow', restored);
  }, [left, bound]);

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

  // RFC 9470 §3: the client repeats the request with the fresh sign-in, so no second press.
  async function act() {
    const current = begin();
    setProving(false);
    setActing(true);
    const out = await action();
    // The page is signed out now and leaves; the dialog stays busy meanwhile.
    if (out.kind === 'left') return setLeft(true);
    if (out.kind === 'landed') return;
    if (!current()) return;
    setActing(false);
    if (out.kind === 'reauthenticate') {
      go({ name: 'first' });
      setExpired((n) => n + 1);
    } else {
      setChecking(false);
      setFailure(out.sentence);
      setStep({ name: 'confirmed' });
      say('actionFailed');
    }
  }

  // THE PAGE LEAVES FOR GOOGLE naming this tab's account, which the relay asks Google to sign in
  // again; the tab carries the fact across, and the return lands confirmed with nothing run.
  async function toGoogle() {
    if (held || acting) return;
    setExpired(0);
    const current = begin();
    setBound(true);
    const sub = await session.getAccount();
    const begun = sub === undefined ? ({ refused: 'failed' } as const) : await startGoogle(sub);
    if (!current()) return setBound(false);
    if ('url' in begun) {
      carryReauthentication(tabStorage(), purpose);
      leaveFor(begun.url);
      return;
    }
    setBound(false);
    say(begun.refused === 'offline' ? 'offline' : 'googleFailed');
  }

  function expire() {
    if (acting) return;
    go({ name: 'first' });
    setExpired((n) => n + 1);
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

  const words = (reason: Reason) => sentence(t, reason, failure ?? lines.failed);
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
        {t.profile.signOutEverywhere.confirm.cancel}
      </Button>
    </AlertDialogCancel>
  );
  const pressedLabel = acting ? lines.busy : proving ? t.auth.signIn.checking : undefined;
  const google = (
    <GoogleButton
      busy={bound || checking || acting}
      className={WIDE}
      onClick={() => void toGoogle()}
    >
      {t.auth.google.continue}
    </GoogleButton>
  );
  const authTime = session.authTime();

  return (
    <AlertDialog
      open={open}
      anchor="top"
      onOpenChange={(next) => !next && close()}
      onOpenAutoFocus={onOpenAutoFocus}
    >
      <div
        key={step.name}
        className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1"
      >
        {step.name === 'confirm' && confirm(() => setStep({ name: 'first' }), cancel)}

        {step.name === 'first' && (
          <>
            <Header
              title={<Title focus={expired === 0}>{t.reauth.title}</Title>}
              lead={lines.lead}
            />
            <div className={`${GUTTER} flex flex-col`}>
              <Address email={email} spaced={!googleFirst} />
              {!googleFirst && firstCheck.props && (
                <BotCheck {...firstCheck.props} action="sign-in" />
              )}
            </div>
            <Footer>
              <Row cancel={cancel}>
                {googleFirst ? (
                  google
                ) : (
                  <Primary busy={proving || acting} onPress={confirmFirst}>
                    {pressedLabel ?? t.reauth.continue}
                  </Primary>
                )}
              </Row>
              {stepError && <StepAlert n={stepError.n}>{words(stepError.reason)}</StepAlert>}
            </Footer>
          </>
        )}

        {step.name === 'passkey' && (
          <>
            <Header
              title={<Title focus>{t.auth.passkey.title}</Title>}
              lead={t.auth.passkey.lead}
              status={acting ? lines.busy : checking ? t.auth.signIn.checking : ''}
            />
            <div className={`${GUTTER} flex flex-col`}>
              <Address email={email} />
            </div>
            <Footer>
              {/* The account's second way: its password, else Google, else none. */}
              <Row cancel={cancel}>
                {ways.password ? (
                  <Button
                    variant="outline"
                    className={`${WIDE} ${BUSY}`}
                    aria-disabled={checking || acting || undefined}
                    onClick={() => !checking && !acting && go({ name: 'password' })}
                  >
                    {t.reauth.passkey.usePassword}
                  </Button>
                ) : (
                  ways.google && google
                )}
              </Row>
              {/* The retry's widget enters with the sentence, as on sign-in
                  (`docs/superpowers/specs/2026-11-05-layout-refresh/signed-out.md`
                  § Перенесено). */}
              {(stepError || retrySaid) && (
                <>
                  {stepError && <StepAlert n={stepError.n}>{words(stepError.reason)}</StepAlert>}
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
                  {retrySaid && <StepAlert n={retrySaid.n}>{words(retrySaid.reason)}</StepAlert>}
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
              <Field label={t.auth.password.label} error={fieldError && words(fieldError.reason)}>
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
              {stepError && <StepAlert n={stepError.n}>{words(stepError.reason)}</StepAlert>}
            </Footer>
          </form>
        )}

        {step.name === 'confirmed' && (
          <>
            <Header
              title={<Title focus>{t.reauth.confirmed.title}</Title>}
              lead={lines.confirmedLead}
            />
            {authTime !== undefined && (
              <div className={`${GUTTER} flex flex-col`}>
                <TimeLeft until={(authTime + WINDOW_S) * 1000} held={acting} onOut={expire} />
              </div>
            )}
            <Footer>
              <Row cancel={cancel}>
                <Primary busy={acting} onPress={() => void act()}>
                  {pressedLabel ?? lines.action}
                </Primary>
              </Row>
              {stepError && <StepAlert n={stepError.n}>{words(stepError.reason)}</StepAlert>}
            </Footer>
          </>
        )}
      </div>
      {/* In place before its words and across the steps, so the expired sentence is announced;
          the footer's foot is under it. */}
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

/** THE TIME LEFT: minutes rounded up, then seconds from 60 (hmrc-frontend's timeout dialog), each
 *  redraw scheduling the next; while `held` by the action, zero waits for its answer. */
function TimeLeft({ until, held, onOut }: { until: number; held: boolean; onOut: () => void }) {
  const t = useT();
  const f = useFormat();
  const [left, setLeft] = useState(() => until - Date.now());
  // Filled only once the region is in place, so the reminder is announced however late it lands.
  const [remind, setRemind] = useState(false);
  const out = useEffectEvent(onOut);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = until - Date.now();
      setLeft(now);
      setRemind(now <= 60_000);
      if (now <= 0) return void (held || out());
      const seconds = Math.ceil(now / 1000);
      const next = seconds <= 60 ? (seconds - 1) * 1000 : (Math.ceil(seconds / 60) - 1) * 60_000;
      timer = setTimeout(tick, now - next);
    };
    tick();
    return () => clearTimeout(timer);
  }, [until, held]);
  const seconds = Math.max(0, Math.ceil(left / 1000));
  const time =
    seconds <= 60 ? f.duration(seconds, 'second') : f.duration(Math.ceil(seconds / 60), 'minute');
  return (
    <>
      <div role="timer" aria-atomic="true" className="text-[12px] leading-[18px] text-muted">
        {t.reauth.timeLeft(time)}
      </div>
      <div role="status" className="sr-only">
        {remind && t.reauth.timeReminder}
      </div>
    </>
  );
}

/** The confirmation's own type, so the flow reads as one dialog. */
export function Title({ focus = false, children }: { focus?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // As the step arrives, never later: focus then stays on a press.
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

/** `status` stands over the lead in its own line, the lead keeping the line's height. */
export function Header({
  title,
  lead,
  status,
}: {
  title: ReactNode;
  lead?: ReactNode;
  status?: string;
}) {
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

/** A band between the header and the footer, in the panel's gutter. */
export function Body({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} flex flex-col`}>{children}</div>;
}

function Address({ email, spaced = false }: { email: string; spaced?: boolean }) {
  return (
    <p className={`truncate text-[13px] leading-[19.5px] text-ink ${spaced ? 'mb-4' : ''}`}>
      {email}
    </p>
  );
}

/** The step's filled action; with no `onPress` it submits the step's form. */
export function Primary({
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

export function Footer({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-4`}>{children}</div>;
}

/** The drawn order is the focus order (WCAG 2.4.3): below md the action stacks first
 *  (`docs/superpowers/specs/2026-11-05-layout-refresh/dialog-buttons-and-radii.md` § Signed). */
export function Row({ cancel, children }: { cancel: ReactNode; children?: ReactNode }) {
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
