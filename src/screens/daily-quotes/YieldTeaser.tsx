import { Fragment } from 'react';
import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';
import { yieldSinceStart } from '../../core/derive';
import type { Asset } from '../../core/types';
import { shortLabel } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

/**
 * THE RAIL'S YIELD CARD (sheet S2 § 3), and it is a REDRAW rather than a move.
 *
 * It used to be a one-line ribbon at the foot of the ritual column — icon,
 * `Дохідність від початку:` and four `label pct` pairs joined by « · », wrapped
 * to whatever width was left. At 360 that measured 246,5 px over ELEVEN lines
 * with «Дохідніс/ть» broken mid-word (sheet D-5, measured in production), so the
 * compact form is not only for the rail: shipping it above 884 and leaving the
 * ribbon below would be one element with two forms, the broken one reserved for
 * the smaller screen.
 *
 * TWO `max-content` COLUMNS, so the labels and the figures each take exactly
 * their own width and the 16 px between them is the only gap in the card. A
 * `justify-between` row would have stretched that gap to whatever the rail had
 * spare, which is what made the old ribbon unreadable at 360.
 *
 * The heading lost its colon with this change: `yieldSinceStart` was an inline
 * prefix, and `Дохідність від початку:` as a card heading is wrong.
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
      {/* `minmax(0,max-content)` ON THE LABEL TRACK, because `truncate` cannot
          work without it: a `max-content` track always equals its own text, so
          the ellipsis never triggers and a long asset name pushes the two tracks
          past the card instead — the same silent clip the ledger's `w-0
          min-w-full` note documents. The figures keep `max-content`; they are
          four glyphs and a sign. */}
      <div className="mt-2.5 grid grid-cols-[minmax(0,max-content)_max-content] gap-x-4 gap-y-[5px] text-[12.5px] text-muted">
        {assets.map((a) => {
          const pct = yieldSinceStart(values[a.id] ?? 0, invested[a.id] ?? 0);
          return (
            <Fragment key={a.id}>
              <span className="min-w-0 truncate">{shortLabel(a)}</span>
              {/* The sign decides the tint. The drawing shows four positives
                  because the seed has four; a loss is not drawn in the same
                  colour as a gain. */}
              <span className={`text-right font-bold ${pct < 0 ? 'text-neg' : 'text-pos'}`}>
                {f.pct(pct)}
              </span>
            </Fragment>
          );
        })}
      </div>
      {/* Drawn as plain 12,5px text, not a button, so the height stays the
          drawing's — and that is exactly why it may NOT take `TAP_44`:
          `tap-target.ts` gives the overlay to a control that already draws a box,
          and this one was just converted out of `buttonVariants({ghost})` into
          bare text. Its 44 px overlay also broke the file's own spacing rule on a
          ~19 px line box, reaching 12,5 px up into the last yield row past a 12 px
          gap. Below the breakpoint the link grows a REAL box instead. */}
      <Link
        to="/yield"
        className="mt-3 inline-flex items-center text-[12.5px] text-ink max-md:min-h-11"
      >
        {t.dailyQuotes.yieldChartLink}
      </Link>
    </Card>
  );
}
