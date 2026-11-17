import { Rows } from '../../components/loading/Placeholder';
import { Card } from '../../components/ui/Card';
import { RECORD, RECORD_ROWS } from '../../components/ui/RecordCard';
import { Scroller } from '../../components/ui/Scroller';
import { TABLE, TD, TH, TH_NUM, TR } from '../../components/ui/table-anatomy';
import { useFormat } from '../../hooks/useFormat';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useT } from '../../i18n/useT';
import type { ArchiveDiagnosis } from '../../lib/repository';
import { Basis } from './Coverage';
import { useMegabytes } from './sources';

// A count that reconciles proves the plumbing; only a value proves the parse
// (`infra/src/capture.ts`, `diagnose`). The archive serves NUMERIC as text at its full scale, so a
// value is shown at two decimals, a price in the language's grammar.

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
        // No box of its own: it sits mid-page, and the page scrolls it (*Scrolling*).
        <Scroller orientation="horizontal">
          <table className={`${TABLE} text-[12.5px] leading-[18.75px]`}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {s.date}
                </th>
                <th scope="col" className={TH}>
                  {s.instrument}
                </th>
                <th scope="col" className={TH}>
                  {s.basis}
                </th>
                <th scope="col" className={TH_NUM}>
                  {s.price}
                </th>
                <th scope="col" className={TH_NUM}>
                  {s.ytm}
                </th>
                <th scope="col" className={TH_NUM}>
                  {s.clean}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.as_of} ${r.instrument_ref} ${r.basis}`} className={TR}>
                  <td className={TD}>{f.date(r.as_of)}</td>
                  <td className={`${TD} font-mono`}>{r.instrument_ref}</td>
                  <td className={TD}>
                    <Basis>{r.basis}</Basis>
                  </td>
                  <td className={`${TD} text-right`}>{price(r.price)}</td>
                  <td className={`${TD} text-right`}>{percent(r.ytm)}</td>
                  <td className={`${TD} text-right`}>{percent(r.clean_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      ) : (
        <div className={RECORD_ROWS}>
          {rows.map((r) => (
            <div
              key={`${r.as_of} ${r.instrument_ref} ${r.basis}`}
              className={`${RECORD} text-[12.5px] leading-[18.75px]`}
            >
              <div className="flex justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="font-mono">{r.instrument_ref}</span>
                  <Basis>{r.basis}</Basis>
                </span>
                <span className="font-mono text-muted">{f.date(r.as_of)}</span>
              </div>
              <div className="mt-1 font-mono text-muted">
                {s.line(price(r.price), percent(r.ytm), percent(r.clean_rate))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
