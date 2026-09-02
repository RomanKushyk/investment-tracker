// S5 — the coupon-due suggestion card (design/extensions/daily-quotes-live.dc.html).
// Sits in the Daily-quotes aside ABOVE the Transaction panel: one card per due
// coupon, dashed border because it is a PROPOSAL.
//
// G5 lives in this file's write path: the card records nothing until the user
// presses "Record coupon", the amount stays editable (seed precedent: paid
// 1 183,50 against a scheduled 1 240,00), no `tax` row is ever drafted (D13),
// and `nextCoupon` rolls EXACTLY ONCE — the write runs in the click handler
// (never in an effect, so StrictMode's double-invoke cannot duplicate it) behind
// a ref latch that also absorbs a double click.
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { rollNextCoupon, type DueCoupon } from '../../core/accrual';
import { amountInputSchema } from '../../core/schemas';
import type { Asset, Transaction } from '../../core/types';
import { useRecordTransaction, useUpdateAsset } from '../../hooks/queries';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';

export function CouponDueCard({
  asset,
  due,
  prefill,
  schedule,
  onSkip,
}: {
  asset: Asset;
  due: DueCoupon;
  /** Amount to prefill (feed forecast or the stated coupon); undefined = empty. */
  prefill: number | undefined;
  /**
   * The provider's published payment dates, when the asset is linked. The roll
   * below uses them instead of a month grid: the real bonds pay every 182 days
   * on a Wednesday, and `addMonths` drifts 2 days by the next coupon and 5 by
   * 2028 — so without this the pointer lands on a date the asset never pays on.
   */
  schedule: readonly string[] | undefined;
  onSkip: () => void;
}) {
  const t = useT();
  const f = useFormat();
  // THE LANGUAGE IS A PARSE RULE HERE TOO. This card writes a `Transaction`,
  // not a display, so «1,240» must mean here exactly what it means in the
  // transaction panel — on the module-level grouping schema the two recorded
  // the identical text 1000x apart into one ledger.
  const language = useSettings((state) => state.language);
  // The field mirrors the prefill until the user touches it — `edited` is the
  // discriminator, so a prefill that only becomes available LATER (a linked
  // bond's `paymentSchedule` forecast arrives with the first fetch, and the card
  // never remounts) still lands in an untouched field, while a typed value is
  // never overwritten by it (G5).
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const amount = edited ?? (prefill === undefined ? '' : f.num(prefill));
  const [reinvest, setReinvest] = useState(false);
  // THE REINVEST'S OWN COUNT. This card writes a `reinvest`, which MOVES A
  // POSITION, and D124/D125 require such a row to state its units at every door
  // — the form, the backup importer and the DDL. The card cannot derive it: it
  // receives the asset, the due date, a prefill and a schedule, and no price at
  // all, so the ₴ it holds cannot be turned into a count without inventing one.
  // So it asks, exactly as the transaction panel does.
  const [units, setUnits] = useState('');
  const [unitsError, setUnitsError] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const recordTransaction = useRecordTransaction();
  const updateAsset = useUpdateAsset();
  // One confirm per card, whatever the browser or StrictMode does with the
  // handler: the latch is checked and set synchronously, before any await.
  const confirmed = useRef(false);
  const errorId = `coupon-amount-${asset.id}-error`;
  const unitsErrorId = `coupon-units-${asset.id}-error`;

  function tx(type: Transaction['type'], value: number, quantity?: number): Transaction {
    return {
      id: crypto.randomUUID(),
      date: due.date, // the coupon's own date — history is never rewritten
      type,
      assetId: asset.id,
      amount: value,
      // Only ever set on the `reinvest`: an `interest_payout` moves no position,
      // and a count on one is what `transaction_quantity_absent_ck` refuses.
      ...(quantity === undefined ? {} : { quantity }),
      source: 'accrual',
    };
  }

  function handleConfirm() {
    const parsed = amountInputSchema(language).safeParse(amount);
    const parsedUnits = reinvest ? amountInputSchema(language).safeParse(units) : undefined;
    if (!parsed.success) setError(true);
    if (parsedUnits !== undefined && !parsedUnits.success) setUnitsError(true);
    if (!parsed.success || (parsedUnits !== undefined && !parsedUnits.success)) return;
    if (confirmed.current) return;
    confirmed.current = true;
    setPending(true);
    void (async () => {
      try {
        await recordTransaction.mutateAsync({ tx: tx('interest_payout', parsed.data) });
        // The paired reinvest makes the payout count as reinvested rather than
        // paid out (same date + asset is what the derivations match on).
        if (parsedUnits?.success === true)
          await recordTransaction.mutateAsync({
            tx: tx('reinvest', parsed.data, parsedUnits.data),
          });
        // Rolled off the occurrence just recorded, not off the asset's stored
        // pointer: the two differ whenever an earlier occurrence was settled by
        // hand, and the pointer must land on a date that is still open.
        const roll = rollNextCoupon(asset, due.date, schedule);
        if (roll?.kind === 'rolled') {
          await updateAsset.mutateAsync({ id: asset.id, patch: { nextCoupon: roll.nextCoupon } });
        }
        toast.success(
          reinvest
            ? t.dailyQuotes.coupon.recordedReinvestToast
            : t.dailyQuotes.coupon.recordedToast,
        );
      } catch {
        // The recorded rows stand (nothing is rolled back): the card simply
        // stops offering this occurrence once its payout row exists.
        confirmed.current = false;
        setPending(false);
        toast.error(t.transaction.failedToast);
      }
    })();
  }

  return (
    <Card
      className="animate-in border border-dashed border-faint px-5 py-[18px] duration-300 fade-in slide-in-from-bottom-1"
      // The card is a suggestion: dashed `faint` edge, never pos/warn tinted.
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] tracking-[.12em] text-muted uppercase">
          {t.dailyQuotes.coupon.badge}
        </span>
        {due.overdueDays > 0 && (
          <span className="rounded-[5px] bg-warn-tint px-2 py-[2px] text-[10px] font-bold tracking-[.08em] text-warn-tint-text uppercase">
            {f.dateShort(due.date)}
          </span>
        )}
      </div>
      <div className="text-[13px] leading-[1.4] font-semibold">
        {prefill === undefined
          ? t.dailyQuotes.coupon.headingNoAmount(asset.name)
          : t.dailyQuotes.coupon.heading(asset.name, f.money(prefill))}
      </div>
      <p className="mt-1.5 mb-3 text-xs leading-[1.5] text-muted">
        {t.dailyQuotes.coupon.scheduled(f.date(due.date))}
      </p>

      <label className="mb-1 block text-[11px] text-muted" htmlFor={`coupon-amount-${asset.id}`}>
        {t.transaction.amount}
      </label>
      <input
        id={`coupon-amount-${asset.id}`}
        name={`coupon-amount-${asset.id}`}
        value={amount}
        onChange={(e) => {
          setEdited(e.target.value);
          if (error) setError(false);
        }}
        inputMode="decimal"
        aria-invalid={error}
        // The message sits outside the label, so it needs the explicit link —
        // otherwise assistive tech announces "invalid" with no reason.
        aria-describedby={error ? errorId : undefined}
        className={`h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] transition ${
          error ? 'border-neg' : 'border-hairline hover:border-faint'
        }`}
      />
      {error && (
        <div
          id={errorId}
          className="mt-1 animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
        >
          {t.dailyQuotes.coupon.amountMissing}
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={reinvest}
          onChange={(e) => {
            setReinvest(e.target.checked);
            // THE ERROR RESETS, THE VALUE DOES NOT. The field unmounts but its
            // state survives, so unchecking after a rejected `0` and re-checking
            // rendered it already red before the user touched anything — and
            // `unitsError` is the only thing that renders red, so clearing it is
            // the whole fix. Clearing `units` as well was broader than the
            // defect: a mis-clicked checkbox would discard a typed `43,4835`
            // with nowhere to recover it, which is why the amount field beside
            // it is not reset either.
            setUnitsError(false);
          }}
          className="mt-[1px] size-4 flex-none rounded-[5px] border-panel-border bg-page accent-ink transition active:scale-[.97]"
        />
        <span className="text-xs leading-[1.45]">
          {t.dailyQuotes.coupon.reinvest}
          <span className="block text-[11px] text-muted">{t.dailyQuotes.coupon.reinvestHint}</span>
        </span>
      </label>

      {/* REVEALED WITH THE CHECKBOX, and required while it is on. A `reinvest`
          moves a position, so D124/D125 make its count mandatory at all three
          doors — and this card is the writer that bypasses the form entirely,
          handing a `Transaction` straight to `recordTransaction`. Without the
          field it would write a row the backup importer and the DDL both refuse,
          so the app could hold local data it cannot export. */}
      {reinvest && (
        <div className="mt-2.5 animate-in duration-200 fade-in slide-in-from-top-1">
          <label className="mb-1 block text-[11px] text-muted" htmlFor={`coupon-units-${asset.id}`}>
            {t.transaction.quantity}
          </label>
          <input
            id={`coupon-units-${asset.id}`}
            name={`coupon-units-${asset.id}`}
            value={units}
            onChange={(e) => {
              setUnits(e.target.value);
              if (unitsError) setUnitsError(false);
            }}
            inputMode="decimal"
            placeholder={t.transaction.quantityPlaceholder}
            aria-invalid={unitsError}
            aria-describedby={unitsError ? unitsErrorId : undefined}
            className={`h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] transition ${
              unitsError ? 'border-neg' : 'border-hairline hover:border-faint'
            }`}
          />
          {unitsError && (
            <div
              id={unitsErrorId}
              className="mt-1 animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
            >
              {/* The panel's own split: blank is a missing count, `0` or `-5`
                  is a count that cannot be one. Showing "enter the number" over
                  a field that HAS a number reads as a bug. */}
              {units.trim() === ''
                ? t.transaction.quantityMissing
                : t.transaction.quantityNotPositive}
            </div>
          )}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <Button size="header" onClick={handleConfirm} disabled={pending}>
          {t.dailyQuotes.coupon.confirm}
        </Button>
        <Button size="header" variant="ghost" onClick={onSkip} disabled={pending}>
          {t.dailyQuotes.coupon.skip}
        </Button>
      </div>
    </Card>
  );
}
