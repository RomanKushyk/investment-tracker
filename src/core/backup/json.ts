// Backup envelope v1 (NEXT-PHASE-PLAN P1 / DECISIONS D12) — pure build +
// parse for the JSON safety backup. The envelope is the app-owned stable
// contract (dexie-export-import rejected, see D12); P4's import feature
// reuses parseBackup as its validation front door.
import { z } from 'zod';

import type { Asset, Settings, Snapshot, Transaction } from '../types';

export const BACKUP_FORMAT = 'kubushka-backup';
export const BACKUP_FORMAT_VERSION = 1;

export type Dataset = 'demo' | 'live';

// Timezone-less ISO by PLAIN REGEX, deliberately NOT z.iso.datetime(): the
// app's pinned datetime convention is `toISOString().slice(0, 19)` (see
// repository.saveSnapshot), so 'Z'-suffixed or offset datetimes are rejected.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-MM-dd');
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    'expected timezone-less yyyy-MM-ddTHH:mm:ss',
  );

// Rows are strictObject (unknown keys rejected) but FORWARD-COMPATIBLE:
// optional fields the plan adds later are accepted already, so formatVersion
// stays 1 when they land.
const assetRowSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  code: z.string(),
  colorKey: z.enum(['reit', 'energy', 'ovdp8976', 'ovdp6475']),
  yieldType: z.enum(['fixed_coupon', 'dividends', 'capitalization', 'div_cap']),
  expectedPct: z.number(),
  targetPct: z.number(),
  // incl. the seed-only 'none' (Energy "None (price only)").
  payoutSchedule: z.enum([
    'maturity',
    'monthly',
    'quarterly',
    'semiannual',
    'none',
  ]),
  firstPurchase: isoDate,
  createdAt: isoDateTime,
  maturity: isoDate.optional(),
  couponAmount: z.number().optional(),
  nextCoupon: isoDate.optional(),
  reinvestPolicy: z.string().optional(),
  // P2 feat/asset-form's Inzhur link — accepted ahead of time (forward-compat).
  inzhur: z
    .strictObject({
      kind: z.enum(['fund', 'bond']),
      ref: z.string().min(1),
      units: z.number(),
    })
    .optional(),
});

const snapshotRowSchema = z.strictObject({
  date: isoDate,
  quotes: z.record(z.string(), z.number()),
  cash: z.number(),
  savedAt: isoDateTime.optional(),
});

// Type enum mirrors core/types.ts TxType exactly — incl. 'withdrawal' and
// 'redemption', widened here in the same commit that widened TxType (P1
// feat/formula-parity) so parsed data keeps satisfying Transaction[].
const transactionRowSchema = z.strictObject({
  id: z.string().min(1),
  date: isoDate,
  type: z.enum([
    'buy',
    'sell',
    'deposit',
    'withdrawal',
    'dividend_accrual',
    'interest_payout',
    'reinvest',
    'redemption',
    'tax',
  ]),
  assetId: z.string(), // '' = portfolio-level rows (deposit/withdrawal)
  // Positive magnitude — the sign is carried by the TxType (every ledger
  // derivation assumes this; the form path enforces it via quoteInputSchema).
  // A negative amount here would double-flip signs in netDeposits/
  // freeCashFromLedger, silently corrupting globalRoi and the drift check.
  amount: z.number().positive(),
  source: z.enum(['own', 'accrual', 'reinvest_reit', 'reinvest_6475']),
});

const settingsSchema = z.strictObject({
  currency: z.enum(['UAH', 'USD']),
  usdRate: z.number(),
});

export const backupEnvelopeSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: isoDateTime,
  dbVersion: z.number().int().positive(),
  dataset: z.enum(['demo', 'live']),
  assets: z.array(assetRowSchema),
  snapshots: z.array(snapshotRowSchema),
  transactions: z.array(transactionRowSchema),
  settings: settingsSchema.optional(),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

// exportedAt and dbVersion are produced by the CALLER (the UI stamps
// `new Date().toISOString().slice(0, 19)`; lib/repository exports the Dexie
// schema version) — this module stays deterministic and pure (G1).
export function buildBackup(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
  settings: Settings | undefined,
  dataset: Dataset,
  exportedAt: string,
  dbVersion: number,
): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    dbVersion,
    dataset,
    // Normalize datetimes to the pinned timezone-less convention: v1's
    // buildNewAsset stamps a full toISOString() (with 'Z' + millis), so
    // without the slice a backup holding any user-created asset would fail
    // this module's own schema.
    assets: assets.map((a) => ({ ...a, createdAt: a.createdAt.slice(0, 19) })),
    snapshots: snapshots.map((s) =>
      s.savedAt ? { ...s, savedAt: s.savedAt.slice(0, 19) } : s,
    ),
    transactions,
    ...(settings ? { settings } : {}),
  };
}

export type ParseBackupResult =
  { ok: true; data: BackupEnvelope } | { ok: false; issues: string[] };

export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    return { ok: false, issues: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [`Not a ${BACKUP_FORMAT} file (expected a JSON object).`],
    };
  }
  const head = raw as Record<string, unknown>;
  if (head.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      issues: [
        `Not a ${BACKUP_FORMAT} file (format: '${String(head.format)}').`,
      ],
    };
  }
  // Version gate BEFORE the row schemas so a newer backup gets one clear
  // message instead of a wall of field errors (P4 dispatches on this).
  if (head.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        `Unsupported formatVersion ${String(head.formatVersion)} — this app reads formatVersion ${BACKUP_FORMAT_VERSION} only.`,
      ],
    };
  }
  const parsed = backupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  const issues = integrityIssues(parsed.data);
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, data: parsed.data };
}

// Post-parse referential integrity — schema-valid rows can still contradict
// each other; nothing orphaned or ambiguous may pass (standing invariant).
function integrityIssues(env: BackupEnvelope): string[] {
  const issues: string[] = [];
  const assetIds = new Set(env.assets.map((a) => a.id));
  for (const tx of env.transactions) {
    if (tx.assetId !== '' && !assetIds.has(tx.assetId)) {
      issues.push(`transactions.${tx.id}: unknown assetId '${tx.assetId}'`);
    }
  }
  const seenDates = new Set<string>();
  for (const s of env.snapshots) {
    for (const key of Object.keys(s.quotes)) {
      if (!assetIds.has(key)) {
        issues.push(`snapshots.${s.date}: quote for unknown asset '${key}'`);
      }
    }
    if (seenDates.has(s.date)) {
      issues.push(
        `snapshots: duplicate date '${s.date}' (date is the primary key)`,
      );
    }
    seenDates.add(s.date);
  }
  return issues;
}
