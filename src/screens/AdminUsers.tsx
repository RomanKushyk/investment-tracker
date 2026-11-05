import { Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';
import { NotFound } from '../app/Boundaries';
import { useSessionStatus } from '../auth/app';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Select } from '../components/ui/Select';
import {
  useAdminUsers,
  useMe,
  useRuleOnUser,
  type ReadFailure,
  type UsersReadKey,
} from '../hooks/queries';
import { useFormat } from '../hooks/useFormat';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useT } from '../i18n/useT';
import type { AdminUser, Ruling, UserStatus } from '../lib/repository';
import { ReadCard } from './ArchiveAdmin';
import { HeldRows } from './archive/Coverage';
import { ConfirmRuling } from './admin-users/ConfirmRuling';
import { useFocusFixup } from './admin-users/focus-fixup';

// КОРИСТУВАЧІ (`design/extensions/admin-users.dc.html`, T1–T5), gated as the archive panel is,
// its reads naming their failures as the panel's do (*Not found and failures*).
export function AdminUsers() {
  const signedIn = useSessionStatus() === 'signedIn';
  return signedIn ? <Gate /> : null;
}

function Gate() {
  const me = useMe();
  if (me === undefined) return null;
  return me.role === 'super_admin' ? <Page me={me.userId} /> : <NotFound />;
}

type Filter = 'pending' | 'active' | 'disabled';
const FILTERS: readonly Filter[] = ['pending', 'active', 'disabled'];
/** «Вимкнені» lists `rejected`: a declined application is deleted, so only a disabled account
 *  holds that status. */
const STATUS: Record<Filter, UserStatus> = {
  pending: 'pending',
  active: 'active',
  disabled: 'rejected',
};
const ACTS: Record<UserStatus, readonly Ruling[]> = {
  pending: ['approve', 'decline'],
  active: ['disable', 'delete'],
  rejected: ['enable', 'delete'],
};
const OUTLINE: ReadonlySet<Ruling> = new Set(['approve', 'enable']);

export type Target = { row: AdminUser; ruling: Ruling };

