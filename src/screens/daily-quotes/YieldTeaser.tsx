import { Fragment } from 'react';
import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';
import { yieldSinceStart } from '../../core/derive';
import type { Asset } from '../../core/types';
import { shortLabel } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

/**
 * THE RAIL'S YIELD CARD, and it is a REDRAW rather than a move. The one-line
 * ribbon it replaced wrapped to eleven lines at 360 with a word broken
 * mid-syllable, so shipping the compact form only above the breakpoint would be
 * one element with two forms, the broken one reserved for the smaller screen.
 *
 * TWO `max-content` COLUMNS, so the labels and the figures each take exactly
 * their own width and the gap between them is the only one in the card. A
 * `justify-between` row stretches that gap to whatever the rail has spare, which
 * is what made the old ribbon unreadable.
 */
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
    <Card className="px-5 py-4">
      <h3 className="text-[13px] font-semibold">{t.dailyQuotes.yieldSinceStart}</h3>
      {/* `minmax(0,max-content)` ON THE LABEL TRACK, because `truncate` cannot work
          without it: a `max-content` track always equals its own text, so the ellipsis
          never triggers and a long asset name pushes the tracks past the card. */}
      <div className="mt-2.5 grid grid-cols-[minmax(0,max-content)_max-content] gap-x-4 gap-y-[5px] text-[12.5px] text-muted">
        {assets.map((a) => {
          const pct = yieldSinceStart(values[a.id] ?? 0, invested[a.id] ?? 0);
          return (
            <Fragment key={a.id}>
              <span className="min-w-0 truncate">{shortLabel(a)}</span>
              {/* The sign decides the tint: a loss is not drawn in the same colour as a gain. */}
              <span className={`text-right font-bold ${pct < 0 ? 'text-neg' : 'text-pos'}`}>
                {f.pct(pct)}
              </span>
            </Fragment>
          );
        })}
      </div>
      {/* Plain text rather than a button, so the height stays the drawing's — and that
          is exactly why it may NOT take `TAP_44`, which is for a control that already
          draws a box. Its overlay would reach up into the last yield row. Below the
          breakpoint the link grows a REAL box instead. */}
      <Link
        to="/yield"
        className="mt-3 inline-flex items-center text-[12.5px] text-ink max-md:min-h-11"
      >
        {t.dailyQuotes.yieldChartLink}
      </Link>
    </Card>
  );
}
