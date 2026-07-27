import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { repo } from '../lib/repository';
import type { Asset, Snapshot, Transaction } from '../lib/types';

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
