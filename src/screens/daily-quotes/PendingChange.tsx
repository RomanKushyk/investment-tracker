import { Card } from '../../components/ui/Card';
import type { Asset, Snapshot } from '../../core/types';
import { pendingChange } from './quotes';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';

/**
 * THE RAIL'S FIRST BLOCK — what this snapshot would change.
 *
 * IT NAMES THE CHANGE AND NEVER THE TOTAL: the sidebar already renders the saved
 * capital, and a live total here would be one quantity with two values on one
 * screen. The arithmetic, and the baseline trap it avoids, live in
 * `pendingChange`.
 *
 * Two states, not three: "partially filled" is not one. Assets left alone
 * contribute nothing because coalesce carries them forward unchanged, so a
 * half-filled draft is simply a smaller change.
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
  const language = useSettings((s) => s.language);
  const { sum, changed } = pendingChange(assets, drafts, snapshots, selectedDate, language);
  // Rounded to kopiykas for the same reason the comparison is: a sum of −1e−9 is a zero the display would sign.
  const net = Math.round(sum * 100);
  const copy = t.dailyQuotes.pendingChange;

  return (
    <Card className="px-5 py-4">
      <h3 className="text-[13px] font-semibold">{copy.label}</h3>
      {changed === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-muted">{copy.none}</p>
      ) : (
        <>
          {/* A NET OF ZERO IS NOT A GAIN. Two offsetting drafts are two changed rows
              worth nothing, and a signed zero in `pos` claimed otherwise; it reads plain
              and muted instead, with the count beside it still telling the truth. */}
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
