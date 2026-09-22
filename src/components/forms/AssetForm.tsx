import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Controller, useForm, useFormState, useWatch, type UseFormReturn } from 'react-hook-form';

import { COLOR_KEYS } from '@quirenote/core/colors';
import { kyivDateIso } from '@quirenote/core/dates';
import {
  assetFormSchema,
  type AssetFormInput,
  type AssetFormValues,
} from '@quirenote/core/schemas';
import { sameRef, scheduleFacts } from '@quirenote/core/inzhur/parse';
import { normalizeRef } from '@quirenote/core/inzhur/ref';
import type { Asset, ColorKey } from '@quirenote/core/types';
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

// Two hosts, one field set (`design/extensions/asset-form.dc.html`): /portfolio
// opens <AssetForm> in a Dialog, and TransactionPanel renders <AssetFormFields>
// inline against its OWN form instance — quick-create keeps the atomic
// recordTransaction(tx, newAsset) and derives firstPurchase from the tx date.

export type AssetFormHandle = UseFormReturn<AssetFormInput, unknown, AssetFormValues>;

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

// `page`, hard-coded, because BOTH hosts stand on `card` — the dialog body and
// the dashed quick-create panel alike — so one value inverts against both. Hover
// takes the field edge to `ink`.
function inputClass(invalid: boolean): string {
  return `h-9 rounded-[9px] border bg-page px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-field-border hover:border-ink'
  }`;
}

