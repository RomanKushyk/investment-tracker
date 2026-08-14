import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { AssetFormFields } from '../components/forms/AssetForm';
import { assetFormDefaults } from '../components/forms/asset-form';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
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

export function TransactionPanel() {
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

  const assetId = form.watch('assetId');
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

  const recent = [...transactions].slice(-3).reverse();
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return (
    <>
      <Card
        radius={24}
        className="animate-in border-panel-border bg-panel fade-in border px-[22px] py-5 duration-300"
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
            <label className="text-label flex flex-col gap-1 text-[11px]">
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
            <label className="text-label flex flex-col gap-1 text-[11px]">
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

          <label className="text-label flex flex-col gap-1 text-[11px]">
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
            <label className="text-label flex flex-col gap-1 text-[11px]">
              {t.transaction.amount}
              <input
                className={inputClass}
                placeholder={t.transaction.amountPlaceholder}
                inputMode="decimal"
                {...form.register('amount')}
              />
            </label>
            <label className="text-label flex flex-col gap-1 text-[11px]">
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

      <Card className="px-5 py-4">
        <div className="text-muted mb-2 text-[10px] tracking-[.12em] uppercase">
          {t.transaction.recentTitle}
        </div>
        <div className="flex flex-col gap-2 text-[12.5px]">
          {recent.length === 0 && (
            <span className="text-muted">{t.transaction.recentEmpty}</span>
          )}
          {recent.map((tx) => {
            const asset = assetById.get(tx.assetId);
            return (
              <div
                key={tx.id}
                className="animate-in fade-in slide-in-from-top-1 flex items-center justify-between gap-2 duration-300"
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
      </Card>
    </>
  );
}
