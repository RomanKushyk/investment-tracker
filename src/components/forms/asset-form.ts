// Non-component companions of AssetForm.tsx — split out (button-variants.ts
// rationale) so the .tsx file only exports components for react-refresh.
// core/schemas emits paths; the pinned S3 message vocabulary now lives in the
// dictionary (t.asset.message), because the words follow the language.
import { sameInstrument } from '../../core/inzhur/ref';
import { todayIso } from '../../core/dates';
import type { InzhurQuote } from '../../core/inzhur/parse';
import type { Format } from '../../core/money';
import type { Dict } from '../../i18n/messages';
import type { AssetFormInput } from '../../core/schemas';
import type { Asset, PayoutSchedule, YieldType } from '../../core/types';
import type { SelectOption } from '../ui/Select';

// ORDER here, labels in the dictionary — the split every option list in the
// app now uses.
const YIELD_TYPE_ORDER: YieldType[] = ['fixed_coupon', 'dividends', 'capitalization', 'div_cap'];

export function yieldTypeOptions(t: Dict) {
  return YIELD_TYPE_ORDER.map((value) => ({ value, label: t.asset.yieldOption[value] }));
}

// The 4 create options; edit mode of an asset ALREADY holding the seed-only
// 'none' additionally shows "None (price only)" (brief S3 — create never
// offers it, and neither does editing a non-'none' asset).
const CREATE_SCHEDULES: PayoutSchedule[] = ['maturity', 'monthly', 'quarterly', 'semiannual'];

export function scheduleOptions(allowNone: boolean, t: Dict) {
  const values: PayoutSchedule[] = allowNone ? [...CREATE_SCHEDULES, 'none'] : CREATE_SCHEDULES;
  return values.map((value) => ({ value, label: t.asset.schedule[value] }));
}

/**
 * Option rows for the active kind: funds read "Inzhur REIT · inzhur-reit"
 * (feed title + slug), bonds "UA4000238976 · matures 24.03.2027". The stored
 * value is EXACTLY the string the manual field would hold (slug / ISIN), so
 * schema and patch mappers stay untouched.
 *
 * `currentRef` keeps an already-linked ref selectable even when the feed does
 * not carry it (an offline session, a delisted bond, a hand-typed slug) — the
 * trigger must never fall back to the placeholder over a value that is set.
 */
export function inzhurRefOptions(
  entries: InzhurQuote[],
  kind: 'fund' | 'bond',
  currentRef: string,
  f: Format,
  t: Dict,
): SelectOption[] {
  const options = entries
    .filter((entry) => entry.kind === kind)
    .map((entry) =>
      kind === 'fund'
        ? {
            value: entry.ref,
            label: entry.title ?? entry.ref,
            ...(entry.title === undefined ? {} : { hint: entry.ref }),
          }
        : {
            value: entry.ref,
            label: entry.ref,
            ...(entry.maturity === undefined
              ? {}
              : { hint: t.asset.picker.matures(f.date(entry.maturity)) }),
          },
    );
  const ref = currentRef.trim();
  // `sameInstrument`, not `===`. A manually typed ref is legal in any case the
  // user likes, so a stored `ua4000238976` against a published `UA4000238976`
  // appended a synthetic row and showed one bond twice, differing only in case —
  // while `matchAssets` treated the two as the same instrument all along.
  return ref !== '' && !options.some((o) => sameInstrument(o.value, ref))
    ? [...options, { value: ref, label: ref }]
    : options;
}

