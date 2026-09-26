import { Eye, EyeOff } from 'lucide-react';
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
