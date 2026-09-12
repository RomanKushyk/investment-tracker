// The backup envelope (NEXT-PHASE-PLAN P1 / DECISIONS D12, now at
// `BACKUP_FORMAT_VERSION` 6 — D113, D122, D125, D127, D129, and the withholding's
// own bump, whose reasoning is on the constant itself) — pure build + parse for the JSON safety
// backup. The envelope is the app-owned stable
// contract (dexie-export-import rejected, see D12); P4's import feature
// EXTENDS this module rather than forking it — `core/backup/import.ts` reuses
// `readEnvelopeHead` (the format/version gate), `backupEnvelopeSchema` and
// `integrityIssues` verbatim and only adds the structured zod-issue mapping
// and the preview diff (D24).
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
 * 2 WHEN `quantity` / `unitPrice` LANDED (#31, D113); 3 WHEN `couponRatePct` DID;
 * 4 WHEN A POSITION-MOVING ROW STARTED REQUIRING ITS COUNT (D125).
 *
 * The rows are `strictObject`, and the header above explains the mechanism that
 * makes a version bump avoidable: declare an optional field BEFORE it ships, and
 * the older build already accepts it. Each of these fields shipped in the SAME
 * commit as its writer, so no earlier build has it declared — it rejects the file
 * with `unrecognized_keys`, naming a field instead of a version.
 *
 * That is not academic here: two live sites run from two branches
 * (dev.quirenote.com from `dev`, quirenote.com from `main`, promoted only on
 * release), so between this merge and the next promotion a backup taken from dev
 * cannot be imported into production. The bump makes that refusal say what it
 * actually is.
 *
 * 3 IS NOT REDUNDANT WITH 2, even though both landed within days and neither has
 * been promoted to production yet. `dev` deploys on every push, so a build
 * carrying `quantity`/`unitPrice` but NOT `couponRatePct` was live — two builds
 * that both call themselves version 2 and disagree about the fields, which is
 * the one thing the number exists to prevent. The version tracks what a build
 * ACCEPTS, not how much time passed.
 */
/**
 * 4 WAS THE FIRST BUMP FOR A STRICTER READER RATHER THAN A NEW FIELD, and D122's
 * rule covers it unchanged: the version tracks what a build ACCEPTS. A v3 build
 * accepts a `buy` with no `quantity` and a v4 build does not, so every file
 * written before this — including one the demo dataset exported yesterday — is
 * refused. Without the bump that refusal reads `invalid_type: transactions[3]
 * .quantity`, naming a field the owner never omitted on purpose; with it, it
 * reads as the older format it is.
 */
/**
 * 5 IS THE SECOND SUCH BUMP (D129). A v4 build accepts a `buy` with no
 * `assetId` and this one does not — and a v4 build is LIVE, because dev deploys
 * on every push. Two builds that both call themselves 4 and disagree about what
 * they accept is the one thing D122 says the number exists to prevent, in those
 * words, about exactly this situation.
 *
 * THE ARGUMENT AGAINST IT WAS TRIED AND IS WRONG. It ran: no build ever WROTE a
 * `buy` with an empty assetId, so bumping refuses readable v4 files to catch a
 * shape none of them contain. True about the writer, and beside the point — the
 * version tracks the READER. D128 proved the same thing about 4 (nothing could
 * produce the count-less row it refuses) and 4 stands; a criterion that has to
 * be re-read case by case is not a criterion.
 *
 * The portfolio-level converse does NOT enter into it: that one is normalized
 * rather than refused, so every v4 file stays readable through it.
 */
/**
 * 6 IS THE THIRD SUCH BUMP, and it is BOTH kinds at once. A v5 build's
 * `strictObject` refuses `taxWithheld` and `note` on `unrecognized_keys`, so
 * every file this build writes is unreadable there — the ordinary new-field
 * reason. And this build refuses a `{ type: 'tax' }` row that v5 accepts, so
 * the reader narrowed too.
 *
 * The second half is what makes the number load-bearing rather than polite.
 * Without it a v5 file carrying tax rows would pass the version gate and then
 * fail row by row, reporting "transactions.tx-0042: invalid" nine times for one
 * fact — that this app no longer has that type. The sentence a version mismatch
 * prints says it once.
 */
export const BACKUP_FORMAT_VERSION = 6;

export type Dataset = 'demo' | 'live';

// Timezone-less ISO by PLAIN REGEX, deliberately NOT z.iso.datetime(): the
// app's pinned datetime convention is `toISOString().slice(0, 19)` (see
// repository.saveSnapshot), so 'Z'-suffixed or offset datetimes are rejected.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-MM-dd');
const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'expected timezone-less yyyy-MM-ddTHH:mm:ss');

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
  payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual', 'none']),
  firstPurchase: isoDate,
  createdAt: isoDateTime,
  maturity: isoDate.optional(),
  // `couponAmount` is the LEGACY stored ₴ figure; `couponRatePct` is what the
  // form asks for since D119. Both optional, and a file may carry either, both
  // or neither. Additive does NOT mean the version stays: `couponRatePct` ships
  // in the same commit as its writer, so no deployed build has it declared, and
  // `strictObject` refuses it by field name. That is what moved the version to 3.
  couponAmount: z.number().optional(),
  // BOUNDED LIKE THE FORM BOUNDS IT. `optionalPercent` refuses 0, a negative and
  // anything over 100, and a backup is the other door onto the same field — the
  // "two doors disagreeing" failure the `units` comment below is about. A stored
  // 0 or negative is worse than wrong, it is INERT: `couponPerPayment` gates on
  // `rate > 0`, so it silently falls back to the legacy amount and no screen ever
  // says why. A 250 scales every coupon figure the asset produces by 2.5.
  couponRatePct: z.number().positive().max(100).optional(),
  nextCoupon: isoDate.optional(),
  reinvestPolicy: z.string().optional(),
  // Asset.inzhur (P2 feat/asset-form) — field names mirror core/types.ts
  // exactly: { kind: 'fund' | 'bond'; ref: string; units: number }.
  inzhur: z
    .strictObject({
      kind: z.enum(['fund', 'bond']),
      ref: z.string().min(1),
      // OPTIONAL since D117, POSITIVE when present — and the pair is the merge
      // rather than either side. A link made after 2026-08-31 carries no count
      // at all (units are `Σ transaction.quantity`), while one made before it
      // carries the last number the removed field held, so a backup must read
      // both. But the form never accepted 0 or a negative, and a hand-edited
      // backup that slipped one past would be read by `matchAssets` as a count
      // it KNOWS — stamping the row `no-position` and skipping it in silence.
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
  ]),
  assetId: z.string(), // '' = portfolio-level rows (deposit/withdrawal)
  // Positive magnitude — the sign is carried by the TxType (every ledger
  // derivation assumes this; the form path enforces it via amountInputSchema).
  // A negative amount here would double-flip signs in netDeposits/
  // freeCashFromLedger, silently corrupting globalRoi and the drift check.
  amount: z.number().positive(),
  source: z.enum(['own', 'accrual', 'reinvest_reit', 'reinvest_6475']),
  // ISSUE #31. OPTIONAL IN BOTH DIRECTIONS, and both directions matter:
  // `buildBackup` passes transactions through unchanged, so a strictObject
  // without these would reject a backup the app had just written — and every
  // row recorded before they existed carries neither, so requiring them would
  // reject every ROW the app has. Optional in the SCHEMA is not the same as
  // additive in the FORMAT: the version moved to 2 all the same (D113), because
  // an older build declares neither key and its `strictObject` refuses the file
  // on `unrecognized_keys` — see `BACKUP_FORMAT_VERSION` for why that refusal
  // had to be made to say what it is.
  quantity: z.number().positive().optional(),
  unitPrice: z.number().positive().optional(),
  // W7's `transaction_tax_sign_ck` is `> 0`, and `.positive()` is it. The other
  // two rules need the row's type and its amount, so they are in the refinement
  // below rather than here.
  taxWithheld: z.number().positive().optional(),
  // `transaction_note_ck` — 1..100, NULL the only spelling of none. THE EMPTY
  // STRING IS REFUSED RATHER THAN NORMALIZED, which is the opposite of what the
  // form does with the same value and deliberately so: the form is where a
  // blank field becomes an absent one, so a `''` arriving here came from a
  // hand-edited file, and repairing it silently would be this door validating
  // one thing and storing another.
  // ONE REFINEMENT FOR THE WHOLE RULE, and the reason is arithmetic rather than
  // taste: any two of `.min(1)`, `.max(100)` and a trim check can fail TOGETHER
  // and report one row twice. `.min(1)` beside the trim did it for an empty
  // note; `.max(100)` beside it does it for a hundred and one spaces. One
  // predicate cannot.
  //
  // It carries a MESSAGE, unlike the row-level refinements below, and may: the
  // rule against English here is about `detail` reaching a localised report,
  // and `note-length` renders from `import-labels.ts` without reading it. What
  // the message serves is `parseBackup`'s own English contract, which prints it
  // — and which said "Invalid input" while this had none.
  //
  // A note of spaces is refused rather than trimmed away, because the ledger
  // draws a second line for any note that is not ABSENT, so such a row would
  // render a blank one for nobody. The form turns whitespace into absence; by
  // this door a blank note is a hand-edited file.
  note: z
    .string()
    .refine((v) => v.trim().length > 0 && [...v].length <= 100, {
      message: 'a note needs 1 to 100 characters of text',
    })
    .optional(),
});

