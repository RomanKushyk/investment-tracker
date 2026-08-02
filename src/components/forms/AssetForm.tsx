import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { Switch as RadixSwitch } from 'radix-ui';
import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  Controller,
  useForm,
  useFormState,
  useWatch,
  type UseFormReturn,
} from 'react-hook-form';

import { COLOR_KEYS } from '../../core/colors';
import {
  assetFormSchema,
  type AssetFormInput,
  type AssetFormValues,
} from '../../core/schemas';
import type { Asset, ColorKey } from '../../core/types';
import { AssetAvatar } from '../ui/AssetAvatar';
import { Button } from '../ui/Button';
import { DatePicker } from '../ui/DatePicker';
import { DialogTitle } from '../ui/Dialog';
import { Select } from '../ui/Select';
import {
  ASSET_FIELD_MESSAGE as MSG,
  assetFormDefaults,
  deriveCode,
  scheduleOptions,
  YIELD_TYPE_OPTIONS,
} from './asset-form';

// The single standalone asset form (NEXT-PHASE-PLAN P2 feat/asset-form,
// brief S3, design/extensions/asset-form.dc.html) — replaces the
// transaction-welded NewAssetFields. Hosts:
//   · Settings→Portfolio renders <AssetForm> in a Dialog (create + edit);
//   · TransactionPanel renders <AssetFormFields> inline with its OWN form
//     instance (quick-create keeps the atomic recordTransaction(tx, newAsset)
//     and derives firstPurchase from the transaction date).

export type AssetFormHandle = UseFormReturn<AssetFormInput, unknown, AssetFormValues>;

// Field anatomy (S3): label 11px `label`, gap 4px; error message 11px `neg`
// under the field (fade + slide-from-top-1, 220ms).
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | false;
  children: ReactNode;
}) {
  return (
    <label className="text-label flex min-w-0 flex-col gap-1 text-[11px]">
      {label}
      {children}
      {error && (
        <span className="text-neg animate-in fade-in slide-in-from-top-1 text-[11px] duration-200">
          {error}
        </span>
      )}
    </label>
  );
}

