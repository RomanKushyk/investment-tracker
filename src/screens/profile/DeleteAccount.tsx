import { deletionLastDay } from '@quirenote/core/deletion';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { leaveThroughLogout, session, showAnswer } from '../../auth/app';
import type { ReauthPurpose } from '../../auth/google';
import { signedOutBy, type SignedOutCause } from '../../auth/signed-out';
import { Button } from '../../components/ui/Button';
import { AlertDialogCancel } from '../../components/ui/Dialog';
import { useDeleteAccount } from '../../hooks/queries';
import { useFormat } from '../../hooks/useFormat';
import { rich } from '../../i18n/rich';
import { useT } from '../../i18n/useT';
import type { DeletionTiming } from '../../lib/repository';
import { NewTabLink } from '../sign-in/parts';
import {
  Body,
  Footer,
  Header,
  Reauthentication,
  Title,
  type ActOutcome,
  type ReauthLines,
  type Ways,
} from './Reauthentication';

// «ВИДАЛИТИ ОБЛІКОВИЙ ЗАПИС» (`account-deletion.dc.html` T2–T5): the confirmation armed by the
// account's own address, the timing the button pressed, the shared step, then the deletion and a
// landing that says what became of the account.

export function DeleteAccount({
  open,
  email,
  ways,
  arrived,
  timing: arrivedTiming,
  onClose,
}: {
  open: boolean;
  email: string;
  ways: Ways;
  arrived?: 'confirmed' | 'refused';
  /** Back from Google, the timing the trip was for. */
  timing?: DeletionTiming;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const d = t.profile.deleteAccount;
  const navigate = useNavigate();
  const deleteAccount = useDeleteAccount();
  const [timing, setTiming] = useState<DeletionTiming>(arrivedTiming ?? 'now');
  const [typed, setTyped] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  // The day the device promises, read once as the dialog opens; the landing names the stored one.
  const [lastDay] = useState(() => deletionLastDay(new Date()));
  // The address is data, not copy, so no translation can leave the buttons unarmable.
  const armed = typed.trim().toLowerCase() === email.toLowerCase();

  const r = d.reauth;
  const lines: ReauthLines =
    timing === 'now'
      ? {
          lead: r.lead,
          confirmedLead: r.confirmedLeadNow,
          action: r.actionNow,
          busy: r.busyNow,
          failed: r.failedNow,
        }
      : {
          lead: r.lead,
          confirmedLead: r.confirmedLeadLater(f.date(lastDay)),
          action: r.actionLater,
          busy: r.busyLater,
          failed: r.failedLater,
        };
  const purpose: ReauthPurpose = timing === 'now' ? 'delete:now' : 'delete:later';

  async function act(): Promise<ActOutcome> {
    const out = await deleteAccount(timing);
    if (out.kind === 'deleted' || out.kind === 'scheduled') {
      const cause: SignedOutCause =
        out.kind === 'deleted' ? { kind: 'deleted' } : { kind: 'scheduled', date: out.date };
      // Every session ended with the deletion; this tab's cookies go too, before any read meets
      // the gate, and the landing says why.
      const signedOut = await session.signOut();
      if (signedOut && leaveThroughLogout(signedOut.logout, '/sign-in', cause)) {
        // A Stop leaves the page here, signed out: no answer may stand over it naming who is in.
        showAnswer(undefined);
        return { kind: 'left' };
      }
      await navigate('/sign-in', { flushSync: true, state: signedOutBy(cause) });
      // A read answered while the rows went is held over every route; the landing replaces it.
      showAnswer(undefined);
      return { kind: 'landed' };
    }
    if (out.kind === 'reauthenticate') return out;
    return out.kind === 'sole' ? { kind: 'failed', sentence: d.superAdmin } : { kind: 'failed' };
  }

  const newTab = (label: string, href: string, key: number) => (
    <NewTabLink key={key} label={label} href={href} />
  );
  const choose = (next: DeletionTiming, proceed: () => void) => {
    setTiming(next);
    proceed();
  };

  return (
    <Reauthentication
      open={open}
      email={email}
      ways={ways}
      arrived={arrived}
      onClose={onClose}
      lines={lines}
      purpose={purpose}
      act={act}
      // T2: focus lands in the field; back from Google there is none, and the title takes it.
      onOpenAutoFocus={(event) => {
        if (fieldRef.current === null) return;
        event.preventDefault();
        fieldRef.current.focus();
      }}
      confirm={(proceed) => (
        <>
          <Header title={<Title>{d.confirm.title}</Title>} lead={rich(d.confirm.body, newTab)} />
          <Body>
            <div className="flex flex-col gap-2 text-[12px] leading-[18px] text-muted">
              <p className="m-0">{d.confirm.nowMeans}</p>
              <p className="m-0">{d.confirm.laterMeans(f.date(lastDay))}</p>
            </div>
            <label
              htmlFor={fieldId}
              className="mt-4 mb-1 block text-[11px] leading-[16.5px] text-muted"
            >
              {t.danger.typeToConfirm(email)}
            </label>
            <input
              ref={fieldRef}
              id={fieldId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="block h-9 w-full rounded-[9px] border border-field-border bg-page px-3 font-body text-[13px] text-ink transition hover:border-ink max-md:text-[16px]"
            />
          </Body>
          {/* Stacked at every width, the destructive pair first (T2). */}
          <Footer>
            <div className="flex flex-col gap-2.5">
              <Button
                variant="danger"
                className="w-full"
                disabled={!armed}
                onClick={() => choose('now', proceed)}
              >
                {d.confirm.now}
              </Button>
              <Button
                variant="outlineDanger"
                className="w-full"
                disabled={!armed}
                onClick={() => choose('later', proceed)}
              >
                {d.confirm.later}
              </Button>
              <AlertDialogCancel asChild>
                <Button variant="outline" className="w-full">
                  {t.profile.signOutEverywhere.confirm.cancel}
                </Button>
              </AlertDialogCancel>
            </div>
          </Footer>
        </>
      )}
    />
  );
}
