import { CircleAlert, CircleCheck, Eye, EyeOff } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';

import { TAP_44 } from '../../components/ui/tap-target';
import { useT } from '../../i18n/useT';

// The signed-out card's parts. Every field it draws is drawn here, because `field-border.test.ts`
// resolves a class only inside the file that declares it (#125), and #84's shared field is not in.

// `page` on `card`, as every field in the app; hover takes the edge to `ink`.
function fieldClass(invalid: boolean): string {
  return `block h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-field-border hover:border-ink'
  }`;
}

export const LINK = `cursor-pointer text-accent underline underline-offset-2 ${TAP_44}`;

export function Title({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1 font-display text-[26px] leading-[39px] font-semibold text-ink">
      {children}
    </h2>
  );
}

/** A step with no field: its heading takes focus, so the step is announced. */
export function FocusedTitle({ children }: { children: ReactNode }) {
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

/** Label, field and the line under it, reserved whether or not it holds a sentence. */
export function Field({
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

/** A field whose rule is on screen before any refusal. A refusal turns it `neg` with a glyph (WCAG
 *  1.4.1) and re-inserts it as an alert: an unchanged one is generally not announced (MDN). */
export function RuleField({
  label,
  rule,
  refused,
  children,
}: {
  label: string;
  rule: string;
  /** The refusal's count, a new one per refusal; undefined while none stands. */
  refused: number | undefined;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  const ruleId = `${id}-rule`;
  return (
    <div className="flex flex-col gap-1 text-[11px] leading-[16.5px] text-muted">
      <label htmlFor={id}>{label}</label>
      {children(id, ruleId)}
      {refused === undefined ? (
        <span id={ruleId} className="min-h-[16.5px]">
          {rule}
        </span>
      ) : (
        <span
          key={refused}
          id={ruleId}
          role="alert"
          className="flex min-h-[16.5px] animate-in gap-1 text-neg duration-200 fade-in"
        >
          <span className="flex-none pt-[2px]">
            <CircleAlert aria-hidden className="size-3" strokeWidth={2} />
          </span>
          <span>{rule}</span>
        </span>
      )}
    </div>
  );
}

/** FIDO's passkey mark, an asset in one flat colour — the button's own — and never a label. */
export function PasskeyMark() {
  return (
    <svg viewBox="50 58 111 111" aria-hidden fill="currentColor" className="block size-6 flex-none">
      <path
        fillRule="evenodd"
        d="M155.56,102.99c0,9.8-6.03,18.13-14.42,21.17l5.08,8.41l-7.51,9.24l7.51,9.03l-12.12,16.26l-8.54-9.11 v-18.41v-16.04c-7.59-3.45-12.91-11.35-12.91-20.55c0-12.37,9.61-22.4,21.45-22.4C145.95,80.6,155.56,90.62,155.56,102.99z M134.1,106.43c2.86,0,5.18-2.42,5.18-5.41c0-2.99-2.32-5.41-5.18-5.41s-5.18,2.42-5.18,5.41 C128.92,104.01,131.24,106.43,134.1,106.43z"
      />
      <path
        fillRule="evenodd"
        d="M155.62,103.06c0,9.68-5.87,17.93-14.09,21.09l4.68,8.42l-6.92,9.24l6.92,9.03l-12.11,16.39v-18.41v-23.3 v-19.1c2.86,0,5.18-2.42,5.18-5.41c0-2.99-2.32-5.41-5.18-5.41V80.6C145.99,80.6,155.62,90.65,155.62,103.06z"
      />
      <path
        fillRule="evenodd"
        d="M118.53,127.62c-6.93-5.69-11.58-14.43-12.22-24.36H69.17c-7.79,0-14.1,6.41-14.1,14.31v17.89 c0,3.95,3.16,7.16,7.05,7.16h49.36c3.89,0,7.05-3.2,7.05-7.16V127.62z"
      />
      <path d="M85.07,98.97c-1.72-0.33-3.43-0.64-5.05-1.32c-6.15-2.58-9.73-7.34-10.89-14.06 c-0.8-4.6-0.42-9.15,1.44-13.45c2.64-6.11,7.39-9.43,13.61-10.55c3.72-0.67,7.43-0.52,11.02,0.82 c5.4,2.01,9.01,5.87,10.69,11.55c1.69,5.72,1.44,11.45-1.11,16.86c-2.64,5.66-7.26,8.69-13.1,9.88c-0.49,0.1-0.97,0.2-1.46,0.29 C88.51,98.97,86.79,98.97,85.07,98.97z" />
    </svg>
  );
}

export function EmailInput({
  id,
  inputRef,
  name,
  autoComplete,
  autoFocus,
  spellCheck,
  value,
  busy,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  name: string;
  autoComplete: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  value: string;
  busy: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <input
      ref={inputRef}
      id={id}
      type="email"
      name={name}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      spellCheck={spellCheck}
      value={value}
      readOnly={busy}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={fieldClass(invalid)}
    />
  );
}

export function PasswordInput({
  id,
  inputRef,
  autoComplete,
  value,
  busy,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** `new-password` is what a password manager offers to generate into, and saves. */
  autoComplete: 'current-password' | 'new-password';
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
        autoComplete={autoComplete}
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

/** The card's way out, a sentence ending in a link. Inline in text, so it takes neither tap helper
 *  (`tap-target.ts`). */
export function Foot({
  prompt,
  to,
  children,
}: {
  prompt: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <p className="mt-[22px] text-[13px] leading-[19.5px] text-muted">
      {prompt}{' '}
      <Link to={to} className="text-accent underline underline-offset-2">
        {children}
      </Link>
    </p>
  );
}

/** A sentence about the whole step, below its button; a new `n` re-inserts it, so a repeat is
 *  announced again. */
export function StepAlert({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div
      key={n}
      role="alert"
      className="mt-3 animate-in text-[11px] leading-[16.5px] text-neg duration-200 fade-in"
    >
      {children}
    </div>
  );
}

// A live region just added is not heard at once: react-aria's announcer waits this long, having
// found that in Safari "less than 100ms were not consistent".
const REGION_SETTLES_MS = 100;

/** A sign-out's arrival: a status box whose words enter once it has settled (ARIA22). Held, they
 *  fade out of the accessibility tree and the box keeps its line, so nothing under it moves. */
export function SignedOutNote({ held, children }: { held: boolean; children: ReactNode }) {
  const [told, setTold] = useState(false);
  useEffect(() => {
    const wait = setTimeout(() => setTold(true), REGION_SETTLES_MS);
    return () => clearTimeout(wait);
  }, []);
  return (
    <div role="status" className="mb-4 min-h-[19.5px] text-[13px] leading-[19.5px] text-ink">
      {told && (
        <p
          className={`flex animate-in items-start gap-2 transition-[opacity,visibility] duration-200 ease-soft fade-in ${
            held ? 'invisible opacity-0' : ''
          }`}
        >
          <CircleCheck
            aria-hidden
            className="mt-[1.75px] size-4 flex-none text-info"
            strokeWidth={2}
          />
          {children}
        </p>
      )}
    </div>
  );
}
