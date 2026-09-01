import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Controller, useForm, useFormState, useWatch, type UseFormReturn } from 'react-hook-form';

import { COLOR_KEYS } from '../../core/colors';
import { kyivDateIso } from '../../core/dates';
import { assetFormSchema, type AssetFormInput, type AssetFormValues } from '../../core/schemas';
import type { Asset, ColorKey } from '../../core/types';
import { useInzhurAssets } from '../../hooks/useInzhurAssets';
import { AssetAvatar } from '../ui/AssetAvatar';
import { Button } from '../ui/Button';
import { DatePicker } from '../ui/DatePicker';
import { DialogBody, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Reveal } from '../ui/Reveal';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import {
  assetFormDefaults,
  deriveCode,
  inzhurRefOptions,
  scheduleOptions,
  yieldTypeOptions,
} from './asset-form';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';

// The single standalone asset form (NEXT-PHASE-PLAN P2 feat/asset-form,
// brief S3, design/extensions/asset-form.dc.html) — replaces the
// transaction-welded NewAssetFields. Hosts:
//   · /portfolio (Settings until A31) renders <AssetForm> in a Dialog (create + edit);
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
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
      {label}
      {children}
      {error && (
        <span className="animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1">
          {error}
        </span>
      )}
    </label>
  );
}

