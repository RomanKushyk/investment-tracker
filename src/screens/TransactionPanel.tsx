import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { AssetFormFields } from '../components/forms/AssetForm';
import { assetFormDefaults } from '../components/forms/asset-form';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Reveal } from '../components/ui/Reveal';
import { Scroller } from '../components/ui/Scroller';
import { DatePicker } from '../components/ui/DatePicker';
import { Select } from '../components/ui/Select';
import { TAP_44, TAP_44_BOX } from '../components/ui/tap-target';
import {
  useAssets,
  useDeleteTransaction,
  useRecordTransaction,
  useTransactions,
  useUpdateAsset,
} from '../hooks/queries';
import { rollbackNextCoupon } from '../core/accrual';
import { assetFromForm } from '../core/asset-builder';
import { NumberField } from '../components/ui/NumberField';
import { COLOR_KEYS } from '../core/colors';
import { inputValue } from '../core/money';
import { todayIso } from '../core/dates';
import {
  UNREADABLE,
  assetFormSchema,
  transactionSchema,
  type AssetFormInput,
  type AssetFormValues,
  type TransactionFormInput,
  type TransactionFormValues,
} from '../core/schemas';
import { convertTypedAmount, priceParts } from '../core/transaction-price';
import {
  isPayout,
  movesPosition,
  targetsAsset,
  type Asset,
  type Transaction,
  type TxType,
} from '../core/types';
import { shortLabel } from './daily-quotes/quotes';
import { useSettings } from '../state/settings';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

// ORDER is a design decision and stays here; the LABELS are looked up, because
// they are language-dependent and the order is not.
const TYPE_ORDER: TxType[] = [
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'dividend_accrual',
  'interest_payout',
  'reinvest',
  'redemption',
];

// The Recent rows use "Coupon" for interest_payout where the Type select spells
// out "Interest payout"; the other eight share their select label.
const SOURCE_ORDER = ['own', 'accrual', 'reinvest_reit', 'reinvest_6475'] as const;

// The invalid variant is not decoration: without it the form's own summary
// ("check the highlighted fields") pointed at nothing.
// `min-w-0` IS LOAD-BEARING SINCE THE ROW BECAME A SUBGRID. An `<input>` has an
// intrinsic min-content width and a grid item's `min-width` is `auto`, so the
// cell's column sizes to that instead of to the cell and everything in it hangs
// past its box. A `flex flex-col` cell never had this — the floor applies to the
// MAIN axis, and there the main axis was vertical.
function inputClass(invalid: boolean): string {
  return `h-9 min-w-0 rounded-[9px] border bg-card px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-field-border hover:border-ink'
  }`;
}

// The amount's own ids, so the error is LINKED to the input rather than folded into its name.
const AMOUNT_ID = 'tx-amount';
const AMOUNT_ERROR_ID = 'tx-amount-error';
const QUANTITY_ID = 'tx-quantity';
const QUANTITY_ERROR_ID = 'tx-quantity-error';
const WITHHOLDING_ID = 'tx-withholding';
const WITHHOLDING_ERROR_ID = 'tx-withholding-error';
const NOTE_ID = 'tx-note';
const NOTE_ERROR_ID = 'tx-note-error';

/**
 * What the amount field holds: the whole transaction, or one unit.
 *
 * SIZED TO THE SETTINGS SWITCH (owner's ruling) — the track is the switch's own
 * 40 × 22 box and the two segments split it.
 *
 * A SEGMENTED CONTROL NEEDS BOTH OF *Shape system*'s RULES: the segment is
 * PROPORTIONAL to its own rendered box, the track CONCENTRIC around it. The
 * switch's own track differs by a pixel because a switch derives both radii from
 * their own boxes, not being segmented. A radius is never portable between two
 * sizes, and `text-[11px]` sets no line height, so a rendered box has to be
 * measured rather than read off the classes.
 *
 * `flex-1` ON BOTH SEGMENTS IS LOAD-BEARING: the thumb is a fixed
 * `calc(50% - 4px)`, which lands correctly only while the two are equal width.
 * `Σ` is wider than `1`, so content-sized labels overhang one state.
 *
 * NO `TAP_44`, AND THAT IS THE HELPER'S OWN RULE: a centred 44px overlay reaches
 * `(44 − w) / 2` past each edge, so two neighbours only tile when `w + gap ≥ 44`.
 * Satisfying it here needs either a gap that breaks the track's concentric
 * spacing or a segment that is geometry, which *Two shells, one breakpoint*
 * forbids growing. Overlapping hit areas are WORSE than small ones, and here the
 * wrong control silently re-reads the amount as a price per unit.
 *
 * WHICH LEAVES A KNOWN GAP, and it is the price of the size: the segments are
 * under WCAG 2.5.8 AA's 24 × 24 and the spacing exception does not rescue them.
 * Accepted deliberately — the owner asked for the switch's footprint — but it is
 * a REGRESSION, not something this control never had.
 *
 * UNDOING IT IS SIX EDITS, NOT ONE NUMBER: the track loses `w-10` and returns to
 * `h-[32px] p-[3px]`, the segments need `px-2.5 py-1` back, and the radii are
 * literals that do NOT follow — segment and thumb 4 → 6, track 7 → 10, and the
 * thumb's `w-[calc(50%-4px)]` and `top/bottom/left-[2px]` back to `-5px`/`[3px]`.
 *
 * `aria-pressed` and not a radio group: it toggles the MEANING of a neighbouring
 * input rather than submitting a value of its own.
 */
