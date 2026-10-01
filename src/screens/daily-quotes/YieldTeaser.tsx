import { Fragment } from 'react';
import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';
import type { YieldTableRow } from '@quirenote/core/view/yield';
import { shortLabel } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

/**
 * THE RAIL'S YIELD CARD. Each figure is `/yield`'s Δ at «Від початку», read off its
 * row: computed here, it would be a second answer to the same question.
 *
 * The same list at every width: a compact form only above the breakpoint would be
 * one element with two forms.
 *
 * TWO `max-content` COLUMNS, so the labels and the figures each take exactly
 * their own width and the gap between them is the only one in the card. A
 * `justify-between` row stretches that gap to whatever the rail has spare.
 */
export function YieldTeaser({ rows }: { rows: YieldTableRow[] }) {
  const f = useFormat();
  const t = useT();
  return (
    <Card className="px-5 py-4">
      <h3 className="text-[13px] font-semibold">{t.dailyQuotes.yieldSinceStart}</h3>
      {/* `minmax(0,max-content)` ON THE LABEL TRACK, because `truncate` cannot work
          without it: a `max-content` track always equals its own text, so the ellipsis
          never triggers and a long asset name pushes the tracks past the card. */}
      <div className="mt-2.5 grid grid-cols-[minmax(0,max-content)_max-content] gap-x-4 gap-y-[5px] text-[12.5px] text-muted">
        {rows.map(({ asset: a, deltaTotal }) => (
          <Fragment key={a.id}>
            <span className="min-w-0 truncate">{shortLabel(a)}</span>
            {/* The sign decides the tint: a loss is not drawn in the same colour as a gain.
                An asset with no quote has no figure: «—», muted, as `/yield` renders it. */}
            <span
              className={`text-right font-bold ${deltaTotal === undefined ? 'text-muted' : deltaTotal < 0 ? 'text-neg' : 'text-pos'}`}
            >
              {deltaTotal === undefined ? '—' : f.pct(deltaTotal)}
            </span>
          </Fragment>
        ))}
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
