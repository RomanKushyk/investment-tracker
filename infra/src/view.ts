// `GET /view`, `buildView` for six periods and the day's rate, and its two siblings, the yield curve
// and the Balances table, too wide to send whole: one gate and one read (*Cloud target*).
//
// The tag is WEAK, a wall-clock day being an input (RFC 9110 §8.8.3), so no `If-Match` accepts it;
// COMPOSED, since under `no-cache` a body hash would rebuild the body to answer a 304.
import { createHash } from 'node:crypto';

import { kyivDateIso } from '@quirenote/core/dates';
import { PERIOD_OPTIONS, type PeriodOption } from '@quirenote/core/period';
import {
  archiveSpan,
  balancesBody,
  seriesBody,
  viewBody,
  type ServedRows,
} from '@quirenote/core/view/serve';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import { connect, connectAsArchiveReader } from './dsql';
import {
  INTERNAL,
  PRECONDITION_FAILED,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  derived,
  headerValues,
  notModified,
  respond,
  strongMatch,
  weakMatch,
} from './http';
import { dataTag, readLedger } from './ledger';
import type { SqlClient } from './migrate';
import { createOfficialRate, type StoredRate } from './official-rate';
import { readPaymentDates, readSellObservations } from './sell-observations';

export const ROUTE = 'GET /view';
export const SERIES_ROUTE = 'GET /view/series';
export const BALANCES_ROUTE = 'GET /view/balances';

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
    etag: '"<data_version>"',
  },
});
const SERIES = derived({
  statusCode: 200,
  name: 'series',
  headers: ['etag', 'cache-control', 'derivation-id'],
  example: { period: '3m', series: [{ date: '2026-10-06', '<asset id>': 4.21 }] },
});
const BALANCES = derived({
  statusCode: 200,
  name: 'balances',
  headers: ['etag', 'cache-control', 'derivation-id'],
  example: {
    assets: ['<asset id>'],
    rows: [
      {
        date: '2026-10-06',
        cells: [{ status: 'value', amount: 15846.3 }],
        cash: 7.75,
        total: 15854.05,
      },
    ],
    page: 0,
    total: 174,
    next: 1,
  },
});
/** RFC 9110 §15.4.5: the validator and the cache policy a 200 would carry, and no body. */
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });
/** A `period` or `page` the route cannot read, by name: a stale tab's retired period is the known one. */
const INVALID_QUERY = derived({
  statusCode: 400,
  name: 'invalid_query',
  headers: [],
  example: { error: 'invalid_query', issues: [{ field: 'period', code: 'invalid', value: '1y' }] },
});

/** What the route can answer, and the only list of it — `openapi.ts` builds the document from here,
 *  and `view.test.ts` proves it against what the route really answers. */
const READ = [
  UNCHANGED,
  PENDING,
  REJECTED,
  NO_APPLICATION,
  FORBIDDEN,
  PRECONDITION_FAILED,
  INTERNAL,
] as const;
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [ROUTE]: [VIEWED, ...READ],
  [SERIES_ROUTE]: [SERIES, INVALID_QUERY, ...READ],
  [BALANCES_ROUTE]: [BALANCES, INVALID_QUERY, ...READ],
};