/**
 * THE IMPORT BOUNDARY ENFORCES W7's `transaction_quantity_absent_ck` TOO.
 *
 * `transactionSchema` (the form) and `unitDelta` (the derivation) both already
 * do — and that was the bug: two different predicates decided whether an asset
 * HAS a unit count (`quantity !== undefined`) and what that count IS
 * (`movesPosition`). A hand-edited backup with `quantity` on an `interest_payout`
 * row created the key and then contributed 0 to it, valuing the whole position
 * at ₴0.00. One predicate, applied at every door.
 */
const transactionRowsSchema = z.array(transactionRowSchema).superRefine((rows, ctx) => {
  checkWithholding(rows, ctx);
  rows.forEach((row, i) => {
    if (movesPosition(row.type)) {
      // BOTH WAYS SINCE D125. A row that moves a position must carry its count,
      // at THIS door too and not only at the form's (D124) — because the form is
      // not the app's only writer. `CouponDueCard` builds a `reinvest` and hands
      // it straight to `recordTransaction`, so a count-less moving row could
      // still reach the store, and from there an export. A backup that refuses
      // what the store can hold would be worse than useless; this is the door
      // that makes the rule true of the DATA rather than of one form.
      //
      // `unitPrice` deliberately keeps only the one-way rule: it is derivable
      // from `amount / quantity`, so a row without it loses nothing, while a
      // row without the COUNT cannot be valued or scaled at all.
      if (row.quantity === undefined) {
        ctx.addIssue({ code: 'custom', path: [i, 'quantity'], params: { rule: 'missing' } });
      }
      return;
    }
    // BOTH fields, not just the count. A hand-edited `unitPrice` on an
    // `interest_payout` was accepted while `quantity` beside it was refused —
    // and the pair is what W7's two CHECKs govern together.
    for (const field of ['quantity', 'unitPrice'] as const) {
      if (row[field] === undefined) continue;
      // NO MESSAGE. This layer emits PATHS, never English (`src/core/README.md`,
      // D8): a message here is carried through as `issue.detail` and printed
      // verbatim into a report the rest of which is in the reader's language.
      // The words belong to `import-labels.ts`, which is why the `IssueCode`
      // vocabulary exists — this rule needed a code, not a sentence.
      ctx.addIssue({ code: 'custom', path: [i, field] });
    }
  });
});

