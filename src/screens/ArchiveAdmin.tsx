import { Archive, ChevronLeft, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';

import { SOURCES } from '@quirenote/core/archive';
import { kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';
import { NotFound } from '../app/Boundaries';
import { useSessionStatus } from '../auth/app';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TAP_44 } from '../components/ui/tap-target';
import { useArchiveDiagnosis, useArchiveRuns, useMe, type ReadFailure } from '../hooks/queries';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { CoverageCard } from './archive/Coverage';
import { Figures } from './archive/Figures';
import { Repairs } from './archive/Repairs';
import { RunLog } from './archive/RunLog';
import { SpotCheck } from './archive/SpotCheck';

// THE SUPER-ADMIN'S ARCHIVE PANEL (`design/extensions/archive-admin.dc.html`, T1–T6). The route is
// the super-admin's alone: until `GET /me` answers nothing is drawn, so no other role sees it
// arrive, and anyone else gets the app's not-found. A failed `/me` throws, as the profile's does.
export function ArchiveAdmin() {
  const signedIn = useSessionStatus() === 'signedIn';
  return signedIn ? <Gate /> : null;
}

function Gate() {
  const me = useMe();
  if (me === undefined) return null;
  return me.role === 'super_admin' ? <Panel me={me.userId} /> : <NotFound />;
}

const CARD = 'animate-in duration-300 fade-in slide-in-from-bottom-1';

function Panel({ me }: { me: string }) {
  const t = useT();
  const diagnosis = useArchiveDiagnosis();
  const log = useArchiveRuns();
  const { data, failure, fetching } = diagnosis;
  // The first read's failure is a card that holds the retry; a refresh's keeps the answer in hand.
  const firstFailed = data === undefined && failure !== undefined && !fetching;
  const unread = data === undefined && failure === undefined && !fetching;
  // A press in a card that leaves takes focus to the slot's busy button (T3), and a first read that
  // fails takes it on to the card's retry; a failure found on arrival moves nothing.
  const slot = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const toSlot = useRef(false);
  const readHere = useRef(false);
  useEffect(() => {
    if (fetching && toSlot.current) slot.current?.focus();
    toSlot.current = false;
  }, [fetching]);
  useEffect(() => {
    if (firstFailed && readHere.current && document.activeElement === document.body) {
      retry.current?.focus();
    }
  }, [firstFailed]);
  const readFromCard = () => {
    toSlot.current = true;
    readHere.current = true;
    diagnosis.read();
  };

  if (failure?.kind === 'refused' || log.failure?.kind === 'refused') return <NotFound />;
  const day = data === undefined ? undefined : kyivDateIso(new Date(diagnosis.at));

  return (
    <div>
      <Link
        to="/settings"
        className={`${TAP_44} mb-1.5 flex w-fit items-center gap-1 text-xs leading-[18px] text-muted transition-colors hover:text-ink`}
      >
        <ChevronLeft size={14} aria-hidden />
        {t.screen.archive.back}
      </Link>
      <ScreenHeader
        title={t.screen.archive.title}
        subtitle={t.screen.archive.subtitle}
        actions={
          unread || firstFailed ? undefined : (
            <Slot
              diagnosis={diagnosis}
              failure={data === undefined ? undefined : failure}
              button={slot}
            />
          )
        }
      />
      {/* The operator's order: the figures, then the repairs and the log above the long group
          list, where a start's result is read. */}
      <div className="flex flex-col gap-3.5" aria-busy={fetching && data === undefined}>
        {unread ? (
          <ReadCard
            glyph={<Archive size={16} aria-hidden />}
            title={t.archive.read.unread}
            lead={t.archive.read.unreadLead}
            action={t.archive.read.start}
            actionGlyph={<Archive size={16} aria-hidden />}
            onAction={readFromCard}
          />
        ) : firstFailed ? (
          <ReadCard
            glyph={<TriangleAlert size={16} aria-hidden className="text-warn" />}
            title={t.archive.read.failed}
            lead={<FailureSentence failure={failure} />}
            action={t.archive.read.retry}
            actionGlyph={<RefreshCw size={16} aria-hidden />}
            onAction={readFromCard}
            button={retry}
          />
        ) : (
          <Figures answer={data} className={CARD} />
        )}
        <Repairs start={log.start} className={`${CARD} delay-75`} />
        <RunLog log={log} me={me} className={`${CARD} delay-150`} />
        {!unread && !firstFailed && (
          <>
            {SOURCES.map((source, i) => (
              <CoverageCard
                key={source}
                source={source}
                answer={data}
                day={day}
                className={`${CARD} ${i === 0 ? 'delay-75' : 'delay-150'}`}
              />
            ))}
            <SpotCheck answer={data} className={`${CARD} delay-200`} />
          </>
        )}
      </div>
    </div>
  );
}

/** The snapshot's time and the one button that reads again, busy while a read is out. */
function Slot({
  diagnosis,
  failure,
  button,
}: {
  diagnosis: ReturnType<typeof useArchiveDiagnosis>;
  failure: ReadFailure | undefined;
  button: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const f = useFormat();
  const r = t.archive.read;
  const { data, at, fetching } = diagnosis;
  const stamp =
    data === undefined ? '' : `${f.date(kyivDateIso(new Date(at)))}, ${kyivTimeHm(new Date(at))}`;
  return (
    <>
      {fetching ? (
        <span className="text-[11px] text-muted">
          {data === undefined ? r.reading : r.refreshingAt(stamp)}
        </span>
      ) : failure !== undefined ? (
        <span className="inline-flex items-center gap-[5px] text-[11px] text-warn-tint-text">
          <TriangleAlert size={12} aria-hidden className="shrink-0" />
          {r.refreshFailed(stamp)}
          <FailureCode failure={failure} />
        </span>
      ) : (
        <span className="text-[11px] text-muted">{r.stamp(stamp)}</span>
      )}
      {/* `aria-disabled`, never `disabled`, while it reads: disabling would drop the focus a
          press just took there. */}
      <Button
        ref={button}
        variant="outline"
        size="header"
        aria-disabled={fetching || undefined}
        className="aria-disabled:opacity-70"
        onClick={() => {
          if (!fetching) diagnosis.read();
        }}
      >
        <RefreshCw size={16} aria-hidden className={fetching ? 'animate-spin' : undefined} />
        {fetching ? (data === undefined ? r.starting : r.refreshing) : r.refresh}
      </Button>
    </>
  );
}

function FailureCode({ failure }: { failure: ReadFailure }) {
  const t = useT();
  if (failure.kind === 'key') return <span className="font-mono">{failure.key}</span>;
  if (failure.kind === 'status') return <span className="font-mono">HTTP {failure.status}</span>;
  return <span>{t.archive.read.offline}</span>;
}

/** What the card says of a failed read: the route's key with its sentence, else the status. */
function FailureSentence({ failure }: { failure: ReadFailure | undefined }) {
  const t = useT();
  const r = t.archive.read;
  if (failure?.kind === 'key') {
    return (
      <>
        {r[failure.key]} <span className="font-mono">{failure.key}</span>
      </>
    );
  }
  if (failure?.kind === 'status') return <>{r.status(failure.status)}</>;
  return <>{r.offline}</>;
}

function ReadCard({
  glyph,
  title,
  lead,
  action,
  actionGlyph,
  onAction,
  button,
}: {
  glyph: ReactNode;
  title: string;
  lead: ReactNode;
  action: string;
  actionGlyph: ReactNode;
  onAction: () => void;
  button?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Card radius={24} className={`p-[22px] ${CARD} delay-75`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex text-muted">{glyph}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="mt-[3px] text-xs leading-normal text-muted">{lead}</div>
          <div className="mt-3.5">
            <Button ref={button} variant="outline" size="md" onClick={onAction}>
              {actionGlyph}
              {action}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
