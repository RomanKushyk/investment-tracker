// The backup envelope — pure build and parse, and the app-owned stable contract.
// `core/backup/import.ts` EXTENDS this module rather than forking it.
import { z } from 'zod';

import {
  isPayout,
  movesPosition,
  targetsAsset,
  type Asset,
  type Settings,
  type Snapshot,
  type Transaction,
} from '../types';

export const BACKUP_FORMAT = 'quirenote-backup';
/**
 * THE VERSION TRACKS WHAT A BUILD ACCEPTS — not how much time passed, and not only
 * what a build WRITES. That one rule decides every bump in both directions: a new
 * OPTIONAL field still bumps it, because the rows are `strictObject` and each
 * ships with its writer, so an earlier build rejects the file on
 * `unrecognized_keys`; and a READER NARROWING bumps it too, because a build that
 * starts requiring a count accepts strictly less than the one before it.
 *
 * "No build ever WROTE that shape" is not an exemption, and was tried: true about
 * the writer and beside the point. Two live sites run from two branches, so a dev
 * backup cannot be imported into production between a merge and the next
 * promotion — and without the bump that refusal arrives as a wall of per-row
 * errors for one fact.
 */
export const BACKUP_FORMAT_VERSION = 7;

export type Dataset = 'demo' | 'live';

// Timezone-less ISO by PLAIN REGEX, deliberately NOT `z.iso.datetime()`: the
// pinned convention is `toISOString().slice(0, 19)`, so offsets are rejected.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-MM-dd');
const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'expected timezone-less yyyy-MM-ddTHH:mm:ss');

const assetRowSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  code: z.string(),
  colorKey: z.enum(['reit', 'energy', 'ovdp8976', 'ovdp6475']),
  yieldType: z.enum(['fixed_coupon', 'dividends', 'capitalization', 'div_cap']),
  expectedPct: z.number(),
  targetPct: z.number(),
  payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual', 'none']),
  firstPurchase: isoDate,
  createdAt: isoDateTime,
  maturity: isoDate.optional(),
  couponAmount: z.number().optional(),
  // BOUNDED LIKE THE FORM BOUNDS IT — a backup is the other door onto the same
  // field, and a stored 0 is worse than wrong, it is INERT: `couponPerPayment`
  // gates on `rate > 0` and falls back to the legacy amount with no screen saying so.
  couponRatePct: z.number().positive().max(100).optional(),
  nextCoupon: isoDate.optional(),
  inzhur: z
    .strictObject({
      kind: z.enum(['fund', 'bond']),
      ref: z.string().min(1),
      // POSITIVE because the form never accepted 0, and a hand-edited 0 would be
      // read by `matchAssets` as a count it KNOWS — stamping the row `no-position`
      // and skipping it in silence.
      units: z.number().positive().optional(),
    })
    .optional(),
});

const snapshotRowSchema = z.strictObject({
  date: isoDate,
  quotes: z.record(z.string(), z.number()),
  cash: z.number(),
  savedAt: isoDateTime.optional(),
});

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
  ]),
  assetId: z.string(), // '' = portfolio-level rows (deposit/withdrawal)
  // POSITIVE MAGNITUDE — the sign is carried by the TxType, and every ledger
  // derivation assumes it. A negative here would double-flip signs in
  // `netDeposits` and `freeCashFromLedger`.
  amount: z.number().positive(),
  // Optional in the SCHEMA is not additive in the FORMAT: an older build declares
  // neither key and its `strictObject` refuses the file on `unrecognized_keys`.
  quantity: z.number().positive().optional(),
  unitPrice: z.number().positive().optional(),
  // `transaction_tax_sign_ck` is `> 0`. The other two rules need the row’s type and
  // its amount, so they live in the refinement below.
  taxWithheld: z.number().positive().optional(),
  // 1..100 characters, absent the only spelling of none. THE EMPTY STRING IS
  // REFUSED RATHER THAN NORMALIZED — the form is where a blank field becomes an
  // absent one, so a `''` here came from a hand-edited file.
  //
  // ONE REFINEMENT FOR THE WHOLE RULE, for an arithmetic reason: any two of
  // `.min(1)`, `.max(100)` and a trim check can fail TOGETHER and report one row
  // twice. It carries a MESSAGE because that serves `parseBackup`’s own contract.
  note: z
    .string()
    .refine((v) => v.trim().length > 0 && [...v].length <= 100, {
      message: 'a note needs 1 to 100 characters of text',
    })
    .optional(),
});

/**
 * ONE PREDICATE, APPLIED AT EVERY DOOR. Two different ones decided whether a row
 * HAS a unit count and what that count IS, and a hand-edited backup with
 * `quantity` on a payout row created the key and then contributed 0 to it,
 * valuing the whole position at nothing.
 */
