import { Plus } from 'lucide-react';
import {
  Controller,
  type Control,
  type UseFormRegister,
} from 'react-hook-form';

import { Select } from '../components/ui/Select';
import type {
  TransactionFormInput,
  TransactionFormValues,
} from '../lib/schemas';

// The New-asset form offers only the 4 README schedules — 'none' is seed-only.
const YIELD_TYPE_OPTIONS = [
  { value: 'fixed_coupon', label: 'Fixed coupon' },
  { value: 'dividends', label: 'Dividends' },
  { value: 'capitalization', label: 'Capitalization' },
  { value: 'div_cap', label: 'Dividends + capitalization' },
];

const PAYOUT_SCHEDULE_OPTIONS = [
  { value: 'maturity', label: 'At maturity' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Semi-annual' },
];

const inputClass =
  'h-9 rounded-[10px] border border-hairline bg-page px-3 font-body text-[13px] text-ink transition';

// Rendered only when Asset = "+ New asset…" (design lines 116-124, README §6.1).
export function NewAssetFields({
  register,
  control,
}: {
  register: UseFormRegister<TransactionFormInput>;
  control: Control<TransactionFormInput, unknown, TransactionFormValues>;
}) {
  return (
    <div className="border-faint flex flex-col gap-2.5 rounded-2xl border border-dashed bg-white p-3.5">
      <div className="text-pos-tint-text flex items-center gap-2 text-[11px] font-bold tracking-[.06em] uppercase">
        <Plus size={13} strokeWidth={2.75} />
        New asset details
      </div>
      <label className="text-label flex flex-col gap-1 text-[11px]">
        Name
        <input
          className={inputClass}
          placeholder="OVDP UA4000241234"
          {...register('newAsset.name')}
        />
      </label>
      <label className="text-label flex flex-col gap-1 text-[11px]">
        Yield type
        <Controller
          control={control}
          name="newAsset.yieldType"
          defaultValue="fixed_coupon"
          render={({ field }) => (
            <Select
              value={field.value ?? ''}
              onValueChange={field.onChange}
              options={YIELD_TYPE_OPTIONS}
              bg="page"
            />
          )}
        />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-label flex flex-col gap-1 text-[11px]">
          Expected, %
          <input
            className={inputClass}
            placeholder="16.5"
            inputMode="decimal"
            {...register('newAsset.expectedPct')}
          />
        </label>
        <label className="text-label flex flex-col gap-1 text-[11px]">
          Target, %
          <input
            className={inputClass}
            placeholder="10"
            inputMode="decimal"
            {...register('newAsset.targetPct')}
          />
        </label>
      </div>
      <label className="text-label flex flex-col gap-1 text-[11px]">
        Payout schedule
        <Controller
          control={control}
          name="newAsset.payoutSchedule"
          defaultValue="maturity"
          render={({ field }) => (
            <Select
              value={field.value ?? ''}
              onValueChange={field.onChange}
              options={PAYOUT_SCHEDULE_OPTIONS}
              bg="page"
            />
          )}
        />
      </label>
    </div>
  );
}
