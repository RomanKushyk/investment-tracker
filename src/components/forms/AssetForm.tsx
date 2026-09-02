import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Controller, useForm, useFormState, useWatch, type UseFormReturn } from 'react-hook-form';

import { COLOR_KEYS } from '../../core/colors';
import { kyivDateIso } from '../../core/dates';
import { assetFormSchema, type AssetFormInput, type AssetFormValues } from '../../core/schemas';
import { sameRef, scheduleFacts } from '../../core/inzhur/parse';
import { normalizeRef } from '../../core/inzhur/ref';
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

// The Inzhur link group — Units (units-first framing, S3) + the ref
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
  // KIND IS DERIVED, NOT ASKED (owner, 2026-08-31). It was a segmented control
  // beside the ref picker, and it never had an answer of its own: an Inzhur bond
  // is an OVDP, which is `fixed_coupon`, and everything else the provider lists
  // is a fund. The segment could therefore only ever agree with the yield type
  // or contradict it — and contradicting it produced a picker listing the wrong
  // instruments with no way to tell why. Turning the link on now adds ONE
  // control, the ref picker.
  const yieldType = useWatch({ control: form.control, name: 'yieldType' });
  const kind: 'fund' | 'bond' = yieldType === 'fixed_coupon' ? 'bond' : 'fund';
  const { data, lastGood, isFetching, isError, disabled, fetchAssets } = useInzhurAssets();
  // ONE NAME FOR ONE FEED. It was bound twice under two names, which is the same
  // divergence `couponsInGap`'s `perCouponAt` and `legacyUnitsOf`'s "one lookup,
  // one answer" were introduced to stop: a later change to the fallback rule
  // would update one and leave the picker reading a different payload from the
  // one filling maturity, next coupon and the rate.
  const feed = data ?? lastGood;
  const [manual, setManual] = useState(false);

  // The derived kind still has to REACH the form, because `inzhur.kind` is what
  // is submitted and what `matchAssets` keys on. And the ref goes with it: a
  // fund slug is not an ISIN, so a yield type changed while linked leaves a ref
  // that can only fail to match — silently, as an unmatched asset at the next
  // fetch. Clearing is the honest outcome; the picker reopens on the right list.
  //
  // ON MOUNT IT TOUCHES NOTHING, and a disagreement inherited from stored data
  // is not this effect's to settle. The old form let `kind` and `yieldType`
  // disagree — the segment was a free choice — so a stored asset can legitimately
  // open with `div_cap` + `kind: 'bond'`. Clearing on mount wiped that asset's ref
  // before the user touched anything, left the picker blank and the form invalid,
  // and re-picking then made `legacyUnitsOf` see a changed ref and DELETE the only
  // unit count the asset had. One save, no user intent, two losses.
  //
  // IT KEYS ON THE DERIVED KIND CHANGING. Two other questions were tried and both
  // were unanswerable, in opposite directions — recorded so neither comes back:
  //
  //   "Is this the first run", via a `settled` ref: a ref is not reset between
  //   StrictMode's two effect passes on one fiber, so the second read `true` and
  //   cleared on mount. `src/main.tsx` mounts in StrictMode, so this was `pnpm
  //   dev` — where the navigation-map walk-throughs run.
  //
  //   "Is the yield type dirty", via `dirtyFields.yieldType`: react-hook-form
  //   diffs against `defaultValues` and UNSETS the entry when a field returns to
  //   its default, so `fixed_coupon` → `dividends` → `fixed_coupon` loses the
  //   flag. The effect then bails with `inzhur.kind` still `'fund'` while the
  //   picker, reading the DERIVED kind, lists ISINs — and picking one stores a
  //   pair `matchKey` can never match: silently unlinked, with no error.
  //
  // A ref holding the PREVIOUS KIND has neither hole: idempotent, so StrictMode's
  // second pass sees equality; and a comparison against the last value rather
  // than a default, so a round trip counts as two changes. Keyed on the KIND, not
  // the yield type — `dividends` and `div_cap` both derive `fund`, and a fund slug
  // stays valid across that.
  const prevKind = useRef(kind);
  useEffect(() => {
    const changed = prevKind.current !== kind;
    // Recorded before every early return: a bail that skipped the assignment
    // would compare the NEXT change against a stale kind and miss it.
    prevKind.current = kind;
    if (!changed) return;
    if (inzhur === undefined) return;
    // NO `inzhur.kind === kind` SHORTCUT. It looks like a cheap no-op guard and
    // it defeats the clearing: a stored `{kind:'bond', ref:'inzhur-reit'}` under
    // `yieldType: 'dividends'` — reachable on `dev`, where the segment was free —
    // derives `fund` on mount, and switching to Fixed coupon then makes the
    // derived kind `bond`, which the STORED kind already says. The guard returned
    // and left a fund slug under `kind: 'bond'`, a pair `matchKey` can never
    // resolve. What changed is the KIND, and a ref belongs to the kind it was
    // picked under; whether the stored field happens to agree says nothing about
    // the ref.
    form.setValue('inzhur.kind', kind);
    form.setValue('inzhur.ref', '');
    form.clearErrors('inzhur.ref');
  }, [kind, inzhur, form]);

  // THE PROVIDER ALREADY KNOWS THREE OF THE FIELDS ABOVE (D121): a bond's
  // maturity, its next coupon date and its cadence are all in `paymentSchedule`,
  // and the picker has been showing "matures 24.03.2027" as a hint while writing
  // it nowhere. Naming an instrument fills them.
  //
  // OVERWRITING IS CORRECT HERE, unlike a quote fetch (G5). These are facts about
  // the instrument the user JUST NAMED — a maturity left over from the previously
  // picked bond is not a value worth protecting, it is the stale ref problem D116
  // solved one field over. What the feed cannot answer is left alone: an unknown
  // cadence writes nothing rather than guessing a divisor into every coupon.
  //
  // Keyed on the ref we last applied, so this fires once per instrument rather
  // than on every render — and clearing the ref re-arms it, so re-picking the
  // same bond fills again.
  //
  // SEEDED WITH THE REF THE FORM OPENED ON, so mount fills nothing. Starting at
  // `undefined` meant opening Edit on an already-linked bond — to fix its NAME —
  // rewrote its stored maturity and next coupon from the cache and Save
  // persisted them. The comment below justifies overwriting as "facts about the
  // instrument the user JUST NAMED"; on mount the user named nothing, and D120's
  // own rule is that a derivation is never written where nothing can mark it
  // stale. It fills when the ref CHANGES, which is the act it was written for.
  //
  // NORMALIZED on both sides, so the canonicalisation below is not mistaken for
  // a naming act: rewriting `ua4000238976` to the feed's `UA4000238976` changes
  // the string and nothing else, and an exact comparison would read that as the
  // user picking a new instrument and refill the whole group from the feed.
  const pickedRef = useRef<string | undefined>(undefined);
  const appliedRef = useRef<string | undefined>(
    normalizeRef(form.getValues('inzhur')?.ref ?? '') || undefined,
  );

  // THE STORED REF TAKES THE PROVIDER'S SPELLING once the feed can supply it.
  //
  // It has to, and the reason is the picker's own control: `RadixSelect.Value`
  // matches the root value against each item's value as an EXACT string, so a
  // stored `ua4000238976` against a published `UA4000238976` rendered the
  // PLACEHOLDER — a linked asset reading as unlinked. `inzhurRefOptions` used to
  // paper over that by appending a synthetic row for any ref not exactly present,
  // which showed one bond twice; comparing with `sameInstrument` removed the
  // duplicate and exposed the placeholder underneath it. Canonicalising fixes
  // both: one row, and it is selected.
  //
  // `shouldDirty: false` — the provider's casing is not the user's edit, and an
  // asset opened and closed untouched must not come out dirty.
  useEffect(() => {
    const ref = inzhur?.ref?.trim() ?? '';
    if (ref === '' || feed === undefined) return;
    // `sameRef`, the SAME spelling the schedule fill uses one effect down — the
    // question is identical and `ref.ts` exists because every private copy of it
    // has been a bug.
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
    // filled from it — otherwise the fill fires on the FEED ARRIVING rather than
    // on the user naming an instrument. Offline, the picker fails over to the
    // manual input; the user types an ISIN and hand-fills maturity, next coupon
    // and rate; pressing "pick from the list" calls `ensureFeed()`, the fetch
    // succeeds, and this effect — which had returned at `feed === undefined`
    // without recording anything — replaced all three, clearing whatever the feed
    // could not answer. Its own justification is "facts about the instrument the
    // user JUST NAMED", and a network success is not a naming act.
    //
    // THE COST, stated: a ref typed while no feed is in hand never auto-fills,
    // not even later. That is the safer direction — it loses a convenience,
    // where the other loses hand-typed data — and re-picking from the list is
    // one press away once the feed is up.
    appliedRef.current = key;
    if (kind !== 'bond' || feed === undefined) return;
    // ONLY WHAT THE PICKER NAMED. A ref typed by hand never fills — see
    // `nameRef` for why — and that is the same trade the feed rule above makes:
    // it loses a convenience rather than hand-entered data.
    if (pickedRef.current !== key) return;
    // `sameRef`, the one owner of "do these two names mean the same instrument".
    const quote = feed.feed.entries.find((e) => sameRef(e, { kind: 'bond', ref }));
    if (quote === undefined) return;
    // KYIV'S CALENDAR DAY, not the browser's. Every date in `paymentSchedule`
    // came through `feedDate`, which normalises to Kyiv midnight — and
    // `nextPaymentOnOrAfter` compares them as STRINGS against this one. A user
    // east of Kyiv on a payment day (or west the day before) would hand it a
    // date one off the schedule's own calendar, so `nextCoupon` would be filled
    // with the wrong occurrence: today's coupon skipped for one 182 days out, or
    // one already paid written in as the anchor. That anchor is what
    // `nextUnsettledCoupon`, `dueCoupons`, `computeReminders`, `couponsInGap`
    // and `couponProjection` all walk from.
    const facts = scheduleFacts(quote, kyivDateIso(new Date()));
    // WRITTEN OR CLEARED, never left. "Leave alone what the feed cannot answer"
    // is D121's rule and it is right for a FIRST fill; on a RE-POINT it keeps
    // the PREVIOUS instrument's answer, which is a different mistake wearing the
    // same clothes. `scheduleFacts` returns no `nextCoupon` for a bond whose
    // schedule is entirely spent, and D19 keeps completed bonds in the picker —
    // so naming A and then B stored B's maturity and rate with A's coupon
    // anchor, the date `nextUnsettledCoupon`, `dueCoupons`, `computeReminders`,
    // `couponsInGap` and `couponProjection` all walk from. D121's own words
    // apply verbatim: a value left over from the previously picked bond is not
    // worth protecting.
    form.setValue('maturity', facts.maturity ?? '');
    form.setValue('nextCoupon', facts.nextCoupon ?? '');
    form.setValue(
      'couponRatePct',
      facts.couponRatePct === undefined ? '' : f.input(facts.couponRatePct),
    );
    // `payoutSchedule` HAS NO EMPTY MEMBER, so "clear it" means choosing what a
    // fresh form would hold — `semiannual`, the measured cadence of all 32 bonds
    // the provider lists (D121).
    //
    // An earlier version left it alone, reasoning that writing a cadence the
    // feed could not read is the guess D121 refuses. But on a RE-POINT the
    // alternative is not silence: it is keeping bond A's cadence on bond B. Both
    // are guesses, and the population default is the better-founded one — it is
    // what the same field would hold had the user opened the form fresh and
    // picked B first. `payoutSchedule` is the divisor in `couponPerPayment` and
    // the step in `rollNextCoupon`, so carrying A's answer across walks B's
    // coupons onto dates it never pays on.
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
      {/* The kind segment stood here. It is derived now — see `kind` above —
          so the ref field takes the whole row rather than 1fr of it. */}
      {/* A one-cell grid since D116 took the segment out: `items-end` and the
          gap have nothing left to act on, and the row is kept only so the note
          below stays outside the field. */}
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
          {/* NAMING A REF WRITES THE KIND WITH IT, in BOTH branches, and it has to:
              the list and the placeholder are built from the DERIVED kind, so a ref
              entered against either belongs to that kind by construction.

              Without this the effect above is the only writer of `inzhur.kind`, and
              it deliberately does nothing on mount — so a `dev`-era asset carrying
              the retired free-choice segment's disagreement (`fixed_coupon` +
              `kind: 'fund'`) opened on a list of ISINs, and picking one saved
              `{kind:'fund', ref:'UA4000238976'}`: a pair `matchKey` can never match,
              silently unmatched at every fetch, and with the segment gone no control
              on the form could correct it. Reconciling on MOUNT is the other way to
              close it and is the wrong one — that is what deletes a legacy unit
              count nobody asked to lose. */}
          <Controller
            control={form.control}
            name="inzhur.ref"
            render={({ field }) => {
              const nameRef = (v: string, picked: boolean) => {
                form.setValue('inzhur.kind', kind);
                // NAMING IS A PICK, NOT A KEYSTROKE. The schedule fill treats a
                // changed ref as "the user just named this instrument", and in
                // the manual input that fires on every character: type an ISIN,
                // hand-correct `nextCoupon`, then fix a typo in the ISIN — the
                // delete and the re-type are two ref changes, and the second
                // rewrote maturity, next coupon, rate and cadence from the feed,
                // discarding the hand-entered anchor. A pick happens once and
                // means one thing.
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
      {/* Note UNDER the row rather than inside the field, which is what keeps
          the ref control on the baseline P2 pinned. The pairing that made this
          matter — a Kind segment beside it — is gone since D116, but the note
          would still push the field up if it moved inside. */}
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
        {/* ONE CHILD IN A TWO-COLUMN GRID, and that is the intended half width —
            D118 removed the Reinvest policy that used to sit in the second cell.
            It keeps the column the two date fields above establish; a rate reading
            "15,68" in a full-row box is a wide field for a short number, and it
            would be the only full-row numeric input on the screen. The sibling
            leftover in `InzhurGroup` was collapsed to a plain `<div>` instead
            because the ISIN it holds is long enough to want the whole row. */}
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
                // Smart default: bonds link by ISIN, everything else by slug.
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
  // Built once per mode AND LANGUAGE, not once per render: a bare call rebuilds
  // the whole zod tree and a resolver closure on every render of a form that
  // re-renders on each field change.
  //
  // THE LANGUAGE ARGUMENT REACHES THE PERCENT FIELDS, which is new — and the
  // bug it closes is OLDER THAN THIS BRANCH. Measured: `dev` binds
  // `expectedPct: quoteInputSchema`, and `quoteInputSchema` is
  // `positiveNumberInput(true)` — the English grouping rule, hard-wired, with no
  // `max` to catch the result. So a Ukrainian typist writing 16,4 % stored
  // 16400 % on `dev` too, into the field that drives `dailyAccrual`'s fallback,
  // `couponProjection`'s estimate and `/yield`'s «проти очікуваної».
  //
  // `dev` DID pass a `lang` here, which is what made this easy to misread: it
  // fed `inzhur.units` and nothing else. B then dropped the parameter as inert,
  // which was true of the field it was actually wired to and false of the form.
  // An earlier version of this comment called the removal "this branch's worst
  // bug" and named `dev` as reading 16.4 — both wrong, and wrong in the
  // direction that would make a revert to `dev` look safe.
  const schema = useMemo(() => assetFormSchema(mode, language), [mode, language]);
  const form = useForm<AssetFormInput, unknown, AssetFormValues>({
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