const transactionRowsSchema = z.array(transactionRowSchema).superRefine((rows, ctx) => {
  checkWithholding(rows, ctx);
  rows.forEach((row, i) => {
    if (movesPosition(row.type)) {
      // BOTH WAYS: a moving row must carry its count at THIS door too, because the
      // form is not the app’s only writer. `unitPrice` keeps only the one-way rule —
      // it is derivable from `amount / quantity`, while a row without the COUNT
      // cannot be valued at all.
      if (row.quantity === undefined) {
        ctx.addIssue({ code: 'custom', path: [i, 'quantity'], params: { rule: 'missing' } });
      }
      return;
    }
    // BOTH fields, not just the count — the pair is what the two CHECKs govern
    // together.
    for (const field of ['quantity', 'unitPrice'] as const) {
      if (row[field] === undefined) continue;
      // NO MESSAGE. This layer emits PATHS, never English — a message here is
      // printed verbatim into a report otherwise in the reader’s language.
      ctx.addIssue({ code: 'custom', path: [i, field] });
    }
  });
});

/**
 * A SEPARATE REFINEMENT rather than more arms above, which is `return`-shaped
 * around the quantity rule: a position-moving row leaves it early, and a
 * withholding is only ever legal on the rows that rule returns past. A MESSAGE IS
 * ALLOWED — the no-English rule is about `detail` reaching a LOCALISED report.
 */
function checkWithholding(rows: z.infer<typeof transactionRowSchema>[], ctx: z.RefinementCtx) {
  rows.forEach((row, i) => {
    if (row.taxWithheld === undefined) return;
    if (!isPayout(row.type)) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'taxWithheld'],
        params: { rule: 'type' },
        message: 'only a dividend accrual or an interest payout carries a withholding',
      });
      return;
    }
    // STRICTLY below: a withholding that is the whole payout leaves nothing received.
    if (row.taxWithheld >= row.amount) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'taxWithheld'],
        params: { rule: 'bound' },
        message: 'a withholding must be smaller than the payout it was taken from',
      });
    }
  });
}

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
  transactions: transactionRowsSchema,
  settings: settingsSchema.optional(),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

// `exportedAt` and `dbVersion` are produced by the CALLER, so this module stays
// deterministic and pure.
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
    // Normalize datetimes to the pinned timezone-less convention: `buildNewAsset`
    // stamps a full `toISOString()`, so without the slice a backup holding any
    // user-created asset would fail this module’s own schema.
    assets: assets.map((a) => ({ ...a, createdAt: a.createdAt.slice(0, 19) })),
    snapshots: snapshots.map((s) => (s.savedAt ? { ...s, savedAt: s.savedAt.slice(0, 19) } : s)),
    transactions,
    ...(settings ? { settings } : {}),
  };
}

export type ParseBackupResult =
  { ok: true; data: BackupEnvelope } | { ok: false; issues: string[] };

export type EnvelopeHeadCode =
  'not-json' | 'not-an-object' | 'not-a-backup' | 'unsupported-version';

// The format gate, extracted so the import validator dispatches on the same
// decision instead of re-deriving it: `code` is what the report branches on and
// `issue` the ONE verbatim sentence it prints, so the two can never drift.
export type EnvelopeHead =
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; code: EnvelopeHeadCode; version?: unknown; issue: string };

