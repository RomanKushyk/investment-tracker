import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { AssetFormFields } from '../components/forms/AssetForm';
import { assetFormDefaults } from '../components/forms/asset-form';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
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
import { COLOR_KEYS } from '../core/colors';
import { todayIso } from '../core/dates';
import {
  assetFormSchema,
  transactionSchema,
  type AssetFormInput,
  type AssetFormValues,
  type TransactionFormInput,
  type TransactionFormValues,
} from '../core/schemas';
import type { Asset, Transaction, TxType } from '../core/types';
import { shortLabel } from './daily-quotes/quotes';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

// Pinned option order (S10, metrics-exposure reference): Withdrawal after
// Deposit (portfolio-level, like Deposit), Redemption after Reinvest
// (targets an asset) — the P1 domain types (D13), exposed since P2.
// ORDER stays here — it is a design decision (S10). The LABELS are looked up,
// because they are language-dependent and the order is not.
const TYPE_ORDER: TxType[] = [
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'dividend_accrual',
  'interest_payout',
  'reinvest',
  'redemption',
  'tax',
];

// The Recent transactions rows use "Coupon" for interest_payout — matches
// design copy (line 145) even though the Type select spells out "Interest
// payout"; the other 8 select types share their select label. The Record
// stays total over TxType.
const SOURCE_ORDER = ['own', 'accrual', 'reinvest_reit', 'reinvest_6475'] as const;

// The invalid variant is not decoration: without it the form's own summary
// ("check the highlighted fields") pointed at nothing. The shape follows
// `AssetForm`'s `inputClass(invalid)` — border `neg` when at fault, and the
// message under the field (S3's anatomy) — but NOT its surface: this panel's
// inputs sit on `card`, not `page`, and take the hover border the rest of the
// form's controls take.
function inputClass(invalid: boolean): string {
  return `h-9 rounded-[9px] border bg-card px-3 font-body text-[13px] text-ink transition ${
    invalid ? 'border-neg' : 'border-hairline hover:border-ink'
  }`;
}

// The amount's own ids, so the error can be LINKED to the input rather than
// folded into its accessible name — see the comment at the field.
const AMOUNT_ID = 'tx-amount';
const AMOUNT_ERROR_ID = 'tx-amount-error';

/**
 * The ledger's distance from the top of the DOCUMENT, published as a custom
 * property so its scroll box can size itself against the viewport (A35 review).
 *
 * MEASURED, NOT MIRRORED — the same answer `useActionBarHeight` gives on `/`,
 * and for the same reason. A first draft summed the parts by hand:
 * `main`'s `pt-8`, `ScreenHeader`'s rendered 85, this card's `py-4`, plus a
 * separate `--app-header-h` published by `Layout` because the desktop header
 * mounts when the rail collapses. That is four components' internals copied
 * into one constant, with no test and nothing to notice when any of them moves
 * — and it was already wrong twice over: `AppHeader` carries
 * `pt-[env(safe-area-inset-top)]` on top of its `h-14`, which the 57 never
 * counted, and nothing counted the inset at all when no header is drawn.
 * Reading the box answers all of it at once, including the cases nobody
 * enumerated.
 *
 * DOCUMENT-RELATIVE, not viewport-relative: `getBoundingClientRect().top` moves
 * with the scroll position, so a page that scrolls at all would feed its own
 * offset back into the box's height. Adding `scrollY` pins it to the layout.
 *
 * The observer watches `document.body` as well as the card, because everything
 * that moves this number is ABOVE the card — the header mounting, the header's
 * title rewrapping in the other language, the window changing width.
 */
