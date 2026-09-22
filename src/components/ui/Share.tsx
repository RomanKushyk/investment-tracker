import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

// A share `sharePct` could not take renders «—» with an accessible name: to a screen
// reader a bare dash is nothing, or the word "hyphen".
export function Share({ pct, fractionDigits }: { pct: number | null; fractionDigits?: number }) {
  const f = useFormat();
  const t = useT();
  if (pct !== null) return <>{f.pctPlain(pct, fractionDigits)}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t.analytics.notComputable}</span>
    </>
  );
}
