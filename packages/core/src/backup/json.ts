// The backup envelope — pure build and parse, and the app-owned stable contract.
// `core/backup/import.ts` EXTENDS this module rather than forking it.
import { z } from 'zod';

import {
  isPayout,
  movesPosition,
  targetsAsset,
  type Asset,
  type Settings,
  type Transaction,
} from '../types';
import type { PriceRow } from '../valuation';

export const BACKUP_FORMAT = 'quirenote-backup';
/**
 * THE VERSION TRACKS WHAT A BUILD ACCEPTS — not how much time passed, and not only
 * what a build WRITES. That one rule decides every bump in both directions: a new
 * OPTIONAL field still bumps it, because the rows are `strictObject` and each
 * ships with its writer, so an earlier build rejects the file on
 * `unrecognized_keys`; and a READER NARROWING bumps it too, because a build that
 * starts requiring a count accepts strictly less than the one before it. A WRITER
 * NARROWING bumps nothing: `buildBackup` projecting its rows leaves the parser as it was.
 *
 * "No build ever WROTE that shape" is not an exemption: true about the writer and
 * beside the point. Two live sites run from two branches, so a dev backup cannot be
 * imported into production between a merge and the next promotion — and without
 * the bump that refusal arrives as a wall of per-row errors for one fact.
 */
export const BACKUP_FORMAT_VERSION = 13;

export type Dataset = 'demo' | 'live';

// A CALENDAR date (RFC 3339 §5.7), not a shape: `Date` rolls `2026-02-30` into March.
// Any string that is not one takes the sentence; a missing or non-string value keeps zod's.
const isoDate = z.iso.date({
  error: (iss) => (iss.code === 'invalid_format' ? 'expected a real date (yyyy-MM-dd)' : undefined),
});
// RFC 3339's date and time with no offset, as `toISOString().slice(0, 19)` writes them, and no :60,
// which an ECMA-262 time value cannot hold. Not `z.iso.datetime()`: it always admits a trailing `Z`.
const isoDateTime = z
  .string()
  .regex(
    new RegExp(
      `^(?:${z.regexes.date.source.slice(1, -1)})T(?:${z.regexes.time({ precision: 0 }).source.slice(1, -1)})$`,
    ),
    'expected a real timestamp (yyyy-MM-ddTHH:mm:ss, no time zone)',
  );

const inzhurSchema = z.strictObject({
  kind: z.enum(['fund', 'bond']),
  ref: z.string().min(1),
  // POSITIVE because the form never accepted 0, and a hand-edited 0 would be
  // read by `matchAssets` as a count it KNOWS — stamping the row `no-position`
  // and skipping it in silence.
  units: z.number().positive().optional(),
});

export const assetRowSchema = z.strictObject({
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
  inzhur: inzhurSchema.optional(),
});

// A day's ₴ quotes as `snapshot.patch` takes them, `null` removing one; the file carries the prices
// the store keeps.
export const snapshotPatchSchema = z.strictObject({
  quotes: z.record(z.string(), z.number().nullable()),
  savedAt: isoDateTime.optional(),
});

// One stored per-unit price of an asset on a day, whatever the ledger holds that day
// (*Cloud target*). Above zero, as `user_price_price_ck` holds it.
export const priceRowSchema = z.strictObject({
  assetId: z.string(),
  asOf: isoDate,
  price: z.number().positive(),
  observedAt: isoDateTime.optional(),
});

export const transactionRowSchema = z.strictObject({
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

export type TransactionRow = z.infer<typeof transactionRowSchema>;

/** ONE PREDICATE, APPLIED AT EVERY DOOR: whether a row has a unit count, and must. `at` is the
 *  row's path in its container. */
export function checkRowCount(row: TransactionRow, ctx: z.RefinementCtx, at: PropertyKey[] = []) {
  if (movesPosition(row.type)) {
    // BOTH WAYS: a moving row must carry its count at THIS door too, because the
    // form is not the app’s only writer. `unitPrice` keeps only the one-way rule —
    // it is derivable from `amount / quantity`, while a row without the COUNT
    // cannot be valued at all.
    if (row.quantity === undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'quantity'], params: { rule: 'missing' } });
    }
    return;
  }
  // BOTH fields, not just the count — the pair is what the two CHECKs govern
  // together.
  for (const field of ['quantity', 'unitPrice'] as const) {
    if (row[field] === undefined) continue;
    // NO MESSAGE. This layer emits PATHS, never English — a message here is
    // printed verbatim into a report otherwise in the reader’s language.
    ctx.addIssue({ code: 'custom', path: [...at, field] });
  }
}

/**
 * A SEPARATE RULE rather than more arms above, which is `return`-shaped
 * around the quantity rule: a position-moving row leaves it early, and a
 * withholding is only ever legal on the rows that rule returns past. A MESSAGE IS
 * ALLOWED — the no-English rule is about `detail` reaching a LOCALISED report.
 */