// Inputs sit on `page` bg inside both hosts (white dialog card and the white
// dashed quick-create panel — master inversion rule); hover border → faint.
function inputClass(invalid: boolean): string {
  return `h-9 rounded-[9px] border bg-page px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-hairline hover:border-faint'
  }`;
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
  const t = useT();
  const segment = (kind: 'fund' | 'bond', label: string) => (
    <button
      type="button"
      aria-pressed={value === kind}
      onClick={() => onChange(kind)}
      className={`relative z-10 cursor-pointer rounded-[7px] px-4 py-[5px] text-xs font-bold transition active:scale-[.97] ${
        value === kind ? 'text-ink' : 'text-muted hover:opacity-85'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="relative flex gap-1 rounded-[11px] border border-panel-border bg-panel p-[3px]">
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-5px)] rounded-[7px] bg-card shadow-(--shadow-thumb) transition-transform duration-300 ease-soft"
        style={{ transform: value === 'fund' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('fund', t.asset.picker.fund)}
      {segment('bond', t.asset.picker.bond)}
    </div>
  );
}

// The Inzhur link group — Units (units-first framing, S3) + Kind + the ref
// field, which in Phase 3 became a LIVE PICKER of the public feed
// (automation.dc.html S7). Own `useFormState`/`useWatch` subscriptions for the
// same reason AssetFormFields holds its own (the form arrives via props).
//
// Three rules the states below implement:
//   · the feed is fetched on FIRST OPEN, never on mount — opening the form
//     fires no request;
//   · linking is NEVER blocked by the network: every failure path lands in a
//     working manual input (and offline is `muted`, not `neg` — it is not a
//     user mistake);
//   · demo forces manual mode with the specced note (G4/D16: no request can
//     leave the app there).
function InzhurGroup({ form }: { form: AssetFormHandle }) {
  const t = useT();
  const MSG = t.asset.message;
  const PICK = t.asset.picker;
  const f = useFormat();
  const { errors } = useFormState({ control: form.control });
  const inzhur = useWatch({ control: form.control, name: 'inzhur' });
  const kind = inzhur?.kind ?? 'fund';
  const { data, lastGood, isFetching, isError, disabled, fetchAssets } = useInzhurAssets();
  const [manual, setManual] = useState(false);

  // The cache feeds the list whenever a live payload is not in hand — the
  // footer then states its date rather than pretending the prices are today's.
  const feed = data ?? lastGood;
  const stale = data === undefined && lastGood !== undefined;
  const options =
    feed === undefined ? [] : inzhurRefOptions(feed.feed.entries, kind, inzhur?.ref ?? '', f, t);
  const failed = isError && !isFetching && options.length === 0;
  const showManual = disabled || manual || failed;

  const note = disabled ? PICK.demo : failed ? PICK.failed : undefined;
  // Before the first open there is no feed and no error yet — the open list is
  // about to fetch, so it reads "loading" rather than flashing "nothing here".
  const loading = isFetching || (feed === undefined && !isError);
  const status = loading ? (
    <div className="animate-pulse px-3 py-2 text-[13px] text-muted">{PICK.loading}</div>
  ) : options.length === 0 ? (
    <div className="px-3 py-2 text-[13px] text-muted">{PICK.empty}</div>
  ) : stale ? (
    <div className="px-3 py-1.5 text-[11px] text-warn">
      as of {f.dateShort(kyivDateIso(new Date(lastGood.fetchedAt)))}
    </div>
  ) : undefined;

  function ensureFeed() {
    if (data === undefined && !isFetching) void fetchAssets();
  }

  return (
    <>
      {/* Units-first framing (S3): while linked, quantity is the input —
          value is derived — so Units leads, emphasized (h 44, display
          font 15/600). */}
      <Field label={t.asset.field.units} error={!!errors.inzhur?.units && MSG.units}>
        <input
          className={`h-11 rounded-[11px] border px-3 font-display text-[15px] font-semibold ${
            errors.inzhur?.units ? 'border-neg' : 'border-hairline hover:border-faint'
          } bg-page text-ink transition`}
          placeholder={t.asset.placeholder.units}
          inputMode="decimal"
          {...form.register('inzhur.units')}
        />
      </Field>
      <div className="grid grid-cols-[auto_1fr] items-end gap-2.5">
        <div className="flex flex-col gap-1 text-[11px] text-muted">
          {t.asset.field.kind}
          <Controller
            control={form.control}
            name="inzhur.kind"
            render={({ field }) => (
              <KindSegment value={field.value ?? 'fund'} onChange={field.onChange} />
            )}
          />
        </div>
        <Field
          label={
            showManual
              ? kind === 'bond'
                ? PICK.bondManual
                : PICK.fundManual
              : kind === 'bond'
                ? PICK.bond
                : PICK.fund
          }
          error={!!errors.inzhur?.ref && (kind === 'bond' ? MSG.refBond : MSG.refFund)}
        >
          <Controller
            control={form.control}
            name="inzhur.ref"
            render={({ field }) =>
              showManual ? (
                <input
                  className={inputClass(!!errors.inzhur?.ref)}
                  aria-invalid={!!errors.inzhur?.ref || undefined}
                  placeholder={kind === 'bond' ? 'UA4000238976' : 'inzhur-reit'}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              ) : (
                <Select
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  options={options}
                  placeholder={PICK.placeholder}
                  bg="page"
                  onOpenChange={(open) => open && ensureFeed()}
                  status={status}
                  scrollList
                />
              )
            }
          />
        </Field>
      </div>
      {/* Note under the row, not inside the field: the Kind segment and the ref
          control stay bottom-aligned exactly as P2 pinned them. */}
      {note !== undefined && (
        <p className="m-0 animate-in text-[11px] text-muted duration-200 fade-in">{note}</p>
      )}
      {/* The escape hatch is always one press away — except in demo, where
          there is nothing to pick. */}
      {!disabled && (
        <button
          type="button"
          onClick={() => {
            setManual(!showManual);
            if (showManual) ensureFeed(); // going back to the list = a retry
          }}
          className="cursor-pointer self-start p-0 text-[11px] text-ink transition hover:opacity-85 active:scale-[.97]"
        >
          {showManual ? PICK.toPicker : PICK.toManual}
        </button>
      )}
      <p className="m-0 text-[11px] leading-normal text-muted">{PICK.helper}</p>
    </>
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
  const t = useT();
  const MSG = t.asset.message;
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
      <Field label={t.asset.field.expectedPct} error={!!errors.expectedPct && MSG.expectedPct}>
        <input
          className={inputClass(!!errors.expectedPct)}
          aria-invalid={!!errors.expectedPct || undefined}
          placeholder={t.asset.placeholder.expectedPct}
          inputMode="decimal"
          {...form.register('expectedPct')}
        />
      </Field>
      <Field label={t.asset.field.targetPct} error={!!errors.targetPct && MSG.targetPct}>
        <input
          className={inputClass(!!errors.targetPct)}
          aria-invalid={!!errors.targetPct || undefined}
          placeholder={t.asset.placeholder.targetPct}
          inputMode="decimal"
          {...form.register('targetPct')}
        />
      </Field>
    </div>
  );

  const yieldTypeField = (
    <Field label={t.asset.field.yieldType}>
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
            options={yieldTypeOptions(t)}
            bg="page"
          />
        )}
      />
    </Field>
  );

  const payoutField = (
    <Field label={t.asset.field.payoutSchedule}>
      <Controller
        control={form.control}
        name="payoutSchedule"
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={field.onChange}
            options={scheduleOptions(allowNone, t)}
            bg="page"
          />
        )}
      />
    </Field>
  );

  const firstPurchaseField = (
    <Field label={t.asset.field.firstPurchase} error={!!errors.firstPurchase && MSG.firstPurchase}>
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
      <Field label={t.asset.field.name} error={!!errors.name && MSG.name}>
        <input
          className={inputClass(!!errors.name)}
          aria-invalid={!!errors.name || undefined}
          placeholder={t.asset.placeholder.name}
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

      <Field label={t.asset.field.code} error={!!errors.code && MSG.code}>
        <div className="flex items-center gap-2.5">
          <AssetAvatar code={(code || 'GB').toUpperCase()} colorKey={avatarColorKey} />
          <input
            className={`${inputClass(!!errors.code)} w-20 uppercase`}
            aria-invalid={!!errors.code || undefined}
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

      <Reveal show={isBond} className="flex flex-col gap-2.5 border-t border-hairline pt-2.5">
        <div className="text-[11px] font-bold tracking-[.06em] text-pos-tint-text uppercase">
          {t.asset.field.fixedCouponGroup}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t.asset.field.maturity} error={!!errors.maturity && MSG.maturity}>
            <Controller
              control={form.control}
              name="maturity"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  bg="page"
                  className="w-full text-left"
                  placeholder={t.asset.placeholder.maturity}
                  invalid={!!errors.maturity}
                />
              )}
            />
          </Field>
          <Field label={t.asset.field.nextCoupon} error={!!errors.nextCoupon && MSG.nextCoupon}>
            <Controller
              control={form.control}
              name="nextCoupon"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  bg="page"
                  className="w-full text-left"
                  placeholder={t.asset.placeholder.nextCoupon}
                  invalid={!!errors.nextCoupon}
                />
              )}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label={t.asset.field.couponAmount}
            error={!!errors.couponAmount && MSG.couponAmount}
          >
            <input
              className={inputClass(!!errors.couponAmount)}
              aria-invalid={!!errors.couponAmount || undefined}
              placeholder={t.asset.placeholder.couponAmount}
              inputMode="decimal"
              {...form.register('couponAmount')}
            />
          </Field>
          <Field label={t.asset.field.reinvestPolicy}>
            <input
              className={inputClass(false)}
              placeholder={t.asset.placeholder.reinvestPolicy}
              {...form.register('reinvestPolicy')}
            />
          </Field>
        </div>
      </Reveal>

      <div className="border-t border-hairline pt-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">{t.asset.field.linkToInzhur}</span>
          <Switch
            label={t.asset.field.linkToInzhur}
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
          <InzhurGroup form={form} />
        </Reveal>
      </div>
    </>
  );
}

// Dialog body for /portfolio's asset manager: heading + fields + Cancel/submit.
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
  const t = useT();
  const MSG = t.asset.message;
  const f = useFormat();
  const language = useSettings((state) => state.language);
  // Once per language, not once per render — see `TransactionPanel`.
  const schema = useMemo(() => assetFormSchema(mode, language), [mode, language]);
  const form = useForm<AssetFormInput, unknown, AssetFormValues>({
    // THE LANGUAGE IS A PARSE RULE for the Units field, not only a display one —
    // a lone comma is the decimal mark in Ukrainian and a thousands mark in
    // English, and this field's own prefill (`f.units`) renders `6,164` in one
    // of them.
    resolver: zodResolver(schema),
    defaultValues: assetFormDefaults(f, asset),
  });
  const avatarColorKey =
    mode === 'edit' && asset ? asset.colorKey : COLOR_KEYS[existingAssetCount % COLOR_KEYS.length];
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  return (
    // The FORM spans all three bands, so `contents`: it keeps every field and
    // the submit button in one <form> — the button sits in the fixed footer
    // while the fields it submits scroll above it — while its own box drops out
    // of layout so the three bands land directly in the panel's grid rows.
    // Nothing is lost to the a11y tree: a form is only a landmark when it has
    // an accessible name, and this one is inside a dialog that supplies it.
    <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
      <DialogHeader>
        <DialogTitle asChild>
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[.06em] text-pos-tint-text uppercase">
            {mode === 'create' && <Plus size={13} strokeWidth={2.75} />}
            {mode === 'create' ? t.transaction.newAssetDetails : t.assets.editTitle}
          </div>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-2.5">
        <AssetFormFields
          form={form}
          mode={mode}
          layout="dialog"
          avatarColorKey={avatarColorKey}
          allowNone={mode === 'edit' && asset?.payoutSchedule === 'none'}
        />
      </DialogBody>
      <DialogFooter>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" onClick={onCancel}>
            {t.assets.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {mode === 'create' ? t.assets.add : t.assets.saveChanges}
          </Button>
        </div>
        {/* Stays with the buttons, not with the fields: it reports on the press,
            and a summary that scrolled away with the form would be announced
            about a control the reader can no longer see. */}
        {hasErrors && (
          <p className="m-0 mt-2 animate-in text-right text-xs text-neg duration-200 fade-in slide-in-from-top-1">
            {MSG.summary}
          </p>
        )}
      </DialogFooter>
    </form>
  );
}
