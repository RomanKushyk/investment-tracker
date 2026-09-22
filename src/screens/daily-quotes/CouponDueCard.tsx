// The coupon-due suggestion card: one per due coupon, in the aside above the
// Transaction panel, dashed because it is a PROPOSAL.
//
// THE WRITE PATH'S RULES ALL LIVE HERE. The card records nothing until the user
// presses; the amount stays editable; NO WITHHOLDING IS EVER DRAFTED, because
// ОВДП coupons are PIT-exempt and a suggested figure is not an observed one; and
// `nextCoupon` rolls EXACTLY ONCE — the write runs in the click handler, never
// in an effect, so StrictMode's double-invoke cannot duplicate it, behind a ref
// latch that also absorbs a double click.
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { NumberField } from '../../components/ui/NumberField';
import { rollNextCoupon, type DueCoupon } from '@quirenote/core/accrual';
import { inputValue } from '@quirenote/core/money';
import { amountInputSchema, couldNotRead } from '@quirenote/core/schemas';
import type { Asset, Transaction } from '@quirenote/core/types';
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
   * below uses them instead of a month grid: the real bonds pay every 182 days on
   * a Wednesday, and `addMonths` drifts far enough to land the pointer on a date
   * the asset never pays on.
   */
  schedule: readonly string[] | undefined;
  onSkip: () => void;
}) {
  const t = useT();
  const f = useFormat();
  // THE LANGUAGE IS A PARSE RULE HERE TOO. This card writes a `Transaction`, not a
  // display, so «1,240» must mean here exactly what it means in the transaction
  // panel — on the module-level schema the two recorded the identical text a
  // thousandfold apart into one ledger.
  const language = useSettings((state) => state.language);
  // The field mirrors the prefill until the user touches it — `edited` is the
  // discriminator, so a prefill that only arrives LATER (a linked bond's forecast
  // comes with the first fetch, and the card never remounts) still lands in an
  // untouched field, while a typed value is never overwritten.
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const amount = edited ?? (prefill === undefined ? '' : inputValue(prefill, 2));
  const [reinvest, setReinvest] = useState(false);
  // THE REINVEST'S OWN COUNT. A row that MOVES A POSITION must state its units at
  // every door — the form, the backup importer and the DDL — and the card cannot
  // derive it: it receives no price at all, so the ₴ it holds cannot be turned
  // into a count without inventing one. So it asks.
  const [units, setUnits] = useState('');
  const [unitsError, setUnitsError] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const recordTransaction = useRecordTransaction();
  const updateAsset = useUpdateAsset();
  // One confirm per card, whatever the browser or StrictMode does: the latch is
  // checked and set synchronously, before any await.
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
      // Only ever on the `reinvest`: an `interest_payout` moves no position, and a
      // count on one is what `transaction_quantity_absent_ck` refuses.
      ...(quantity === undefined ? {} : { quantity }),
    };
  }

  // READ FROM THE CURRENT TEXT, not kept from the last press: `amount` changes
  // with no `onChange` when a linked bond's prefill arrives, so a stored verdict
  // would sit under a value it never judged.
  const amountFault = amountInputSchema(language).safeParse(amount);
  const unitsFault = reinvest ? amountInputSchema(language).safeParse(units) : undefined;
  const showAmountError = error && !amountFault.success;
  const showUnitsError = unitsError && unitsFault?.success === false;

  function handleConfirm() {
    const parsed = amountFault;
    const parsedUnits = unitsFault;
    if (!parsed.success) setError(true);
    if (parsedUnits !== undefined && !parsedUnits.success) setUnitsError(true);
    if (!parsed.success || (parsedUnits !== undefined && !parsedUnits.success)) return;
    if (confirmed.current) return;
    confirmed.current = true;
    setPending(true);
    void (async () => {
      try {
        await recordTransaction.mutateAsync({ tx: tx('interest_payout', parsed.data) });
        // The paired reinvest makes the payout count as reinvested rather than paid out
        // (same date + asset is what the derivations match on).
        if (parsedUnits?.success === true)
          await recordTransaction.mutateAsync({
            tx: tx('reinvest', parsed.data, parsedUnits.data),
          });
        // Rolled off the occurrence just recorded, not off the asset's stored pointer:
        // the two differ whenever an earlier occurrence was settled by hand, and the
        // pointer must land on a date that is still open.
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
        confirmed.current = false;
        setPending(false);
        toast.error(t.transaction.failedToast);
      }
    })();
  }

  return (
    <Card
      className="animate-in border border-dashed border-faint px-5 py-[18px] duration-300 fade-in slide-in-from-bottom-1"
      // A suggestion: dashed `faint` edge, never pos/warn tinted.
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
      <NumberField
        id={`coupon-amount-${asset.id}`}
        name={`coupon-amount-${asset.id}`}
        value={amount}
        onChange={(next) => {
          setEdited(next);
        }}
        aria-invalid={showAmountError}
        aria-describedby={showAmountError ? errorId : undefined}
        className={`h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] transition ${
          showAmountError ? 'border-neg' : 'border-field-border hover:border-ink'
        }`}
      />
      {showAmountError && (
        <div
          id={errorId}
          className="mt-1 animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
        >
          {/* The sign message is BORROWED from the panel exactly as Units borrows its
              own, because both cards write the same `Transaction`. */}
          {couldNotRead(amountFault.error?.issues ?? [])
            ? t.transaction.amountUnreadable
            : amount.trim() === ''
              ? t.transaction.amountMissing
              : t.transaction.amountNotPositive}
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={reinvest}
          onChange={(e) => {
            setReinvest(e.target.checked);
            // THE ERROR RESETS, THE VALUE DOES NOT. The field unmounts but its state
            // survives, so unchecking after a rejected value and re-checking rendered it
            // already red before the user touched anything. Clearing `units` as well is
            // broader than the defect: a mis-clicked checkbox would discard a typed count
            // with nowhere to recover it.
            setUnitsError(false);
          }}
          className="mt-[1px] size-4 flex-none rounded-[5px] border-panel-border bg-page accent-ink transition active:scale-[.97]"
        />
        <span className="text-xs leading-[1.45]">
          {t.dailyQuotes.coupon.reinvest}
          <span className="block text-[11px] text-muted">{t.dailyQuotes.coupon.reinvestHint}</span>
        </span>
      </label>

      {/* REVEALED WITH THE CHECKBOX, and required while it is on. This card is the
          writer that bypasses the form entirely, handing a `Transaction` straight to
          `recordTransaction` — so without the field it would write a row the backup
          importer and the DDL both refuse, and the app could hold local data it
          cannot export. */}
      {reinvest && (
        <div className="mt-2.5 animate-in duration-200 fade-in slide-in-from-top-1">
          <label className="mb-1 block text-[11px] text-muted" htmlFor={`coupon-units-${asset.id}`}>
            {t.transaction.quantity}
          </label>
          <NumberField
            id={`coupon-units-${asset.id}`}
            name={`coupon-units-${asset.id}`}
            value={units}
            onChange={(next) => {
              setUnits(next);
            }}
            placeholder={t.transaction.quantityPlaceholder}
            aria-invalid={showUnitsError}
            aria-describedby={showUnitsError ? unitsErrorId : undefined}
            className={`h-9 w-full rounded-[9px] border bg-page px-3 font-body text-[13px] transition ${
              showUnitsError ? 'border-neg' : 'border-field-border hover:border-ink'
            }`}
          />
          {showUnitsError && (
            <div
              id={unitsErrorId}
              className="mt-1 animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
            >
              {/* The panel's own split: blank is a missing count, a non-positive number is a
                  count that cannot be one. Showing "enter the number" over a field that HAS
                  one reads as a bug. */}
              {units.trim() === ''
                ? t.transaction.quantityMissing
                : couldNotRead(unitsFault?.error?.issues ?? [])
                  ? t.transaction.quantityUnreadable
                  : t.transaction.quantityNotPositive}
            </div>
          )}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        {/* Outline, not the fill: `/`'s one accent CTA is "Save snapshot", and this
            card is a rail prompt that can appear more than once. */}
        <Button size="header" variant="outline" onClick={handleConfirm} disabled={pending}>
          {t.dailyQuotes.coupon.confirm}
        </Button>
        <Button size="header" variant="ghost" onClick={onSkip} disabled={pending}>
          {t.dailyQuotes.coupon.skip}
        </Button>
      </div>
    </Card>
  );
}
