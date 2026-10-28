import { Rows } from '../../components/loading/Placeholder';
import { Card } from '../../components/ui/Card';
import { Scroller } from '../../components/ui/Scroller';
import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import type { ArchiveDiagnosis } from '../../lib/repository';
import { Basis } from './Coverage';
import { useMegabytes } from './sources';

// A count that reconciles proves the plumbing; only a value proves the parse
// (`infra/src/capture.ts`, `diagnose`). The archive serves NUMERIC as text at its full scale, so a
// value is shown as the drawing shows it: two decimals, a price in the language's grammar.

/** The newest rows the archive holds, and what its stored captures weigh. */
export function SpotCheck({
  answer,
  className,
}: {
  answer: ArchiveDiagnosis | undefined;
  className: string;
}) {
  const t = useT();
  const f = useFormat();
  const megabytes = useMegabytes();
  const desktop = useIsDesktop();
  const s = t.archive.spot;
  const price = (v: string | null) => (v === null ? '—' : f.num(Number(v)));
  // Both are percent in the archive (`migrations/002_price_observation.sql`).
  const percent = (v: string | null) => (v === null ? '—' : f.pctPlain(Number(v), 2));

  const head = (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
      <div className="text-[10px] tracking-[.12em] text-muted uppercase">{s.title}</div>
      {answer && (
        <span className="text-[11px] text-muted">
          {s.total(
            f.numWhole(Number(answer.size.rows)),
            megabytes(Number(answer.size.total_bytes)),
          )}
        </span>
      )}
    </div>
  );
  if (answer === undefined) {
    return (
      <Card radius={24} className={`p-[22px] ${className}`}>
        {head}
        <Rows className="[&>*+*]:border-t [&>*+*]:border-hairline" rowClassName="py-3" />
      </Card>
    );
  }
  const rows = answer.sample;
  return (
    <Card radius={24} className={`p-[22px] ${className}`}>
      {head}
      {desktop ? (
        <Scroller orientation="horizontal">
          <table className="w-full border-collapse text-[12.5px] leading-[18.75px]">
            <thead>
              <tr className="text-[11px] leading-[16.5px] text-muted">
                <th className="py-1.5 pr-4 text-left font-normal">{s.date}</th>
                <th className="py-1.5 pr-4 text-left font-normal">{s.instrument}</th>
                <th className="py-1.5 pr-4 text-left font-normal">{s.basis}</th>
                <th className="py-1.5 pr-4 text-right font-normal">{s.price}</th>
                <th className="py-1.5 pr-4 text-right font-normal">{s.ytm}</th>
                <th className="py-1.5 pr-4 text-right font-normal">{s.clean}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.as_of} ${r.instrument_ref} ${r.basis}`}
                  className="border-t border-hairline"
                >
                  <td className="py-[9px] pr-4">{f.date(r.as_of)}</td>
                  <td className="py-[9px] pr-4 font-mono">{r.instrument_ref}</td>
                  <td className="py-[9px] pr-4">
                    <Basis>{r.basis}</Basis>
                  </td>
                  <td className="py-[9px] pr-4 text-right">{price(r.price)}</td>
                  <td className="py-[9px] pr-4 text-right">{percent(r.ytm)}</td>
                  <td className="py-[9px] pr-4 text-right">{percent(r.clean_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      ) : (
        rows.map((r, i) => (
          <div
            key={`${r.as_of} ${r.instrument_ref} ${r.basis}`}
            className={`py-2.5 text-[12.5px] leading-[18.75px] ${i > 0 ? 'border-t border-hairline' : ''}`}
          >
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="font-mono">{r.instrument_ref}</span>
                <Basis>{r.basis}</Basis>
              </span>
              <span className="text-muted">{f.date(r.as_of)}</span>
            </div>
            <div className="mt-1 text-muted">
              {s.line(price(r.price), percent(r.ytm), percent(r.clean_rate))}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