// S3 group reveal/hide (brief motion table): reveal = fade + slide-from-top
// 300ms; hide = SYMMETRIC fade/slide-out 300ms — the group stays mounted
// until its exit animation ends (a bare `{flag && …}` unmount would skip
// it). fill-mode-forwards holds the exited frame until React removes the
// node; reduced-motion collapses both to ~0 via the global kill-switch.
function Reveal({
  show,
  className,
  children,
}: {
  show: boolean;
  className: string;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(show);
  // Sanctioned adjust-state-on-render: re-entering while (or after) the exit
  // played must remount the group in the same render pass.
  if (show && !present) setPresent(true);
  if (!show && !present) return null;
  return (
    <div
      className={`${className} duration-300 ${
        show
          ? 'animate-in fade-in slide-in-from-top-2'
          : 'animate-out fade-out slide-out-to-top-2 fill-mode-forwards'
      }`}
      onAnimationEnd={(e) => {
        if (!show && e.target === e.currentTarget) setPresent(false);
      }}
    >
      {children}
    </div>
  );
}

// Inputs sit on `page` bg inside both hosts (white dialog card and the white
// dashed quick-create panel — master inversion rule); hover border → faint.
function inputClass(invalid: boolean): string {
  return `h-9 rounded-[10px] border bg-page px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-hairline hover:border-faint'
  }`;
}

// Track 40×22 radius 999 (off: hairline bg + panel-border; on: ink), 16px
// card thumb — D7 thumb transform rides the 220ms soft default.
function InzhurSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label="Link to Inzhur"
      className={`h-[22px] w-10 flex-none cursor-pointer rounded-full border p-[2px] transition active:scale-[.97] ${
        checked ? 'border-ink bg-ink' : 'border-panel-border bg-hairline'
      }`}
    >
      <RadixSwitch.Thumb
        className={`bg-card block size-4 rounded-full shadow-[0_1px_3px_rgba(38,38,42,.06)] transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </RadixSwitch.Root>
  );
}

// Fund/Bond segmented control — sliding-thumb clone of the currency toggle
// (D7: transform 300ms soft; both labels are 4 mono chars, so 50% works).
function KindSegment({
  value,
  onChange,
}: {
  value: 'fund' | 'bond';
  onChange: (kind: 'fund' | 'bond') => void;
}) {
  const segment = (kind: 'fund' | 'bond', label: string) => (
    <button
      type="button"
      aria-pressed={value === kind}
      onClick={() => onChange(kind)}
      className={`relative z-10 cursor-pointer rounded-full px-4 py-[5px] text-xs font-bold transition active:scale-[.97] ${
        value === kind ? 'text-ink' : 'text-muted hover:opacity-85'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="border-panel-border bg-panel relative flex gap-1 rounded-full border p-[3px]">
      <div
        aria-hidden
        className="bg-card ease-soft absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-5px)] rounded-full shadow-[0_1px_3px_rgba(38,38,42,.06)] transition-transform duration-300"
        style={{ transform: value === 'fund' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('fund', 'Fund')}
      {segment('bond', 'Bond')}
    </div>
  );
}

export function AssetFormFields({
  form,
  mode,
  layout,
  avatarColorKey,
  allowNone = false,
}: {
  form: AssetFormHandle;
  mode: 'create' | 'edit';
  // 'dialog' = full field set incl. First purchase; 'inline' = the
  // TransactionPanel quick-create (First purchase derives from the tx date).
  layout: 'dialog' | 'inline';
  avatarColorKey: ColorKey;
  allowNone?: boolean;
}) {
  // useFormState/useWatch (not form.formState/form.watch): the form instance
  // arrives via props, so this component must hold its OWN subscription —
  // otherwise the owner's re-render can be bailed out of by the memoized
  // element and errors/reveals would never update (React Compiler memoizes
  // this file; the useForm owner components are the ones rhf re-renders).
  // dirtyFields is subscribed alongside errors: Code auto-derives from the
  // Name's first two letters only while the Code field itself is pristine
  // (create mode) — the user editing Code makes it dirty and the derivation
  // stops; edit mode never derives (the stored code stands).
  const { errors, dirtyFields, isSubmitted } = useFormState({ control: form.control });
  const yieldType = useWatch({ control: form.control, name: 'yieldType' });
  const inzhur = useWatch({ control: form.control, name: 'inzhur' });
  const code = useWatch({ control: form.control, name: 'code' });
  const linked = inzhur !== undefined;
  const isBond = yieldType === 'fixed_coupon';

  const expectedTargetRow = (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="Expected, %" error={!!errors.expectedPct && MSG.expectedPct}>
        <input
          className={inputClass(!!errors.expectedPct)}
          placeholder="16.5"
          inputMode="decimal"
          {...form.register('expectedPct')}
        />
      </Field>
      <Field label="Target, %" error={!!errors.targetPct && MSG.targetPct}>
        <input
          className={inputClass(!!errors.targetPct)}
          placeholder="10"
          inputMode="decimal"
          {...form.register('targetPct')}
        />
      </Field>
    </div>
  );

  const yieldTypeField = (
    <Field label="Yield type">
      <Controller
        control={form.control}
        name="yieldType"
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={(v) => {
              field.onChange(v);
              // The fixed-coupon group hides for non-bond types — wipe its
              // values so a hidden field can never hold (or block on) state
              // the user cannot see (what-you-see-is-what-you-save).
              if (v !== 'fixed_coupon') {
                form.setValue('maturity', '');
                form.setValue('couponAmount', '');
                form.setValue('nextCoupon', '');
                form.setValue('reinvestPolicy', '');
                form.clearErrors(['maturity', 'couponAmount', 'nextCoupon', 'reinvestPolicy']);
              }
            }}
            options={YIELD_TYPE_OPTIONS}
            bg="page"
          />
        )}
      />
    </Field>
  );

  const payoutField = (
    <Field label="Payout schedule">
      <Controller
        control={form.control}
        name="payoutSchedule"
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={field.onChange}
            options={scheduleOptions(allowNone)}
            bg="page"
          />
        )}
      />
    </Field>
  );

  const firstPurchaseField = (
    <Field label="First purchase" error={!!errors.firstPurchase && MSG.firstPurchase}>
      <Controller
        control={form.control}
        name="firstPurchase"
        render={({ field }) => (
          <DatePicker
            value={field.value}
            onChange={field.onChange}
            bg="page"
            className="w-full text-left"
            invalid={!!errors.firstPurchase}
          />
        )}
      />
    </Field>
  );

  return (
    <>
      <Field label="Name" error={!!errors.name && MSG.name}>
        <input
          className={inputClass(!!errors.name)}
          placeholder="OVDP UA4000241234"
          {...form.register('name', {
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              if (mode === 'create' && !dirtyFields.code) {
                // shouldValidate only post-submit: a derived valid code must
                // clear its lingering error, but an untouched form must not
                // start flagging fields while the user types the name.
                form.setValue('code', deriveCode(e.target.value), {
                  shouldValidate: isSubmitted,
                });
              }
            },
          })}
        />
      </Field>

      <Field label="Code" error={!!errors.code && MSG.code}>
        <div className="flex items-center gap-2.5">
          <AssetAvatar code={(code || 'GB').toUpperCase()} colorKey={avatarColorKey} />
          <input
            className={`${inputClass(!!errors.code)} w-20 uppercase`}
            placeholder="GB"
            maxLength={2}
            {...form.register('code')}
          />
        </div>
      </Field>

      {layout === 'dialog' && mode === 'edit' ? (
        // Edit dialog pairs Yield type + Payout schedule; First purchase full
        // width below (design edit column).
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {yieldTypeField}
            {payoutField}
          </div>
          {expectedTargetRow}
          {firstPurchaseField}
        </>
      ) : (
        <>
          {yieldTypeField}
          {expectedTargetRow}
          {layout === 'dialog' ? (
            <div className="grid grid-cols-2 gap-2.5">
              {payoutField}
              {firstPurchaseField}
            </div>
          ) : (
            payoutField
          )}
        </>
      )}

      <Reveal show={isBond} className="border-hairline flex flex-col gap-2.5 border-t pt-2.5">
        <div className="text-pos-tint-text text-[11px] font-bold tracking-[.06em] uppercase">
          Fixed coupon
        </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Maturity" error={!!errors.maturity && MSG.maturity}>
              <Controller
                control={form.control}
                name="maturity"
                render={({ field }) => (
                  <DatePicker
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    bg="page"
                    className="w-full text-left"
                    placeholder="25.02.2027"
                    invalid={!!errors.maturity}
                  />
                )}
              />
            </Field>
            <Field label="Next coupon" error={!!errors.nextCoupon && MSG.nextCoupon}>
              <Controller
                control={form.control}
                name="nextCoupon"
                render={({ field }) => (
                  <DatePicker
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    bg="page"
                    className="w-full text-left"
                    placeholder="25.08.2026"
                    invalid={!!errors.nextCoupon}
                  />
                )}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Coupon amount, ₴" error={!!errors.couponAmount && MSG.couponAmount}>
              <input
                className={inputClass(!!errors.couponAmount)}
                placeholder="1 240,00"
                inputMode="decimal"
                {...form.register('couponAmount')}
              />
            </Field>
            <Field label="Reinvest policy">
              <input
                className={inputClass(false)}
                placeholder="Auto (dividends)"
                {...form.register('reinvestPolicy')}
              />
            </Field>
          </div>
      </Reveal>

      <div className="border-hairline border-t pt-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink text-[13px] font-semibold">Link to Inzhur</span>
          <InzhurSwitch
            checked={linked}
            onCheckedChange={(on) => {
              if (on) {
                // Smart default: bonds link by ISIN, everything else by slug.
                form.setValue('inzhur', { kind: isBond ? 'bond' : 'fund', ref: '', units: '' });
              } else {
                form.setValue('inzhur', undefined);
                form.clearErrors('inzhur');
              }
            }}
          />
        </div>
        <Reveal show={linked} className="mt-2.5 flex flex-col gap-2.5">
            {/* Units-first framing (S3): while linked, quantity is the input —
                value is derived — so Units leads, emphasized (h 44, display
                font 15/600). */}
            <Field label="Units" error={!!errors.inzhur?.units && MSG.units}>
              <input
                className={`h-11 rounded-[10px] border px-3 font-display text-[15px] font-semibold ${
                  errors.inzhur?.units ? 'border-neg' : 'border-hairline hover:border-faint'
                } bg-page text-ink transition`}
                placeholder="6 164"
                inputMode="decimal"
                {...form.register('inzhur.units')}
              />
            </Field>
            <div className="grid grid-cols-[auto_1fr] items-end gap-2.5">
              <div className="text-label flex flex-col gap-1 text-[11px]">
                Kind
                <Controller
                  control={form.control}
                  name="inzhur.kind"
                  render={({ field }) => (
                    <KindSegment value={field.value ?? 'fund'} onChange={field.onChange} />
                  )}
                />
              </div>
              <Field
                label={inzhur?.kind === 'bond' ? 'Bond ISIN' : 'Fund slug'}
                error={
                  !!errors.inzhur?.ref && (inzhur?.kind === 'bond' ? MSG.refBond : MSG.refFund)
                }
              >
                <input
                  className={inputClass(!!errors.inzhur?.ref)}
                  placeholder={inzhur?.kind === 'bond' ? 'UA4000238976' : 'inzhur-reit'}
                  {...form.register('inzhur.ref')}
                />
              </Field>
            </div>
            <p className="text-muted m-0 text-[11px] leading-normal">
              Linked assets are valued as units × the fetched sell price. Fetching arrives in the
              next release — the link and units are stored now.
            </p>
        </Reveal>
      </div>
    </>
  );
}

