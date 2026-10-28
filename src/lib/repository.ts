// The client of the user API (*Cloud target*), over the transport: the one module that reads the
// portfolio and writes it. UI consumes it through hooks/queries.ts.
//
// A READ goes under the validator it was last answered with, and a 304 hands back what the caller
// held. A WRITE goes under the strong tag the view or the last write gave, one at a time, so a tab
// is never refused against its own tag, which a read sent before one of its writes landed does not
// move back; a tag another tab has moved is a 412, which is never retried. The caller reads the
// view again and decides. What a tab began for an account ends when the account changes.
import type { FundRef, Source } from '@quirenote/core/archive';
import type { StagedImport } from '@quirenote/core/backup/parts';
import type { PeriodOption } from '@quirenote/core/period';
import type { AccountSettings } from '@quirenote/core/settings';
import type { Asset, Transaction } from '@quirenote/core/types';
import type { BalancesBody, DayQuotes, SeriesBody, ViewBody } from '@quirenote/core/view/serve';

import { abortImport, exportState, replaceDataset, type ExportedState } from './backup';
import type { SettingsCopy } from './settings-copy';
import type { Reply, Transport } from './transport';
import {
  type CouponReopen,
  addAssetOps,
  clearOps,
  deleteAsset,
  deleteSnapshotOps,
  deleteTransactionOps,
  moveSnapshotOps,
  recordCouponOps,
  recordTransactionOps,
  saveSnapshotOps,
  saveTargetsOps,
  send,
  updateAssetOps,
  updateTransactionOps,
} from './writes';

export type Refusal = Exclude<Reply, { kind: 'ok' }>;
export type { CouponReopen };

/** What the API said when it did not do what was asked. */
export class ApiError extends Error {
  constructor(readonly reply: Refusal) {
    super(`the user API answered ${reply.kind}`);
    this.name = 'ApiError';
  }

  /** A 412: the dataset moved under the tag the write carried. Nothing was written. */
  get stale(): boolean {
    return this.reply.kind === 'conflict';
  }

  /** No ID token to send, one the API refused, or an account that changed under the call: the
   *  caller is not signed in as the account it asked for. */
  get signedOut(): boolean {
    return this.reply.kind === 'unauthorized';
  }
}

/** What the repository asks of the device's copy of the account's settings: the view is read through
 *  it, so each answer overwrites the copy, and the account ending reaches it. */
export type AccountCopy = Pick<SettingsCopy, 'read' | 'forget'>;
const noCopy: AccountCopy = { read: (load) => load(), forget() {} };

/** A read's body with the weak validator it came under, which the next read of it sends. */
export type Revalidated<T> = T & { validator?: string };

/** `GET /view`: the figures and the rows, the account's settings, and the strong tag a write goes
 *  under (the body's `etag`, named `tag` here beside the validator the header gave). */
export type ViewData = Revalidated<ViewBody> & { tag: string; settings: AccountSettings };
export type SeriesData = Revalidated<SeriesBody>;
export type BalancesData = Revalidated<BalancesBody>;
export type DayData = Revalidated<DayQuotes>;

/** `GET /me`: the caller's own account and what it holds. A field the API does not hold is absent. */
export interface MeBody {
  userId: string;
  email: string;
  role: 'user' | 'super_admin';
  memberSince: string;
  googleLinked: boolean;
  /** A password the account set itself; an invitation's, never replaced, is not one. */
  passwordSet: boolean;
  assets: number;
  transactions: number;
  firstTransaction?: string;
  settings: AccountSettings;
}
export type MeData = Revalidated<MeBody>;

/** One `(instrument_ref, basis, source)` group of `diagnose`'s reconciliation, as
 *  `infra/src/diagnose-reconciliation.ts` maps it: counts are Postgres text, and the measured
 *  fields are null when nothing was measured. `emptyDates` is the latest 100 of `emptyDays`. */
