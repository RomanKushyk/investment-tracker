import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Dash } from '../../components/loading/Placeholder';
import { KpiCard } from '../../components/ui/KpiCard';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import type { ArchiveDiagnosis } from '../../lib/repository';
import { SOURCES, useMegabytes, type Source } from './sources';

/** One figure per source: the empty days its strips mark and count, then `gaps`, named for what
 *  it is because it nets, and the stored captures. `undefined` while the first read is out. */
export function Figures({
  answer,
  className,
}: {
  answer: ArchiveDiagnosis | undefined;
  className: string;
}) {
  return (
    <div className={`grid gap-3.5 md:grid-cols-2 ${className}`}>
      {SOURCES.map((source) => (
        <Figure key={source} source={source} answer={answer} />
      ))}
    </div>
  );
}

function Figure({ source, answer }: { source: Source; answer: ArchiveDiagnosis | undefined }) {
  const t = useT();
  const f = useFormat();
  const megabytes = useMegabytes();
  const k = t.archive.kpi;
  if (answer === undefined) {
    const held = <span className="text-faint">—</span>;
    return (
      <KpiCard label={t.archive.source[source]} value={<Dash />} sub="—">
        <Breakdown gaps={held} size={held} />
      </KpiCard>
    );
  }
  const groups = answer.observations.filter((g) => g.source === source);
  const empty = groups.reduce((sum, g) => sum + (g.emptyDays ?? 0), 0);
  const withEmpty = groups.filter((g) => (g.emptyDays ?? 0) > 0).length;
  const unmeasured = groups.filter((g) => g.emptyDays === null).length;
  const gaps = groups.reduce((sum, g) => sum + (g.gaps ?? 0), 0);
  const stored = answer.bySource.find((s) => s.source === source);
  return (
    <KpiCard
      label={t.archive.source[source]}
      valueClassName={`flex items-center gap-2 ${empty > 0 ? 'text-warn-tint-text' : ''}`}
      value={
        <>
          {empty > 0 && <TriangleAlert size={20} aria-hidden />}
          {k.empty(empty, f.numWhole(empty))}
        </>
      }
      sub={
        empty > 0 || unmeasured > 0 ? k.emptySub(withEmpty, groups.length, unmeasured) : k.noEmpty
      }
    >
      <Breakdown
        gaps={f.numWhole(gaps)}
        size={`${f.numWhole(Number(stored?.n ?? 0))} · ${megabytes(Number(stored?.bytes ?? 0))}`}
      />
    </KpiCard>
  );
}

function Breakdown({ gaps, size }: { gaps: ReactNode; size: ReactNode }) {
  const t = useT();
  return (
    <>
      <div className="mt-3.5 mb-2.5 h-px bg-hairline" />
      <div className="flex flex-col gap-1">
        <Row label={t.archive.kpi.gaps}>{gaps}</Row>
        <Row label={t.archive.kpi.size}>{size}</Row>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs leading-[18px]">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{children}</span>
    </div>
  );
}