function PriceModeSegment({
  value,
  onChange,
}: {
  value: 'total' | 'unit';
  onChange: (mode: 'total' | 'unit') => void;
}) {
  const t = useT();
  // GLYPH VISIBLE, WORDS IN THE TOOLTIP AND THE ACCESSIBLE NAME.
  //
  // `Σ` and `1`, not `₴` and `1`: both modes are in hryvnia, so the currency
  // distinguishes nothing. Σ against 1 compares a sum with a single unit.
  //
  // `aria-label` is right here and wrong two components over: a trigger's
  // accessible name comes from its CONTENTS, so `Select` must never take one. A
  // bare `Σ` is not a name, so this supplies the words the glyph replaced.
  const segment = (mode: 'total' | 'unit', glyph: string, label: string) => (
    <button
      type="button"
      aria-pressed={value === mode}
      aria-label={label}
      title={label}
      // ONLY ON AN ACTUAL CHANGE, never on a click: the panel converts the amount on
      // this event, so firing on every press multiplies by the count each time.
      // `aria-pressed` already says the press is a no-op.
      onClick={() => {
        if (mode !== value) onChange(mode);
      }}
      className={`relative z-10 flex-1 cursor-pointer rounded-[4px] text-[11px] font-bold transition active:scale-[.97] ${
        value === mode ? 'text-ink' : 'text-page hover:opacity-85'
      }`}
    >
      {glyph}
    </button>
  );
  return (
    <div
      data-filled-track
      className="relative flex h-[22px] w-10 gap-1 rounded-[7px] border border-ink bg-ink p-[2px]"
    >
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-[2px] bottom-[2px] left-[2px] w-[calc(50%-4px)] rounded-[4px] bg-card transition-transform duration-300 ease-soft"
        style={{ transform: value === 'total' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('total', 'Σ', t.transaction.priceTotal)}
      {segment('unit', '1', t.transaction.priceUnit)}
    </div>
  );
}

/**
 * The ledger's distance from the top of the DOCUMENT, published as a custom
 * property so its scroll box can size itself against the viewport.
 *
 * MEASURED, NOT MIRRORED. Summing the parts by hand copies four components'
 * internals into one constant, with nothing to notice when any of them moves —
 * and it missed `AppHeader`'s `pt-[env(safe-area-inset-top)]` and the inset when
 * no header is drawn at all.
 *
 * DOCUMENT-RELATIVE, not viewport-relative: `getBoundingClientRect().top` moves
 * with the scroll position, so a page that scrolls would feed its own offset
 * back into the box's height. Adding `scrollY` pins it to the layout.
 *
 * The observer watches `document.body` too, because everything that moves this
 * number is ABOVE the card.
 */
function useLedgerTop() {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(-1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    // The guard is not an optimisation. Writing unconditionally from inside a
    // ResizeObserver whose subject this property RESIZES is the observe → write →
    // resize cycle the browser reports as an undelivered-notifications loop.
    if (top === last.current) return;
    last.current = top;
    el.style.setProperty('--ledger-top', `${top}px`);
  }, []);

  useLayoutEffect(measure);

  // A ResizeObserver WATCHES SIZE AND THIS PUBLISHES A POSITION, so the subject
  // must be an element that actually resizes when the card moves. Neither obvious
  // candidate does: `document.body` is floored at the viewport by `Layout`'s
  // `min-h-dvh`, and the card's own box is content-driven. `main` IS the element
  // that changes — `flex-1` under the column the header joins, so it loses exactly
  // the header's height.
  //
  // Rendering does not catch this: `createBrowserRouter` builds each route's
  // element ONCE, so `<Outlet/>` hands React the identical object and the subtree
  // bails out of re-rendering.
  useEffect(() => {
    const el = ref.current;
    const main = el?.closest('main');
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (main !== null && main !== undefined) observer.observe(main);
    if (el !== null) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return ref;
}

export function TransactionPanel() {
  const ledgerRef = useLedgerTop();
  const f = useFormat();
  const t = useT();
  const language = useSettings((state) => state.language);
  // BUILT ONCE PER LANGUAGE, not once per render: as bare calls in the component
  // body these rebuilt the whole zod tree on every `useWatch` change and every
  // query settle, and the language changes at most once a session.
  const txSchema = useMemo(() => transactionSchema(language), [language]);
  // The asset form takes the language for the same reason: `expectedPct` is an
  // UNBOUNDED percent, so a Ukrainian `16,400` read under the English grouping
  // rule stores 16400 with nothing to catch it.
  const newAssetSchema = useMemo(() => assetFormSchema('create', language), [language]);
  const assetsData = useAssets().data;
  const assets = useMemo(() => assetsData ?? [], [assetsData]);
  const transactions = useTransactions().data ?? [];
  const recordTransaction = useRecordTransaction();
  const deleteTransaction = useDeleteTransaction();
  const updateAsset = useUpdateAsset();
  // WHICH ROW IS ASKING — one id, because two rows asking at once is a state the screen has no use for.
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);

  const form = useForm<TransactionFormInput, unknown, TransactionFormValues>({
    // THE LANGUAGE IS A PARSE RULE HERE, not only a display one: a lone comma is the
    // decimal mark in Ukrainian and a thousands mark in English, and the unit price
    // and the count are the fields a Ukrainian typist writes with three decimals — the
    // one shape the normalizer cannot disambiguate alone.
    resolver: zodResolver(txSchema),
    defaultValues: {
      date: todayIso(),
      type: 'buy',
      assetId: '',
      amount: '',
      source: 'own',
      quantity: '',
      taxWithheld: '',
      note: '',
      // Total is the default because it is what every provider statement quotes; per-unit is the deliberate switch.
      priceMode: 'total',
    },
  });

  // The quick-create sub-form is the standalone AssetForm's fields on their own
  // form instance, validated only when Asset = "+ New asset…". The record itself
  // stays the atomic recordTransaction(tx, newAsset).
  const assetForm = useForm<AssetFormInput, unknown, AssetFormValues>({
    resolver: zodResolver(newAssetSchema),
    defaultValues: assetFormDefaults(f),
  });

  // `useWatch`, not `form.watch`: the latter returns a function React Compiler
  // cannot memoize safely, so it skipped memoizing this whole component.
  const assetId = useWatch({ control: form.control, name: 'assetId' });
  // Units belong only to rows that move a position — `transaction_quantity_absent_ck` shown as UI.
  const txType = useWatch({ control: form.control, name: 'type' });
  const priceMode = useWatch({ control: form.control, name: 'priceMode' });
  const takesUnits = movesPosition(txType);
  // A withholding belongs only to a distribution — `transaction_tax_absent_ck` shown as UI.
  const takesWithholding = isPayout(txType);
  // A deposit and a withdrawal cross the PORTFOLIO's edge, not an asset's, so the picker has nothing to ask.
  const needsAsset = targetsAsset(txType);
  // TWO QUESTIONS, and conflating them cost a half-typed asset. `pickedNew` is
  // where the PICKER is; `isNewAsset` is whether quick-create is in play, which
  // also needs the type to want an asset. Only the second gates the panel and
  // `onSubmit`; the RESET below keys off the first, because a glance at «Внесок»
  // must not discard a name and code already typed.
  const pickedNew = assetId === 'new';
  const isNewAsset = needsAsset && pickedNew;

  useEffect(() => {
    if (!form.getValues('assetId') && assets.length > 0) {
      form.setValue('assetId', assets[0].id);
    }
  }, [assets, form]);

  // THE ERROR, NOT THE VALUE. The asset field hides on a type that targets none,
  // and a hidden field carrying a red border feeds the submit summary a highlight
  // nobody can see.
  //
  // The VALUE deliberately stays, and clearing-and-restoring it here cannot work
  // on this control: the effect's write lands, then the freshly mounted Radix
  // `Select` reports its own empty value through `field.onChange`.
  // `transactionSchema` blanks the field for these types on the way out instead,
  // which needs no timing to be right.
  useLayoutEffect(() => {
    if (!needsAsset) form.clearErrors('assetId');
  }, [needsAsset, form]);

  // Reset the sub-form whenever it leaves play, so stale values never linger into a later round.
  useEffect(() => {
    if (!pickedNew) assetForm.reset(assetFormDefaults(f));
  }, [pickedNew, assetForm, f]);

  // The units field HIDES on a type that moves no position, and a hidden field
  // holding a value is an invisible error: `transactionSchema` refuses a quantity
  // on a payout, so the failure would point at a control nobody can see. The mode
  // goes back to `total` with it, so the amount can never be left meaning "per
  // unit" with no count to multiply by.
  // THE NUMBER MOVES WITH THE LABEL; the arithmetic is `convertTypedAmount`'s. The
  // result is STORED, not shown — `NumberField` groups it for whichever language
  // is on screen.
  const convertAmount = useCallback(
    (to: 'total' | 'unit') => {
      const typed = form.getValues('amount');
      if (typed.trim() === '') return;
      const next = convertTypedAmount(typed, form.getValues('quantity') ?? '', to, language);
      form.setValue('amount', next === undefined ? '' : inputValue(next), {
        shouldValidate: form.formState.isSubmitted,
      });
    },
    [form, language],
  );

  useEffect(() => {
    if (takesUnits) return;
    // CONVERT BEFORE CLEARING THE COUNT — it is what the conversion divides by, and
    // a per-unit price left behind is recorded as a deposit's total.
    if (form.getValues('priceMode') === 'unit') convertAmount('total');
    form.setValue('quantity', '');
    form.setValue('priceMode', 'total');
    form.clearErrors('quantity');
    // BOTH, because the underflow path sets them as a pair: what failed there was
    // the PRODUCT, and on a type with no product the amount's red border outlived
    // the reason for it.
    form.clearErrors('amount');
  }, [takesUnits, form, convertAmount]);

  // THE WITHHOLDING LEAVES WITH ITS ERROR, for the reason the units above give:
  // the schema REFUSES a withholding on a type that takes none rather than
  // normalizing it away, so the refusal would point at a control off screen.
  useEffect(() => {
    if (takesWithholding) return;
    form.setValue('taxWithheld', '');
    form.clearErrors('taxWithheld');
  }, [takesWithholding, form]);

  // `handleSubmit` AWAITS the zod resolver, and the quick-create branch awaits a
  // second nested one, so two presses can both land inside that window — each
  // minting its own id, and on quick-create building the asset twice.
  // `disabled={isPending}` cannot cover it: nothing is pending yet. A ref latch
  // round the whole submit path, as the coupon card already does.
  const inFlight = useRef(false);

  function record(values: TransactionFormValues, newAsset: Asset | undefined) {
    // `amount` is ALWAYS the total ₴ the transaction moved, whichever way it was
    // typed: the toggle changes what the user enters, never what is stored.
    // `undefined` MEANS THERE IS NO ROW TO RECORD, and it is the only refusal. A
    // price that merely underflowed is NOT this case — that is a recordable row
    // with no stored price, the shape every row written before this had.
    const parts = priceParts(values);
    if (parts === undefined) {
      // BOTH FIELDS, because what failed is their PRODUCT — highlighting only the
      // amount tells a user who typed a sane price to look at the number that is fine.
      // `type: 'product'` IS READ BY BOTH ERROR RENDERERS; without it they fall
      // through to "must be a positive number" for two positive values.
      form.setError('amount', { type: 'product' });
      form.setError('quantity', { type: 'product' });
      releaseLatch();
      return;
    }
    const { amount, unitPrice } = parts;
    const tx: Transaction = {
      id: crypto.randomUUID(),
      date: values.date,
      type: values.type,
      assetId: newAsset ? newAsset.id : values.assetId,
      amount,
      source: values.source,
      // Spread rather than assigned: Dexie stores `undefined` as a present key, and
      // `json.ts` round-trips the object, so an absent field must be ABSENT.
      ...(values.quantity === undefined ? {} : { quantity: values.quantity }),
      ...(unitPrice === undefined ? {} : { unitPrice }),
      // The note needs it MOST: the schema turns a blank field into `undefined`, and
      // assigning that stores a present key holding nothing — `transaction_note_ck`
      // spells none as NULL and the backup envelope refuses `''`.
      ...(values.taxWithheld === undefined ? {} : { taxWithheld: values.taxWithheld }),
      ...(values.note === undefined ? {} : { note: values.note }),
    };
    recordTransaction.mutate(
      { tx, newAsset },
      {
        onSuccess: () => {
          releaseLatch();
          toast.success(t.transaction.recordedToast);
          // WHAT THE USER CHOSE SURVIVES THE RESET, and only the amount clears.
          // `assets[0]?.id` was read from the render that submitted, so recording three
          // coupons re-picked the first asset every time, and on quick-create the
          // just-made asset was not in that array at all.
          form.reset({
            date: values.date,
            type: values.type,
            // `assetId` — THE WATCHED VALUE FROM THE SUBMITTING RENDER, not a `getValues`
            // read. `values.assetId` cannot serve: the transform has blanked it on a
            // portfolio-level type. Nor can the control be re-read here, because
            // `handleSubmit` AWAITS the resolver and a picker moved inside that window would
            // be restored over the choice the row was written with.
            assetId: newAsset ? newAsset.id : assetId,
            amount: '',
            source: values.source,
            // The COUNT clears with the amount — it is per-transaction. The MODE survives,
            // like type/asset/source: it is how this user reads their statements.
            quantity: '',
            // BOTH CLEAR WITH THE AMOUNT: a withholding is per-payout and a note is per row,
            // so carrying either over attaches the last row's facts to the next one.
            taxWithheld: '',
            note: '',
            priceMode: values.priceMode,
          });
          // THE ERRORS, NOT THE VALUES. A full `assetForm.reset` here wipes a half-typed
          // asset whenever a row is recorded that did not use the sub-form. What no effect
          // covers is a failed quick-create press whose red borders outlive a LATER
          // successful submit — the picker never moved, so nothing cleared them.
          //
          // `reset` WITH `keepValues`, not `clearErrors`, and the difference is
          // `isSubmitted`: `clearErrors` leaves that flag set, so the sub-form stays in
          // re-validate-on-change and the next keystroke can light a field red on a form
          // nobody has submitted since.
          //
          // `keepDirty` IS NOT OPTIONAL. With `formValues` undefined and no dirty flag RHF
          // falls through to `dirtyFields: {}`, and `AssetForm` gates the Name→Code
          // derivation on `!dirtyFields.code` — so wiping it makes a hand-typed «Код»
          // start being overwritten again.
          assetForm.reset(undefined, {
            keepValues: true,
            keepDefaultValues: true,
            keepDirty: true,
          });
        },
        onError: () => {
          releaseLatch();
          toast.error(t.transaction.failedToast);
        },
      },
    );
  }

  // Released by the write's outcome or by either form refusing — a latch never lowered disables the form for the session.
  const releaseLatch = () => {
    inFlight.current = false;
  };

  function removeTransaction(tx: Transaction) {
    deleteTransaction.mutate(tx.id, {
      onSuccess: () => {
        // A CONFIRMED COUPON GETS ITS OCCURRENCE BACK. The card's confirm writes the
        // payout AND rolls `asset.nextCoupon` forward, and `nextUnsettledCoupon` walks
        // the grid FORWARD, so deleting only the transaction loses the occurrence from
        // the ledger, the due cards, the reminders and income at once. The pointer moves
        // only through a confirm, and a delete is that confirm taken back; the
        // arithmetic is `rollbackNextCoupon`.
        const asset = assetById.get(tx.assetId);
        const reopened =
          asset === undefined
            ? undefined
            : rollbackNextCoupon(
                asset,
                tx,
                transactions.filter((t) => t.id !== tx.id),
              );
        if (asset !== undefined && reopened !== undefined) {
          updateAsset.mutate({ id: asset.id, patch: { nextCoupon: reopened } });
        }
        setConfirmingId(undefined);
        toast.success(
          reopened === undefined
            ? t.transaction.delete.doneToast
            : t.transaction.delete.couponReopenedToast,
        );
      },
      // The row stays in its asking state on failure, so the answer is still one press away.
      onError: () => toast.error(t.transaction.delete.failedToast),
    });
  }

  function onSubmit(values: TransactionFormValues) {
    if (isNewAsset) {
      // Both forms must pass; assetForm.handleSubmit surfaces the sub-form's field
      // errors and only calls through when it validates.
      void assetForm.handleSubmit(
        (assetValues) => {
          record(values, assetFromForm(assetValues, values.date, assets.length));
        },
        // The sub-form refused, so nothing will settle to release the latch.
        releaseLatch,
      )();
      return;
    }
    record(values, undefined);
  }

  // THE FULL LEDGER, newest first. The last-three cap existed because this panel
  // was a guest on `/`; on a route of its own the history is the point, and the
  // list scrolls inside its own box.
  const ledger = [...transactions].reverse();
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return (
    <>
      {/* NO `px-5` HERE, and that is the Scroller's contract, not an omission.
          Passing `radius` opens the inline gutter from the ScrollArea ROOT, outside
          the scroll box, so a Card padding of its own would inset the rows a SECOND
          time and make the radius wrong on its own terms — a radius is measured at
          the Scroller's box. `py-4` stays: the gutter is inline only. ImportDialog.tsx
          carries the same warning. */}
      {/* THE WIDE COLUMN, and its width IS the grid track's — no cap of its own; the
          ledger card's comment below carries the ruling.

          THE HEIGHT CAP IS THE VIEWPORT'S AT `lg` AND UP. Side by side the card only
          has to leave the header and the page's own padding, so the PAGE stops
          scrolling while the column does. Below `lg` the cap is fixed — the card is
          stacked there, and 360 must not move.

          `--ledger-top` IS MEASURED: everything above the card is read off the layout
          rather than summed by hand (see `useLedgerTop`); the fallback in the `var()`
          survives only for the first paint, and the subtrahend beside it is this card's own
          `py-4` plus `main`'s `pb-12` — NOT `main`'s top, which the measurement already
          includes, being taken at this card's own box.

          `max()` FLOORS IT, because a `max-height` calc that resolves negative is
          clamped to zero, not ignored: a wide but very short window collapsed the
          card to an empty box with a scroll rail and eighteen invisible rows.

          THE HEIGHT EASES, because the `lg` media query flips DISCRETELY while the
          rail's width animates, so this box would otherwise snap mid-transition.

          AND THIS BOUNDS THE LEDGER ONLY. The form is uncapped deliberately: a tall
          FORM should scroll the page rather than trap its own submit button. */}
      {/* THE SIDE BLOCK — narrow beside the ledger, capped when the grid collapses,
          and never stretched into a settings page.

          IT LEADS IN THE DOM, and `lg:col-start-2` puts it on the right anyway. The
          opposite makes the phone's visual order disagree with its reading order — a
          keyboard or screen reader goes through every ledger row and delete button
          before the first field of the form it can see at the top (WCAG 2.4.3,
          1.3.2). Collapsed, the column IS the sequence. */}
      <Card
        radius={24}
        className="min-w-0 animate-in border border-panel-border bg-panel px-[22px] py-5 duration-300 fade-in max-lg:max-w-[560px] lg:col-start-2 lg:row-start-1"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="font-display text-lg font-semibold">{t.transaction.title}</div>
          <span className="text-[10px] tracking-[.08em] text-muted uppercase">
            {t.transaction.badge}
          </span>
        </div>
        <p className="mt-1 mb-3.5 text-xs text-muted">{t.transaction.subtitle}</p>
        {/* THE LATCH IS CHECKED IN THE DOM EVENT: the earliest point a second press can
            be seen — `handleSubmit` has not begun awaiting the resolver — and a ref read
            inside a function handed to `handleSubmit` DURING RENDER is what
            `react-hooks/refs` refuses, correctly. */}
        <form
          onSubmit={(e) => {
            if (inFlight.current) {
              e.preventDefault();
              return;
            }
            inFlight.current = true;
            void form.handleSubmit(onSubmit, releaseLatch)(e);
          }}
          className="flex flex-col gap-2.5"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t.transaction.date}
              <Controller
                control={form.control}
                name="date"
                render={({ field, fieldState }) => (
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    invalid={fieldState.invalid}
                    className="w-full text-left"
                  />
                )}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t.transaction.type}
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={TYPE_ORDER.map((value) => ({
                      value,
                      label: t.transaction.types[value],
                    }))}
                  />
                )}
              />
            </label>
          </div>

          <Reveal show={needsAsset} className="flex min-w-0 flex-col">
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t.transaction.asset}
              <Controller
                control={form.control}
                name="assetId"
                render={({ field, fieldState }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t.transaction.assetPlaceholder}
                    // Reachable with no assets at all, or on a press before `useAssets()` resolves:
                    // the schema refuses an empty id on a type that needs one.
                    invalid={fieldState.invalid}
                    options={[
                      { value: 'new', label: t.transaction.newAssetOption },
                      ...assets.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                  />
                )}
              />
            </label>
          </Reveal>

          {/* A BARE `&&`, AND `Reveal` IS REFUSED HERE. It animates opacity and translate,
              never HEIGHT, so the wrapper holds its full height for the whole exit and the
              collapse becomes a bigger snap, later. The `!pickedNew` effect then lands on
              live DOM and blanks the fields mid-fade; RHF repaints «Назва» but not «Код»,
              so re-entering inside the window leaves the visible «Код» disagreeing with
              form state. And ten controls stay hit-testable and in the tab order while
              leaving, because `Reveal` marks nothing `inert`. What this panel wants is a
              HEIGHT animation plus an `inert` subtree, which belongs in `Reveal` itself.
              Do not re-wrap this without that. */}
          {isNewAsset && (
            <div className="animate-in duration-300 fade-in slide-in-from-top-2">
              <div className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-faint bg-card p-3.5">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-[.06em] text-pos-tint-text uppercase">
                  <Plus size={13} strokeWidth={2.75} />
                  {t.transaction.newAssetDetails}
                </div>
                <AssetFormFields
                  form={assetForm}
                  mode="create"
                  layout="inline"
                  avatarColorKey={COLOR_KEYS[assets.length % COLOR_KEYS.length]}
                />
              </div>
            </div>
          )}

          {/* THE ROW HAS TWO SHAPES. With units the count and the amount share a row,
              because a count is what makes a per-unit price into a total; without them the
              row closes up rather than leaving a hole.

              ALL THREE CELLS AUTO-PLACE. The only placement rule is `col-span-2` on
              «Джерело», and a spanning cell cannot fit beside two others — so the span
              alone is what puts it on its own line.

              THE SPAN ASKS THE DOM, not `takesUnits`: the flag flips the instant the type
              changes, while the field is still on screen playing its leave animation, so a
              layout driven by it reflows twice. `:has` turns false only once the node is
              gone, so the three cells re-place in ONE step.

              SUBGRID, three shared rows — label, control, error — so the cells align
              control-to-control whatever sits above them. AN `items-end` ROW WAS REFUSED:
              it pins the cells' BOTTOMS, which holds only until an error renders under one
              of them — on exactly the screen a user is looking at because something is
              wrong. Row 1 sizes itself to the taller label, which is also what ruled out
              equalising the label rows by hand.

              UNITS ARE REQUIRED on the types that take them. They were optional until the
              owner ruled otherwise: the coupon derivation is `rate × units`, so a buy
              recorded in the default `total` mode with this blank produced a bond with no
              coupon figure anywhere and no explanation. */}
          <div className="group grid grid-cols-2 grid-rows-[auto_auto_auto] gap-2.5">
            <Reveal show={takesUnits} className="row-span-3 grid min-w-0 grid-rows-subgrid gap-1">
              <label className="self-center text-[11px] text-muted" htmlFor={QUANTITY_ID}>
                {t.transaction.quantity}
              </label>
              <Controller
                control={form.control}
                name="quantity"
                render={({ field, fieldState }) => (
                  <>
                    <NumberField
                      id={QUANTITY_ID}
                      className={inputClass(fieldState.invalid)}
                      placeholder={t.transaction.quantityPlaceholder}
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={fieldState.invalid ? QUANTITY_ERROR_ID : undefined}
                      name={field.name}
                      ref={field.ref}
                      // `?? ''` because the schema takes an ABSENT quantity as "no units" too, which
                      // is what keeps a minimal transaction parseable. The input itself is always
                      // controlled.
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                    {fieldState.error && (
                      <span
                        id={QUANTITY_ERROR_ID}
                        className="animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
                      >
                        {fieldState.error.type === 'product'
                          ? t.transaction.productTooSmall
                          : (field.value ?? '').trim() === ''
                            ? t.transaction.quantityMissing
                            : fieldState.error.type === UNREADABLE
                              ? t.transaction.quantityUnreadable
                              : t.transaction.quantityNotPositive}
                      </span>
                    )}
                  </>
                )}
              />
            </Reveal>

            {/* NOT A `<label>` WRAPPER: a message inside the label becomes part of the
                input's accessible NAME, so submitting an empty field renames it instead of
                explaining itself. `htmlFor` + `aria-describedby` carries it as a description.
                ONE MESSAGE PER FAILURE: the amount schema refuses blank, zero, negative and
                non-numeric, and a single message told someone who typed `0` to enter the
                amount they had just typed. */}
            <div className="row-span-3 grid min-w-0 grid-rows-subgrid gap-1">
              {/* THE SEGMENT RIDES THE LABEL ROW. `min-w-0` + `truncate` on the label, because
                  the row has a hard budget: the unit-mode label plus the track plus the gap
                  has to fit the grid column. */}
              <div className="flex items-center justify-between gap-2">
                <label className="min-w-0 truncate text-[11px] text-muted" htmlFor={AMOUNT_ID}>
                  {/* THE LABEL IS THE CONTRACT. A number meaning one thing while the field says
                      «Сума, ₴» is a worse defect than the one this fixes — silent, and in the
                      direction of recording a price as a total. */}
                  {priceMode === 'unit' ? t.transaction.amountUnit : t.transaction.amount}
                </label>
                {/* THE SAME `Reveal` THE UNITS FIELD USES, because these two appear and leave on
                    one condition: a bare `&&` had the track vanish in a single frame while the
                    field it governs was still gliding away. `distance={1}` because this one
                    moves inside a label row, and a shrinkable track would be squeezed before the
                    `truncate` label beside it. */}
                <Reveal show={takesUnits} distance={1} className="shrink-0">
                  <Controller
                    control={form.control}
                    name="priceMode"
                    render={({ field }) => (
                      <PriceModeSegment
                        value={field.value ?? 'total'}
                        onChange={(mode) => {
                          convertAmount(mode);
                          field.onChange(mode);
                        }}
                      />
                    )}
                  />
                </Reveal>
              </div>
              <Controller
                control={form.control}
                name="amount"
                render={({ field, fieldState }) => (
                  <>
                    <NumberField
                      id={AMOUNT_ID}
                      className={inputClass(fieldState.invalid)}
                      placeholder={t.transaction.amountPlaceholder}
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={fieldState.invalid ? AMOUNT_ERROR_ID : undefined}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                    {fieldState.error && (
                      <span
                        id={AMOUNT_ERROR_ID}
                        className="animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
                      >
                        {fieldState.error.type === 'product'
                          ? t.transaction.productTooSmall
                          : field.value.trim() === ''
                            ? t.transaction.amountMissing
                            : // The schema already said which, and reading it is what
                              // stops «has to be positive» over a «16,5», which is.
                              fieldState.error.type === UNREADABLE
                              ? t.transaction.amountUnreadable
                              : t.transaction.amountNotPositive}
                      </span>
                    )}
                  </>
                )}
              />
            </div>

            {/* THE WITHHOLDING TAKES THE SLOT «Одиниці» LEAVES — one layout rule with a
                second occupant. The mirror image, a withholding in the units slot, is
                refused on the rule rather than on taste: it would make the first column mean
                units on four types and a deduction on two. IT DOES NOT HOLD THE AMOUNT
                STILL — cells place in document order and the row's first occupant decides;
                what the placement settles is which field the amount is PAIRED with.

                A KNOWN TRANSIENT, ACCEPTED, AND TWO CURES REFUSED — written down because
                the next reader will reach for the same `:has` gate the Source span beside
                it uses. Switching Buy → a payout flips `takesWithholding` at once while
                `Reveal` keeps the units mounted for their exit, so four `row-span-3` cells
                briefly share a two-column grid: this one auto-places in the FIRST column,
                under the units rather than beside them, and moves up AND ACROSS to the amount's
                side when they unmount. `group-has-[#tx-quantity]:hidden` is worse: `Reveal`
                unmounts in `onAnimationEnd`, and `display:none` means the exit animation
                never runs, so the field stays mounted forever and then REAPPEARS at full
                size on the next type that has no units. Taking it out of flow instead
                unmounts correctly but leaves the exiting copy positioned over the row it
                just left. So the transient stays; sequencing the two Reveals is the real
                fix. */}
            <Reveal
              show={takesWithholding}
              className="row-span-3 grid min-w-0 grid-rows-subgrid gap-1"
            >
              <label
                className="min-w-0 self-center truncate text-[11px] text-muted"
                htmlFor={WITHHOLDING_ID}
              >
                {t.transaction.withholding}
              </label>
              <Controller
                control={form.control}
                name="taxWithheld"
                render={({ field, fieldState }) => (
                  <>
                    <NumberField
                      id={WITHHOLDING_ID}
                      className={inputClass(fieldState.invalid)}
                      placeholder={t.transaction.withholdingPlaceholder}
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={fieldState.invalid ? WITHHOLDING_ERROR_ID : undefined}
                      name={field.name}
                      ref={field.ref}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                    {fieldState.error && (
                      <span
                        id={WITHHOLDING_ERROR_ID}
                        className="animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
                      >
                        {/* THERE IS NO "MISSING" ARM. `custom` is the BOUND rule and only the bound
                            rule: the schema's other custom refusal is a withholding on a type that takes
                            none, and the effect above clears the field before that type can reach here. */}
                        {fieldState.error.type === 'custom'
                          ? t.transaction.withholdingAboveAmount
                          : fieldState.error.type === UNREADABLE
                            ? t.transaction.withholdingUnreadable
                            : t.transaction.withholdingNotPositive}
                      </span>
                    )}
                  </>
                )}
              />
            </Reveal>

            {/* Spanning lands this in the grid's IMPLICIT row, and the full-width shape needs
                no spacing of its own. It never shares a line with a «Сума» carrying the Σ/1
                track, because the track is gated on the same condition the span is. IT ASKS
                THE DOM ABOUT BOTH OCCUPANTS: the rule is "whoever takes the second column
                pushes Source down". */}
            <label className="row-span-3 grid min-w-0 grid-rows-subgrid gap-1 text-[11px] text-muted group-has-[#tx-quantity]:col-span-2 group-has-[#tx-withholding]:col-span-2">
              {t.transaction.source}
              <Controller
                control={form.control}
                name="source"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={SOURCE_ORDER.map((value) => ({
                      value,
                      label: t.transaction.sources[value],
                    }))}
                  />
                )}
              />
            </label>
          </div>

          {/* THE NOTE IS ASKED ON ALL EIGHT TYPES, full width and last, because it is the
              only free text on the panel and the only field nobody has to fill.

              NO `maxLength`. A hard stop would make the refusal unreachable: a cap the
              field silently enforces teaches nothing about why the bound is what it is,
              where a sentence does.

              The cell owns the gap between its own three parts and the form owns the one
              between its rows; making these siblings of the FORM means a cell paying for a
              gap it never asked for. The label is outside the `Controller` and linked by
              `htmlFor`, like «Сума» above and for the same reason. */}
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-[11px] text-muted" htmlFor={NOTE_ID}>
              {t.transaction.note}
            </label>
            <Controller
              control={form.control}
              name="note"
              render={({ field, fieldState }) => (
                <>
                  <input
                    id={NOTE_ID}
                    type="text"
                    className={inputClass(fieldState.invalid)}
                    placeholder={t.transaction.notePlaceholder}
                    aria-invalid={fieldState.invalid || undefined}
                    aria-describedby={fieldState.invalid ? NOTE_ERROR_ID : undefined}
                    name={field.name}
                    ref={field.ref}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                  {fieldState.error && (
                    <span
                      id={NOTE_ERROR_ID}
                      className="animate-in text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
                    >
                      {t.transaction.noteTooLong}
                    </span>
                  )}
                </>
              )}
            />
          </div>

          <Button
            type="submit"
            weight="bold"
            className="w-full"
            // `isSubmitting` covers the async window the latch also guards: the resolver runs before anything is pending.
            disabled={recordTransaction.isPending || form.formState.isSubmitting}
          >
            {t.transaction.submit}
          </Button>
          {/* `isNewAsset` GATES THE SUB-FORM'S HALF, or its errors could put this line on
              screen with nothing able to carry a highlight. The window is not one render
              frame: the reset keys off the PICKER, and `isNewAsset` also goes false when
              the TYPE stops targeting an asset, so with the picker still on the sentinel
              the errors persist unbounded. */}
          {(Object.keys(form.formState.errors).length > 0 ||
            (isNewAsset && Object.keys(assetForm.formState.errors).length > 0)) && (
            <p className="text-xs text-neg">{t.transaction.invalid}</p>
          )}
        </form>
      </Card>

      {/* NO WIDTH CAP — THE TRACK IS THE BOUND. The old cap protected nothing and
          opened a dead strip between the ledger and the form; it had been removed and
          argued back once before, and `transactions-layout.test.ts` pins the absence
          on this card's own class string. */}
      <Card ref={ledgerRef} className="min-w-0 py-4 lg:col-start-1 lg:row-start-1">
        <Scroller
          radius={20}
          className="max-h-[420px] transition-[max-height] duration-[260ms] ease-soft lg:max-h-[max(200px,calc(100dvh-var(--ledger-top,197px)-80px))]"
        >
          {/* `w-0 min-w-full` IS THE WHOLE REASON THE ELLIPSIS WORKS. Radix wraps a
              viewport's children in its own `min-width:100%; display:table` box, and a
              table box is shrink-to-fit — so a row whose label is `truncate` makes
              min-content equal max-content, the box grows past the viewport, and
              `orientation="vertical"` clips the excess with NO rail to say so. `w-0` puts
              the child's preferred width at zero so the table box collapses back onto its
              own `min-width:100%`, and `min-w-full` fills it.

              The hairline between rows is what makes a ledger read as a ledger, and it is
              the line `/payouts`' own table draws. `divide-y` was the obvious spelling and
              produced NO rule in this build, so the row carries its own border. */}
          <div className="flex w-0 min-w-full flex-col text-[12.5px]">
            {ledger.length === 0 && <span className="text-muted">{t.transaction.recentEmpty}</span>}
            {ledger.map((tx) => {
              // THE TYPE DECIDES, NOT THE ID. Three doors stopped WRITING a borrowed asset
              // onto a portfolio-level row; none of them touches a row already in the store
              // and nothing migrates it, so an older deposit still names whichever asset the
              // picker happened to be showing. Asking the type makes the display right for
              // what is stored as well as for what is written from now on.
              //
              // `removeTransaction`'s lookup is deliberately left alone: `rollbackNextCoupon`
              // refuses anything but an `interest_payout` on its own asset.
              const asset = targetsAsset(tx.type) ? assetById.get(tx.assetId) : undefined;
              const asking = confirmingId === tx.id;
              return (
                // THE ROW IS TWO LINES NOW, and the boundary moved out with it: the hairline,
                // the padding and the `first:` exception belong to the WHOLE record, or a noted
                // row would draw its rule between its own two halves.
                <div
                  key={tx.id}
                  className="group animate-in border-t border-hairline py-2 duration-300 fade-in slide-in-from-top-1 first:border-t-0"
                >
                  <div className="flex items-center justify-between gap-2.5 max-md:gap-2">
                    {asking ? (
                      <>
                        {/* THE ROW ITSELF ASKS, and the question REPLACES the row — so the label, amount
                            and date it stood on are gone at the moment of confirming something
                            unrecoverable, where two coupons of one amount were indistinguishable. */}
                        <span role="alert" className="min-w-0 flex-1 truncate text-neg">
                          {t.transaction.delete.ask(f.money(tx.amount), f.dateShort(tx.date))}
                        </span>
                        {/* `TAP_44`, NOT `TAP_44_BOX`: the BOX squares a control to 44 × 44 below `md`,
                            where «Видалити» has no wrap opportunity and spills straight out of its own
                            border. `autoFocus` keeps the keyboard on the question it just asked — the ✕
                            unmounts in the same commit. */}
                        <button
                          type="button"
                          autoFocus
                          onClick={() => removeTransaction(tx)}
                          disabled={deleteTransaction.isPending}
                          className={`${TAP_44} cursor-pointer rounded-[6px] border border-neg px-2 py-[3px] font-semibold text-neg transition hover:bg-neg-tint active:scale-[.97]`}
                        >
                          {t.transaction.delete.confirm}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(undefined)}
                          className={`${TAP_44} cursor-pointer rounded-[6px] px-2 py-[3px] text-muted transition hover:text-ink active:scale-[.97]`}
                        >
                          {t.transaction.delete.cancel}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {tx.type === 'interest_payout'
                            ? t.transaction.recentCoupon
                            : t.transaction.types[tx.type]}{' '}
                          · {asset ? shortLabel(asset) : t.transaction.portfolioRow}
                        </span>
                        {/* THE COUNT, AND ONLY WHERE ONE IS POSSIBLE. The fetch reports which assets it
                            had to value from a stale stored total, and this is where that report is
                            acted on. `movesPosition` GATES IT, because absence has to mean something: on
                            a deposit or a payout there is no count to miss, and a blank there would read
                            the same as the gap being hunted. */}
                        {movesPosition(tx.type) && (
                          <span
                            className="whitespace-nowrap text-muted"
                            title={t.transaction.quantity}
                          >
                            {tx.quantity === undefined ? '—' : f.units(tx.quantity)}
                          </span>
                        )}
                        <strong className="whitespace-nowrap">{f.money(tx.amount)}</strong>
                        <span className="whitespace-nowrap text-muted">{f.dateShort(tx.date)}</span>
                        {/* HOVER REVEALS IT ON A POINTER, because always-on glyphs on every row are
                            noise on a desktop and a hover-only control does not exist on a phone.
                            `focus-visible` keeps it reachable. */}
                        <button
                          type="button"
                          aria-label={t.transaction.delete.aria}
                          data-delete-row={tx.id}
                          onClick={() => setConfirmingId(tx.id)}
                          className={`${TAP_44_BOX} flex-none cursor-pointer p-1 text-faint opacity-0 transition group-hover:opacity-100 hover:text-neg focus-visible:opacity-100 active:scale-[.97] max-md:opacity-100`}
                        >
                          <X size={12} strokeWidth={2.75} />
                        </button>
                      </>
                    )}
                  </div>
                  {/* THE WITHHOLDING, READ BACK. It was stored on the row and derived into three
                      totals with no screen showing it as itself, so a figure small enough to pass
                      `tax_withheld < amount` understated the tax and lifted the asset's XIRR with
                      nothing to check it against a statement.

                      A LINE OF ITS OWN, ABOVE THE NOTE, AND THAT IS THE CAP'S DOING: the note's
                      character bound is a DRAWN number that `transaction_note_ck` enforces in SQL,
                      derived from how it wraps at the row's width. Sharing the note's line would
                      narrow it and re-derive that number.

                      THE MINUS RATHER THAN THE WORD, measured rather than preferred: spelling
                      «утримано» out overruns the row on a four-figure dividend, a sum this
                      portfolio's REIT position reaches. `signedMoney` carries the U+2212 the app
                      pins in one place. */}
                  {!asking && tx.taxWithheld !== undefined && (
                    <div className="mt-0.5 text-[11px] leading-4 text-muted">
                      {t.transaction.withheldAndNet(
                        f.signedMoney(-tx.taxWithheld),
                        f.money(tx.amount - tx.taxWithheld),
                      )}
                    </div>
                  )}
                  {/* THE NOTE, AND NOTHING WHERE THERE IS NONE: the unannotated row is the normal
                      one, and drawing a gap for it would cost every row to annotate a few.

                      IT RUNS THE ROW'S FULL WIDTH and does not reserve the ✕ column, which is a
                      child of the line above. Reserving it costs a fourth line at the narrow
                      shell, which would move the cap — the width and the character bound are one
                      decision, drawn in `design/extensions/withholding-and-note.dc.html`. It wraps
                      rather than truncating, because a note the row hides is a note nobody
                      reads. */}
                  {!asking && tx.note !== undefined && (
                    <div className="mt-0.5 text-[11px] leading-4 [overflow-wrap:anywhere] text-muted">
                      {tx.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Scroller>
      </Card>
    </>
  );
}