export interface ArchiveGroup {
  instrument_ref: string;
  basis: string;
  source: string;
  dates: string;
  measured_from: string | null;
  last_as_of: string | null;
  publishedDays: string | null;
  gaps: number | null;
  importedDays: string | null;
  emptyDays: number | null;
  emptyDates: string[] | null;
}

/** `GET /admin/archive/diagnosis`: the capture's `diagnose` answer, in the fields the panel reads. */
export interface ArchiveDiagnosis {
  size: { rows: string; total_bytes: string };
  bySource: { source: string; n: string; bytes: string }[];
  observations: ArchiveGroup[];
  sample: {
    as_of: string;
    instrument_ref: string;
    basis: string;
    price: string | null;
    ytm: string | null;
    clean_rate: string | null;
  }[];
}

/** A start of `POST /admin/archive/operations`, as its schema takes one. */
export type ArchiveStart =
  | { mode: 'observe'; source: Source; from: string; to: string }
  | { mode: 'importFundHistory'; refs: FundRef[] };

/** One run of `/admin/archive/operations`, as `operationOf` in `infra/src/archive-operations.ts`
 *  serves it: `parameters` as started, `result` the capture's own answer, and a run past its
 *  deadline read `failed`, reason `deadline_exceeded`. */
export interface ArchiveOperation {
  id: string;
  mode: ArchiveStart['mode'];
  parameters: Record<string, unknown>;
  state: 'running' | 'succeeded' | 'failed';
  startedBy: string;
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: { reason: string; message: string | null } | null;
}

/** One page of the list, newest first; `next` only while more follow. */
export interface ArchiveOperationsPage {
  operations: ArchiveOperation[];
  next?: string;
}

/** What a start came to. A refusal records no run, but for `startFailed`, which the log may show
 *  failed, and an answer that never came, after which the start may have landed. */
