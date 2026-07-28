import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { repo } from '../lib/repository';
import type { Asset, Snapshot, Transaction } from '../core/types';

export const keys = {
  assets: ['assets'],
  snapshots: ['snapshots'],
  transactions: ['transactions'],
} as const;

export function useAssets() {
  return useQuery({ queryKey: keys.assets, queryFn: repo.listAssets });
}

export function useSnapshots() {
  return useQuery({ queryKey: keys.snapshots, queryFn: repo.listSnapshots });
}

export function useTransactions() {
  return useQuery({ queryKey: keys.transactions, queryFn: repo.listTransactions });
}

export function useSaveSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Snapshot) => repo.saveSnapshot(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.snapshots }),
  });
}

export function useRecordTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tx, newAsset }: { tx: Transaction; newAsset?: Asset }) =>
      repo.recordTransaction(tx, newAsset),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.transactions });
      await qc.invalidateQueries({ queryKey: keys.assets });
    },
  });
}

// --- Write-surface mutations (G2): per-entity invalidation for row ops,
// --- invalidate-all for cascade/replace/clear.

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Asset> }) =>
      repo.updateAsset(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.assets }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries(), // cascade touches all three tables
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Transaction> }) =>
      repo.updateTransaction(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.transactions }),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteTransaction(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.transactions }),
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => repo.deleteSnapshot(date),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.snapshots }),
  });
}

export function useReplaceAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof repo.replaceAll>[0]) => repo.replaceAll(data),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useClearAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { reseed: boolean }) => repo.clearAll(opts),
    onSuccess: () => qc.invalidateQueries(),
  });
}
