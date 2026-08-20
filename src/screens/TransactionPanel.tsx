import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { AssetFormFields } from '../components/forms/AssetForm';
import { assetFormDefaults } from '../components/forms/asset-form';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Scroller } from '../components/ui/Scroller';
import { DatePicker } from '../components/ui/DatePicker';
import { Select } from '../components/ui/Select';
import {
  useAssets,
  useRecordTransaction,
  useTransactions,
} from '../hooks/queries';
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

const inputClass =
  'h-9 rounded-[9px] border border-hairline bg-card px-3 font-body text-[13px] text-ink transition';

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
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const write = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      el.style.setProperty('--ledger-top', `${top}px`);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(document.body);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
          toast.success(t.transaction.recordedToast);
          form.reset({
            date: values.date,
            type: 'buy',
            assetId: assets[0]?.id ?? '',
            amount: '',
            source: 'own',
          });
          assetForm.reset(assetFormDefaults(f));
        },
        onError: () => toast.error(t.transaction.failedToast),
      },
    );
  }

  function onSubmit(values: TransactionFormValues) {
    if (isNewAsset) {
      // Both forms must pass; assetForm.handleSubmit surfaces the sub-form's
      // field errors and only calls through when it validates. firstPurchase
      // keeps deriving from the transaction date (quick-create rule).
      void assetForm.handleSubmit((assetValues) => {
        record(values, assetFromForm(assetValues, values.date, assets.length));
      })();
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
      {/* THE NARROW COLUMN — 360 beside the ledger, 560 when stacked, never the
          full width. The drawing says `flex:0 1 360px`; grow-1 plus a cap
          renders the same 360 beside the ledger AND still fills a wrapped line
          up to the 560 this screen has always used. `min-w-0` because a flex
          item without it will not shrink below its content and forces
          horizontal overflow.

          The `@container` these query lives on `Transactions.tsx`'s row, this
          component's ONE caller. A container query with no eligible ancestor
          evaluates false rather than erroring, so if this panel is rendered
          anywhere else the caps silently stop applying — it sat in `/`'s aside
          until A32, and that container's breakpoint is 884, not 944. */}
      <Card
        radius={24}
        className="animate-in border-panel-border bg-panel fade-in min-w-0 max-w-[560px] flex-[1_1_360px] border px-[22px] py-5 duration-300 @min-[944px]:max-w-[360px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="font-display text-lg font-semibold">{t.transaction.title}</div>
          <span className="text-muted text-[10px] tracking-[.08em] uppercase">
            {t.transaction.badge}
          </span>
        </div>
        <p className="text-muted mt-1 mb-3.5 text-xs">
          {t.transaction.subtitle}
        </p>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-2.5"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-muted flex flex-col gap-1 text-[11px]">
              {t.transaction.date}
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    className="w-full text-left"
                  />
                )}
              />
            </label>
            <label className="text-muted flex flex-col gap-1 text-[11px]">
              {t.transaction.type}
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={TYPE_ORDER.map((value) => ({ value, label: t.transaction.types[value] }))}
                  />
                )}
              />
            </label>
          </div>

          <label className="text-muted flex flex-col gap-1 text-[11px]">
            {t.transaction.asset}
            <Controller
              control={form.control}
              name="assetId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t.transaction.assetPlaceholder}
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
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Same dashed reveal panel as v1 (design lines 116-124), now
                  hosting the shared AssetFormFields inline: create-mode core
                  fields only — no First purchase (derived from the tx date). */}
              <div className="border-faint flex flex-col gap-2.5 rounded-2xl border border-dashed bg-card p-3.5">
                <div className="text-pos-tint-text flex items-center gap-2 text-[11px] font-bold tracking-[.06em] uppercase">
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
            <label className="text-muted flex flex-col gap-1 text-[11px]">
              {t.transaction.amount}
              <input
                className={inputClass}
                placeholder={t.transaction.amountPlaceholder}
                inputMode="decimal"
                {...form.register('amount')}
              />
            </label>
            <label className="text-muted flex flex-col gap-1 text-[11px]">
              {t.transaction.source}
              <Controller
                control={form.control}
                name="source"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={SOURCE_ORDER.map((value) => ({ value, label: t.transaction.sources[value] }))}
                  />
                )}
              />
            </label>
          </div>

          <Button
            type="submit"
            weight="bold"
            className="w-full"
            disabled={recordTransaction.isPending}
          >
            {t.transaction.submit}
          </Button>
          {(Object.keys(form.formState.errors).length > 0 ||
            Object.keys(assetForm.formState.errors).length > 0) && (
            <p className="text-neg text-xs">
              {t.transaction.invalid}
            </p>
          )}
        </form>
      </Card>

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
      {/* THE WIDE COLUMN — `flex:1 1 560px` as drawn; the ledger is what the
          route is for and it takes the remainder. Its cap is released only
          above 944, so a wrapped line keeps the 560 this screen shipped with.

          THE HEIGHT CAP IS THE VIEWPORT'S ABOVE 944, not 420. That number was
          chosen when this card sat UNDER the form and had to leave room for it;
          side by side it only has to leave the header and the page's own
          padding, so all 18 seeded rows fit and the PAGE stops scrolling while
          the column does (D65). Below 944 the cap stays 420 — the card is
          stacked again there, and 360 must not move.

          `--ledger-top` IS MEASURED, and 80 is this box's own two paddings —
          `py-4` here (32) plus `main`'s `pb-12` (48). Everything ABOVE the card
          is read off the layout rather than summed by hand; see `useLedgerTop`.
          197 survives only as the pre-measurement fallback for the first paint.

          `max()` FLOORS IT AT 200, because a `max-height` calc that resolves
          negative is clamped to zero, not ignored (A35 review): a wide but very
          short window — a split screen, a short embedded frame, a dragged
          desktop window — collapsed the card to an empty box with a scroll rail
          and eighteen invisible rows.

          THE CAP IS 884 ABOVE 944, not none. An unbounded ledger renders 1860
          wide on a 2560 monitor, and each row is a `justify-between` with a
          truncated label at one end and a short amount at the other — the same
          defect `/` caps its own column at 884 for. Reusing that number rather
          than inventing one: it is the app's existing answer to "a column that
          must not stretch". Below container 1268 it never binds.

          THE HEIGHT EASES, because the container query flips DISCRETELY while
          the rail's width animates over 260 ms (D66/S1), so this box would
          otherwise snap mid-transition while everything around it glides —
          against the standing "nothing pops or snaps" rule.

          AND THIS BOUNDS THE LEDGER ONLY. The form is uncapped deliberately —
          the quick-create reveal makes it tall, and a tall FORM should scroll
          the page rather than trap its own submit button. "The page stops
          scrolling" is a claim about the read-only ledger state, which is the
          state the complaint was about. */}
      <Card
        ref={ledgerRef}
        className="min-w-0 max-w-[560px] flex-[1_1_560px] py-4 @min-[944px]:max-w-[884px]"
      >
        <Scroller
          radius={20}
          className="ease-soft max-h-[420px] transition-[max-height] duration-[260ms] @min-[944px]:max-h-[max(200px,calc(100dvh-var(--ledger-top,197px)-80px))]"
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
          <div className="flex w-0 min-w-full flex-col gap-[9px] text-[12.5px]">
            {ledger.length === 0 && (
              <span className="text-muted">{t.transaction.recentEmpty}</span>
            )}
            {ledger.map((tx) => {
              const asset = assetById.get(tx.assetId);
              return (
                <div
                  key={tx.id}
                  className="animate-in fade-in slide-in-from-top-1 flex items-center justify-between gap-2.5 duration-300 max-md:gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tx.type === 'interest_payout' ? t.transaction.recentCoupon : t.transaction.types[tx.type]} ·{' '}
                    {asset ? shortLabel(asset) : t.transaction.portfolioRow}
                  </span>
                  <strong className="whitespace-nowrap">
                    {f.money(tx.amount)}
                  </strong>
                  <span className="text-muted whitespace-nowrap">
                    {f.dateShort(tx.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </Scroller>
      </Card>
    </>
  );
}