// Code auto-derivation while untouched — same rule as core buildNewAsset.
export function deriveCode(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

// Fresh defaultValues per mode. Numbers/dates are the raw string inputs of
// AssetFormInput; edit prefills from the stored asset. EVERY numeric prefill goes
// through the bound formatter's `input` — not `num`, not `units`, not `pctPlain`;
// the block on `expectedPct` below measures why each of the other three is wrong
// here. The two fields that once used `num` / `units` are gone: Coupon amount to
// D119's rate and Units to D117's ledger derivation.
//
// `input`'s OWN CONTRACT HAS A CAVEAT NOW. `money.ts` verifies it against
// `GROUPING = true` and warns that wiring it into a field parsed the Ukrainian
// way voids the round trip silently. The three percent fields ARE parsed that
// way since `assetFormSchema(mode, lang)` came back, and the round trip survives
// only because uk's `free.format` groups with NBSP, which `normalizeNumberInput`
// strips before its comma rule can run. Nothing pins that coincidence: a change
// to the grouping character, to the padding heuristic or to `f.free`'s options
// reintroduces a silent 1000x on a yield, on an untouched Save. The durable fix
// is a language-aware `input`; recorded here because the field it would protect
// is the one that already carried that bug once.
// Percent fields joined them in A36 through `f.input`; they were plain
// dot-decimal strings until then, which is what the edit fragment's `16.4`
// pinned and why the Ukrainian UI showed a dot in two fields.
export function assetFormDefaults(f: Format, asset?: Asset): AssetFormInput {
  if (!asset) {
    return {
      name: '',
      code: '',
      yieldType: 'fixed_coupon',
      expectedPct: '',
      targetPct: '',
      // `semiannual`, not `maturity` (D121), and it PAIRS WITH THE YIELD TYPE
      // ABOVE rather than standing on its own. The form opens on `fixed_coupon`,
      // and the old pairing said a new bond pays once at the end — a zero-coupon
      // instrument — while ALL 32 bonds the provider lists and both seed bonds
      // pay twice a year (`docs/reference/OVDP-COUPON-STRUCTURE.md`). It is the
      // divisor in `couponPerPayment`, so the default was wrong in the one place
      // a default is most likely to survive unread. Linking a bond overwrites it
      // from the feed's own gaps anyway; this is what an UNLINKED one opens on.
      //
      // SWITCHING THE YIELD TYPE DOES NOT MOVE IT, and that is unchanged rather
      // than introduced here: the old default left `maturity` on a dividends
      // asset, which is no better. A schedule that followed the yield type would
      // be a new behaviour, not a fix to this one.
      payoutSchedule: 'semiannual',
      firstPurchase: todayIso(),
      maturity: '',
      couponRatePct: '',
      nextCoupon: '',
      inzhur: undefined,
    };
  }
  return {
    name: asset.name,
    code: asset.code,
    yieldType: asset.yieldType,
    // `f.input`, NOT `String` — Contract 0 (D58) separates formatting per
    // language with no exceptions, and these two reached the field as raw JS: a
    // 17,5 % target rendered "17.5" in the Ukrainian UI, next to fields that
    // were already localized.
    //
    // `input` and not `num` or `pctPlain`, measured: `num` forces two decimals
    // ("40,00" for a whole target), and `pctPlain` ROUNDS to one (7,25 → "7,3",
    // silently editing the user's own value) and appends a " %" the label
    // already carries. A first cut used `units`, whose shape is right, and
    // argued the round trip held; it does not — uk 6,164 parses back as 6164.
    // `input` is `units` that checks (see `money.ts`).
    expectedPct: f.input(asset.expectedPct),
    targetPct: f.input(asset.targetPct),
    payoutSchedule: asset.payoutSchedule,
    firstPurchase: asset.firstPurchase,
    maturity: asset.maturity ?? '',
    couponRatePct: asset.couponRatePct !== undefined ? f.input(asset.couponRatePct) : '',
    nextCoupon: asset.nextCoupon ?? '',
    // No `units` since D117 — the group stopped asking, and a legacy value is
    // deliberately NOT round-tripped through the form: it survives untouched in
    // the store precisely because nothing here writes it back.
    inzhur: asset.inzhur ? { kind: asset.inzhur.kind, ref: asset.inzhur.ref } : undefined,
  };
}
