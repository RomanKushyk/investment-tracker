import { Info } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { FUND_REFS, SOURCES, type FundRef, type Source } from '@quirenote/core/archive';
import { daysBetween } from '@quirenote/core/dates';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DatePicker } from '../../components/ui/DatePicker';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from '../../components/ui/Dialog';
import { Switch } from '../../components/ui/Switch';
import { TAP_44 } from '../../components/ui/tap-target';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import type { ArchiveStart, StartReply } from '../../lib/repository';

// THE TWO REPAIRS (`design/extensions/archive-admin.dc.html`, T2 and T5), each sent behind a
// confirmation that echoes it. The server's 422 is the one validator: the form checks nothing.

type Start = (start: ArchiveStart) => Promise<StartReply>;

export function Repairs({ start, className }: { start: Start; className: string }) {
  const t = useT();
  return (
    <Card radius={24} className={`p-[22px] ${className}`}>
      <div className="mb-3.5 text-[10px] tracking-[.12em] text-muted uppercase">
        {t.archive.repairs.title}
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-x-[22px]">
        <ObserveForm start={start} />
        <hr className="my-4 border-hairline md:hidden" />
        <ImportForm start={start} className="md:border-l md:border-hairline md:pl-[22px]" />
      </div>
    </Card>
  );
}

/** What a form shows of a start's answer: nothing for a start, else its refusal. */
type Refused = Exclude<StartReply, { kind: 'started' }> | undefined;
const refusedOf = (reply: StartReply): Refused => (reply.kind === 'started' ? undefined : reply);

/** The sentence for one 422 issue, by its field and code, else by its code alone. */
function fieldSentence(
  sentences: Readonly<Record<string, string>>,
  field: string,
  code: string,
): string | undefined {
  const name = /^refs\.\d+$/.test(field) ? 'refsN' : field;
  return sentences[`${name}.${code}`] ?? sentences[code];
}

/** One form's refusal, its owned fields' under each and any other under the form. Only the latest
 *  start's answer is shown, as a mutation observer keeps only its latest call's. */
function useRefusal(owned: readonly string[]) {
  const t = useT();
  const r = t.archive.repairs.refused;
  const [refused, setRefused] = useState<Refused>(undefined);
  const latest = useRef(0);
  const send = (sent: Promise<StartReply>) => {
    const n = (latest.current += 1);
    void sent.then((reply) => {
      if (n === latest.current) setRefused(refusedOf(reply));
    });
  };
  const issues = refused?.kind === 'invalid' ? refused.issues : [];
  const owner = (field: string) => owned.find((o) => field === o || field.startsWith(`${o}.`));
  const at = (field: string) => {
    const issue = issues.find((i) => owner(i.field) === field);
    return (
      issue && (fieldSentence(r.field, issue.field, issue.code) ?? r.other(issue.field, issue.code))
    );
  };
  const lines = issues
    .filter((i) => owner(i.field) === undefined)
    .map((i) => r.other(i.field, i.code));
  const sentence =
    refused === undefined || refused.kind === 'invalid' || refused.kind === 'prodOnly'
      ? undefined
      : refused.kind === 'startFailed'
        ? r.startFailed
        : refused.kind === 'throttled'
          ? r.throttled
          : refused.kind === 'offline'
            ? r.network
            : r.internal;
  return {
    refused,
    clear: () => setRefused(undefined),
    send,
    at,
    lines: sentence === undefined ? lines : [...lines, sentence],
  };
}

