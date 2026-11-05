import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from '../../components/ui/Dialog';
import { useT } from '../../i18n/useT';
import type { Ruling, RulingReply } from '../../lib/repository';
import type { Target } from '../AdminUsers';

// THE FIVE CONFIRMATIONS (`design/extensions/admin-users.dc.html`, T4 and T5): a refusal is said
// above the buttons, the action left armed where a retry could land.

type Refused = Exclude<RulingReply, { kind: 'done' } | { kind: 'gate' }>;
/** Where a retry would repeat the answer, the action is withdrawn. */
const FINAL: ReadonlySet<string> = new Set([
  'self',
  'demo',
  'not_found',
  'already_decided',
  'undecided',
  'invalid_request',
]);
const PRIMARY: ReadonlySet<Ruling> = new Set(['approve', 'enable']);
const MARK = '\u0001';

export function ConfirmRuling({
  target: { row, ruling },
  rule,
  onClose,
  onGate,
}: {
  target: Target;
  rule: (ruling: Ruling, id: string) => Promise<RulingReply>;
  onClose: () => void;
  onGate: () => void;
}) {
  const t = useT();
  const u = t.users;
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<Refused>();
  const [typed, setTyped] = useState('');
  const withdrawn = refused?.kind === 'refused' && FINAL.has(refused.key);
  const armed = ruling !== 'delete' || typed.trim().toLowerCase() === row.email.toLowerCase();

  // Radix would send the focus of a removed button to the dialog itself.
  useEffect(() => {
    if (withdrawn) cancel.current?.focus();
  }, [withdrawn]);

  async function send() {
    if (busy.current || !armed) return;
    busy.current = true;
    // Focus stays on the action through its way and an armed refusal.
    action.current?.focus();
    setSending(true);
    const reply = await rule(ruling, row.id);
    busy.current = false;
    setSending(false);
    if (reply.kind === 'done') onClose();
    else if (reply.kind === 'gate') onGate();
    else setRefused(reply);
  }

  const [before, after] = u.confirm[ruling].body(MARK).split(MARK);
  return (
    <AlertDialog
      open
      // A ruling sent cannot be recalled, and its answer is said here: nothing closes it meanwhile.
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
      // Delete opens in its typed field, as DeleteAccount's does; the rest on Cancel, Radix's own.
      onOpenAutoFocus={
        ruling === 'delete'
          ? (event) => {
              event.preventDefault();
              field.current?.focus();
            }
          : undefined
      }
    >
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg leading-6 font-semibold">{u.confirm[ruling].title}</h3>
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <p className="m-0 mt-1 text-xs leading-[18px] [overflow-wrap:anywhere] text-muted">
            {before}
            <span className="font-semibold text-ink">{row.email}</span>
            {after}
          </p>
        </AlertDialogDescription>
      </DialogHeader>
      {ruling === 'delete' && (
        <DialogBody>
          <label
            htmlFor={fieldId}
            className="mt-4 mb-1 block text-[11px] leading-[16.5px] [overflow-wrap:anywhere] text-muted"
          >
            {t.danger.typeToConfirm(row.email)}
          </label>
          <input
            ref={field}
            id={fieldId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="block h-9 w-full rounded-[9px] border border-field-border bg-page px-3 font-body text-[13px] text-ink transition hover:border-ink max-md:text-[16px]"
          />
        </DialogBody>
      )}
      <DialogFooter>
        {refused !== undefined && <RefusalLine ruling={ruling} refused={refused} />}
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogCancel asChild>
            <Button
              ref={cancel}
              variant="outline"
              aria-disabled={sending || undefined}
              className="aria-disabled:opacity-70"
            >
              {u.cancel}
            </Button>
          </AlertDialogCancel>
          {!withdrawn && (
            // `aria-disabled` on its way, never `disabled`, which would drop the focus.
            <Button
              ref={action}
              variant={PRIMARY.has(ruling) ? 'primary' : 'danger'}
              disabled={!armed}
              aria-disabled={sending || undefined}
              className="aria-disabled:opacity-70"
              onClick={() => void send()}
            >
              {u.action[ruling]}
            </Button>
          )}
        </div>
      </DialogFooter>
    </AlertDialog>
  );
}

/** The refusal's sentence and its key in mono; 429 and no answer have no key (T5). */
function RefusalLine({ ruling, refused }: { ruling: Ruling; refused: Refused }) {
  const r = useT().users.refused;
  const internal =
    ruling === 'decline'
      ? r.internal_decline
      : ruling === 'disable'
        ? r.internal_disable
        : ruling === 'delete'
          ? r.internal_delete
          : r.internal;
  let sentence: string;
  let key: string | undefined;
  if (refused.kind === 'throttled') sentence = r.throttled;
  else if (refused.kind === 'offline') sentence = r.network;
  else if (refused.kind === 'failed') sentence = internal;
  else {
    key = refused.key;
    sentence =
      refused.key === 'internal'
        ? internal
        : refused.key === 'already_decided'
          ? ruling === 'disable'
            ? r.already_decided_disable
            : ruling === 'enable'
              ? r.already_decided_enable
              : r.already_decided_application
          : r[refused.key];
  }
  return (
    <div
      role="alert"
      className="mb-3 animate-in text-xs leading-[18px] [overflow-wrap:anywhere] text-neg duration-200 fade-in"
    >
      {sentence}
      {key !== undefined && (
        <>
          {' '}
          <span className="font-mono">{key}</span>
        </>
      )}
    </div>
  );
}
