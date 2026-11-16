import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { SOURCES, type Source } from '@quirenote/core/archive';
import { Dash } from '../../components/loading/Placeholder';
import { Card } from '../../components/ui/Card';
import { Fact } from '../../components/ui/RecordCard';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import type { ArchiveDiagnosis } from '../../lib/repository';
import { useMegabytes } from './sources';

/** One figure per source: the empty days its strips mark and count, then `gaps`, named for what
 *  it is because it nets, and the stored captures. `undefined` while the first read is out. */
export function Figures({
  answer,
  className,
}: {
  answer: ArchiveDiagnosis | undefined;
  className: string;
}) {
  // Equal rows, so both cards stand one height when they stack below md.
  return (
    <div className={`grid auto-rows-fr gap-3.5 md:grid-cols-2 ${className}`}>
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
      <Hero label={t.archive.source[source]} value={<Dash />} caption="—">
        <Facts gaps={held} size={held} />
      </Hero>
    );
  }
  const groups = answer.observations.filter((g) => g.source === source);
  const empty = groups.reduce((sum, g) => sum + (g.emptyDays ?? 0), 0);
  const withEmpty = groups.filter((g) => (g.emptyDays ?? 0) > 0).length;
  const unmeasured = groups.filter((g) => g.emptyDays === null).length;
  const gaps = groups.reduce((sum, g) => sum + (g.gaps ?? 0), 0);
  const stored = answer.bySource.find((s) => s.source === source);
  return (
    <Hero
      label={t.archive.source[source]}
      warn={empty > 0}
      value={
        <>
          {empty > 0 && <TriangleAlert size={26} aria-hidden />}
          {k.empty(empty, f.numWhole(empty))}
        </>
      }
      caption={
        empty > 0 || unmeasured > 0 ? k.emptySub(withEmpty, groups.length, unmeasured) : k.noEmpty
      }
    >
      <Facts
        gaps={f.numWhole(gaps)}
        size={`${f.numWhole(Number(stored?.n ?? 0))} · ${megabytes(Number(stored?.bytes ?? 0))}`}
      />
    </Hero>
  );
}

// Padding 23 / 21: the glass's 1px edge is drawn inset over it, so the content sits 22 / 20 inside.
function Hero({
  label,
  value,
  warn = false,
  caption,
  children,
}: {
  label: string;
  value: ReactNode;
  warn?: boolean;
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card radius={24} className="px-[23px] py-[21px] text-ink">
      <div className="text-label-caps text-muted uppercase">{label}</div>
      <div
        className={`flex items-center gap-2 font-display text-display-hero ${warn ? 'text-warn-tint-text' : ''}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-label text-muted">{caption}</div>
      {children}
    </Card>
  );
}

function Facts({ gaps, size }: { gaps: ReactNode; size: ReactNode }) {
  const t = useT();
  return (
    <dl className="m-0 mt-3.5 grid grid-cols-2 gap-x-4.5 gap-y-2.5">
      <Fact label={t.archive.kpi.gaps}>{gaps}</Fact>
      <Fact label={t.archive.kpi.size}>{size}</Fact>
    </dl>
  );
}
