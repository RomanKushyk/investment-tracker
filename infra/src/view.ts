// `GET /view` — `buildView` for all six periods and the day's rate, in one answer (*Cloud target*).
//
// The tag is WEAK, a wall-clock day being an input (RFC 9110 §8.8.3), so no `If-Match` accepts it;
// COMPOSED, since under `no-cache` a body hash would rebuild the body to answer a 304.
import { createHash } from 'node:crypto';

import { kyivDateIso } from '@quirenote/core/dates';
import { archiveSpan, viewBody } from '@quirenote/core/view/serve';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import { connect, connectAsArchiveReader } from './dsql';
import {
  INTERNAL,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  derived,
  headerValues,
  json,
  notModified,
  respond,
  strongMatch,
  weakMatch,
} from './http';
import { readLedger } from './ledger';
import type { SqlClient } from './migrate';
import { createOfficialRate, type StoredRate } from './official-rate';
import { readPaymentDates, readSellObservations } from './sell-observations';

export const ROUTE = 'GET /view';

/** Stored by the browser alone, and revalidated on every use. Not `must-revalidate`, which binds
 *  only a stale response and lets a shared cache reuse one sent with `Authorization` (RFC 9111
 *  §5.2.2.2). */
const CACHE_POLICY = 'private, no-cache';

/** What a script on another origin may read: neither is CORS-safelisted, and with credentials a
 *  `*` names a header called `*`. The template's `ExposeHeaders` is held to this. */
export const EXPOSED = ['derivation-id', 'etag'] as const;

const VIEWED = derived({
  statusCode: 200,
  name: 'view',
  headers: ['etag', 'cache-control', 'derivation-id'],
  example: {
    view: '<buildView: every screen, the windowed ones for each of the six periods>',
    fx: { rate: 41.4983, date: '2026-10-06' },
  },
});
/** RFC 9110 §15.4.5: the validator and the cache policy a 200 would carry, and no body. */
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });
const PRECONDITION_FAILED = json(412, '{"error":"precondition_failed"}');

/** What the route can answer, and the only list of it — `openapi.ts` builds the document from here,
 *  and `view.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [ROUTE]: [
    VIEWED,
    UNCHANGED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    PRECONDITION_FAILED,
    INTERNAL,
  ],
};

/** The two preconditions a request may carry, for the document: neither is required. */
export const PARAMETERS: Record<
  string,
  { name: string; in: string; required: boolean; schema: { type: string } }[]
> = {
  [ROUTE]: [
    { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
    { name: 'If-Match', in: 'header', required: false, schema: { type: 'string' } },
  ],
};

type ArchiveClient = SqlClient & { end(): Promise<void> };

export interface ViewDeps {
  user: SqlClient;
  /** Opened only for a ledger with something to read there, and closed by `view`. */
  archive: () => Promise<ArchiveClient>;
  rate: { served(client: SqlClient, today: string): Promise<StoredRate | undefined> };
  now: () => number;
  derivationId: string;
}

/** The build's identifier, read here rather than at module scope: `pnpm openapi` imports this
 *  module with no define. */
export const derivationId = (): string => __DERIVATION_ID__;

async function readArchive(deps: ViewDeps, span: NonNullable<ReturnType<typeof archiveSpan>>) {
  const client = await deps.archive();
  try {
    // In turn, on one connection. The span's funds find no terms: the capture writes none for one.
    const sell = await readSellObservations(client, span.refs, span.from, span.to);
    const terms = await readPaymentDates(client, span.refs, span.from, span.to);
    return { rows: sell.rows, digest: sell.digest, dates: terms.rows, datesDigest: terms.digest };
  } finally {
    await client
      .end()
      .catch((err: unknown) => console.error('view archive disconnect failed', err));
  }
}

/** Sound only while its inputs are complete. The caller is one: every `data_version` starts at 0,
 *  and a cache may revalidate a response it cannot choose (RFC 9111 §4.3.1). */
const tagOf = (inputs: readonly unknown[]): string =>
  `W/"${createHash('sha256').update(JSON.stringify(inputs), 'utf8').digest('base64url')}"`;

export async function view(deps: ViewDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;

    const today = kyivDateIso(new Date(deps.now()));
    const ledger = await readLedger(deps.user, gate.caller.userId);
    const span = archiveSpan(ledger.assets, ledger.transactions, today);
    // Settled, not raced: the user connection ends once this answers, and a missing rate is being
    // stored on it.
    const [rated, read] = await Promise.allSettled([
      deps.rate.served(deps.user, today),
      span === undefined ? undefined : readArchive(deps, span),
    ]);
    if (rated.status === 'rejected') {
      if (read.status === 'rejected') console.error('view archive read failed', read.reason);
      throw rated.reason;
    }
    if (read.status === 'rejected') throw read.reason;
    const [fx, archive] = [rated.value, read.value];
    const etag = tagOf([
      gate.caller.userId,
      ledger.dataVersion,
      archive?.digest ?? null,
      archive?.datesDigest ?? null,
      fx?.rate ?? null,
      fx?.date ?? null,
      today,
      deps.derivationId,
    ]);

    // RFC 9110 §13.2.2's order, If-Match first, each only once the answer would otherwise be a 200.
    const ifMatch = headerValues(event, 'if-match');
    if (ifMatch.length > 0 && !strongMatch(ifMatch, etag)) return PRECONDITION_FAILED;
    if (weakMatch(headerValues(event, 'if-none-match'), etag)) {
      return notModified(UNCHANGED, { etag, 'cache-control': CACHE_POLICY });
    }

    const body = viewBody({
      assets: ledger.assets,
      transactions: ledger.transactions,
      userPrices: ledger.userPrices,
      archiveRows: archive?.rows ?? [],
      paymentDates: archive?.dates ?? [],
      today,
      fx,
    });
    return respond(
      VIEWED,
      { etag, 'cache-control': CACHE_POLICY, 'derivation-id': deps.derivationId },
      JSON.stringify(body),
    );
  } catch (err) {
    // LOGGED, NOT RETURNED. An archive refusal has logged its own metric line already.
    console.error('view failed', err);
    return INTERNAL;
  }
}

// ONE READER PER EXECUTION ENVIRONMENT: NBU failing costs one slow fetch per environment every five
// minutes, not one per request.
const officialRate = createOfficialRate();

export async function handler(event: ApiEvent): Promise<ApiResult | EmptyResult> {
  const user = await connect().catch((err: unknown) => {
    console.error('view connect failed', err);
    return undefined;
  });
  if (user === undefined) return INTERNAL;

  try {
    return await view(
      {
        user,
        archive: connectAsArchiveReader,
        rate: officialRate,
        now: Date.now,
        derivationId: derivationId(),
      },
      event,
    );
  } finally {
    await user.end().catch((err: unknown) => console.error('view disconnect failed', err));
  }
}