/**
 * THE WITHHOLDING'S OTHER TWO CHECKS, at the door that guards the store.
 *
 * They are a separate refinement rather than more arms inside the one above
 * because that one is `return`-shaped around the quantity rule — a
 * position-moving row leaves it early — and a withholding is only ever legal on
 * the rows that rule returns past. Folding them together would make the
 * withholding's rules reachable only by accident of control flow.
 *
 * A MESSAGE IS ALLOWED HERE, and the rule it looks like it breaks is narrower
 * than it reads. What `src/core/README.md` forbids is English reaching a
 * LOCALISED report — which happens through `detail`, and only for the `invalid`
 * code that has no label of its own. These two map to codes `import-labels.ts`
 * renders, so their `detail` is never read. What the message serves is
 * `parseBackup`'s own English contract, which `useBackupDownload` puts in front
 * of the user when the export guard refuses a file: without one it says
 * "Invalid input" and names no rule.
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
    // STRICTLY below — `transaction_tax_bound_ck`. A withholding that is the
    // whole payout leaves nothing received.
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
    snapshots: snapshots.map((s) => (s.savedAt ? { ...s, savedAt: s.savedAt.slice(0, 19) } : s)),
    transactions,
    ...(settings ? { settings } : {}),
  };
}

export type ParseBackupResult =
  { ok: true; data: BackupEnvelope } | { ok: false; issues: string[] };

// --- Format-level gate (shared) --------------------------------------------
// The gate `parseBackup` has always applied, extracted in P4 so the import
// validator (core/backup/import.ts) dispatches on the same decision instead of
// re-deriving it: `code` is what the S4 report branches on, `issue` is the ONE
// verbatim sentence it prints as its mono technical-detail line. One
// implementation, so the two can never drift.
export type EnvelopeHeadCode =
  'not-json' | 'not-an-object' | 'not-a-backup' | 'unsupported-version';

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
  // Version gate BEFORE the row schemas so a newer backup gets one clear
  // message instead of a wall of field errors (P4 dispatches on this).
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
 * THE ASSET A PORTFOLIO-LEVEL ROW NAMES IS BLANKED, NOT REFUSED (D129) — the
 * same answer `transactionSchema` gives at the form.
 *
 * THE FILE THIS PROTECTS IS A **v5** ONE, and an earlier draft of this docblock
 * named the wrong population. It said every backup written before D129 carries a
 * real `assetId` on its deposits and refusing them would make those files
 * unimportable — true of the ids, false of the consequence: D129 also took
 * `BACKUP_FORMAT_VERSION` to 5, so a pre-D129 file never reaches this code. It
 * is refused by the version gate first.
 *
 * What DOES reach here is a file exported today from a store whose deposits
 * predate D129 — the owner's own, if they ever recorded one through the form.
 * Those rows are legitimate history carrying a value W7's
 * `transaction_asset_absent_ck` discards anyway, and refusing them would make
 * that store unable to back itself up. Blanking lands the row the way `seed.ts`
 * has always written one.
 *
 * IT IS NOT WHAT FIXES THE LEDGER. An earlier draft claimed blanking is what
 * stops a row reading «Внесок · REIT» on screen; that only ever applied to data
 * that had made a round trip through export and import. The renderer asks
 * `targetsAsset(tx.type)` directly, which is what makes the display right for
 * rows already in the store.
 *
 * AFTER `integrityIssues`, NEVER BEFORE, AND NOT IN THE ROW SCHEMA. As a
 * `.transform` on the rows it ran first, so a deposit naming an asset the file
 * does not carry was silently tidied instead of reported: the `unknown-asset-id`
 * branch was never reached. A dangling id is not a value to discard, it is
 * evidence the file lost an asset row — the one thing the referential pass
 * exists to say — and `integrityIssues` states that as its standing invariant.
 * So the order is: validate the file as written, then normalize what is stored.
 */
