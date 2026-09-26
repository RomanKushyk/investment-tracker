import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { apply } from '../../auth/app';
import type { ApplyRefusal } from '../../auth/apply';
import { Button } from '../../components/ui/Button';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { EmailInput, Field, FocusedTitle, Foot, StepAlert, Title } from './parts';

/** A refusal, and a count that re-inserts its alert so a repeat is announced again. */
type Said = { reason: ApplyRefusal; n: number };

const ON_THE_FIELD: ApplyRefusal[] = ['emailMissing', 'emailInvalid'];

function sentence(t: Dict, reason: ApplyRefusal): string {
  return {
    emailMissing: t.auth.emailMissing,
    emailInvalid: t.auth.emailInvalid,
    throttled: t.auth.apply.busyServer,
    offline: t.auth.offline,
    failed: t.auth.apply.failed,
  }[reason];
}

const STEP = 'flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1';

/** The one-field application. The endpoint answers every address alike, so the recorded view
 *  promises no status and no email but the invitation. */
export function Apply() {
  const t = useT();
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaid(undefined);
    const outcome = await apply(address);
    setBusy(false);
    if (outcome.kind === 'recorded') setRecorded(outcome.email);
    else setSaid({ reason: outcome.reason, n: ++refusals.current });
  }

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