function Page({ me }: { me: string }) {
  const t = useT();
  const desktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>('pending');
  const [target, setTarget] = useState<Target>();
  const [gated, setGated] = useState(false);
  const list = useAdminUsers(STATUS[filter]);
  const rule = useRuleOnUser();
  const firstFailed = list.rows === undefined && list.failure !== undefined && !list.loading;

  const focus = useFocusFixup<HTMLDivElement>();

  // A retry that fails again takes focus back, unless the user moved it from where the fixup put
  // it; another filter's read is not this retry's.
  const retry = useRef<HTMLButtonElement>(null);
  const readHere = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    const unmoved = active === document.body || active === focus.landed.current;
    if (firstFailed && readHere.current && unmoved) retry.current?.focus();
    if (list.rows !== undefined || firstFailed) readHere.current = false;
  }, [firstFailed, list.rows, focus.landed]);
  useEffect(() => {
    readHere.current = false;
  }, [filter]);

  if (gated || list.failure?.kind === 'refused') return <NotFound />;
  const pick = (row: AdminUser, ruling: Ruling) => setTarget({ row, ruling });

  let body: ReactNode;
  if (list.rows === undefined) body = <HeldRows />;
  else if (list.rows.length === 0) body = <Empty filter={filter} />;
  else if (desktop) body = <Table rows={list.rows} filter={filter} me={me} pick={pick} />;
  else body = <Stack rows={list.rows} filter={filter} me={me} pick={pick} />;

  const panel = (
    <>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <div className="text-[10px] tracking-[.12em] text-muted uppercase">
          {t.users.filter[filter]}
        </div>
        <span className="text-[11px] leading-[16.5px] text-muted">{t.users.order}</span>
      </div>
      {list.stale && list.failure !== undefined && (
        <div className="-mt-1 mb-2.5">
          <ReadLine failure={list.failure} at={list.failedAt} />
        </div>
      )}
      {body}
      {list.more !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            data-more
            variant="outline"
            size="sm"
            aria-disabled={list.loadingMore || undefined}
            className="aria-disabled:opacity-70"
            onClick={() => {
              if (!list.loadingMore) list.more?.();
            }}
          >
            {t.archive.runs.more}
          </Button>
          {list.moreFailed && list.failure !== undefined && (
            <span role="alert">
              <ReadLine failure={list.failure} at={list.failedAt} />
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <div {...focus.props}>
      <ScreenHeader
        title={t.screen.users.title}
        subtitle={t.screen.users.subtitle}
        actions={<FilterControl value={filter} onChange={setFilter} />}
      />
      <div aria-busy={list.loading || undefined}>
        {firstFailed ? (
          <ReadCard
            glyph={<TriangleAlert size={16} aria-hidden className="text-warn" />}
            title={t.users.failed}
            lead={<FailureSentence failure={list.failure!} />}
            action={t.users.retry}
            actionGlyph={<RefreshCw size={16} aria-hidden />}
            onAction={() => {
              readHere.current = true;
              list.read();
            }}
            button={retry}
          />
        ) : desktop ? (
          <Card radius={24} className="p-[22px]">
            {panel}
          </Card>
        ) : (
          panel
        )}
      </div>
      {target !== undefined && (
        <ConfirmRuling
          key={`${target.ruling}:${target.row.id}`}
          target={target}
          rule={rule}
          onClose={() => setTarget(undefined)}
          onGate={() => {
            setTarget(undefined);
            setGated(true);
          }}
        />
      )}
    </div>
  );
}

/** PeriodControl's Select in the header slot, with no count on it (T1). */
function FilterControl({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const t = useT();
  const id = useId();
  return (
    <div className="flex w-[272px] flex-col gap-1">
      <span id={`${id}-label`} className="sr-only">
        {t.users.filter.label}
      </span>
      <Select
        id={`${id}-trigger`}
        ariaLabelledBy={`${id}-label ${id}-trigger`}
        value={value}
        onValueChange={(v) => onChange(v as Filter)}
        options={FILTERS.map((f) => ({ value: f, label: t.users.filter[f] }))}
      />
    </div>
  );
}

/** «dd.MM.yyyy, HH:mm» in Kyiv, or «—» for a row not decided yet. */
function Stamp({ at }: { at: string | null }) {
  const f = useFormat();
  if (at === null) return <>—</>;
  const d = new Date(at);
  return <>{`${f.date(kyivDateIso(d))}, ${kyivTimeHm(d)}`}</>;
}

function You() {
  const t = useT();
  return (
    <span className="ml-2 inline-flex h-5 flex-none items-center rounded-[5px] bg-accent-tint px-1.5 align-middle text-[11px] font-semibold text-ink">
      {t.users.you}
    </span>
  );
}

/** Portfolio's rowActions: outline for approve and enable, outlineDanger for the rest. */
function Actions({ row, pick }: { row: AdminUser; pick: (row: AdminUser, r: Ruling) => void }) {
  const t = useT();
  return (
    <>
      {ACTS[row.status].map((ruling) => (
        <Button
          key={ruling}
          variant={OUTLINE.has(ruling) ? 'outline' : 'outlineDanger'}
          size="sm"
          aria-label={t.users.actionAria(t.users.action[ruling], row.email)}
          onClick={() => pick(row, ruling)}
        >
          {t.users.action[ruling]}
        </Button>
      ))}
    </>
  );
}

type ListProps = {
  rows: AdminUser[];
  filter: Filter;
  me: string;
  pick: (row: AdminUser, r: Ruling) => void;
};

function Table({ rows, filter, me, pick }: ListProps) {
  const t = useT();
  const decided = filter !== 'pending';
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col />
        <col className="w-[150px]" />
        {decided && <col className="w-[150px]" />}
        <col className="w-[200px]" />
      </colgroup>
      <thead>
        <tr>
          {[
            t.users.col.email,
            t.users.col.applied,
            ...(decided ? [t.users.col.decided] : []),
            '',
          ].map((label, i) => (
            <th
              key={i}
              scope="col"
              className="py-2 pr-3 text-left text-[11px] leading-[16.5px] font-normal text-muted"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="animate-in border-t border-hairline duration-200 fade-in">
            <th scope="row" className="py-3 pr-3 text-left font-semibold">
              {/* The address clips, «Ви» never does. */}
              <div className="flex min-w-0 items-center">
                <span className="min-w-0 truncate">{row.email}</span>
                {row.id === me && <You />}
              </div>
            </th>
            <td className="py-3 pr-3 text-[12.5px] text-muted">
              <Stamp at={row.appliedAt} />
            </td>
            {decided && (
              <td className="py-3 pr-3 text-[12.5px] text-muted">
                <Stamp at={row.decidedAt} />
              </td>
            )}
            <td className="py-3">
              {/* Your own row has no action and keeps the others' height. */}
              <div
                className="flex justify-end gap-2.5"
                data-row-actions={row.id === me ? undefined : ''}
              >
                {row.id === me ? (
                  <span aria-hidden className="inline-block h-[30px]" />
                ) : (
                  <Actions row={row} pick={pick} />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stack({ rows, filter, me, pick }: ListProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3.5">
      {rows.map((row, i) => (
        <RecordCard
          key={row.id}
          index={i}
          title={<span className="text-[15px]">{row.email}</span>}
          tag={row.id === me ? <You /> : undefined}
          footer={
            row.id === me ? undefined : (
              <span data-row-actions className="contents">
                <Actions row={row} pick={pick} />
              </span>
            )
          }
        >
          <Fact label={t.users.col.applied}>
            <Stamp at={row.appliedAt} />
          </Fact>
          {filter !== 'pending' && (
            <Fact label={t.users.col.decided}>
              <Stamp at={row.decidedAt} />
            </Fact>
          )}
        </RecordCard>
      ))}
    </div>
  );
}

/** RunLog's empty line. Активні always holds your own row. */
function Empty({ filter }: { filter: Filter }) {
  const t = useT();
  return (
    <div className="flex gap-2.5 pt-[18px] pb-1 text-muted">
      <Inbox size={16} aria-hidden className="mt-px shrink-0" />
      <div className="text-[13px] font-semibold text-ink">
        {filter === 'active' ? '' : t.users.empty[filter]}
      </div>
    </div>
  );
}

/** The key's sentence and the key in mono; with no key, the archive's status or offline line. */
function FailureSentence({ failure }: { failure: ReadFailure<UsersReadKey> }) {
  const t = useT();
  if (failure.kind === 'key') {
    return (
      <>
        {t.users.refused[failure.key]} <span className="font-mono">{failure.key}</span>
      </>
    );
  }
  if (failure.kind === 'status') return <>{t.archive.read.status(failure.status)}</>;
  return <>{t.archive.read.offline}</>;
}

/** RunLog's Stale, for a re-read that failed with rows in hand: when, and the key. */
function ReadLine({ failure, at }: { failure: ReadFailure<UsersReadKey>; at: number }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-[5px] text-[11px] leading-[16.5px] text-warn-tint-text">
      <TriangleAlert size={12} aria-hidden className="shrink-0" />
      <span>
        {t.users.stale(kyivTimeHm(new Date(at)))}{' '}
        {failure.kind === 'key' ? (
          <span className="font-mono">{failure.key}</span>
        ) : failure.kind === 'status' ? (
          t.archive.read.status(failure.status)
        ) : (
          t.archive.read.offline
        )}
      </span>
    </span>
  );
}
