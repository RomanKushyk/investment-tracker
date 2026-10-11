// The backup over the API: the export is `GET /state`, the import the staged routes (*Cloud
// target*). The repository calls its requests, and the Settings rows and the import dialog reach
// those through `src/hooks/queries.ts`.
import { z } from 'zod';

import {
  assetRecordSchema,
  priceRowSchema,
  transactionRecordSchema,
} from '@quirenote/core/backup/json';
import type { StagedImport } from '@quirenote/core/backup/parts';
import { snapshotsOfPrices } from '@quirenote/core/valuation';

import type { Reply, Transport } from './transport';

type Ok = Extract<Reply, { kind: 'ok' }>;
type Refusal = Exclude<Reply, { kind: 'ok' }>;
/** A 412 is the commit's answer alone, and it is `ImportReply`'s own `conflict`. */
type Failed = Exclude<Refusal, { kind: 'conflict' }>;

const stateSchema = z.object({
  assets: z.array(assetRecordSchema),
  transactions: z.array(transactionRecordSchema),
  prices: z.array(priceRowSchema),
});

/** The dataset as `GET /state` answers it, with the tag a write or a commit goes under. */
export type ExportedState = z.infer<typeof stateSchema> & { etag: string };

export type ExportReply = ({ kind: 'exported' } & ExportedState) | Refusal;

const misread = ({ status, body }: Ok): Failed => ({ kind: 'failed', status, body });

export async function exportState(call: Transport): Promise<ExportReply> {
  const reply = await call({ method: 'GET', path: '/state' });
  if (reply.kind !== 'ok') return reply;
  const state = stateSchema.safeParse(reply.body);
  return state.success && reply.etag !== undefined
    ? { kind: 'exported', ...state.data, etag: reply.etag }
    : misread(reply);
}

/** The tables the CSV files are cut from. A day is a day the prices record, as the JSON backup
 *  reads them, and never one `/view`'s series carries an asset onto. */
export function csvTablesOf({ assets, transactions, prices }: ExportedState) {
  return { assets, transactions, snapshots: snapshotsOfPrices(transactions, prices) };
}

/** `conflict` is the commit's 412: another write landed since `tag` was read, and the import is
 *  still open under `id` for the caller to commit under the new tag or abort. */
export type ImportReply =
  { kind: 'imported'; etag: string } | { kind: 'conflict'; id: string } | Failed;

const begunSchema = z.object({ id: z.uuid() });
const committedSchema = z.object({ etag: z.string().min(1) });

/** Any other route answering 412 breaks the contract, so it is a failure like the rest. */
const refused = (reply: Refusal): Failed =>
  reply.kind === 'conflict' ? { kind: 'failed', status: 412 } : reply;

export async function abortImport(
  call: Transport,
  id: string,
): Promise<{ kind: 'aborted' } | Failed> {
  const reply = await call({ method: 'DELETE', path: `/imports/${id}` });
  return reply.kind === 'ok' ? { kind: 'aborted' } : refused(reply);
}

/** The import closed, since the driver goes no further with it, and the answer returned: a part the
 *  route refused stages nothing, so the manifest can no longer be met. */
async function aborted(call: Transport, id: string, reply: Refusal): Promise<Failed> {
  await abortImport(call, id);
  return refused(reply);
}

/** Commits the staged import under `tag`. A 5xx may follow a commit that landed, and a commit sent
 *  again answers 200 with the tag, so one is sent once more before the import is given up. */
export async function commitImport(call: Transport, id: string, tag: string): Promise<ImportReply> {
  const commit = () =>
    call({ method: 'POST', path: `/imports/${id}/commit`, headers: { 'if-match': tag } });
  let reply = await commit();
  if (reply.kind === 'failed' && (reply.status ?? 0) >= 500) reply = await commit();
  if (reply.kind === 'conflict') return { kind: 'conflict', id };
  if (reply.kind !== 'ok') return aborted(call, id, reply);
  const committed = committedSchema.safeParse(reply.body);
  return committed.success
    ? { kind: 'imported', etag: committed.data.etag }
    : aborted(call, id, misread(reply));
}

/** Replaces the dataset with the staged import: begun, every part put in order after the one
 *  before answered, then committed under `tag`. A failure the driver cannot recover from closes
 *  the import. */
export async function replaceDataset(
  call: Transport,
  tag: string,
  { manifest, parts }: StagedImport,
): Promise<ImportReply> {
  const begun = await call({ method: 'POST', path: '/imports', body: JSON.stringify(manifest) });
  if (begun.kind !== 'ok') return refused(begun);
  const open = begunSchema.safeParse(begun.body);
  if (!open.success) return misread(begun);
  const { id } = open.data;
  for (const part of parts) {
    const staged = await call({
      method: 'PUT',
      path: `/imports/${id}/parts/${part.number}`,
      body: part.body,
      headers: { 'content-digest': `sha-256=:${part.digest}:` },
    });
    if (staged.kind !== 'ok') return aborted(call, id, staged);
  }
  return commitImport(call, id, tag);
}
