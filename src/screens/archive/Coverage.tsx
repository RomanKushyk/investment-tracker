import { TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';

import { Bar } from '../../components/loading/Placeholder';
import { Card } from '../../components/ui/Card';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import type { ArchiveDiagnosis, ArchiveGroup } from '../../lib/repository';
import { axisOf, orderGroups, stripOf, ticksOf, type Axis, type Strip } from './strip';
import type { Source } from './sources';

// A group is one row: the ref and its basis, the strip, the count. At 360 the ref and the count
// share a line above a full-width strip.
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 ' +
  'md:grid-cols-[210px_minmax(0,1fr)_92px] md:gap-x-4';

// The hue alone carries neither mark nor era, `warn` and `info` falling short of 3 : 1 on `muted`: a
// missing day stands past the band in a `card` keyline, and imported history is half its height.
const HATCH = 'repeating-linear-gradient(135deg, var(--color-card) 0 2px, transparent 2px 5px)';
const KEYLINE = 'shadow-[0_0_0_1px_var(--color-card)]';

const at = (left: number, width: number): CSSProperties => ({
  left: `${left}%`,
  width: `${width}%`,
});

/** One card per source, each on its own axis from its earliest bound to today. */
export function CoverageCard({
  source,
  answer,
  day,
  className,
}: {
  source: Source;
  answer: ArchiveDiagnosis | undefined;
  /** The Kyiv day the answer was read on, which the axis ends at, as every date it plots is Kyiv's. */
  day: string | undefined;
  className: string;
}) {
  const t = useT();
  const f = useFormat();
  const title = (
    <div className="text-[10px] tracking-[.12em] text-muted uppercase">
      {t.archive.coverage.title(t.archive.source[source])}
    </div>
  );
  if (answer === undefined || day === undefined) {
    return (
      <Card radius={24} className={`p-[22px] ${className}`}>
        <div className="mb-4">{title}</div>
        <HeldRows />
      </Card>
    );
  }
  const groups = orderGroups(answer.observations.filter((g) => g.source === source));
  const axis = axisOf(groups, day);
  const strips = new Map(groups.map((g) => [g, axis && stripOf(g, axis)]));
  const imported = [...strips.values()].some((s) => s?.imported !== undefined);
  return (
    <Card radius={24} className={`p-[22px] ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 md:mb-4">
        <div>
          {title}
          {axis && (
            <div className="mt-1 text-[11px] text-muted">
              {t.archive.coverage.span(f.date(axis.from), groups.length)}
            </div>
          )}
        </div>
        <Legend imported={imported} />
      </div>
      {axis && <Ticks axis={axis} />}
      {groups.map((g) => (
        <GroupRow key={`${g.instrument_ref} ${g.basis}`} group={g} strip={strips.get(g)} />
      ))}
    </Card>
  );
}

function Legend({ imported }: { imported: boolean }) {
  const t = useT();
  const c = t.archive.coverage;
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted">
      <Key swatch="size-2.5 rounded-[3px] bg-muted">{c.captured}</Key>
      {imported && <Key swatch="h-1.5 w-2.5 rounded-[2px] bg-info">{c.imported}</Key>}
      <Key swatch={`h-3 w-0.5 rounded-[1px] bg-warn ${KEYLINE}`}>{c.empty}</Key>
      <Key swatch="size-2.5 rounded-[3px] bg-muted" style={{ backgroundImage: HATCH }}>
        {c.unserved}
      </Key>
    </div>
  );
}

function Key({
  swatch,
  style,
  children,
}: {
  swatch: string;
  style?: CSSProperties;
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`block shrink-0 ${swatch}`} style={style} />
      {children}
    </span>
  );
}

function Ticks({ axis }: { axis: Axis }) {
  const t = useT();
  return (
    <div className="mb-2.5 md:mb-2 md:grid md:grid-cols-[210px_minmax(0,1fr)_92px] md:gap-x-4">
      <span className="max-md:hidden" />
      <div aria-hidden className="relative h-[15px] text-[10px] leading-[15px] text-muted">
        {ticksOf(axis).map((tick) => (
          <span
            key={tick.left}
            className="absolute border-l border-hairline pl-1 whitespace-nowrap"
            style={{ left: `${tick.left}%` }}
          >
            {tick.month === undefined
              ? tick.year
              : `${t.dates.monthShort[tick.month]}${tick.year === undefined ? '' : ` ${tick.year}`}`}
          </span>
        ))}
        <span className="absolute right-0">{t.archive.coverage.today}</span>
      </div>
      <span className="max-md:hidden" />
    </div>
  );
}

function GroupRow({ group, strip }: { group: ArchiveGroup; strip: Strip | undefined }) {
  const t = useT();
  const f = useFormat();
  const empty = group.emptyDays;
  return (
    <div className={`${ROW} border-t border-hairline py-2.5 md:py-[9px]`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs leading-[18px]">{group.instrument_ref}</span>
        <Basis>{group.basis}</Basis>
      </div>
      <div className="max-md:order-last max-md:col-span-2">
        <Track strip={strip} />
        {strip?.cut && (
          <div className="mt-1 text-[11px] text-muted">
            {t.archive.coverage.cut(
              strip.cut.count,
              f.numWhole(strip.cut.count),
              f.date(strip.cut.before),
            )}
          </div>
        )}
      </div>
      <div className="text-right text-xs leading-[18px]">
        {empty === null ? (
          <span className="text-muted">{t.archive.coverage.notMeasured}</span>
        ) : empty > 0 ? (
          <span className="inline-flex items-center gap-1 font-semibold text-warn-tint-text">
            <TriangleAlert size={12} aria-hidden />
            {t.archive.kpi.empty(empty, f.numWhole(empty))}
          </span>
        ) : (
          <span className="text-muted">0</span>
        )}
      </div>
    </div>
  );
}

/** The strip is drawn for the eye; the count beside it says the same to a screen reader. */
function Track({ strip }: { strip: Strip | undefined }) {
  return (
    <div aria-hidden className="relative h-3 rounded-[3px] bg-page">
      {strip?.imported && (
        <div
          className={`absolute inset-y-[3px] bg-info ${strip.imported.roundLeft ? 'rounded-l-[2px]' : ''}`}
          style={at(strip.imported.left, strip.imported.width)}
        />
      )}
      {strip?.captured && (
        <div
          className={[
            'absolute inset-y-0 bg-muted',
            strip.captured.roundLeft ? 'rounded-l-[3px]' : '',
            strip.captured.roundRight ? 'rounded-r-[3px]' : '',
            strip.captured.seam ? 'border-l-2 border-card' : '',
          ].join(' ')}
          style={at(strip.captured.left, strip.captured.width)}
        />
      )}
      {strip?.cut?.left !== undefined && strip.cut.width !== undefined && (
        <div
          className={`absolute inset-y-0 ${strip.cut.left === 0 ? 'rounded-l-[3px]' : ''}`}
          style={{ ...at(strip.cut.left, strip.cut.width), backgroundImage: HATCH }}
        />
      )}
      {strip?.marks.map((mark) => (
        <div
          key={mark.left}
          data-mark
          className={`absolute -inset-y-[3px] rounded-[1px] bg-warn ${KEYLINE}`}
          style={{ left: `${mark.left}%`, width: `max(2px, ${mark.width}%)` }}
        />
      ))}
    </div>
  );
}

export function Basis({ children }: { children: string }) {
  return (
    <span className="inline-block rounded-[4px] border border-hairline px-[5px] text-[10px] leading-[14px] text-muted">
      {children}
    </span>
  );
}

/** A list on its way: three rows of the group's columns, with no axis and no legend. */
export function HeldRows() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-x-4 border-t border-hairline py-3 md:grid-cols-[210px_minmax(0,1fr)_92px]"
        >
          <Bar w="70%" />
          <Bar w="100%" className="max-md:hidden" />
          <Bar w="60%" />
        </div>
      ))}
    </div>
  );
}