export function blankPortfolioAssetIds(env: BackupEnvelope): BackupEnvelope {
  return {
    ...env,
    transactions: env.transactions.map((t) => (targetsAsset(t.type) ? t : { ...t, assetId: '' })),
  };
}

// --- Structured row issues (D8) --------------------------------------------
// The envelope's own issue vocabulary: a location (table + row address +
// field) plus a CODE, never an English sentence — the S4 report renders the
// words (core/backup/import.ts maps zod issues onto the same shape, and
// screens/settings/import-labels.ts owns the copy). `parseBackup` keeps its
// P1 string contract by rendering these through `renderIssue` below.
export type IssueTable = 'assets' | 'snapshots' | 'transactions' | 'settings' | 'envelope';

export type IssueCode =
  | 'unknown-asset-id'
  | 'unknown-quote-asset'
  | 'duplicate-key'
  | 'unknown-key'
  | 'expected-datetime'
  | 'expected-date'
  | 'expected-positive-amount'
  /** `quantity` / `unitPrice` on a row that moves no position (#31, D112). */
  | 'units-on-non-position-row'
  /** No `quantity` on a row that DOES move a position (D125) — the converse. */
  | 'units-missing-on-position-row'
  /**
   * No `assetId` on a row that BELONGS to one — W7's
   * `transaction_asset_present_ck`, widened from four types to six. Renamed
   * from `asset-missing-on-position-row` with that widening: a code naming
   * four types while firing on six is exactly what this vocabulary exists to
   * prevent.
   */
  | 'asset-missing-on-asset-row'
  /** `taxWithheld` on one of the six types that carry none. */
  | 'withholding-on-non-payout-row'
  /** `taxWithheld` that is not strictly below its own row's `amount`. */
  | 'withholding-above-amount'
  /** `note` empty, whitespace-only, or over 100 characters. */
  | 'note-length'
  | 'invalid';

