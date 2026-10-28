import {
  Check,
  Clock,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { SOURCE } from '@quirenote/core/archive';
import { kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Scroller } from '../../components/ui/Scroller';
import type { PendingStart, ReadFailure, useArchiveRuns } from '../../hooks/queries';
import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import type { ArchiveOperation } from '../../lib/repository';
import { HeldRows } from './Coverage';

// THE RUN LOG (`design/extensions/archive-admin.dc.html`, T2, T3 and T6): newest first, a start
// still unanswered on top as the client's own row, a table at and above md and stacked rows below.

type State = 'pending' | ArchiveOperation['state'];
type Row = { kind: 'pending'; entry: PendingStart } | { kind: 'run'; run: ArchiveOperation };

const CHIP: Record<State, string> = {
  pending: 'border border-field-border text-muted',
  running: 'bg-info-tint text-info-tint-text',
  succeeded: 'bg-panel text-ink',
  failed: 'bg-warn-tint text-warn-tint-text',
};
const GLYPH: Record<State, LucideIcon> = {
  pending: Clock,
  running: LoaderCircle,
  succeeded: Check,
  failed: TriangleAlert,
};

export function RunLog({
  log,
  me,
  className,
}: {
  log: ReturnType<typeof useArchiveRuns>;
  /** The caller's user id: a run they started reads «Ви». */
  me: string;
  className: string;
}) {
  const t = useT();
  const desktop = useIsDesktop();
  const r = t.archive.runs;
  const rows: Row[] = [
    ...log.pending.map((entry): Row => ({ kind: 'pending', entry })),
    ...(log.runs ?? []).map((run): Row => ({ kind: 'run', run })),
  ];
  let body: ReactNode;
  if (rows.length > 0) {
    body = desktop ? <Table rows={rows} me={me} /> : <Stack rows={rows} me={me} />;
  } else if (log.runs !== undefined) {
    body = (
      <div className="flex gap-2.5 pt-[18px] pb-1 text-muted">
        <Clock size={16} aria-hidden className="mt-px shrink-0" />
        <div>
          <div className="text-[13px] font-semibold text-ink">{r.empty}</div>
          <div className="mt-0.5 text-xs leading-[18px]">{r.emptyLead}</div>
        </div>
      </div>
    );
  } else if (log.failure !== undefined && !log.loading) {
    body = <FirstFailed failure={log.failure} retry={log.read} />;
  } else {
    body = <HeldRows />;
  }
  return (
    <Card radius={24} className={`p-[22px] ${className}`} aria-busy={log.loading || undefined}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <div className="text-[10px] tracking-[.12em] text-muted uppercase">{r.title}</div>
        <span className="text-[11px] leading-[16.5px] text-muted">{r.order}</span>
      </div>
      {log.stale && log.failure !== undefined && <Stale failure={log.failure} at={log.failedAt} />}
      {body}
      {log.more !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            variant="outline"
            size="sm"
            aria-disabled={log.loadingMore || undefined}
            className="aria-disabled:opacity-70"
            onClick={() => {
              if (!log.loadingMore) log.more?.();
            }}
          >
            {r.more}
          </Button>
          {log.moreFailed && log.failure !== undefined && (
            <span role="alert" className="text-[11px] leading-[16.5px] text-warn-tint-text">
              {log.failure.kind === 'status'
                ? t.archive.read.status(log.failure.status)
                : t.archive.read.offline}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function Table({ rows, me }: { rows: Row[]; me: string }) {
  const t = useT();
  const c = t.archive.runs.columns;
  // As wide as the drawing's table at least: a narrower card scrolls it, as the spot check's
  // does, rather than squeezing the result column out.
  return (
    <Scroller orientation="horizontal">
      <table className="w-full min-w-[902px] table-fixed border-collapse font-mono text-[12.5px] leading-[18.75px]">
        <colgroup>
          <col className="w-[128px]" />
          <col className="w-[200px]" />
          <col className="w-[150px]" />
          <col className="w-[96px]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            {[c.state, c.operation, c.started, c.by, c.result].map((label) => (
              <th
                key={label}
                className="py-2 pr-3 text-left text-[11px] leading-[16.5px] font-normal text-muted"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              data-run
              className="animate-in border-t border-hairline align-top duration-200 fade-in"
            >
              <td className="py-3 pr-3">
                <Chip state={stateOf(row)} />
              </td>
              <td className="py-3 pr-3">
                <Operation row={row} />
              </td>
              <td className="py-3 pr-3">
                <Started row={row} />
                {row.kind === 'run' && row.run.state === 'running' && (
                  <div className="text-[11.5px] leading-[17px] text-muted">
                    {t.archive.runs.until(kyivTimeHm(new Date(row.run.deadlineAt)))}
                  </div>
                )}
              </td>
              <td className="py-3 pr-3">
                <StartedBy row={row} me={me} />
              </td>
              <td className="py-3 pr-3">
                <Result row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

function Stack({ rows, me }: { rows: Row[]; me: string }) {
  const t = useT();
  return (
    <ul className="m-0 list-none p-0 font-mono text-[12.5px] leading-[18.75px]">
      {rows.map((row) => (
        <li
          key={keyOf(row)}
          data-run
          className="animate-in py-3.5 duration-200 fade-in not-first:border-t not-first:border-hairline"
        >
          <div className="mb-2 flex items-center justify-between gap-2.5">
            <Chip state={stateOf(row)} />
            <span className="text-[11px] text-muted">
              <Started row={row} />
            </span>
          </div>
          <Operation row={row} />
          <div className="mt-2">
            <Result row={row} />
          </div>
          <div className="mt-2 text-[11px] text-muted">
            {t.archive.runs.by} <StartedBy row={row} me={me} />
            {row.kind === 'run' &&
              row.run.state === 'running' &&
              ` · ${t.archive.runs.until(kyivTimeHm(new Date(row.run.deadlineAt)))}`}
          </div>
        </li>
      ))}
    </ul>
  );
}

const keyOf = (row: Row) => (row.kind === 'pending' ? row.entry.key : row.run.id);
const stateOf = (row: Row): State => (row.kind === 'pending' ? 'pending' : row.run.state);
const parametersOf = (row: Row): Record<string, unknown> =>
  row.kind === 'pending' ? row.entry.start : row.run.parameters;
const modeOf = (row: Row) => (row.kind === 'pending' ? row.entry.start.mode : row.run.mode);
/** A day the API served, or «—» where it holds none. */
const dayOr = (date: (iso: string) => string, v: unknown) =>
  typeof v === 'string' && v !== '' ? date(v) : '—';

/** Keyed by its state, so a state that changes cross-fades rather than swaps. */
function Chip({ state }: { state: State }) {
  const t = useT();
  const Glyph = GLYPH[state];
  return (
    <span
      key={state}
      className={`inline-flex h-[22px] animate-in items-center gap-[5px] rounded-[6px] px-2 text-[11px] leading-[16.5px] font-semibold whitespace-nowrap duration-200 fade-in ${CHIP[state]}`}
    >
      <Glyph
        size={12}
        strokeWidth={2}
        aria-hidden
        className={state === 'running' ? 'animate-spin' : undefined}
      />
      {t.archive.runs.state[state]}
    </span>
  );
}

function Operation({ row }: { row: Row }) {
  const t = useT();
  const f = useFormat();
  const p = parametersOf(row);
  if (modeOf(row) === 'observe') {
    const source = p.source === SOURCE.inzhur ? SOURCE.inzhur : SOURCE.nbuFairValue;
    return (
      <>
        <div className="font-bold">
          {t.archive.runs.observe(t.archive.repairs.observe.sources[source])}
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">
          {dayOr(f.date, p.from)} – {dayOr(f.date, p.to)}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="font-bold">{t.archive.runs.import}</div>
      <div className="text-[11.5px] leading-[17px] text-muted">
        <span className="font-mono">{Array.isArray(p.refs) ? p.refs.join(', ') : '—'}</span>
      </div>
    </>
  );
}

function Started({ row }: { row: Row }) {
  const t = useT();
  const f = useFormat();
  if (row.kind === 'pending') return <>{t.archive.runs.justNow}</>;
  const at = new Date(row.run.startedAt);
  return <>{`${f.date(kyivDateIso(at))}, ${kyivTimeHm(at)}`}</>;
}

/** «Ви» for the caller's own runs, else the first eight characters of the starter's id. */
function StartedBy({ row, me }: { row: Row; me: string }) {
  const t = useT();
  if (row.kind === 'pending' || row.run.startedBy === me) return <span>{t.archive.runs.you}</span>;
  return <span className="font-mono">{row.run.startedBy.slice(0, 8)}…</span>;
}

function Result({ row }: { row: Row }) {
  const t = useT();
  const f = useFormat();
  const r = t.archive.runs;
  if (row.kind === 'pending') return <div>{r.pending}</div>;
  const run = row.run;
  if (run.state === 'running') {
    return <div>{r.running(kyivTimeHm(new Date(run.deadlineAt)))}</div>;
  }
  if (run.state === 'failed') {
    const minutes = Math.round((Date.parse(run.deadlineAt) - Date.parse(run.startedAt)) / 60_000);
    const reason = run.error?.reason ?? '';
    return (
      <div className="flex flex-col gap-[3px]">
        <div>
          {reason === 'deadline_exceeded'
            ? r.reason.deadline_exceeded(minutes)
            : reason === 'start_failed' || reason === 'capture_failed'
              ? r.reason[reason]
              : reason}
        </div>
        {run.error?.message && (
          <div className="font-mono text-[11px] leading-[16.5px] break-all text-muted">
            {run.error.message}
          </div>
        )}
      </div>
    );
  }
  const result = run.result ?? {};
  const n = (v: unknown) => (typeof v === 'number' ? f.numWhole(v) : '—');
  const lines: string[] = [];
  if (run.mode === 'importFundHistory') {
    for (const fund of Array.isArray(result.funds)
      ? (result.funds as Record<string, unknown>[])
      : []) {
      const rows = typeof fund.rows === 'number' ? fund.rows : 0;
      const [from, to] = [dayOr(f.date, fund.from), dayOr(f.date, fund.to)];
      lines.push(r.fund(String(fund.ref), rows, n(fund.rows), n(fund.written), from, to));
    }
  } else if (run.parameters.source === SOURCE.inzhur) {
    lines.push(
      r.inzhur(
        n(result.dates),
        n(result.written),
        n(result.skipped),
        n(result.termsWritten),
        n(result.termsRefused),
      ),
    );
  } else {
    lines.push(r.nbu(n(result.dates), n(result.written), n(result.mismatched)));
  }
  return (
    <div className="flex flex-col gap-[3px]">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
      {result.complete === false && typeof result.nextFrom === 'string' && (
        <div className="inline-flex items-center gap-[5px] font-semibold text-warn-tint-text">
          <TriangleAlert size={12} aria-hidden className="shrink-0" />
          {r.incomplete(f.date(result.nextFrom))}
        </div>
      )}
    </div>
  );
}

/** A poll that failed with rows in hand: the rows stay, and the poll goes on. */
function Stale({ failure, at }: { failure: ReadFailure; at: number }) {
  const t = useT();
  const hm = kyivTimeHm(new Date(at));
  return (
    <div className="-mt-1 mb-2.5 inline-flex items-center gap-[5px] text-[11px] leading-[16.5px] text-warn-tint-text">
      <TriangleAlert size={12} aria-hidden className="shrink-0" />
      {failure.kind === 'status'
        ? t.archive.runs.staleStatus(hm, failure.status)
        : t.archive.runs.staleOffline(hm)}
    </div>
  );
}

function FirstFailed({ failure, retry }: { failure: ReadFailure; retry: () => void }) {
  const t = useT();
  const cause =
    failure.kind === 'status' ? t.archive.read.status(failure.status) : t.archive.read.offline;
  return (
    <div className="flex gap-2.5">
      <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{t.archive.runs.failed}</div>
        <div className="mt-[3px] text-xs leading-[18px] text-muted">
          {t.archive.runs.failedLead(cause)}
        </div>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw size={14} aria-hidden />
            {t.archive.read.retry}
          </Button>
        </div>
      </div>
    </div>
  );
}
