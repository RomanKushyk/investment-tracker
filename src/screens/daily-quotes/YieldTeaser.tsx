import { LineChart } from 'lucide-react';
import { Link } from 'react-router';

import { buttonVariants } from '../../components/ui/button-variants';
import { Card } from '../../components/ui/Card';
import { yieldSinceStart } from '../../lib/derive';
import { fmtPct } from '../../lib/format';
import type { Asset } from '../../lib/types';

// Bonds are labeled by their last 4 digits ("…8976"); other assets by the
// last word of their name ("Inzhur REIT" -> "REIT") — matches design copy.
function shortLabel(a: Asset): string {
  return a.yieldType === 'fixed_coupon' ? `…${a.name.slice(-4)}` : a.name.split(' ').at(-1)!;
}

export function YieldTeaser({
  assets,
  values,
  invested,
}: {
  assets: Asset[];
  values: Record<string, number>;
  invested: Record<string, number>;
}) {
  return (
    <Card className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 px-[22px] py-4">
      <LineChart size={20} strokeWidth={2.75} className="flex-none text-ink" />
      <div className="min-w-0 flex-1 text-[13px] break-words">
        <strong>Yield since start:</strong>{' '}
        {assets
          .map(
            (a) =>
              `${shortLabel(a)} ${fmtPct(yieldSinceStart(values[a.id] ?? 0, invested[a.id] ?? 0))}`,
          )
          .join(' · ')}
      </div>
      <Link to="/yield" className={buttonVariants({ variant: 'ghost' })}>
        Yield chart →
      </Link>
    </Card>
  );
}
