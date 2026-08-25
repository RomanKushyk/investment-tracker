import { Card } from '../../components/ui/Card';
import type { Asset, Snapshot } from '../../core/types';
import { pendingChange } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';

/**
 * THE RAIL'S FIRST BLOCK (sheet D-4) — what this snapshot would change.
 *
 * It exists to make an always-present rail honest on a day with no coupon: the
 * width went "to the day and the portfolio", and without this the rail only
 * holds two rehoused elements and never says so.
 *
 * IT NAMES THE CHANGE AND NEVER THE TOTAL. The sidebar already renders the
 * saved capital; a live total here would be one quantity with two values on one
 * screen. The arithmetic — including the baseline trap it avoids and why an
 * asset without a baseline is not counted — lives in `pendingChange`.
 *
 * Two states, not three: "partially filled" is not one. Assets left alone
 * contribute nothing because coalesce carries them forward unchanged (D33), so
 * a half-filled draft is simply a smaller change.
 */
export function PendingChange({
  assets,
  drafts,
  snapshots,
  selectedDate,
}: {
  assets: Asset[];
  drafts: Record<string, string | undefined>;
  snapshots: Snapshot[];
  selectedDate: string;
}) {
  const f = useFormat();
  const t = useT();
  const { sum, changed } = pendingChange(assets, drafts, snapshots, selectedDate);
  // Rounded to kopiykas for the same reason the comparison is: a sum of
  // −0.000000001 is a zero the display would sign.
  const net = Math.round(sum * 100);
  const copy = t.dailyQuotes.pendingChange;

  return (
    <Card className="px-5 py-4">
      <h3 className="text-[13px] font-semibold">{copy.label}</h3>
      {changed === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-muted">{copy.none}</p>
      ) : (
        <>
          {/* The figure is a DELTA, so it takes the signed treatment the rest of
              the app gives one — `f.signed` owns the glyph (U+2212, never the
              ASCII hyphen) and the tint.
              A NET OF ZERO IS NOT A GAIN. Two offsetting drafts (+100 and −100)
              are two changed rows worth nothing, and «+0,00 ₴» in `pos` claimed
              otherwise; it reads plain and muted instead, with the count beside
              it still telling the truth. */}
          <p
            key={sum}
            className={`mt-1.5 animate-in text-[19px] font-semibold duration-200 fade-in ${
              net === 0 ? 'text-muted' : net > 0 ? 'text-pos' : 'text-neg'
            }`}
          >
            {net === 0 ? f.money(0) : f.signedMoney(sum)}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">{copy.count(changed, assets.length)}</p>
        </>
      )}
    </Card>
  );
}