export interface RowIssue {
  table: IssueTable;
  /** Row address — a snapshot date, a transaction id, or an array index. */
  at?: string;
  /** Field inside the row, or the primary-key name for a duplicate. */
  field?: string;
  code: IssueCode;
  /** The offending value the sentence quotes (an id, a date, a key list). */
  value?: string;
  /** Verbatim validator message — rendered only by the 'invalid' fallback. */
  detail?: string;
}

// Post-parse referential integrity — schema-valid rows can still contradict
// each other; nothing orphaned or ambiguous may pass (standing invariant).
// Duplicate primary keys join the pass in P4: a duplicated asset/transaction
// id survives the row schemas, silently collapses in the id set, and would
// then abort `replaceAll`'s bulkAdd with an opaque ConstraintError instead of
// a row-addressed reason.
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
    // TWO QUESTIONS ABOUT ONE FIELD, and `!== ''` only ever asked the first. An
    // empty id is legitimate on a portfolio-level row and meaningless on a
    // position-moving one, so skipping the whole check for it let
    // `{ type: 'buy', assetId: '' }` through — the shape `transactionSchema`
    // refuses at the form and `transaction_asset_present_ck` rejects at
    // migration, rendering meanwhile as «Купівля · Портфель».
    //
    // `targetsAsset` NOW, and it used to be `movesPosition`. The looseness was
    // deliberate and its reason is spent. The FORM asked for an asset on a
    // `tax` and both payout types while `transaction_asset_present_ck` required
    // one on none of the three — and a backup that refuses what the store can
    // legitimately hold cannot be written at all, since the export re-reads its
    // own output, so the day anything put `{ type: 'tax', assetId: '' }` into
    // Dexie a stricter rule here would have locked the database out of
    // exporting before a wipe. That was D126's deadlock.
    //
    // All three legs of it are gone: the type is retired, the CHECK widens to
    // six so the store and the form finally agree, and no fixture produces an
    // asset-less payout. What would be left if this door stayed loose is worse
    // than asymmetry — a withholding is attributed by the row's OWN asset, so an
    // imported payout naming none would carry one past attribution and then fail
    // the CHECK at migration.
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

// The P1 string form of an integrity issue — kept byte-identical so
// `parseBackup`'s contract (and its fixtures) never moved.
//
// THESE SENTENCES ARE NOT THE UI COPY, and the duplication is not an oversight:
// `import-labels.ts` owns the localised words for the S4 report, this owns a
// frozen English contract for `parseBackup`'s string result. A code with a
// sentence in both places has it written twice on purpose, and rewording one
// does not reword the other. (The export guard's toast still shows THIS string
// in a Ukrainian-default app — a pre-existing wart of every code here, not
// D129's to fix.)
function renderIssue(i: RowIssue): string {
  const at = i.at ? `${i.table}.${i.at}` : i.table;
  switch (i.code) {
    case 'unknown-asset-id':
      return `${at}: unknown assetId '${i.value ?? ''}'`;
    case 'unknown-quote-asset':
      return `${at}: quote for unknown asset '${i.value ?? ''}'`;
    case 'asset-missing-on-asset-row':
      // The honest inversion. Naming the six types that must carry one reads
      // worse than naming the two that must not.
      return `${at}: only a deposit or a withdrawal may omit an asset`;
    case 'duplicate-key':
      return `${at}: duplicate ${i.field ?? 'key'} '${i.value ?? ''}' (${i.field ?? 'key'} is the primary key)`;
    default:
      return `${[at, i.field].filter(Boolean).join('.')}: ${i.detail ?? i.code}`;
  }
}