// Dialog body for Settings→Portfolio: heading + fields + Cancel/submit.
// Mounted fresh per open (the host keys it), so useForm captures the asset's
// values as defaults.
export function AssetForm({
  mode,
  asset,
  existingAssetCount,
  pending,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  asset?: Asset; // edit prefill
  existingAssetCount: number; // create: avatar preview cycles the next free hue
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: AssetFormValues) => void;
}) {
  const form = useForm<AssetFormInput, unknown, AssetFormValues>({
    resolver: zodResolver(assetFormSchema(mode)),
    defaultValues: assetFormDefaults(asset),
  });
  const avatarColorKey =
    mode === 'edit' && asset ? asset.colorKey : COLOR_KEYS[existingAssetCount % COLOR_KEYS.length];
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      <DialogTitle asChild>
        <div className="text-pos-tint-text mb-1 flex items-center gap-2 text-[11px] font-bold tracking-[.06em] uppercase">
          {mode === 'create' && <Plus size={13} strokeWidth={2.75} />}
          {mode === 'create' ? 'New asset details' : 'Edit asset'}
        </div>
      </DialogTitle>
      <AssetFormFields
        form={form}
        mode={mode}
        layout="dialog"
        avatarColorKey={avatarColorKey}
        allowNone={mode === 'edit' && asset?.payoutSchedule === 'none'}
      />
      <div className="mt-1 flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {mode === 'create' ? 'Add asset' : 'Save changes'}
        </Button>
      </div>
      {hasErrors && (
        <p className="text-neg animate-in fade-in slide-in-from-top-1 m-0 text-right text-xs duration-200">
          {MSG.summary}
        </p>
      )}
    </form>
  );
}
