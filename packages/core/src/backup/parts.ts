// The parts of a staged import, as a caller sends them: each row has been through the doors the
// routes apply to a row. A value no column takes passes them, and its part is the store's to
// refuse. The rules between rows are validateImport's (*Cloud target*). PURE: the rows in, the
// bytes and digests out.
import type { z } from 'zod';

import { MAX_BODY_BYTES } from '../ops';
import { targetsAsset } from '../types';
import { rowIssueCodes, type RowIssueCode } from './import';
import {
  assetRecordSchema,
  priceRowSchema,
  transactionRecordSchema,
  type BackupEnvelope,
  type RowIssue,
} from './json';

/** AWS's DSQL loading guidance: "Aim for transactions of a few hundred rows rather than
 *  thousands." The routes refuse a part past it, and the caller cuts there. */
export const MAX_PART_ROWS = 500;

/** One part as `PUT /imports/{id}/parts/{part}` takes it: `body` is the exact text to send, and
 *  `digest` the SHA-256 of its UTF-8 bytes in base64, `Content-Digest`'s `sha-256` (RFC 9530). */
export interface ImportPart {
  number: number;
  body: string;
  digest: string;
}

/** What `POST /imports` takes: each table's row count, and the SHA-256 in base64 of the parts' raw
 *  digests, in part order, joined. */
export interface ImportManifest {
  assets: number;
  transactions: number;
  prices: number;
  digest: string;
}

export interface StagedImport {
  manifest: ImportManifest;
  parts: ImportPart[];
}

/** The import's parts, or every fault a row door or an id finds, in the importer's codes. */
export type ImportParts = ({ ok: true } & StagedImport) | { ok: false; issues: RowIssue[] };

type Table = 'assets' | 'transactions' | 'prices';
type Row = readonly [Table, object];

// The shape the route folds, which its UUID door accepts in either case.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** The store has no column for the legacy unit count, and the door refuses the key. */
const stored = (asset: BackupEnvelope['assets'][number]) =>
  asset.inzhur === undefined
    ? asset
    : { ...asset, inzhur: { kind: asset.inzhur.kind, ref: asset.inzhur.ref } };

/** One row's faults: the door's, each id that is no uuid, the `rules` the door lacks, and a body of
 *  this row alone past the bound, which the route refuses 413 once the import has begun. A
 *  transaction is addressed by its id, as the importer addresses it, unless the id is the fault;
 *  the rest by their index. */
function rowIssues(
  table: Table,
  index: number,
  row: object,
  door: z.ZodType,
  ids: [field: string, id: string][],
  rules: RowIssueCode[] = [],
): RowIssue[] {
  const parsed = door.safeParse(row);
  const alone = new TextEncoder().encode(bodyOf([[table, row]])).length;
  const faults: RowIssueCode[] = [
    ...(parsed.success ? [] : rowIssueCodes(table, parsed.error.issues)),
    ...ids
      .filter(([, id]) => !UUID.test(id))
      .map(([field, value]) => ({ field, code: 'invalid' as const, value })),
    ...rules,
    ...(alone > MAX_BODY_BYTES ? [{ code: 'invalid' as const }] : []),
  ];
  const id = (row as { id?: string }).id;
  const named = table === 'transactions' && !faults.some((f) => f.field === 'id') && id;
  return faults.map((fault) => ({ table, at: named || String(index), ...fault }));
}

function bodyOf(chunk: readonly Row[]): string {
  const part: Record<string, object[]> = {};
  for (const [table, row] of chunk) (part[table] ??= []).push(row);
  return JSON.stringify(part);
}

/** The chunk as one body, or halved until each half's bytes fit, in order. One row is a part as it
 *  is: `rowIssues` has refused any that the bound cannot hold. */
function fitted(chunk: readonly Row[]): { body: string; bytes: Uint8Array<ArrayBuffer> }[] {
  const body = bodyOf(chunk);
  const bytes = new TextEncoder().encode(body);
  if (chunk.length === 1 || bytes.length <= MAX_BODY_BYTES) return [{ body, bytes }];
  const half = chunk.length >> 1;
  return [...fitted(chunk.slice(0, half)), ...fitted(chunk.slice(half))];
}

/** The file's rows, assets first, as parts of at most `MAX_PART_ROWS` rows and `MAX_BODY_BYTES`
 *  bytes, numbered from 1. A part may hold the last assets and the first rows naming them: the
 *  route stages a part's assets before its other tables. Nothing is built for a file a row door,
 *  an id or a row's size refuses, since a part the route refuses leaves the import uncommittable. */
export async function importParts(
  tables: Pick<BackupEnvelope, 'assets' | 'transactions' | 'prices'>,
): Promise<ImportParts> {
  const assets = tables.assets.map(stored);
  const issues = [
    ...assets.flatMap((a, i) => rowIssues('assets', i, a, assetRecordSchema, [['id', a.id]])),
    ...tables.transactions.flatMap((t, i) => {
      // As the route reads a row's asset: an asset row names one, a deposit or a withdrawal none.
      const names = t.assetId !== '';
      const takes = targetsAsset(t.type);
      return rowIssues(
        'transactions',
        i,
        t,
        transactionRecordSchema,
        [['id', t.id], ...(names && takes ? ([['assetId', t.assetId]] as [string, string][]) : [])],
        [
          ...(!names && takes
            ? [{ field: 'assetId', code: 'asset-missing-on-asset-row' as const }]
            : []),
          ...(names && !takes
            ? [{ field: 'assetId', code: 'invalid' as const, value: t.assetId }]
            : []),
        ],
      );
    }),
    ...tables.prices.flatMap((p, i) =>
      rowIssues('prices', i, p, priceRowSchema, [['assetId', p.assetId]]),
    ),
  ];
  if (issues.length > 0) return { ok: false, issues };

  const rows: Row[] = [
    ...assets.map((row): Row => ['assets', row]),
    ...tables.transactions.map((row): Row => ['transactions', row]),
    ...tables.prices.map((row): Row => ['prices', row]),
  ];
  const built = [];
  for (let from = 0; from < rows.length; from += MAX_PART_ROWS) {
    built.push(...fitted(rows.slice(from, from + MAX_PART_ROWS)));
  }
  const digests = await Promise.all(built.map(({ bytes }) => sha256(bytes)));
  const raw = new Uint8Array(digests.length * 32);
  digests.forEach((digest, i) => raw.set(digest, i * 32));

  return {
    ok: true,
    manifest: {
      assets: tables.assets.length,
      transactions: tables.transactions.length,
      prices: tables.prices.length,
      digest: base64(await sha256(raw)),
    },
    parts: built.map(({ body }, i) => ({
      number: i + 1,
      body,
      digest: base64(digests[i]),
    })),
  };
}