function ObserveForm({ start }: { start: Start }) {
  const t = useT();
  const f = useFormat();
  const o = t.archive.repairs.observe;
  const id = useId();
  const [source, setSource] = useState<Source>(SOURCES[0]);
  // Empty on arrival: the range is read off the coverage strips, and no range is the usual one.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);
  const refusal = useRefusal(['source', 'from', 'to']);
  const days = from !== '' && to !== '' && to >= from ? daysBetween(from, to) + 1 : undefined;
  return (
    <div role="group" aria-labelledby={`${id}-title`}>
      <FormHead id={`${id}-title`} title={o.title} helper={o.helper} />
      <div id={`${id}-source`} className="mt-3.5 mb-1.5 text-xs leading-[18px] text-muted">
        {o.source}
      </div>
      <SourceControl value={source} onChange={setSource} labelledBy={`${id}-source`} />
      <FieldError text={refusal.at('source')} />
      <div className="mt-3 grid grid-cols-2 gap-3 md:flex md:flex-wrap">
        {(
          [
            ['from', o.from, from, setFrom],
            ['to', o.to, to, setTo],
          ] as const
        ).map(([field, label, value, onChange]) => (
          <div key={field} className="md:w-[130px]">
            <label
              htmlFor={`${id}-${field}`}
              className="mb-1.5 block text-xs leading-[18px] text-muted"
            >
              {label}
            </label>
            <DatePicker
              id={`${id}-${field}`}
              value={value}
              onChange={onChange}
              className="w-full text-right whitespace-nowrap"
              invalid={refusal.at(field) !== undefined}
            />
            <FieldError text={refusal.at(field)} />
          </div>
        ))}
      </div>
      <StartButton
        onPress={() => {
          refusal.clear();
          setOpen(true);
        }}
      />
      <FormRefusal refused={refusal.refused} lines={refusal.lines} />
      <ConfirmStart
        open={open}
        onOpenChange={setOpen}
        title={t.archive.repairs.confirm.observe}
        echo={[
          [t.archive.repairs.confirm.operation, t.archive.repairs.confirm.ops.observe],
          [
            o.source,
            <>
              {o.sources[source]} · <span className="font-mono">{source}</span>
            </>,
          ],
          [o.from, from === '' ? '—' : f.date(from)],
          [o.to, to === '' ? '—' : f.date(to)],
          [t.archive.repairs.confirm.days, days === undefined ? '—' : f.numWhole(days)],
        ]}
        onStart={() => {
          setOpen(false);
          refusal.send(start({ mode: 'observe', source, from, to }));
        }}
      />
    </div>
  );
}

function ImportForm({ start, className }: { start: Start; className: string }) {
  const t = useT();
  const i = t.archive.repairs.import;
  const id = useId();
  const [refs, setRefs] = useState<readonly FundRef[]>(FUND_REFS);
  const [open, setOpen] = useState(false);
  const refusal = useRefusal(['refs']);
  // In the list's order, whichever order they were switched on in.
  const chosen = FUND_REFS.filter((ref) => refs.includes(ref));
  return (
    <div role="group" aria-labelledby={`${id}-title`} className={className}>
      <FormHead id={`${id}-title`} title={i.title} helper={i.helper} />
      <div className="mt-3.5 mb-1.5 text-xs leading-[18px] text-muted">{i.funds}</div>
      {FUND_REFS.map((ref) => (
        <div key={ref} className="flex items-center justify-between gap-3 py-1.5">
          <div className="min-w-0">
            <div className="font-mono text-[12.5px] leading-[18.75px]">{ref}</div>
            <div className="text-[11px] leading-[16.5px] text-muted">{i.names[ref]}</div>
          </div>
          <Switch
            checked={refs.includes(ref)}
            onCheckedChange={(on) =>
              setRefs((held) => (on ? [...held, ref] : held.filter((r) => r !== ref)))
            }
            label={i.names[ref]}
          />
        </div>
      ))}
      <FieldError text={refusal.at('refs')} />
      <StartButton
        onPress={() => {
          refusal.clear();
          setOpen(true);
        }}
      />
      <FormRefusal refused={refusal.refused} lines={refusal.lines} />
      <ConfirmStart
        open={open}
        onOpenChange={setOpen}
        title={t.archive.repairs.confirm.import}
        echo={[
          [t.archive.repairs.confirm.operation, t.archive.repairs.confirm.ops.importFundHistory],
          [i.funds, <span className="font-mono">{chosen.join(', ') || '—'}</span>],
        ]}
        onStart={() => {
          setOpen(false);
          refusal.send(start({ mode: 'importFundHistory', refs: chosen }));
        }}
      />
    </div>
  );
}