export function checkRowWithholding(
  row: TransactionRow,
  ctx: z.RefinementCtx,
  at: PropertyKey[] = [],
) {
  if (row.taxWithheld === undefined) return;
  if (!isPayout(row.type)) {
    ctx.addIssue({
      code: 'custom',
      path: [...at, 'taxWithheld'],
      params: { rule: 'type' },
      message: 'only a dividend accrual or an interest payout carries a withholding',
    });
    return;
  }
  // STRICTLY below: a withholding that is the whole payout leaves nothing received.
  if (row.taxWithheld >= row.amount) {
    ctx.addIssue({
      code: 'custom',
      path: [...at, 'taxWithheld'],
      params: { rule: 'bound' },
      message: 'a withholding must be smaller than the payout it was taken from',
    });
  }
}

// Every withholding before every count, the order a file's report has always listed them in.
const transactionRowsSchema = z.array(transactionRowSchema).superRefine((rows, ctx) => {
  rows.forEach((row, i) => checkRowWithholding(row, ctx, [i]));
  rows.forEach((row, i) => checkRowCount(row, ctx, [i]));
});

/** One transaction with every rule a row owes on its own: the mutation surface's door. */
export const transactionRecordSchema = transactionRowSchema.superRefine((row, ctx) => {
  checkRowWithholding(row, ctx);
  checkRowCount(row, ctx);
});

/** One asset as the mutation surface stores it: the provider link without the legacy unit count,
 *  which no column holds. */
export const assetRecordSchema = assetRowSchema.extend({
  inzhur: inzhurSchema.omit({ units: true }).optional(),
  // The store's CHECKs, refused at their fields; a code counted in characters, as `length()` counts.
  code: z.string().refine((v) => [...v].length === 2),
  expectedPct: z.number().min(0),
  targetPct: z.number().min(0).max(100),
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
  prices: z.array(priceRowSchema),
  transactions: transactionRowsSchema,
  settings: settingsSchema.optional(),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export type TemporalKind = 'date' | 'datetime';

// The envelope's rows, and the one only an op carries: `snapshot.patch`'s, where `rowIssueCodes`
// roots it.
const rowsSchema = backupEnvelopeSchema.extend({ snapshots: z.array(snapshotPatchSchema) });

// The schema an issue's path lands on, found by walking the rows. Identity, not a list
// of field names: a field is a date because it uses the date schema, and a quote keyed
// `date` walks into the record's number and is nothing of the kind.
export function temporalKindAt(path: PropertyKey[]): TemporalKind | undefined {
  let schema: z.ZodType | undefined = rowsSchema;
  for (const key of path) {
    schema = stepInto(schema, key);
    if (schema === undefined) return undefined;
  }
  const leaf = unwrapOptional(schema);
  return leaf === isoDate ? 'date' : leaf === isoDateTime ? 'datetime' : undefined;
}

// An object's shape by key, an array's element past the index, a record's value past the key.
function stepInto(schema: z.ZodType, key: PropertyKey): z.ZodType | undefined {
  const inner = unwrapOptional(schema);
  if (inner instanceof z.ZodObject) {
    return Object.hasOwn(inner.shape, key) ? (inner.shape[String(key)] as z.ZodType) : undefined;
  }
  if (inner instanceof z.ZodArray) return inner.element as z.ZodType;
  if (inner instanceof z.ZodRecord) return inner.valueType as z.ZodType;
  return undefined;
}

function unwrapOptional(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema;
}

// THE MODEL'S SHAPE, NOT THE STORE'S: a retired key stays in IndexedDB, and the strict
// reader refuses it. The keys come from the row schemas, so no list is written twice.
function project<T extends object>(row: T, shape: object): T {
  return Object.fromEntries(Object.entries(row).filter(([k]) => Object.hasOwn(shape, k))) as T;
}

// `exportedAt` and `dbVersion` are produced by the CALLER, so this module stays
// deterministic and pure.
export function buildBackup(
  assets: Asset[],
  prices: PriceRow[],
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
    assets: assets.map((a) => {
      const row = project({ ...a, createdAt: a.createdAt.slice(0, 19) }, assetRowSchema.shape);
      return a.inzhur ? { ...row, inzhur: project(a.inzhur, inzhurSchema.shape) } : row;
    }),
    prices: prices.map((p) =>
      project(
        p.observedAt ? { ...p, observedAt: p.observedAt.slice(0, 19) } : p,
        priceRowSchema.shape,
      ),
    ),
    transactions: transactions.map((t) => project(t, transactionRowSchema.shape)),
    ...(settings ? { settings: project(settings, settingsSchema.shape) } : {}),
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

// `String` of a parsed value can throw: an array joins itself once per level of nesting, and an
// object whose own `toString` is not callable falls back to `valueOf`. A kind is named, never converted.
const kindOf = (value: unknown): string | undefined =>
  Array.isArray(value)
    ? 'an array'
    : typeof value === 'object' && value !== null
      ? 'an object'
      : undefined;

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
      issue: `Not a ${BACKUP_FORMAT} file (format: ${kindOf(head.format) ?? `'${String(head.format)}'`}).`,
    };
  }
  // Version gate BEFORE the row schemas, so a newer backup gets one clear message
  // instead of a wall of field errors.
  if (head.formatVersion !== BACKUP_FORMAT_VERSION) {
    const kind = kindOf(head.formatVersion);
    return {
      ok: false,
      code: 'unsupported-version',
      version: head.formatVersion,
      issue: `Unsupported formatVersion ${kind ? `(${kind})` : String(head.formatVersion)} — this app reads formatVersion ${BACKUP_FORMAT_VERSION} only.`,
    };
  }
  return { ok: true, raw: head };
}

