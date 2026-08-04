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
import { fmtDate, fmtDateShort, fmtProse, fmtTable } from '../../core/money';
import { quoteInputSchema } from '../../core/schemas';
import type { Asset, Transaction } from '../../core/types';
import { useRecordTransaction, useUpdateAsset } from '../../hooks/queries';

export function CouponDueCard({
  asset,
  due,
  prefill,
  onSkip,
}: {
  asset: Asset;
  due: DueCoupon;
  /** Amount to prefill (feed forecast or the stated coupon); undefined = empty. */
  prefill: number | undefined;
  onSkip: () => void;
}) {
  const [amount, setAmount] = useState(prefill === undefined ? '' : fmtTable(prefill));
  const [reinvest, setReinvest] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const recordTransaction = useRecordTransaction();
  const updateAsset = useUpdateAsset();
  // One confirm per card, whatever the browser or StrictMode does with the
  // handler: the latch is checked and set synchronously, before any await.
  const confirmed = useRef(false);

  function tx(type: Transaction['type'], value: number): Transaction {
    return {
      id: crypto.randomUUID(),
      date: due.date, // the coupon's own date — history is never rewritten
      type,
      assetId: asset.id,
      amount: value,
      source: 'accrual',
    };
  }

  function handleConfirm() {
    const parsed = quoteInputSchema.safeParse(amount);
    if (!parsed.success) {
      setError(true);
      return;
    }
    if (confirmed.current) return;
    confirmed.current = true;
    setPending(true);
    void (async () => {
      try {
        await recordTransaction.mutateAsync({ tx: tx('interest_payout', parsed.data) });
        // The paired reinvest makes the payout count as reinvested rather than
        // paid out (same date + asset is what the derivations match on).
        if (reinvest) await recordTransaction.mutateAsync({ tx: tx('reinvest', parsed.data) });
        const roll = rollNextCoupon(asset);
        if (roll?.kind === 'rolled') {
          await updateAsset.mutateAsync({ id: asset.id, patch: { nextCoupon: roll.nextCoupon } });
        }
        toast.success(reinvest ? 'Coupon + reinvest recorded' : 'Coupon recorded');
      } catch {
        // The recorded rows stand (nothing is rolled back): the card simply
        // stops offering this occurrence once its payout row exists.
        confirmed.current = false;
        setPending(false);
        toast.error('Could not record transaction — please try again.');
      }
    })();
  }

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-1 border-faint border border-dashed px-5 py-[18px] duration-300"
      // The card is a suggestion: dashed `faint` edge, never pos/warn tinted.
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-muted text-[10px] tracking-[.12em] uppercase">Coupon due</span>
        {due.overdueDays > 0 && (
          <span className="bg-warn-tint text-warn-tint-text rounded-full px-2 py-[2px] text-[10px] font-bold tracking-[.08em] uppercase">
            {fmtDateShort(due.date)}
          </span>
        )}
      </div>
      <div className="text-[13px] leading-[1.4] font-semibold">
        {asset.name} — coupon{prefill === undefined ? '' : ` ${fmtProse(prefill)}`}
      </div>
      <p className="text-muted mt-1.5 mb-3 text-xs leading-[1.5]">
        Scheduled for {fmtDate(due.date)}. Confirm to record it — the amount is editable, history is
        never rewritten.
      </p>

      <label className="text-label mb-1 block text-[11px]" htmlFor={`coupon-amount-${asset.id}`}>
        Amount, ₴
      </label>
      <input
        id={`coupon-amount-${asset.id}`}
        name={`coupon-amount-${asset.id}`}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          if (error) setError(false);
        }}
        inputMode="decimal"
        aria-invalid={error}
        className={`bg-page h-9 w-full rounded-[10px] border px-3 font-body text-[13px] transition ${
          error ? 'border-neg' : 'border-hairline hover:border-faint'
        }`}
      />
      {error && (
        <div className="text-neg animate-in fade-in slide-in-from-top-1 mt-1 text-[11px] duration-200">
          Enter an amount.
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={reinvest}
          onChange={(e) => setReinvest(e.target.checked)}
          className="accent-ink border-panel-border bg-page mt-[1px] size-4 flex-none rounded-[5px] transition active:scale-[.97]"
        />
        <span className="text-xs leading-[1.45]">
          Also record a reinvest of this amount
          <span className="text-muted block text-[11px]">
            Same date, same asset — the payout then counts as reinvested, not paid out.
          </span>
        </span>
      </label>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <Button size="header" onClick={handleConfirm} disabled={pending}>
          Record coupon
        </Button>
        <Button size="header" variant="ghost" onClick={onSkip} disabled={pending}>
          Skip
        </Button>
      </div>
    </Card>
  );
}