function FormHead({ id, title, helper }: { id: string; title: string; helper: string }) {
  return (
    <>
      <div id={id} className="text-[13px] font-semibold">
        {title}
      </div>
      <div className="mt-[3px] text-xs leading-[18px] text-muted">{helper}</div>
    </>
  );
}

/** Pressable while a start is out: each press is a start of its own, and the log shows both. */
function StartButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <div className="mt-4">
      <Button variant="outline" size="md" onClick={onPress}>
        {t.archive.repairs.start}
      </Button>
    </div>
  );
}

function FieldError({ text }: { text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <div role="alert" className="mt-1.5 text-[11px] leading-[16.5px] text-neg">
      {text}
    </div>
  );
}

/** Dev's 405 as a notice, since it is a fact of the environment, not a fault; any other refusal
 *  the form cannot place at a field, a line under the button. */
function FormRefusal({ refused, lines }: { refused: Refused; lines: string[] }) {
  const t = useT();
  if (refused?.kind === 'prodOnly') {
    return (
      <div
        role="status"
        className="mt-3 flex animate-in gap-2.5 rounded-2xl bg-info-tint px-4 py-3 text-xs leading-[18px] text-info-tint-text duration-200 fade-in"
      >
        <Info size={16} aria-hidden className="mt-px shrink-0" />
        <span>{t.archive.repairs.refused.prodOnly}</span>
      </div>
    );
  }
  if (lines.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-3 animate-in text-xs leading-[18px] text-neg duration-200 fade-in"
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

/** The source, on the language control's filled track: two segments and a thumb that slides. */
function SourceControl({
  value,
  onChange,
  labelledBy,
}: {
  value: Source;
  onChange: (source: Source) => void;
  labelledBy: string;
}) {
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-filled-track
      className="relative grid w-fit grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1"
    >
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-1 bottom-1 left-1 w-[calc((100%-12px)/2)] rounded-[7px] bg-card transition-transform duration-300 ease-soft"
        style={{ transform: `translateX(calc(${SOURCES.indexOf(value)} * (100% + 4px)))` }}
      />
      {SOURCES.map((source) => (
        <button
          key={source}
          type="button"
          role="radio"
          aria-checked={value === source}
          onClick={() => onChange(source)}
          className={`relative z-10 cursor-pointer rounded-[7px] px-3 py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${value === source ? 'text-ink' : 'text-page hover:opacity-85'}`}
        >
          {t.archive.repairs.observe.sources[source]}
        </button>
      ))}
    </div>
  );
}

/** The confirmation: the start as it will be sent, then «Запустити», the screen's one fill. */
function ConfirmStart({
  open,
  onOpenChange,
  title,
  echo,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  echo: [string, ReactNode][];
  onStart: () => void;
}) {
  const t = useT();
  const c = t.archive.repairs.confirm;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg leading-6 font-semibold">{title}</h3>
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <p className="m-0 mt-1 text-xs leading-[18px] text-muted">{c.body}</p>
        </AlertDialogDescription>
      </DialogHeader>
      <DialogBody>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[12px] bg-page px-3.5 py-3 text-[12.5px] leading-[18.75px]">
          {echo.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="m-0 text-right font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogBody>
      <DialogFooter>
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogCancel asChild>
            <Button variant="outline">{c.cancel}</Button>
          </AlertDialogCancel>
          {/* Radix keeps the closing panel pressable through its exit, so a second click of a
              double-click lands on a dialog already closed: it sends nothing. */}
          <Button onClick={() => open && onStart()}>{c.start}</Button>
        </div>
      </DialogFooter>
    </AlertDialog>
  );
}
