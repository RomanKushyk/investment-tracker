// The op vocabulary of `POST /mutations`, shared by the API and the client that builds the ops
// (*Cloud target*). Keys, never prose: a refused op is named in the import's codes.
import { z } from 'zod';

import { rowIssueCodes, type RowIssueCode, type ZodIssueLike } from './backup/import';
import {
  assetRecordSchema,
  priceRowSchema,
  snapshotPatchSchema,
  transactionRecordSchema,
} from './backup/json';

/** One request's bounds: DynamoDB's and Azure's batch size, and a body well within what Lambda takes. */
export const MAX_OPS = 100;
export const MAX_BODY_BYTES = 1024 * 1024;

export const OP_NAMES = [
  'asset.add',
  'asset.patch',
  'asset.delete',
  'asset.prune',
  'transaction.add',
  'transaction.patch',
  'transaction.delete',
  'snapshot.patch',
  'snapshot.delete',
  'snapshot.move',
  'dataset.clear',
] as const;

const id = z.string().min(1);
const patch = z.record(z.string(), z.unknown());
const date = priceRowSchema.shape.asOf;

export const opSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('asset.add'), asset: assetRecordSchema }),
  z.strictObject({ op: z.literal('asset.patch'), id, patch }),
  z.strictObject({ op: z.literal('asset.delete'), id }),
  z.strictObject({ op: z.literal('asset.prune'), id }),
  z.strictObject({ op: z.literal('transaction.add'), transaction: transactionRecordSchema }),
  z.strictObject({ op: z.literal('transaction.patch'), id, patch }),
  z.strictObject({ op: z.literal('transaction.delete'), id }),
  z.strictObject({ op: z.literal('snapshot.patch'), date, patch: snapshotPatchSchema }),
  z.strictObject({ op: z.literal('snapshot.delete'), date }),
  z.strictObject({ op: z.literal('snapshot.move'), from: date, to: date }),
  z.strictObject({ op: z.literal('dataset.clear') }),
]);

export type Op = z.infer<typeof opSchema>;

const ROW_TABLE = { asset: 'assets', transaction: 'transactions' } as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An op's own key, by the schema the op it names gives it: a day is a day by the date schema. */
const schemaAt = (op: unknown, key: string): unknown => {
  const name = isObject(op) ? op.op : undefined;
  const option = opSchema.options.find((o) => o.shape.op.value === name);
  return option === undefined ? undefined : (option.shape as Record<string, unknown>)[key];
};

/** The table an op's faults below `head` are coded as: an added row's, or a snapshot's patch, which
 *  its schema validates as it comes, where an asset's or a transaction's is merged first. */
function rowTableAt(
  op: unknown,
  head: unknown,
): 'assets' | 'transactions' | 'snapshots' | undefined {
  if (head === 'patch') return isObject(op) && op.op === 'snapshot.patch' ? 'snapshots' : undefined;
  if (typeof head !== 'string' || !Object.hasOwn(ROW_TABLE, head)) return undefined;
  return ROW_TABLE[head as keyof typeof ROW_TABLE];
}

/** An op's faults: a row's below the row, in the import's codes; the op's own at its key. */
export function opIssues(issues: readonly ZodIssueLike[], op: unknown): RowIssueCode[] {
  return issues.flatMap((issue) => {
    const [head, ...rest] = issue.path;
    const table = rowTableAt(op, head);
    if (table !== undefined) return rowIssueCodes(table, [{ ...issue, path: rest }]);
    const field = issue.path.map(String).join('.');
    const keys = Array.isArray(issue.keys) ? issue.keys.map(String) : [];
    return [
      {
        ...(field === '' ? {} : { field }),
        code:
          issue.code === 'unrecognized_keys'
            ? 'unknown-key'
            : issue.path.length === 1 && schemaAt(op, field) === date
              ? 'expected-date'
              : 'invalid',
        ...(keys.length > 0 ? { value: keys.join(', ') } : {}),
      },
    ];
  });
}

/** RFC 7396: a member set to null is removed, two objects merge member by member, and anything else
 *  replaces. A fresh value; the target is not written. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    // An assignment to it would set the result's prototype rather than a member.
    if (key === '__proto__') throw new RangeError('a merge patch never names __proto__');
    if (value === null) delete out[key];
    else out[key] = mergePatch(Object.hasOwn(out, key) ? out[key] : undefined, value);
  }
  return out;
}