function useLedgerTop() {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(-1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    // The guard is not an optimisation. Writing unconditionally from inside a
    // ResizeObserver whose subject this property RESIZES is the textbook
    // observe → write → resize cycle, and the browser reports it as
    // "ResizeObserver loop completed with undelivered notifications".
    if (top === last.current) return;
    last.current = top;
    el.style.setProperty('--ledger-top', `${top}px`);
  }, []);

  // Cheap, and it covers a route change or a language switch landing new text
  // above the card.
  useLayoutEffect(measure);

  // A ResizeObserver WATCHES SIZE AND THIS PUBLISHES A POSITION, so the subject
  // has to be an element that actually resizes when the card moves (1.7.0
  // release review, then corrected again by measuring the fix). Collapsing the
  // desktop rail mounts `AppHeader` and pushes this card down 57 px, and
  // neither obvious subject notices: `document.body` is floored at the viewport
  // by `Layout`'s `min-h-dvh` whenever the content fits, and the card's own box
  // is content-driven and unchanged while its height is under the cap.
  //
  // `main` IS the element that changes — it is `flex-1` under the column the
  // header joins, so it loses exactly the header's height. Observing it turns a
  // position problem into the size problem an observer can answer.
  //
  // And rendering does NOT catch this on its own: `createBrowserRouter` builds
  // each route's element ONCE, so `<Outlet/>` hands React the identical element
  // object and the subtree bails out of re-rendering. The first fix relied on
  // that render and was measured doing nothing.
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
  const assetsData = useAssets().data;
  const assets = useMemo(() => assetsData ?? [], [assetsData]);
  const transactions = useTransactions().data ?? [];
  const recordTransaction = useRecordTransaction();
  const deleteTransaction = useDeleteTransaction();
  const updateAsset = useUpdateAsset();
  // WHICH ROW IS ASKING — one id, because two rows asking at once is a state the
  // screen has no use for and a reader would have to rule out.
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);

  const form = useForm<TransactionFormInput, unknown, TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      date: todayIso(),
      type: 'buy',
      assetId: '',
      amount: '',
      source: 'own',
    },
  });

  // The quick-create sub-form is the standalone AssetForm's fields on their
  // own form instance (P2 feat/asset-form — replaces the schema-welded
  // NewAssetFields). Validated only when Asset = "+ New asset…"; the record
  // itself stays the atomic recordTransaction(tx, newAsset).
  const assetForm = useForm<AssetFormInput, unknown, AssetFormValues>({
    resolver: zodResolver(assetFormSchema('create')),
    defaultValues: assetFormDefaults(f),
  });

  // `useWatch`, not `form.watch`: the latter returns a function React Compiler
  // cannot memoize safely, so it skipped memoizing this whole component and said
  // so as a lint warning. It also subscribes just this read instead of
  // re-rendering the form on every field change. Same idiom as AssetForm.
  const assetId = useWatch({ control: form.control, name: 'assetId' });
  const isNewAsset = assetId === 'new';

  // Default the Asset select to the first existing asset once assets load
  // (an empty picker would satisfy the schema only via the "new" branch).
  useEffect(() => {
    if (!form.getValues('assetId') && assets.length > 0) {
      form.setValue('assetId', assets[0].id);
    }
  }, [assets, form]);

  // Reset the sub-form whenever it leaves play so stale values/errors never
  // linger into a later "+ New asset…" round.
  useEffect(() => {
    if (!isNewAsset) assetForm.reset(assetFormDefaults(f));
  }, [isNewAsset, assetForm, f]);

  // `handleSubmit` AWAITS the zod resolver, and on the quick-create branch it
  // awaits a second nested one, so two presses can both land inside that window
  // — each minting its own `crypto.randomUUID()`, and on quick-create building
  // the asset twice. `disabled={isPending}` cannot cover it: nothing is pending
  // yet. Same answer the coupon card already uses for the same hazard: a ref
  // latch around the whole submit path, released when the write settles or when
  // the sub-form refuses.
  const inFlight = useRef(false);

  function record(values: TransactionFormValues, newAsset: Asset | undefined) {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      date: values.date,
      type: values.type,
      assetId: newAsset ? newAsset.id : values.assetId,
      amount: values.amount,
      source: values.source,
    };
    recordTransaction.mutate(
      { tx, newAsset },
      {
        onSuccess: () => {
          releaseLatch();
          toast.success(t.transaction.recordedToast);
          // WHAT THE USER CHOSE SURVIVES THE RESET, and only the amount clears.
          // `assets[0]?.id` was read from the render that submitted: recording
          // three coupons for the third asset re-picked the first one every
          // time, and on quick-create the just-made asset was not in that array
          // at all, so the select snapped to the wrong asset — or to the empty
          // placeholder when the ledger had none, which is the invisible-error
          // state this task exists to remove.
          form.reset({
            date: values.date,
            type: values.type,
            assetId: newAsset ? newAsset.id : values.assetId,
            amount: '',
            source: values.source,
          });
          assetForm.reset(assetFormDefaults(f));
        },
        onError: () => {
          releaseLatch();
          toast.error(t.transaction.failedToast);
        },
      },
    );
  }

  // Released by the write's outcome, or by either form refusing — a latch that
  // is never lowered disables the form for the rest of the session.
  const releaseLatch = () => {
    inFlight.current = false;
  };

  function removeTransaction(tx: Transaction) {
    deleteTransaction.mutate(tx.id, {
      onSuccess: () => {
        // A CONFIRMED COUPON GETS ITS OCCURRENCE BACK. The card's confirm writes
        // the payout AND rolls `asset.nextCoupon` forward; deleting only the
        // transaction left the pointer ahead of it, and `nextUnsettledCoupon`
        // walks the grid FORWARD and never looks behind the pointer — so the
        // occurrence left the ledger, the due cards, the reminders and income all
        // at once, with nothing on any screen to say it had. D23: the pointer
        // moves only through a confirm, and a delete is that confirm taken back
        // (owner's ruling, 2026-08-25). The arithmetic is `rollbackNextCoupon`.
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
      // The row stays in its asking state on failure, so the answer is still
      // one press away rather than lost with the toast.
      onError: () => toast.error(t.transaction.delete.failedToast),
    });
  }

  function onSubmit(values: TransactionFormValues) {
    if (isNewAsset) {
      // Both forms must pass; assetForm.handleSubmit surfaces the sub-form's
      // field errors and only calls through when it validates. firstPurchase
      // keeps deriving from the transaction date (quick-create rule).
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

  // A32 — THE FULL LEDGER, newest first. The last-three cap existed because
  // this panel was a guest on `/`, where anything longer would have pushed the
  // daily ritual off the screen. On a route of its own the history is the
  // point, so the cap goes and the list scrolls inside its own box (D65).
  const ledger = [...transactions].reverse();
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return (
    <>
      {/* F6 — NO MICROLABEL. "Останні транзакції" became false the moment the
          list stopped being the last three, and the extension declined to
          invent a replacement for a heading the screen's own title already
          gives. */}
      {/* NO `px-5` HERE, and that is the Scroller's contract, not an omission
          (A32 review). Passing `radius` opens the inline gutter from the
          ScrollArea ROOT — 28 a side, outside the scroll box — so a Card padding
          of its own inset the rows a SECOND time (20 + 24 + 4 = 48 a side) and
          pushed the rail 28 off the card's edge instead of 8. It also made the
          `radius` wrong on its own terms: a radius is measured at the Scroller's
          box, and a 20 seen from inside 20 px of padding presents 0. With the
          padding gone the two agree, and the result is the extension's drawn
          `padding:16px 28px` exactly. `py-4` stays — the gutter is inline only.
          ImportDialog.tsx carries the same warning; this repeated it. */}
      {/* THE WIDE COLUMN — the `1.6fr` track of D88's grid; the ledger is what
          the route is for and it takes the wide track. Its width IS the
          track's since D93 — no cap of its own; the ledger card's comment
          below carries the ruling. (This paragraph once described the flex
          row — `flex:1 1 560px`, a cap keyed to a 944 container query — D88
          retired all of that with the composition.)

          THE HEIGHT CAP IS THE VIEWPORT'S AT `lg` AND UP, not 420. That number
          was chosen when this card sat UNDER the form and had to leave room
          for it; side by side it only has to leave the header and the page's
          own padding, so all 18 seeded rows fit and the PAGE stops scrolling
          while the column does (D65). Below `lg` the cap stays 420 — the card
          is stacked again there, and 360 must not move.

          `--ledger-top` IS MEASURED, and 80 is this box's own two paddings —
          `py-4` here (32) plus `main`'s `pb-12` (48). Everything ABOVE the card
          is read off the layout rather than summed by hand; see `useLedgerTop`.
          197 survives only as the pre-measurement fallback for the first paint.

          `max()` FLOORS IT AT 200, because a `max-height` calc that resolves
          negative is clamped to zero, not ignored (A35 review): a wide but very
          short window — a split screen, a short embedded frame, a dragged
          desktop window — collapsed the card to an empty box with a scroll rail
          and eighteen invisible rows.

          THE HEIGHT EASES, because the `lg` media query flips DISCRETELY while
          the rail's width animates over 260 ms (D66/S1), so this box would
          otherwise snap mid-transition while everything around it glides —
          against the standing "nothing pops or snaps" rule.

          AND THIS BOUNDS THE LEDGER ONLY. The form is uncapped deliberately —
          the quick-create reveal makes it tall, and a tall FORM should scroll
          the page rather than trap its own submit button. "The page stops
          scrolling" is a claim about the read-only ledger state, which is the
          state the complaint was about. */}
      {/* THE SIDE BLOCK — the narrow track, on the RIGHT since the owner's
          2026-08-25 instruction. It keeps every property the drawing gave it
          except its side: narrow beside the ledger, capped at 560 when the grid
          collapses, and never stretched into a settings page. Since D94 that
          sentence is literally the code (`max-lg:max-w-[560px]`).

          IT LEADS IN THE DOM, and `lg:col-start-2` puts it on the right anyway.
          The first cut did the opposite — ledger first, `max-lg:order-first` on
          the form — and that made the phone's visual order disagree with its
          reading order: a keyboard or a screen reader went through 18 ledger rows
          AND 18 delete buttons before the first field of the form it could see at
          the top (WCAG 2.4.3, 1.3.2). Collapsed, the column IS the sequence, so
          that is the order the DOM owes. Beside the ledger the two are perceived
          together and acting before reading is defensible. */}
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
        {/* THE LATCH IS CHECKED IN THE DOM EVENT, not inside `onSubmit`, for two
            reasons that agree: it is the earliest point a second press can be
            seen — `handleSubmit` has not begun awaiting the resolver yet — and a
            ref read inside a function handed to `handleSubmit` DURING RENDER is
            what `react-hooks/refs` refuses, correctly. Same place the coupon
            card puts its own latch. */}
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
                  // Reachable with no assets at all, or on a press before
                  // `useAssets()` resolves and the effect above has defaulted
                  // this: the schema refuses an empty id, and without this the
                  // summary named highlights that did not exist.
                  invalid={fieldState.invalid}
                  borderColor={isNewAsset ? 'faint' : 'hairline'}
                  options={[
                    { value: 'new', label: t.transaction.newAssetOption },
                    ...assets.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
              )}
            />
          </label>

          {isNewAsset && (
            <div className="animate-in duration-300 fade-in slide-in-from-top-2">
              {/* Same dashed reveal panel as v1 (design lines 116-124), now
                  hosting the shared AssetFormFields inline: create-mode core
                  fields only — no First purchase (derived from the tx date). */}
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

          <div className="grid grid-cols-2 gap-2.5">
            {/* NOT A `<label>` WRAPPER, unlike its neighbours, and the reason is
                the error: a message inside the label becomes part of the
                input's accessible NAME, so submitting an empty field renamed it
                to «Сума, ₴ Введіть суму.» under a screen reader instead of
                explaining itself. `htmlFor` + `aria-describedby` is the link
                that carries it as a description — the idiom `CouponDueCard` and
                Settings already use, and the one `navigation-map.md` pins.
                ONE MESSAGE PER FAILURE: `quoteInputSchema` refuses blank, zero,
                negative and non-numeric, and a single "Введіть суму." told
                someone who typed `0` to enter the amount they had just typed.
                The value itself says which of the two it is — no zod internals,
                and `fieldState` is the single read behind border, flag and
                message alike. */}
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-[11px] text-muted" htmlFor={AMOUNT_ID}>
                {t.transaction.amount}
              </label>
              <Controller
                control={form.control}
                name="amount"
                render={({ field, fieldState }) => (
                  <>
                    <input
                      id={AMOUNT_ID}
                      className={inputClass(fieldState.invalid)}
                      placeholder={t.transaction.amountPlaceholder}
                      inputMode="decimal"
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
                        {field.value.trim() === ''
                          ? t.transaction.amountMissing
                          : t.transaction.amountNotPositive}
                      </span>
                    )}
                  </>
                )}
              />
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
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

          <Button
            type="submit"
            weight="bold"
            className="w-full"
            // `isSubmitting` covers the async window the latch also guards:
            // the resolver runs before anything is pending.
            disabled={recordTransaction.isPending || form.formState.isSubmitting}
          >
            {t.transaction.submit}
          </Button>
          {/* `isNewAsset` GATES THE SUB-FORM'S HALF: its fields are unmounted
              whenever the select holds a real asset, so their errors could put
              this line on screen with nothing able to carry a highlight. The
              window is one render frame — the effect above resets the sub-form
              as soon as the select leaves «+ Новий актив…» — so this closes a
              flash, not the durable defect. THAT one was every control here
              lacking an invalid state at all, which is fixed above. */}
          {(Object.keys(form.formState.errors).length > 0 ||
            (isNewAsset && Object.keys(assetForm.formState.errors).length > 0)) && (
            <p className="text-xs text-neg">{t.transaction.invalid}</p>
          )}
        </form>
      </Card>

      {/* NO WIDTH CAP SINCE D93 (owner ruling, 2026-08-25). Inside D88's
          `1.6fr` track the TRACK is the bound — the old 884 cap protected
          nothing and opened a dead strip between the ledger and the form. The
          cap had been removed and argued back once before; D93 is the number
          that ends that loop, and `transactions-layout.test.ts` pins the
          absence on this card's own class string. The wide-monitor row
          stretch, and the precedents (`/` dropped its own 884, `/payouts`
          never had one), are priced in D93. */}
      <Card ref={ledgerRef} className="min-w-0 py-4 lg:col-start-1 lg:row-start-1">
        <Scroller
          radius={20}
          className="max-h-[420px] transition-[max-height] duration-[260ms] ease-soft lg:max-h-[max(200px,calc(100dvh-var(--ledger-top,197px)-80px))]"
        >
          {/* `w-0 min-w-full` IS THE WHOLE REASON THE ELLIPSIS WORKS (A32
              review). Radix wraps a viewport's children in its own
              `min-width:100%; display:table` box, and a table box is sized
              shrink-to-fit — so a row whose label is `truncate` (i.e.
              `white-space: nowrap`) makes min-content equal max-content, the
              box grows past the viewport, and `orientation="vertical"` clips
              the excess with NO rail to say so. Measured at 360: the ledger ran
              51 px wide and the date fell off every row, silently. `w-0` puts
              the child's preferred width at zero so the table box collapses
              back onto its own `min-width:100%`, and `min-w-full` fills it —
              the label then has a definite width to ellipsize against. */}
          {/* A SEPARATOR PER ROW, not the 9 px gap the rows used to sit in: a
              hairline between them is what makes a ledger read as a ledger, and
              it is the same line `/payouts`' own table draws between its rows —
              `border-t border-hairline` on the row, `first:border-t-0` to spare
              the top one. `divide-y` was the obvious spelling and it produced NO
              rule in this build (measured: the colour from `divide-hairline`
              applied, the width stayed 0), so the row carries its own border,
              which is also the app's existing idiom. */}
          <div className="flex w-0 min-w-full flex-col text-[12.5px]">
            {ledger.length === 0 && <span className="text-muted">{t.transaction.recentEmpty}</span>}
            {ledger.map((tx) => {
              const asset = assetById.get(tx.assetId);
              const asking = confirmingId === tx.id;
              return (
                <div
                  key={tx.id}
                  className="group flex animate-in items-center justify-between gap-2.5 border-t border-hairline py-2 duration-300 fade-in slide-in-from-top-1 first:border-t-0 max-md:gap-2"
                >
                  {asking ? (
                    <>
                      {/* THE ROW ITSELF ASKS. The app has no modal for a single
                          line and should not grow one: a quote row's suggestion
                          and the coupon card both ask in place, and this is the
                          same act — a question where the answer will land. */}
                      {/* IT NAMES THE RECORD, and `role="alert"` announces it.
                          The question REPLACES the row, so the label, amount and
                          date it stood on are gone at the moment of confirming
                          something unrecoverable — two coupons of one amount, or
                          two rows for one asset days apart, were indistinguishable
                          there. A reader who never sees the swap was told nothing
                          at all. */}
                      <span role="alert" className="min-w-0 flex-1 truncate text-neg">
                        {t.transaction.delete.ask(f.money(tx.amount), f.dateShort(tx.date))}
                      </span>
                      {/* `TAP_44`, NOT `TAP_44_BOX`: both of these draw a box and
                          hold a label, and the BOX squares a control to 44 × 44
                          below `md`, where «Видалити» has no wrap opportunity and
                          spills straight out of its own border. `tap-target.ts`
                          reserves the real box for a control without one, and
                          `Sidebar.tsx` says so outright.
                          `autoFocus` keeps the keyboard on the question it just
                          asked — the ✕ unmounts in the same commit and React moves
                          focus nowhere, which means <body>. */}
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
                      <strong className="whitespace-nowrap">{f.money(tx.amount)}</strong>
                      <span className="whitespace-nowrap text-muted">{f.dateShort(tx.date)}</span>
                      {/* HOVER REVEALS IT ON A POINTER, AND TOUCH ALWAYS SEES IT.
                          Eighteen always-on glyphs are noise on a desktop; a
                          hover-only control does not exist on a phone, where
                          there is no hover to have. `focus-visible` keeps it
                          reachable by keyboard, which hover alone never is. */}
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
              );
            })}
          </div>
        </Scroller>
      </Card>
    </>
  );
}