export function readEnvelopeHead(text: string): EnvelopeHead {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    return { ok: false, code: 'not-json', issue: `Not valid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'not-an-object',
      issue: `Not a ${BACKUP_FORMAT} file (expected a JSON object).`,
    };
  }
  const head = raw as Record<string, unknown>;
  if (head.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      code: 'not-a-backup',
      issue: `Not a ${BACKUP_FORMAT} file (format: '${String(head.format)}').`,
    };
  }
  // Version gate BEFORE the row schemas, so a newer backup gets one clear message
  // instead of a wall of field errors.
  if (head.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      code: 'unsupported-version',
      version: head.formatVersion,
      issue: `Unsupported formatVersion ${String(head.formatVersion)} — this app reads formatVersion ${BACKUP_FORMAT_VERSION} only.`,
    };
  }
  return { ok: true, raw: head };
}

export function parseBackup(text: string): ParseBackupResult {
  const head = readEnvelopeHead(text);
  if (!head.ok) return { ok: false, issues: [head.issue] };
  const parsed = backupEnvelopeSchema.safeParse(head.raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const issues = integrityIssues(parsed.data);
  return issues.length > 0
    ? { ok: false, issues: issues.map(renderIssue) }
    : { ok: true, data: blankPortfolioAssetIds(parsed.data) };
}

/**
 * BLANKED, NOT REFUSED: what reaches here is a file exported today from a store
 * whose deposits predate the rule — legitimate history carrying a value the CHECK
 * discards anyway, and refusing it would stop that store backing itself up.
 *
 * AFTER `integrityIssues`, NEVER BEFORE. As a `.transform` it ran first, so a
 * deposit naming an asset the file does not carry was silently tidied instead of
 * reported — and a dangling id is evidence the file lost an asset row.
 */
export function blankPortfolioAssetIds(env: BackupEnvelope): BackupEnvelope {
  return {
    ...env,
    transactions: env.transactions.map((t) => (targetsAsset(t.type) ? t : { ...t, assetId: '' })),
  };
}

// The envelope’s issue vocabulary: a location plus a CODE, never an English
// sentence — the report renders the words. `parseBackup` keeps its string contract
// by rendering these through `renderIssue` below.
export type IssueTable = 'assets' | 'snapshots' | 'transactions' | 'settings' | 'envelope';

export type IssueCode =
  | 'unknown-asset-id'
  | 'unknown-quote-asset'
  | 'duplicate-key'
  | 'unknown-key'
  | 'expected-datetime'
  | 'expected-date'
  | 'expected-positive-amount'
  | 'units-on-non-position-row'
  | 'units-missing-on-position-row'
  /** No `assetId` on a row that BELONGS to one — `transaction_asset_present_ck`. */
  | 'asset-missing-on-asset-row'
  | 'withholding-on-non-payout-row'
  | 'withholding-above-amount'
  | 'note-length'
  | 'invalid';

export interface RowIssue {
  table: IssueTable;
  at?: string;
  field?: string;
  code: IssueCode;
  value?: string;
  detail?: string;
}

// Post-parse referential integrity — schema-valid rows can still contradict each
// other. Duplicate primary keys are here because a duplicated id survives the row
// schemas and would abort `bulkAdd` with an opaque ConstraintError instead.
export function integrityIssues(env: BackupEnvelope): RowIssue[] {
  const issues: RowIssue[] = [];

  const assetIds = new Set<string>();
  for (const a of env.assets) {
    if (assetIds.has(a.id)) {
      issues.push({ table: 'assets', field: 'id', code: 'duplicate-key', value: a.id });
    }
    assetIds.add(a.id);
  }

  const txIds = new Set<string>();
  for (const tx of env.transactions) {
    if (txIds.has(tx.id)) {
      issues.push({ table: 'transactions', field: 'id', code: 'duplicate-key', value: tx.id });
    }
    txIds.add(tx.id);
    // TWO QUESTIONS ABOUT ONE FIELD, and `!== ''` only asked the first: an empty id is
    // legitimate on a portfolio-level row and meaningless on one that names an asset.
    // A withholding is attributed by the row’s OWN asset, so an imported payout naming
    // none would carry one past attribution and then fail the CHECK.
    if (tx.assetId === '') {
      if (targetsAsset(tx.type)) {
        issues.push({ table: 'transactions', at: tx.id, code: 'asset-missing-on-asset-row' });
      }
    } else if (!assetIds.has(tx.assetId)) {
      issues.push({
        table: 'transactions',
        at: tx.id,
        code: 'unknown-asset-id',
        value: tx.assetId,
      });
    }
  }

  const seenDates = new Set<string>();
  for (const s of env.snapshots) {
    for (const key of Object.keys(s.quotes)) {
      if (!assetIds.has(key)) {
        issues.push({
          table: 'snapshots',
          at: s.date,
          code: 'unknown-quote-asset',
          value: key,
        });
      }
    }
    if (seenDates.has(s.date)) {
      issues.push({ table: 'snapshots', field: 'date', code: 'duplicate-key', value: s.date });
    }
    seenDates.add(s.date);
  }
  return issues;
}

// NOT THE UI COPY, and the duplication is deliberate: `import-labels.ts` owns the
// localised words, this one a frozen English contract for `parseBackup`.
function renderIssue(i: RowIssue): string {
  const at = i.at ? `${i.table}.${i.at}` : i.table;
  switch (i.code) {
    case 'unknown-asset-id':
      return `${at}: unknown assetId '${i.value ?? ''}'`;
    case 'unknown-quote-asset':
      return `${at}: quote for unknown asset '${i.value ?? ''}'`;
    case 'asset-missing-on-asset-row':
      // The honest inversion: naming the six types that must carry one reads worse
      // than naming the two that must not.
      return `${at}: only a deposit or a withdrawal may omit an asset`;
    case 'duplicate-key':
      return `${at}: duplicate ${i.field ?? 'key'} '${i.value ?? ''}' (${i.field ?? 'key'} is the primary key)`;
    default:
      return `${[at, i.field].filter(Boolean).join('.')}: ${i.detail ?? i.code}`;
  }
}