const FORBIDDEN_KEY = '__proto__';

/** Shaped like a zod issue, so both doors address and render it as they do zod's. */
export interface ForbiddenKeyIssue {
  code: 'forbidden_key';
  path: PropertyKey[];
  keys: string[];
  message: string;
}

// zod skips `__proto__` in the record and the strict object alike, so no schema can refuse it.
// The walk goes only where the schemas reach: its depth is theirs, and a stray key stays theirs.
export function forbiddenKeyIssues(raw: Record<string, unknown>): ForbiddenKeyIssue[] {
  const issues: ForbiddenKeyIssue[] = [];
  const found = (path: PropertyKey[], key: string) =>
    issues.push({
      code: 'forbidden_key',
      path,
      keys: [key],
      message: `Forbidden key: "${key}"`,
    });
  const walk = (schema: z.ZodType, value: unknown, path: PropertyKey[]) => {
    const inner = unwrapOptional(schema);
    if (typeof value !== 'object' || value === null) return;
    if (inner instanceof z.ZodArray) {
      const element = inner.element as z.ZodType;
      if (Array.isArray(value)) value.forEach((row, i) => walk(element, row, [...path, i]));
      return;
    }
    if (Array.isArray(value) || !(inner instanceof z.ZodObject || inner instanceof z.ZodRecord)) {
      return;
    }
    if (Object.hasOwn(value, FORBIDDEN_KEY)) found(path, FORBIDDEN_KEY);
    // An asset id is a quote key, so refuse here, before the row schemas, any name `Object.prototype`
    // owns (`qs`'s predicate), and `__proto__` by name, since an engine may delete that accessor.
    if (inner === assetRowSchema) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && (id === FORBIDDEN_KEY || Object.hasOwn(Object.prototype, id))) {
        found([...path, 'id'], id);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const next = stepInto(inner, key);
      if (next !== undefined) walk(next, child, [...path, key]);
    }
  };
  walk(backupEnvelopeSchema, raw, []);
  return issues;
}

const pathLine = (issue: { path: PropertyKey[]; message: string }) =>
  `${issue.path.join('.') || '(root)'}: ${issue.message}`;

export function parseBackup(text: string): ParseBackupResult {
  const head = readEnvelopeHead(text);
  if (!head.ok) return { ok: false, issues: [head.issue] };
  const forbidden = forbiddenKeyIssues(head.raw);
  if (forbidden.length > 0) return { ok: false, issues: forbidden.map(pathLine) };
  const parsed = backupEnvelopeSchema.safeParse(head.raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(pathLine) };
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
export type IssueTable = 'assets' | 'prices' | 'transactions' | 'settings' | 'envelope';

export type IssueCode =
  | 'unknown-asset-id'
  | 'unknown-quote-asset'
  | 'duplicate-key'
  /** A second price for one asset and day, the store's key. */
  | 'duplicate-price'
  | 'unknown-key'
  | 'forbidden-key'
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

  // `asOf` is a fixed-width date, so the pair reads back from its key alone.
  const priced = new Set<string>();
  for (const p of env.prices) {
    if (!assetIds.has(p.assetId)) {
      issues.push({ table: 'prices', at: p.asOf, code: 'unknown-asset-id', value: p.assetId });
    }
    const key = `${p.asOf} ${p.assetId}`;
    if (priced.has(key)) {
      issues.push({ table: 'prices', at: p.asOf, code: 'duplicate-price', value: p.assetId });
    }
    priced.add(key);
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
    case 'asset-missing-on-asset-row':
      // The honest inversion: naming the six types that must carry one reads worse
      // than naming the two that must not.
      return `${at}: only a deposit or a withdrawal may omit an asset`;
    case 'duplicate-key':
      return `${at}: duplicate ${i.field ?? 'key'} '${i.value ?? ''}' (${i.field ?? 'key'} is the primary key)`;
    case 'duplicate-price':
      return `${at}: a second price for asset '${i.value ?? ''}'`;
    default:
      return `${[at, i.field].filter(Boolean).join('.')}: ${i.detail ?? i.code}`;
  }
}