// The Inzhur link group. Its own `useFormState`/`useWatch` subscriptions, for
// the reason `AssetFormFields` gives below: the form arrives via props.
//
// Three rules the states below implement: the feed is fetched on FIRST OPEN, so
// opening the form fires no request; linking is NEVER blocked by the network, so
// every failure path lands in a working manual input, and offline reads `muted`
// rather than `neg` because it is not a user mistake; demo forces manual mode,
// no request being allowed to leave the app there.
function InzhurGroup({ form }: { form: AssetFormHandle }) {
  const t = useT();
  const MSG = t.asset.message;
  const PICK = t.asset.picker;
  const f = useFormat();
  const { errors } = useFormState({ control: form.control });
  const inzhur = useWatch({ control: form.control, name: 'inzhur' });
  // DERIVED, NOT ASKED: an Inzhur bond is an OVDP, which is `fixed_coupon`, and
  // everything else the provider lists is a fund — so a control of its own could
  // only agree with the yield type or contradict it, and contradicting it lists
  // the wrong instruments with no way to tell why.
  const yieldType = useWatch({ control: form.control, name: 'yieldType' });
  const kind: 'fund' | 'bond' = yieldType === 'fixed_coupon' ? 'bond' : 'fund';
  const { data, lastGood, isFetching, isError, disabled, fetchAssets } = useInzhurAssets();
  // ONE NAME FOR ONE FEED. Bound twice, a later change to the fallback rule
  // updates one binding and leaves the picker reading a different payload from
  // the one filling maturity, next coupon and the rate.
  const feed = data ?? lastGood;
  const [manual, setManual] = useState(false);

  // The derived kind has to REACH the form — `inzhur.kind` is submitted and
  // `matchAssets` keys on it — and the ref goes with it, a fund slug not being an
  // ISIN: a yield type changed while linked otherwise leaves a ref that can only
  // fail to match, silently, as an unmatched asset at the next fetch.
  //
  // ON MOUNT IT TOUCHES NOTHING. Stored data written before the kind was derived
  // can legitimately disagree with it (`div_cap` + `kind: 'bond'`); clearing that
  // on mount wiped the asset's ref before the user touched anything, and
  // re-picking then made `legacyUnitsOf` see a changed ref and DELETE the only
  // unit count the asset had.
  //
  // KEYED ON A REF HOLDING THE PREVIOUS KIND: idempotent, so StrictMode's second
  // pass sees equality, and compared against the last value rather than a
  // default, so a round trip counts as two changes. Both alternatives fail —
  // `dirtyFields.yieldType` is UNSET when a field returns to its default, and a
  // `settled` first-run ref is not reset between StrictMode's two passes, so it
  // cleared on mount. On the KIND, not the yield type: `dividends` and `div_cap`
  // both derive `fund`, and a fund slug stays valid across that.
  const prevKind = useRef(kind);
  useEffect(() => {
    const changed = prevKind.current !== kind;
    // Before every early return: a bail that skipped the assignment would
    // compare the NEXT change against a stale kind and miss it.
    prevKind.current = kind;
    if (!changed) return;
    if (inzhur === undefined) return;
    // NO `inzhur.kind === kind` SHORTCUT. It reads as a cheap no-op guard and it
    // defeats the clearing: a stored `{kind:'bond', ref:'inzhur-reit'}` under
    // `yieldType: 'dividends'` derives `fund` on mount, and switching to Fixed
    // coupon makes the derived kind `bond`, which the STORED kind already says —
    // so the guard returns and leaves a fund slug under `kind: 'bond'`, a pair
    // `matchKey` can never resolve. A ref belongs to the kind it was picked
    // under, whatever the stored field happens to say.
    form.setValue('inzhur.kind', kind);
    form.setValue('inzhur.ref', '');
    form.clearErrors('inzhur.ref');
  }, [kind, inzhur, form]);

  // Naming a bond from the list fills its maturity, next coupon, cadence and
  // rate, and overwriting them is right — *Forms and layout*.
  //
  // Keyed on the ref last applied, so this fires once per instrument rather than
  // on every render, and clearing the ref re-arms it.
  //
  // SEEDED WITH THE REF THE FORM OPENED ON, so mount fills nothing. Starting at
  // `undefined`, opening Edit on an already-linked bond — to fix its NAME —
  // rewrote its stored maturity and next coupon from the cache, and Save
  // persisted them. On mount the user has named nothing.
  //
  // NORMALIZED on both sides, so canonicalising `ua4000238976` to the feed's
  // `UA4000238976` is not read as the user naming a new instrument and does not
  // refill the whole group.
  const pickedRef = useRef<string | undefined>(undefined);
  const appliedRef = useRef<string | undefined>(
    normalizeRef(form.getValues('inzhur')?.ref ?? '') || undefined,
  );

  // THE STORED REF TAKES THE PROVIDER'S SPELLING once the feed can supply it,
  // because `RadixSelect.Value` matches the root value against each item's value
  // as an EXACT string: a stored `ua4000238976` against a published
  // `UA4000238976` renders the PLACEHOLDER, a linked asset reading as unlinked.
  //
  // `shouldDirty: false` — the provider's casing is not the user's edit, and an
  // asset opened and closed untouched must not come out dirty.
  useEffect(() => {
    const ref = inzhur?.ref?.trim() ?? '';
    if (ref === '' || feed === undefined) return;
    // `sameRef`, the one owner of "do these two names mean the same instrument":
    // `ref.ts` exists because every private copy of it has been a bug.
    const entry = feed.feed.entries.find((e) => sameRef(e, { kind, ref }));
    if (entry === undefined || entry.ref === ref) return;
    form.setValue('inzhur.ref', entry.ref, { shouldDirty: false });
  }, [inzhur?.ref, kind, feed, form]);

  useEffect(() => {
    const ref = inzhur?.ref?.trim() ?? '';
    if (ref === '') {
      appliedRef.current = undefined;
      return;
    }
    const key = normalizeRef(ref);
    if (appliedRef.current === key) return;
    // MARKED APPLIED THE MOMENT THE REF CHANGES, whether or not anything could be
    // filled from it; otherwise the fill fires on the FEED ARRIVING rather than
    // on the user naming an instrument. Offline, a hand-typed ISIN with
    // hand-filled maturity, next coupon and rate had all three replaced the
    // moment a later fetch succeeded — and a network success is not a naming act.
    //
    // THE COST, stated: a ref typed while no feed is in hand never auto-fills,
    // not even later. That is the safer direction — marking only what could be
    // filled loses hand-typed data, this loses a convenience — and re-picking
    // from the list is one press away.
    appliedRef.current = key;
    if (kind !== 'bond' || feed === undefined) return;
    // ONLY WHAT THE PICKER NAMED. A ref typed by hand never fills; `nameRef` has
    // why.
    if (pickedRef.current !== key) return;
    const quote = feed.feed.entries.find((e) => sameRef(e, { kind: 'bond', ref }));
    if (quote === undefined) return;
    // KYIV'S CALENDAR DAY, not the browser's: every date in `paymentSchedule`
    // came through `feedDate`, which normalises to Kyiv midnight, and
    // `nextPaymentOnOrAfter` compares them as STRINGS against this one. A user
    // east of Kyiv on a payment day (or west the day before) hands it a date one
    // off the schedule's own calendar, so `nextCoupon` takes the wrong occurrence
    // — today's coupon skipped for one 182 days out, or one already paid written
    // in as the anchor `nextUnsettledCoupon`, `dueCoupons`, `computeReminders`,
    // `couponsInGap` and `couponProjection` all walk from.
    const facts = scheduleFacts(quote, kyivDateIso(new Date()));
    // WRITTEN OR CLEARED, never left. Leaving what the feed cannot answer is
    // right for a FIRST fill and wrong on a RE-POINT, where it keeps the PREVIOUS
    // instrument's answer: `scheduleFacts` returns no `nextCoupon` for a bond
    // whose schedule is entirely spent, and a spent bond stays in the picker, so
    // naming A and then B stored B's maturity and rate against A's coupon anchor.
    form.setValue('maturity', facts.maturity ?? '');
    form.setValue('nextCoupon', facts.nextCoupon ?? '');
    form.setValue(
      'couponRatePct',
      facts.couponRatePct === undefined ? '' : f.input(facts.couponRatePct),
    );
    // `payoutSchedule` HAS NO EMPTY MEMBER, so "clear it" means what a fresh form
    // would hold: `semiannual`, the cadence every bond the provider lists pays on
    // (docs/reference/OVDP-COUPON-STRUCTURE.md). Keeping bond A's cadence would
    // be a guess too, and the worse one — this field is the divisor in
    // `couponPerPayment` and the step in `rollNextCoupon`, so carrying A across
    // walks B's coupons onto dates it never pays on.
    form.setValue('payoutSchedule', facts.payoutSchedule ?? 'semiannual');
  }, [inzhur?.ref, kind, feed, form, f]);

  // The cache feeds the list whenever a live payload is not in hand — the
  // footer then states its date rather than pretending the prices are today's.
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
      <div>
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
          {/* NAMING A REF WRITES THE KIND WITH IT, in BOTH branches: the list and
              the placeholder are built from the DERIVED kind, so a ref entered
              against either belongs to that kind by construction. Without it the
              effect above is the only writer of `inzhur.kind` and does nothing on
              mount, so stored data disagreeing with the derived kind stays
              unmatched at every fetch with no control able to correct it. */}
          <Controller
            control={form.control}
            name="inzhur.ref"
            render={({ field }) => {
              const nameRef = (v: string, picked: boolean) => {
                form.setValue('inzhur.kind', kind);
                // NAMING IS A PICK, NOT A KEYSTROKE. The schedule fill reads a
                // changed ref as "the user just named this instrument", and in
                // the manual input that fires on every character — fixing a typo
                // in a hand-typed ISIN rewrote maturity, next coupon, rate and
                // cadence from the feed over the hand-entered anchor.
                if (picked) pickedRef.current = normalizeRef(v);
                field.onChange(v);
              };
              return showManual ? (
                <input
                  className={inputClass(!!errors.inzhur?.ref)}
                  aria-invalid={!!errors.inzhur?.ref || undefined}
                  placeholder={kind === 'bond' ? 'UA4000238976' : 'inzhur-reit'}
                  value={field.value ?? ''}
                  onChange={(e) => nameRef(e.target.value, false)}
                  onBlur={field.onBlur}
                />
              ) : (
                <Select
                  value={field.value ?? ''}
                  onValueChange={(v) => nameRef(v, true)}
                  options={options}
                  placeholder={PICK.placeholder}
                  bg="page"
                  onOpenChange={(open) => open && ensureFeed()}
                  status={status}
                  scrollList
                />
              );
            }}
          />
        </Field>
      </div>
      {/* Under the row, not inside the field: inside, it pushes the ref control
          off the baseline. */}
      {note !== undefined && (
        <p className="m-0 animate-in text-[11px] text-muted duration-200 fade-in">{note}</p>
      )}
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
  // useFormState/useWatch, not form.formState/form.watch: the form instance
  // arrives via props, so this component holds its OWN subscription — React
  // Compiler memoizes this file, and rhf re-renders the useForm owner, so the
  // memoized element would otherwise bail out and errors and reveals never
  // update. `dirtyFields` rides along for Code, which auto-derives from the
  // Name's first two letters in CREATE mode and only while Code is pristine —
  // edit mode never derives, the stored code standing.
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
              // The fixed-coupon group hides for non-bond types, so its values
              // are wiped: a hidden field must never hold, or block on, state
              // the user cannot see.
              if (v !== 'fixed_coupon') {
                form.setValue('maturity', '');
                form.setValue('couponRatePct', '');
                form.setValue('nextCoupon', '');
                form.clearErrors(['maturity', 'couponRatePct', 'nextCoupon']);
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
        {/* One child, and the half width is the point: it keeps the column the
            two date fields above establish, where a rate reading "15,68" would be
            the only full-row numeric input on the screen. */}
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label={t.asset.field.couponRatePct}
            error={!!errors.couponRatePct && MSG.couponRatePct}
          >
            <input
              className={inputClass(!!errors.couponRatePct)}
              aria-invalid={!!errors.couponRatePct || undefined}
              placeholder={t.asset.placeholder.couponRatePct}
              inputMode="decimal"
              {...form.register('couponRatePct')}
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
                form.setValue('inzhur', { kind: isBond ? 'bond' : 'fund', ref: '' });
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

// Mounted fresh per open — the host keys it — so `useForm` captures the asset's
// values as its defaults.
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
  // Once per mode AND LANGUAGE: a bare call rebuilds the whole zod tree and a
  // resolver closure on every field change. The language has to reach the percent
  // fields because `expectedPct` has no `max` — a Ukrainian «16,400» read under
  // the English rule stores 16400 %, where a field bounded at 100 would refuse it
  // — and it must match the language `assetFormDefaults` printed in. The two part
  // when the language changes under an open dialog; #123 reformats them.
  const schema = useMemo(() => assetFormSchema(mode, language), [mode, language]);
  const form = useForm<AssetFormInput, unknown, AssetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: assetFormDefaults(f, asset),
  });
  const avatarColorKey =
    mode === 'edit' && asset ? asset.colorKey : COLOR_KEYS[existingAssetCount % COLOR_KEYS.length];
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  return (
    // `contents`: one <form> spans all three bands — the submit button sits in
    // the fixed footer while the fields it submits scroll above it — and its own
    // box drops out of layout so the bands land in the panel's grid rows. The
    // a11y tree loses nothing: a form is a landmark only when it has an
    // accessible name, and the dialog around this one supplies it.
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
        {/* With the buttons, not the fields: it reports on the press, and a
            summary that scrolled away would be announced about a control the
            reader can no longer see. */}
        {hasErrors && (
          <p className="m-0 mt-2 animate-in text-right text-xs text-neg duration-200 fade-in slide-in-from-top-1">
            {MSG.summary}
          </p>
        )}
      </DialogFooter>
    </form>
  );
}
