import { LineChart } from 'lucide-react';
import { Link } from 'react-router';

import { buttonVariants } from '../../components/ui/button-variants';
import { Card } from '../../components/ui/Card';
import { yieldSinceStart } from '../../core/derive';
import type { Asset } from '../../core/types';
import { shortLabel } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

export function YieldTeaser({
  assets,
  values,
  invested,
}: {
  assets: Asset[];
  values: Record<string, number>;
  invested: Record<string, number>;
}) {
  const f = useFormat();
  const t = useT();
  return (
    <Card className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 px-[22px] py-4">
      <LineChart size={20} strokeWidth={2.75} className="text-ink flex-none" />
      <div className="min-w-0 flex-1 text-[13px] break-words">
        <strong>{t.dailyQuotes.yieldSinceStart}</strong>{' '}
        {assets
          .map(
            (a) =>
              `${shortLabel(a)} ${f.pct(yieldSinceStart(values[a.id] ?? 0, invested[a.id] ?? 0))}`,
          )
          .join(' · ')}
      </div>
      <Link to="/yield" className={buttonVariants({ variant: 'ghost' })}>
        {t.dailyQuotes.yieldChartLink}
      </Link>
    </Card>
  );
}