type Parameter = {
  name: string;
  in: 'header' | 'query';
  required: boolean;
  description?: string;
  schema: { type: string; enum?: readonly string[]; minimum?: number; maximum?: number };
};
/** The two preconditions a request may carry: neither is required. */
const PRECONDITIONS: Parameter[] = [
  { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
  { name: 'If-Match', in: 'header', required: false, schema: { type: 'string' } },
];
/** What each route's request may carry, for the document. */
export const PARAMETERS: Record<string, Parameter[]> = {
  [ROUTE]: PRECONDITIONS,
  [SERIES_ROUTE]: [
    {
      name: 'period',
      in: 'query',
      required: true,
      schema: { type: 'string', enum: PERIOD_OPTIONS },
    },
    ...PRECONDITIONS,
  ],
  [BALANCES_ROUTE]: [
    {
      name: 'page',
      in: 'query',
      required: false,
      // An integer schema carries no pattern, so the one spelling `pageOf` takes is stated here.
      description: 'Digits with no sign or leading zero; none is the first page.',
      schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
    ...PRECONDITIONS,
  ],
};

const refused = (field: string, value: string | undefined): ApiResult =>
  respond(
    INVALID_QUERY,
    {},
    JSON.stringify({
      error: 'invalid_query',
      issues: [{ field, code: 'invalid', ...(value === undefined ? {} : { value }) }],
    }),
  );

/** Required and from core's list: a period no longer on it is refused, never read as another. */
const periodOf = (event: ApiEvent): PeriodOption | ApiResult => {
  const value = event.queryStringParameters?.period;
  return PERIOD_OPTIONS.find((p) => p === value) ?? refused('period', value);
};

/** One spelling per page — digits, no sign, no leading zero — so one page has one URL. */
const PAGE = /^(0|[1-9][0-9]*)$/;
/** The first page when none is named, as AIP-158 reads a request with no token. */
const pageOf = (event: ApiEvent): number | ApiResult => {
  const value = event.queryStringParameters?.page;
  if (value === undefined) return 0;
  const page = Number(value);
  return PAGE.test(value) && Number.isSafeInteger(page) ? page : refused('page', value);
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

type Headers = { etag: string; 'cache-control': string; 'derivation-id': string };
/** A route's part of the read: what joins the tag, so no period or page validates another, and its
 *  200 from the rows read, the rate served and the write's version. */
type Route = {
  variant: readonly unknown[];
  answer: (
    rows: ServedRows,
    fx: StoredRate | undefined,
    dataVersion: string,
    headers: Headers,
  ) => ApiResult;
};

export async function view(deps: ViewDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  switch (event.routeKey) {
    case ROUTE:
      return read(deps, event, () => ({
        variant: [],
        answer: (rows, fx, dataVersion, headers) =>
          respond(
            VIEWED,
            headers,
            // The strong tag a write sends back, beside this read's weak one (*Cloud target*).
            JSON.stringify({ ...viewBody({ ...rows, fx }), etag: dataTag(dataVersion) }),
          ),
      }));
    case SERIES_ROUTE:
      return read(deps, event, () => {
        const period = periodOf(event);
        return typeof period === 'object'
          ? period
          : {
              variant: [SERIES_ROUTE, period],
              answer: (rows, _fx, _version, headers) =>
                respond(SERIES, headers, JSON.stringify(seriesBody(rows, period))),
            };
      });
    case BALANCES_ROUTE:
      return read(deps, event, () => {
        const page = pageOf(event);
        return typeof page === 'object'
          ? page
          : {
              variant: [BALANCES_ROUTE, page],
              answer: (rows, _fx, _version, headers) =>
                respond(BALANCES, headers, JSON.stringify(balancesBody(rows, page))),
            };
      });
    default:
      console.error('view answered a route it does not serve', event.routeKey);
      return INTERNAL;
  }
}

/** The read the three routes share, each precondition answered before the route builds its body.
 *  The route's query is checked once the gate admits the caller (AIP-211), before the ledger. */
async function read(
  deps: ViewDeps,
  event: ApiEvent,
  routeOf: () => Route | ApiResult,
): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    const route = routeOf();
    if ('statusCode' in route) return route;

    const today = kyivDateIso(new Date(deps.now()));
    const ledger = await readLedger(deps.user, gate.caller.userId);
    const span = archiveSpan(ledger.assets, ledger.transactions, today);
    // Settled, not raced: the user connection ends once this answers, and a missing rate is being
    // stored on it.
    const [rated, archived] = await Promise.allSettled([
      deps.rate.served(deps.user, today),
      span === undefined ? undefined : readArchive(deps, span),
    ]);
    if (rated.status === 'rejected') {
      if (archived.status === 'rejected') {
        console.error('view archive read failed', archived.reason);
      }
      throw rated.reason;
    }
    if (archived.status === 'rejected') throw archived.reason;
    const [fx, archive] = [rated.value, archived.value];
    const etag = tagOf([
      gate.caller.userId,
      ledger.dataVersion,
      archive?.digest ?? null,
      archive?.datesDigest ?? null,
      fx?.rate ?? null,
      fx?.date ?? null,
      today,
      deps.derivationId,
      ...route.variant,
    ]);

    // RFC 9110 §13.2.2's order, If-Match first, each only once the answer would otherwise be a 200.
    const ifMatch = headerValues(event, 'if-match');
    if (ifMatch.length > 0 && !strongMatch(ifMatch, etag)) return PRECONDITION_FAILED;
    if (weakMatch(headerValues(event, 'if-none-match'), etag)) {
      return notModified(UNCHANGED, { etag, 'cache-control': CACHE_POLICY });
    }

    const rows: ServedRows = {
      assets: ledger.assets,
      transactions: ledger.transactions,
      userPrices: ledger.userPrices,
      archiveRows: archive?.rows ?? [],
      paymentDates: archive?.dates ?? [],
      today,
    };
    return route.answer(rows, fx, ledger.dataVersion, {
      etag,
      'cache-control': CACHE_POLICY,
      'derivation-id': deps.derivationId,
    });
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