export type StartReply =
  | { kind: 'started'; operation: ArchiveOperation }
  | { kind: 'prodOnly' }
  | { kind: 'invalid'; issues: { field: string; code: string }[] }
  | { kind: 'startFailed' }
  | { kind: 'throttled' }
  | { kind: 'failed'; status: number }
  | { kind: 'offline' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// The body is the API's own, pinned by the derivation identifier; these keep a misread answer (an
// error page behind a 200) from reaching a screen as a portfolio.
const isView = (b: unknown): b is ViewBody & { etag: string; settings: AccountSettings } =>
  isObject(b) &&
  typeof b.etag === 'string' &&
  isObject(b.view) &&
  Array.isArray(b.assets) &&
  Array.isArray(b.transactions) &&
  isObject(b.today) &&
  isObject(b.deleteCounts) &&
  isObject(b.settings);
const isSeries = (b: unknown): b is SeriesBody =>
  isObject(b) && typeof b.period === 'string' && Array.isArray(b.series);
const isBalances = (b: unknown): b is BalancesBody =>
  isObject(b) && Array.isArray(b.assets) && Array.isArray(b.rows) && typeof b.page === 'number';
const isDay = (b: unknown): b is DayQuotes =>
  isObject(b) && typeof b.date === 'string' && isObject(b.quotes) && isObject(b.previous);
const isMe = (b: unknown): b is MeBody =>
  isObject(b) &&
  typeof b.userId === 'string' &&
  typeof b.role === 'string' &&
  typeof b.assets === 'number' &&
  typeof b.transactions === 'number' &&
  isObject(b.settings);
const isDiagnosis = (b: unknown): b is ArchiveDiagnosis =>
  isObject(b) &&
  isObject(b.size) &&
  Array.isArray(b.bySource) &&
  Array.isArray(b.observations) &&
  Array.isArray(b.sample);

const isOperation = (b: unknown): b is ArchiveOperation =>
  isObject(b) &&
  typeof b.id === 'string' &&
  typeof b.state === 'string' &&
  typeof b.startedAt === 'string' &&
  isObject(b.parameters);
const isOperationsPage = (b: unknown): b is ArchiveOperationsPage =>
  isObject(b) && Array.isArray(b.operations) && b.operations.every(isOperation);
const isIssue = (v: unknown): v is { field: string; code: string } =>
  isObject(v) && typeof v.field === 'string' && typeof v.code === 'string';

const NAMED_STATUS: Partial<Record<Refusal['kind'], number>> = {
  notModified: 304,
  inFlight: 409,
  conflict: 412,
  tooLarge: 413,
  keyReused: 422,
  invalidOp: 422,
  preconditionRequired: 428,
  unauthorized: 401,
  answer: 403,
};

/** The refusal a start's form shows, from the route's own answers (`RESPONSES` in
 *  `infra/src/archive-operations.ts`); any other is its status, or no answer. */
function startReplyOf(reply: Refusal): StartReply {
  if (reply.kind === 'throttled') return { kind: 'throttled' };
  // A kind the transport names from a status is a definite refusal, never a lost answer.
  const named = NAMED_STATUS[reply.kind];
  if (named !== undefined) return { kind: 'failed', status: named };
  if (reply.kind !== 'failed' || reply.status === undefined) return { kind: 'offline' };
  const body = isObject(reply.body) ? reply.body : {};
  if (reply.status === 405 && body.error === 'operations_prod_only') return { kind: 'prodOnly' };
  if (reply.status === 502 && body.error === 'start_failed') return { kind: 'startFailed' };
  if (reply.status === 422 && body.error === 'invalid_operation' && Array.isArray(body.issues)) {
    return { kind: 'invalid', issues: body.issues.filter(isIssue) };
  }
  return { kind: 'failed', status: reply.status };
}

export function createRepository(call: Transport, copy: AccountCopy = noCopy) {
  /** The strong tag the next write goes under; none until the view or an export has been read. */
  let tag: string | undefined;
  /** How many writes of this tab have landed: a read sent before one is older than the tag it gave. */
  let landed = 0;
  let queue: Promise<unknown> = Promise.resolve();
  /** How many times the account has changed under this tab. */
  let accounts = 0;

  /** The transport for an operation begun now: once the account changes it sends nothing more, and
   *  an answer that comes after is a 401's kind, since its tag, ops or file are the last account's. */
  function begun(): Transport {
    const at = accounts;
    return async (request) => {
      if (accounts !== at) return { kind: 'unauthorized' };
      const reply = await call(request);
      return accounts === at ? reply : { kind: 'unauthorized' };
    };
  }

  type Answer =
    | { unchanged: true }
    | { unchanged: false; body: unknown; status: number; validator: string | undefined };

  /** The body at `path`, or that it is unchanged since `validator`, which the 304 says. */
  async function get(path: string, validator: string | undefined): Promise<Answer> {
    const reply = await begun()({
      method: 'GET',
      path,
      ...(validator === undefined ? {} : { headers: { 'if-none-match': validator } }),
    });
    if (reply.kind === 'notModified' && validator !== undefined) return { unchanged: true };
    if (reply.kind !== 'ok') throw new ApiError(reply);
    return { unchanged: false, body: reply.body, status: reply.status, validator: reply.etag };
  }

  const misread = ({ status, body }: { status: number; body: unknown }) =>
    new ApiError({ kind: 'failed', status, body });

  /** The body at `path`, or `previous` itself when the API answers that it is unchanged. */
  async function revalidate<T extends object>(
    path: string,
    previous: Revalidated<T> | undefined,
    accept: (body: unknown) => body is T,
  ): Promise<Revalidated<T>> {
    const answer = await get(path, previous?.validator);
    if (answer.unchanged) return previous as Revalidated<T>;
    if (!accept(answer.body)) throw misread(answer);
    return answer.validator === undefined
      ? answer.body
      : { ...answer.body, validator: answer.validator };
  }

  /** A write has landed, and its tag is the one the next goes under. */
  function moveTag(etag: string): void {
    tag = etag;
    landed += 1;
  }

  /** One write at a time, whatever the one before came to. */
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  /** The tag a write goes under: the last the view or a write gave, and, where this tab holds none
   *  (it has read no view since the account changed), the dataset's own from the export. */
  async function tagged(op: Transport): Promise<string> {
    if (tag !== undefined) return tag;
    const state = await exportState(op);
    if (state.kind !== 'exported') throw new ApiError(state);
    return (tag = state.etag);
  }

  async function write(ops: Parameters<typeof send>[2]): Promise<void> {
    // Begun when asked, not when its turn comes: a write queued behind another is still the
    // account's it was asked for.
    const op = begun();
    await exclusive(async () => {
      const reply = await send(op, await tagged(op), ops);
      if (reply.kind !== 'written') throw new ApiError(reply);
      moveTag(reply.etag);
    });
  }

  return {
    readView: (previous?: ViewData): Promise<ViewData> =>
      // Through the copy, whether the API sent the view or said it is unchanged: the settings it
      // holds are the account's either way.
      copy.read(async () => {
        // An older read never moves the tag back: one sent before a write of this tab landed is
        // answered for a dataset that write has changed.
        const sentAt = landed;
        const answer = await get('/view', previous?.validator);
        if (answer.unchanged) {
          const held = previous as ViewData;
          if (landed === sentAt) tag = held.tag;
          return held;
        }
        if (!isView(answer.body)) throw misread(answer);
        const { etag, ...rest } = answer.body;
        if (landed === sentAt) tag = etag;
        return {
          ...rest,
          tag: etag,
          ...(answer.validator === undefined ? {} : { validator: answer.validator }),
        };
      }),
    readSeries: (period: PeriodOption, previous?: SeriesData) =>
      revalidate(`/view/series?period=${period}`, previous, isSeries),
    readBalances: (page: number, previous?: BalancesData) =>
      revalidate(`/view/balances?page=${page}`, previous, isBalances),
    readDay: (date: string, previous?: DayData) =>
      revalidate(`/view/day?date=${date}`, previous, isDay),
    /** The account's own read, asked for by the screen that shows it and never on a load. */
    readMe: (previous?: MeData) => revalidate('/me', previous, isMe),
    /** The super-admin's diagnosis of the price archive, read on a press only and sent once: each
     *  arrival executes the observe window's payloads (`infra/src/capture.ts`, `diagnose`). */
    readArchiveDiagnosis: async (): Promise<ArchiveDiagnosis> => {
      const reply = await begun()({ method: 'GET', path: '/admin/archive/diagnosis', once: true });
      if (reply.kind !== 'ok') throw new ApiError(reply);
      if (!isDiagnosis(reply.body)) throw misread(reply);
      return reply.body;
    },
    /** One page of the archive's runs, ten to a page, from `cursor` on. */
    readArchiveOperations: async (cursor?: string): Promise<ArchiveOperationsPage> => {
      const query = cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const reply = await begun()({
        method: 'GET',
        path: `/admin/archive/operations?limit=10${query}`,
      });
      if (reply.kind !== 'ok') throw new ApiError(reply);
      if (!isOperationsPage(reply.body)) throw misread(reply);
      return reply.body;
    },
    /** Starts a repair, sent once (*Cloud target*): each start is a run of its own, so the operator
     *  repeats one, never the transport. A refusal comes back for its form, never thrown. */
    startArchiveOperation: async (start: ArchiveStart): Promise<StartReply> => {
      const reply = await begun()({
        method: 'POST',
        path: '/admin/archive/operations',
        body: JSON.stringify(start),
        once: true,
      });
      if (reply.kind !== 'ok') return startReplyOf(reply);
      // A 2xx the client cannot read may still have recorded the run: as no answer, check the log.
      if (!isOperation(reply.body)) return { kind: 'offline' };
      return { kind: 'started', operation: reply.body };
    },

    /** Replaces the day's quotes with the drafts: a quote the day holds that they left out is
     *  cleared. `stored` is the day as the view served it. */
    saveSnapshot: (date: string, quotes: Record<string, number>, stored: Record<string, number>) =>
      write(saveSnapshotOps(date, quotes, stored)),
    recordTransaction: (tx: Transaction, newAsset?: Asset) =>
      write(recordTransactionOps(tx, newAsset)),
    /** The payout, its reinvest and the asset's roll, which land whole or not at all. */
    recordCoupon: (payout: Transaction, reinvest?: Transaction, nextCoupon?: string) =>
      write(recordCouponOps(payout, reinvest, nextCoupon)),
    addAsset: (asset: Asset) => write(addAssetOps(asset)),
    updateAsset: (id: string, patch: Partial<Asset>) => write(updateAssetOps(id, patch)),
    /** The targets of every changed asset in one request: they land whole or not at all. */
    saveTargets: (targets: readonly { id: string; targetPct: number }[]) =>
      write(saveTargetsOps(targets)),
    /** THE ASSET, ITS TRANSACTIONS AND ITS PRICES, past one request's row bound in steps. */
    async deleteAsset(id: string): Promise<void> {
      const op = begun();
      await exclusive(async () => {
        const reply = await deleteAsset(op, await tagged(op), id);
        if (reply.kind !== 'written') throw new ApiError(reply);
        moveTag(reply.etag);
      });
    },
    updateTransaction: (id: string, patch: Partial<Transaction>) =>
      write(updateTransactionOps(id, patch)),
    deleteTransaction: (id: string, reopen?: CouponReopen) =>
      write(deleteTransactionOps(id, reopen)),
    deleteSnapshot: (date: string) => write(deleteSnapshotOps(date)),
    /** Refused onto a day that holds prices, and from one that holds none. */
    moveSnapshotDate: (from: string, to: string) => write(moveSnapshotOps(from, to)),
    /** The erase: a new, empty dataset, with nothing put back. */
    clearAll: () => write(clearOps()),

    /** Merges the fields into the account's settings (RFC 7396): it names what changed and the rest
     *  stays as stored. It is no write of the dataset, so it goes under no tag and no key, moves
     *  none and waits for no write; the merge applied twice leaves one state. */
    async patchSettings(fields: Partial<AccountSettings>): Promise<void> {
      const reply = await begun()({
        method: 'PATCH',
        path: '/me/settings',
        headers: { 'content-type': 'application/merge-patch+json' },
        body: JSON.stringify(fields),
      });
      if (reply.kind !== 'ok') throw new ApiError(reply);
    },

    /** The dataset as the API holds it now, with the tag it is at. It moves no tag of this tab: a
     *  write goes under what the view this tab shows was read at, never under a newer one. */
    async exportState(): Promise<ExportedState> {
      const state = await exportState(begun());
      if (state.kind !== 'exported') throw new ApiError(state);
      return state;
    },

    /** Stages the file's parts and commits them under `etag`, the tag of the export the person
     *  confirmed the replacement against. A commit another write has overtaken is closed and comes
     *  back as `conflict`, for the caller to show the new difference. */
    replaceAll(etag: string, plan: StagedImport): Promise<'imported' | 'conflict'> {
      const op = begun();
      return exclusive(async () => {
        const reply = await replaceDataset(op, etag, plan);
        if (reply.kind === 'imported') {
          moveTag(reply.etag);
          return 'imported';
        }
        if (reply.kind === 'conflict') {
          await abortImport(op, reply.id);
          return 'conflict';
        }
        throw new ApiError(reply);
      });
    },

    /** The account has changed: nothing held for it is the next one's, and nothing begun for it
     *  goes on. */
    forget(): void {
      tag = undefined;
      accounts += 1;
      copy.forget();
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
