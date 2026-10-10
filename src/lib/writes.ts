// The repository's writes as `POST /mutations` ops (*Cloud target*). A builder is pure and returns
// the list its write sends; `send` and `deleteAsset` are the calls, over the transport.
import { z } from 'zod';

import type { Op } from '@quirenote/core/ops';
import type { Asset, Transaction } from '@quirenote/core/types';

import type { Reply, Transport } from './transport';

/** What one op answered: the quotes `snapshot.patch` and `snapshot.move` dropped, and the rows
 *  `asset.prune` left. */
const resultSchema = z.object({
  dropped: z.array(z.string()).optional(),
  remaining: z.number().int().nonnegative().optional(),
});
export type OpResult = z.infer<typeof resultSchema>;

const writtenSchema = z.object({ etag: z.string().min(1), results: z.array(resultSchema) });

/** A write that landed, with the tag the next one goes under and each op's answer in the op's
 *  order, or the reply that says why it did not. */
export type WriteReply =
  { kind: 'written'; etag: string; results: OpResult[] } | Exclude<Reply, { kind: 'ok' }>;

/** The ops as one request under `tag`, the strong tag `/view` or the last write gave. */
export async function send(call: Transport, tag: string, ops: Op[]): Promise<WriteReply> {
  const reply = await call({
    method: 'POST',
    path: '/mutations',
    body: JSON.stringify({ ops }),
    headers: { 'if-match': tag },
    keyed: true,
  });
  if (reply.kind !== 'ok') return reply;
  const written = writtenSchema.safeParse(reply.body);
  return written.success
    ? { kind: 'written', ...written.data }
    : { kind: 'failed', status: reply.status, body: reply.body };
}

// The store has no column for the legacy unit count, and its door refuses the key.
const linkOf = ({ kind, ref }: NonNullable<Asset['inzhur']>) => ({ kind, ref });

/** The asset as the store keeps it: `createdAt` cut at the second, as the backup cuts it, since the
 *  door takes no time zone and `toISOString()` writes one. */
const rowOf = (asset: Asset) => ({
  ...asset,
  createdAt: asset.createdAt.slice(0, 19),
  ...(asset.inzhur === undefined ? {} : { inzhur: linkOf(asset.inzhur) }),
});

/** A patch as RFC 7396 spells it: a member left `undefined`, which Dexie removed, is `null`, since
 *  JSON drops `undefined` and the merge would then keep the stored value. */
const removing = (patch: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]),
  );

/** A day's quotes as the drafts hold them. `stored` is the day as `/view` or `/view/day` served
 *  it: a quote it holds that the drafts left out is cleared with a `null`, since the patch merges
 *  and would keep it. The server stamps the witness time. */
export function saveSnapshotOps(
  date: string,
  quotes: Readonly<Record<string, number>>,
  stored: Readonly<Record<string, number>>,
): Op[] {
  const cleared = Object.keys(stored).filter((id) => !Object.hasOwn(quotes, id));
  const patch: Record<string, number | null> = Object.fromEntries([
    ...Object.entries(quotes),
    ...cleared.map((id): [string, null] => [id, null]),
  ]);
  return [{ op: 'snapshot.patch', date, patch: { quotes: patch } }];
}

/** The asset, when the transaction creates it, goes first: the transaction names it. */
export function recordTransactionOps(transaction: Transaction, newAsset?: Asset): Op[] {
  return [
    ...(newAsset === undefined ? [] : addAssetOps(newAsset)),
    { op: 'transaction.add', transaction },
  ];
}

export function addAssetOps(asset: Asset): Op[] {
  return [{ op: 'asset.add', asset: rowOf(asset) }];
}

export function updateAssetOps(id: string, patch: Partial<Asset>): Op[] {
  const link = patch.inzhur === undefined ? {} : { inzhur: linkOf(patch.inzhur) };
  return [{ op: 'asset.patch', id, patch: { ...removing(patch), ...link } }];
}

export function updateTransactionOps(id: string, patch: Partial<Transaction>): Op[] {
  return [{ op: 'transaction.patch', id, patch: removing(patch) }];
}

export function deleteTransactionOps(id: string): Op[] {
  return [{ op: 'transaction.delete', id }];
}

export function deleteSnapshotOps(date: string): Op[] {
  return [{ op: 'snapshot.delete', date }];
}

export function moveSnapshotOps(from: string, to: string): Op[] {
  return [{ op: 'snapshot.move', from, to }];
}

/** There is no reseed: the dataset is new and empty. */
export function clearOps(): Op[] {
  return [{ op: 'dataset.clear' }];
}

/** Every changed target in one list, so that the save lands whole or not at all and costs one of
 *  the route's two requests a second. */
export function saveTargetsOps(targets: readonly { id: string; targetPct: number }[]): Op[] {
  return targets.flatMap(({ id, targetPct }) => updateAssetOps(id, { targetPct }));
}

const rowsRefused = z.object({ error: z.literal('too_many_rows') });

/** The asset and its rows, or, past the bound one request may change, the asset emptied in steps
 *  and then deleted. A step is a write of its own under the tag the last gave, so it ends at the
 *  first reply that is not a write, and at a count that does not fall, which would ask again for
 *  ever. */
export async function deleteAsset(call: Transport, tag: string, id: string): Promise<WriteReply> {
  const first = await send(call, tag, [{ op: 'asset.delete', id }]);
  if (first.kind !== 'failed' || !rowsRefused.safeParse(first.body).success) return first;
  // The refusal changed nothing, so the first step goes under the tag the delete did.
  let current = tag;
  let before = Infinity;
  do {
    const step = await send(call, current, [{ op: 'asset.prune', id }]);
    if (step.kind !== 'written') return step;
    current = step.etag;
    const remaining = step.results[0]?.remaining;
    if (remaining === undefined || remaining >= before) {
      return { kind: 'failed', status: 200, body: step.results };
    }
    before = remaining;
  } while (before > 0);
  return send(call, current, [{ op: 'asset.delete', id }]);
}
