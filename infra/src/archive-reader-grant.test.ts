import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './__fixtures__/pglite';
import {
  beyondReading,
  CONFLICT_ATTEMPTS,
  CONNECT_ATTEMPTS,
  grantReader,
  handler,
  OBJECT_CHECKS,
  OWNED,
  READER,
  UNREAD,
} from './archive-reader-grant';
import { connect } from './dsql';
import type { SqlClient } from './migrate';

vi.mock('./dsql', async (actual) => ({
  ...(await actual<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const ARN_A = 'arn:aws:iam::123456789012:role/quirenote-backend-archive-reader';
const ARN_B = 'arn:aws:iam::123456789012:role/quirenote-backend-archive-reader-2';
const TABLES = ['price_capture', 'price_observation', 'instrument', 'bond_terms'];
const props = (arn = ARN_A) => ({ ReaderRoleArn: arn });

// Real PostgreSQL, so each privilege is judged by catalog logic, not a stand-in: PGlite runs 18 and
// DSQL 16, so a privilege added after 16, MAINTAIN, is one DSQL cannot grant.
// The role and all it is given live inside one transaction, rolled back, as the fixture requires.
describe('beyondReading', () => {
  /** What the check finds in the provider's outcome with `setup` applied, all of it rolled back. */
  const found = async (setup: string) => {
    const db = await freshDb();
    await db.exec('BEGIN');
    try {
      await db.exec(`
        CREATE ROLE archive_reader WITH LOGIN;
        CREATE TABLE price_capture (id int PRIMARY KEY, price numeric);
        GRANT SELECT ON price_capture TO archive_reader;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO archive_reader;`);
      if (setup) await db.exec(setup);
      return await beyondReading(db as unknown as SqlClient);
    } finally {
      await db.exec('ROLLBACK');
    }
  };

  // The summary of access privileges, https://www.postgresql.org/docs/16/ddl-priv.html: every
  // object type that carries a privilege, each with a check or a reason it needs none.
  it('covers every object type PostgreSQL keeps privileges on', () => {
    expect(Object.keys(OBJECT_CHECKS).sort()).toEqual(
      [
        'DATABASE',
        'DOMAIN',
        'FUNCTION or PROCEDURE',
        'FOREIGN DATA WRAPPER',
        'FOREIGN SERVER',
        'LANGUAGE',
        'LARGE OBJECT',
        'PARAMETER',
        'SCHEMA',
        'SEQUENCE',
        'TABLE',
        'Table column',
        'TABLESPACE',
        'TYPE',
      ].sort(),
    );
    const none = Object.entries(OBJECT_CHECKS).filter(([, c]) => typeof c !== 'string');
    expect(none.map(([kind]) => kind).sort()).toEqual(['DOMAIN', 'LANGUAGE', 'TYPE']);
  });

  it('finds nothing in a reader that only reads', async () => {
    expect(await found('')).toEqual([]);
  });

  it.each([
    [
      'an INSERT on a table',
      'GRANT INSERT ON price_capture TO archive_reader',
      /can write public\.price_capture/,
    ],
    [
      'a DELETE on a table',
      'GRANT DELETE ON price_capture TO archive_reader',
      /can write public\.price_capture/,
    ],
    [
      'an UPDATE on a column',
      'GRANT UPDATE (price) ON price_capture TO archive_reader',
      /can write public\.price_capture/,
    ],
    [
      'a write through PUBLIC',
      'GRANT INSERT ON price_capture TO PUBLIC',
      /can write public\.price_capture/,
    ],
    [
      'a grant option on the table',
      'GRANT SELECT ON price_capture TO archive_reader WITH GRANT OPTION',
      /pass on its read of public\.price_capture/,
    ],
    [
      'a grant option on a column',
      'GRANT SELECT (price) ON price_capture TO archive_reader WITH GRANT OPTION',
      /pass on its read of public\.price_capture/,
    ],
    ['a membership', 'CREATE ROLE writer; GRANT writer TO archive_reader', /member of writer/],
    [
      'CREATE on a schema',
      'CREATE SCHEMA extra; GRANT CREATE ON SCHEMA extra TO archive_reader',
      /create in extra/,
    ],
    [
      'a sequence',
      'CREATE SEQUENCE s; GRANT USAGE ON SEQUENCE s TO archive_reader',
      /advance or set public\.s/,
    ],
    [
      'a SECURITY DEFINER function',
      "CREATE FUNCTION f() RETURNS int LANGUAGE SQL SECURITY DEFINER AS 'SELECT 1'",
      /run f\(\) as its owner/,
    ],
    ['a role attribute', 'ALTER ROLE archive_reader CREATEROLE', /role attribute beyond LOGIN/],
    ['no LOGIN', 'ALTER ROLE archive_reader NOLOGIN', /cannot log in/],
    [
      'CREATE on the database',
      'GRANT CREATE ON DATABASE template1 TO archive_reader',
      /create in database template1/,
    ],
    [
      'CREATE on a tablespace',
      'GRANT CREATE ON TABLESPACE pg_default TO archive_reader',
      /create in tablespace pg_default/,
    ],
    [
      'ALTER SYSTEM on a parameter',
      'GRANT ALTER SYSTEM ON PARAMETER work_mem TO archive_reader',
      /alter the system setting work_mem/,
    ],
    [
      'a write on a large object',
      'SELECT lo_create(4242); GRANT UPDATE ON LARGE OBJECT 4242 TO archive_reader',
      /write large object 4242/,
    ],
    [
      'a large object it owns',
      'SELECT lo_create(4243); ALTER LARGE OBJECT 4243 OWNER TO archive_reader',
      /write large object 4243/,
    ],
    [
      'a foreign data wrapper',
      'CREATE FOREIGN DATA WRAPPER w; GRANT USAGE ON FOREIGN DATA WRAPPER w TO archive_reader',
      /use foreign data wrapper w/,
    ],
    [
      'a foreign server',
      'CREATE FOREIGN DATA WRAPPER w; CREATE SERVER sv FOREIGN DATA WRAPPER w; GRANT USAGE ON FOREIGN SERVER sv TO archive_reader',
      /use foreign server sv/,
    ],
    [
      'a global default',
      'ALTER DEFAULT PRIVILEGES GRANT INSERT ON TABLES TO archive_reader',
      /default in every schema gives it a on tables/,
    ],
    [
      'a default for PUBLIC',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO PUBLIC',
      /default in public gives PUBLIC a on tables/,
    ],
    [
      'a default on sequences',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO PUBLIC',
      /gives PUBLIC U on sequences/,
    ],
    [
      'a default on schemas',
      'ALTER DEFAULT PRIVILEGES GRANT CREATE ON SCHEMAS TO archive_reader',
      /gives it C on schemas/,
    ],
    [
      'a default with a grant option',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO archive_reader WITH GRANT OPTION',
      /default in public gives it r\* on tables/,
    ],
    [
      'a sequence read it can pass on',
      'CREATE SEQUENCE s; GRANT SELECT ON SEQUENCE s TO archive_reader WITH GRANT OPTION',
      /pass on its read of public\.s/,
    ],
    [
      'a schema use it can pass on',
      'CREATE SCHEMA extra; GRANT USAGE ON SCHEMA extra TO archive_reader WITH GRANT OPTION',
      /pass on its use of extra/,
    ],
    [
      'a function it owns',
      "CREATE FUNCTION g() RETURNS int LANGUAGE SQL AS 'SELECT 1'; ALTER FUNCTION g() OWNER TO archive_reader",
      /owns function g\(\)/,
    ],
    [
      'a domain it owns',
      'CREATE DOMAIN px AS numeric; ALTER DOMAIN px OWNER TO archive_reader',
      /owns type px/,
    ],
    [
      'a table it cannot read',
      'CREATE TABLE bond_terms (id int); REVOKE SELECT ON bond_terms FROM archive_reader',
      /cannot read public\.bond_terms/,
    ],
  ])('finds %s', async (_, setup, named) => {
    const beyond = await found(setup);
    expect(
      beyond.some((f) => named.test(f)),
      JSON.stringify(beyond),
    ).toBe(true);
  });

  // Each of these names an object, or shapes the reader's own session, and writes nothing.
  it.each([
    [
      'USAGE on a type',
      "CREATE TYPE mood AS ENUM ('calm'); GRANT USAGE ON TYPE mood TO archive_reader",
    ],
    [
      'USAGE on a domain',
      'CREATE DOMAIN price AS numeric; GRANT USAGE ON DOMAIN price TO archive_reader',
    ],
    ['SET on a parameter', 'GRANT SET ON PARAMETER work_mem TO archive_reader'],
    ['a plain function', "CREATE FUNCTION g() RETURNS int LANGUAGE SQL AS 'SELECT 1'"],
    [
      'a default EXECUTE on functions',
      'ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO archive_reader',
    ],
    ['a table created after the default', 'CREATE TABLE nbu_rate (id int)'],
  ])('finds nothing in %s', async (_, setup) => {
    expect(await found(setup)).toEqual([]);
  });
});

type Grant = [table: string, privilege: string];

/** Answers as the dev cluster did (`infra/docs/dsql-constraints.md`, *Roles and IAM mappings*); an
 *  unknown statement throws. `conflicts` refuses a statement `40001`, `committed` applies it first. */
function fakeCluster(
  seed: {
    login?: boolean;
    mappings?: string[];
    grants?: Grant[];
    beyond?: string[];
    tables?: string[];
    conflicts?: Record<string, number>;
    committed?: Record<string, number>;
  } = {},
) {
  const state = {
    login: seed.login,
    mappings: [...(seed.mappings ?? [])],
    grants: [...(seed.grants ?? [])],
    tables: [...(seed.tables ?? TABLES)],
    lost: [] as string[],
    conflicts: { ...seed.conflicts },
    committed: { ...seed.committed },
    statements: [] as string[],
  };
  const sqlError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const conflict = () => sqlError('40001', 'change conflicts with another transaction (OC000)');
  const reads = (t: string) => state.grants.some(([g, p]) => g === t && p === 'SELECT');
  const apply = (text: string) => {
    let m: RegExpMatchArray | null;
    if (text === `CREATE ROLE ${READER} WITH LOGIN`) {
      if (state.login !== undefined) throw sqlError('42710', `role "${READER}" already exists`);
      state.login = true;
    } else if (text === `ALTER ROLE ${READER} WITH LOGIN`) {
      state.login = true;
    } else if ((m = text.match(/^AWS IAM GRANT archive_reader TO '([^']+)'$/))) {
      if (!state.mappings.includes(m[1])) state.mappings.push(m[1]);
    } else if ((m = text.match(/^AWS IAM REVOKE archive_reader FROM '([^']+)'$/))) {
      const arn = m[1];
      if (!state.mappings.includes(arn))
        throw sqlError('42704', `IAM role "${arn}" does not exist`);
      state.mappings = state.mappings.filter((a) => a !== arn);
    } else if ((m = text.match(/^GRANT SELECT ON public\."(\w+)" TO archive_reader$/))) {
      // A grant the cluster takes and then loses, as one on a table admin does not own would be.
      if (!reads(m[1]) && !state.lost.includes(m[1])) state.grants.push([m[1], 'SELECT']);
    } else if (
      text !== 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO archive_reader'
    ) {
      throw new Error(`the fake cluster does not know: ${text}`);
    }
  };
  const query = (async (text: string) => {
    // A turn of the event loop per statement, so two runs interleave as two Lambdas would.
    await Promise.resolve();
    if ((state.conflicts[text] ?? 0) > 0) {
      state.conflicts[text]--;
      throw conflict();
    }
    if (text === 'SELECT 1 FROM pg_roles WHERE rolname = $1')
      return { rows: state.login === undefined ? [] : [{ '?column?': 1 }] };
    if (text.includes('rolcanlogin'))
      return {
        rows: state.login === undefined ? [] : [{ rolcanlogin: state.login, elevated: false }],
      };
    if (text.includes('FROM pg_auth_members') || text.includes('FROM pg_default_acl'))
      return { rows: [] };
    // The checks themselves are PostgreSQL's, tested above; one stands in here for what they find.
    if (text === OBJECT_CHECKS.TABLE)
      return { rows: (seed.beyond ?? []).map((found) => ({ found })) };
    if (Object.values(OBJECT_CHECKS).includes(text) || text === OWNED) return { rows: [] };
    if (text === UNREAD)
      return {
        rows: state.tables
          .filter((t) => !reads(t))
          .map((t) => ({ found: `it cannot read public.${t}` })),
      };
    if (text === 'SELECT arn FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1')
      return { rows: state.mappings.map((arn) => ({ arn })) };
    if (text.includes('FROM information_schema.role_table_grants'))
      return {
        rows: state.grants
          .filter(([, p]) => p === 'SELECT')
          .map(([table_name]) => ({ table_name })),
      };
    if (text === "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
      return { rows: state.tables.map((tablename) => ({ tablename })) };
    state.statements.push(text);
    apply(text);
    if ((state.committed[text] ?? 0) > 0) {
      state.committed[text]--;
      throw conflict();
    }
    return { rows: [] };
  }) as SqlClient['query'];
  return { state, query };
}

const CREATE = 'CREATE ROLE archive_reader WITH LOGIN';
const LOGIN = 'ALTER ROLE archive_reader WITH LOGIN';
const DEFAULT =
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO archive_reader';
const grants = (tables: string[]) =>
  tables.map((t) => `GRANT SELECT ON public."${t}" TO archive_reader`);

describe('grantReader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** A run with its backoff timers run out, so a retried statement costs no wall-clock time. */
  const granted = async (cluster: ReturnType<typeof fakeCluster>, given = props()) => {
    // Settled into a value before the timers run, so a refusal is never an unhandled rejection.
    const outcome = grantReader(cluster, given).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const { error } = await outcome;
    if (error !== undefined) throw error;
  };

  it('creates the role, grants SELECT on every table, present and future, then maps the reader', async () => {
    const cluster = fakeCluster();
    await granted(cluster);
    expect(cluster.state.statements).toEqual([
      CREATE,
      LOGIN,
      DEFAULT,
      ...grants(TABLES),
      `AWS IAM GRANT archive_reader TO '${ARN_A}'`,
    ]);
    expect(cluster.state.mappings).toEqual([ARN_A]);
  });

  // The tables are the capture's to create: a fresh archive's deploy runs before any capture has.
  it('succeeds on a cluster that holds no table yet, leaving the default to grant them', async () => {
    const cluster = fakeCluster({ tables: [] });
    await granted(cluster);
    expect(cluster.state.statements).toEqual([
      CREATE,
      LOGIN,
      DEFAULT,
      `AWS IAM GRANT archive_reader TO '${ARN_A}'`,
    ]);
  });

  // A mapping listed under the right ARN can still be stale, so the second run re-binds it.
  it('runs twice and never fails, re-binding the mapping and granting no table twice', async () => {
    const cluster = fakeCluster();
    await granted(cluster);
    cluster.state.statements.length = 0;
    await granted(cluster);
    expect(cluster.state.statements).toEqual([
      LOGIN,
      DEFAULT,
      `AWS IAM REVOKE archive_reader FROM '${ARN_A}'`,
      `AWS IAM GRANT archive_reader TO '${ARN_A}'`,
    ]);
  });

  // Lambda can deliver one event twice: both runs read the same mapping and revoke it.
  it('lets two runs of one event overlap and both succeed', async () => {
    const cluster = fakeCluster();
    await granted(cluster);
    const both = Promise.all([grantReader(cluster, props()), grantReader(cluster, props())]);
    await vi.runAllTimersAsync();
    await both;
    expect(cluster.state.mappings).toEqual([ARN_A]);
  });

  it('grants a table the capture created since the last run', async () => {
    const cluster = fakeCluster();
    await granted(cluster);
    cluster.state.tables.push('nbu_rate');
    cluster.state.statements.length = 0;
    await granted(cluster);
    expect(cluster.state.statements.slice(2, 3)).toEqual(grants(['nbu_rate']));
  });

  it('revokes the stale mapping and grants the new ARN when the reader ARN changes', async () => {
    const cluster = fakeCluster();
    await granted(cluster, props(ARN_A));
    cluster.state.statements.length = 0;
    await granted(cluster, props(ARN_B));
    expect(cluster.state.statements.slice(-2)).toEqual([
      `AWS IAM REVOKE archive_reader FROM '${ARN_A}'`,
      `AWS IAM GRANT archive_reader TO '${ARN_B}'`,
    ]);
    expect(cluster.state.mappings).toEqual([ARN_B]);
  });

  it('revokes every mapping the role holds but the current one, a hand-made one included', async () => {
    const stray = 'arn:aws:iam::123456789012:role/someone-else';
    const cluster = fakeCluster({ login: true, mappings: [stray, ARN_A] });
    await granted(cluster);
    expect(cluster.state.mappings).toEqual([ARN_A]);
    expect(cluster.state.statements).not.toContain(CREATE);
  });

  it('gives a role made some other way, without LOGIN, the LOGIN a mapping needs', async () => {
    const cluster = fakeCluster({ login: false });
    await granted(cluster);
    expect(cluster.state.login).toBe(true);
    expect(cluster.state.statements).not.toContain(CREATE);
  });

  // Failing closed: a reader that can do more than read keeps no mapping to connect by, and nothing
  // it holds is revoked, that being an admin's to remove.
  it('fails naming what the reader can do beyond reading, and leaves it no mapping', async () => {
    const cluster = fakeCluster({
      login: true,
      mappings: [ARN_A],
      beyond: ['it can write public.price_capture'],
    });
    await expect(granted(cluster)).rejects.toThrow(/can write public\.price_capture/);
    expect(cluster.state.mappings).toEqual([]);
    expect(cluster.state.statements.filter((s) => s.startsWith('AWS IAM GRANT'))).toEqual([]);
    expect(cluster.state.statements.filter((s) => /^REVOKE /.test(s))).toEqual([]);
  });

  it('fails on a public table its grant did not reach, and leaves it no mapping', async () => {
    const cluster = fakeCluster({ login: true, mappings: [ARN_A] });
    cluster.state.lost.push('bond_terms');
    await expect(granted(cluster)).rejects.toThrow(/cannot read public\.bond_terms/);
    expect(cluster.state.mappings).toEqual([]);
  });

  it('runs a statement again after a 40001, and gives up after the last attempt', async () => {
    const grant = `AWS IAM GRANT archive_reader TO '${ARN_A}'`;
    const once = fakeCluster({ conflicts: { [grant]: CONFLICT_ATTEMPTS - 1 } });
    await granted(once);
    expect(once.state.mappings).toEqual([ARN_A]);
    const always = fakeCluster({ conflicts: { [grant]: CONFLICT_ATTEMPTS } });
    await expect(granted(always)).rejects.toMatchObject({ code: '40001' });
  });

  // An attempt can commit and still answer `40001`; its retry then meets its own effect.
  it.each([
    ['CREATE ROLE', CREATE, {}],
    [
      'AWS IAM REVOKE',
      `AWS IAM REVOKE archive_reader FROM '${ARN_A}'`,
      { login: true, mappings: [ARN_A] },
    ],
  ])('takes a %s that committed before its 40001 as done', async (_, statement, seed) => {
    const cluster = fakeCluster({ ...seed, committed: { [statement]: 1 } });
    await granted(cluster);
    expect(cluster.state.mappings).toEqual([ARN_A]);
    expect(cluster.state.login).toBe(true);
  });

  it.each([
    ['another partition', 'arn:aws-us-gov:iam::123456789012:role/quirenote-backend-archive-reader'],
    ['a role path', 'arn:aws:iam::123456789012:role/service/quirenote-backend-archive-reader'],
  ])('takes a role ARN in %s', async (_, arn) => {
    const cluster = fakeCluster();
    await granted(cluster, props(arn));
    expect(cluster.state.mappings).toEqual([arn]);
  });

  it.each([
    ['a role ARN with a quote', props("arn:aws:iam::123456789012:role/x' OR '1")],
    ['a user ARN', props('arn:aws:iam::123456789012:user/roman')],
  ])('refuses %s before it sends a statement', async (_, given) => {
    const cluster = fakeCluster();
    await expect(granted(cluster, given)).rejects.toThrow(/role ARN/);
    expect(cluster.state.statements).toEqual([]);
  });
});

describe('handler', () => {
  const event = (RequestType: 'Create' | 'Update' | 'Delete', p = props()) => ({
    RequestType,
    ResponseURL:
      'https://cloudformation-custom-resource-response.example/presigned?X-Amz-Signature=x',
    StackId: 'arn:aws:cloudformation:eu-north-1:123456789012:stack/quirenote-backend/id',
    RequestId: 'request-1',
    LogicalResourceId: 'ArchiveReaderGrant',
    ResourceType: 'Custom::ArchiveReaderGrant',
    ...(RequestType === 'Create' ? {} : { PhysicalResourceId: READER }),
    ResourceProperties: { ServiceToken: 'arn:aws:lambda:…', ServiceTimeout: '600', ...p },
  });
  const put = vi.fn(async () => new Response(null, { status: 200 }));
  const end = vi.fn(async () => {});
  /** The one response CloudFormation reads, as the provider PUT it. */
  const answered = () => {
    expect(put).toHaveBeenCalledTimes(1);
    const [url, init] = put.mock.calls[0] as unknown as [string, RequestInit];
    const body = Buffer.from(init.body as Uint8Array).toString('utf8');
    return { url, init, body, json: JSON.parse(body) as Record<string, unknown> };
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', put);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(connect).mockReset();
    put.mockClear();
    end.mockReset();
  });

  it('answers SUCCESS to the presigned URL with the fields the protocol requires', async () => {
    const cluster = fakeCluster();
    vi.mocked(connect).mockResolvedValue({ query: cluster.query, end } as never);
    await handler(event('Create'));
    const { url, init, json } = answered();
    expect(url).toBe(event('Create').ResponseURL);
    expect(init.method).toBe('PUT');
    // No content type: the presigned URL was signed without one, as AWS's own `cfn-response` sends.
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    expect(json).toEqual({
      Status: 'SUCCESS',
      PhysicalResourceId: READER,
      StackId: event('Create').StackId,
      RequestId: 'request-1',
      LogicalResourceId: 'ArchiveReaderGrant',
    });
    expect(cluster.state.mappings).toEqual([ARN_A]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('answers FAILED naming what the reader can do beyond reading', async () => {
    const cluster = fakeCluster({ beyond: ['it can write public.bond_terms'] });
    vi.mocked(connect).mockResolvedValue({ query: cluster.query, end } as never);
    await handler(event('Update'));
    expect(answered().json).toMatchObject({
      Status: 'FAILED',
      Reason: expect.stringContaining('can write public.bond_terms'),
    });
  });

  it('answers an Update under the same physical id, so CloudFormation never reads it as a replacement', async () => {
    vi.mocked(connect).mockResolvedValue({ query: fakeCluster().query, end } as never);
    await handler(event('Update', props(ARN_B)));
    expect(answered().json.PhysicalResourceId).toBe(READER);
  });

  it('answers SUCCESS when the grant committed and the connection will not close', async () => {
    end.mockRejectedValueOnce(new Error('Connection terminated'));
    vi.mocked(connect).mockResolvedValue({ query: fakeCluster().query, end } as never);
    await handler(event('Create'));
    expect(answered().json.Status).toBe('SUCCESS');
  });

  it.each([
    ['an ASCII message', 'x'],
    ['a message of three-byte characters', 'ї'],
    ['a message of control characters', '\u0001'],
  ])(
    'answers FAILED with a reason that keeps the body within 4096 bytes, for %s',
    async (_, unit) => {
      const query = vi.fn(async () => {
        throw Object.assign(new Error(`permission denied ${unit.repeat(10_000)}`), {
          code: '42501',
        });
      });
      vi.mocked(connect).mockResolvedValue({ query, end } as never);
      await handler(event('Update'));
      const { body, json } = answered();
      expect(json.Status).toBe('FAILED');
      expect(json.PhysicalResourceId).toBe(READER);
      expect(String(json.Reason)).toMatch(/^Error: permission denied/);
      // The protocol's ceiling on the whole response body.
      expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(4096);
      expect(end).toHaveBeenCalledTimes(1);
    },
  );

  // A new stack's first connect can come before IAM carries the function's grant: `08006`, briefly.
  it('connects again after an 08006, and answers FAILED once the attempts run out', async () => {
    vi.useFakeTimers();
    try {
      const denied = () => Object.assign(new Error('access denied'), { code: '08006' });
      vi.mocked(connect)
        .mockRejectedValueOnce(denied())
        .mockResolvedValue({ query: fakeCluster().query, end } as never);
      const first = handler(event('Create'));
      await vi.runAllTimersAsync();
      await first;
      expect(answered().json.Status).toBe('SUCCESS');
      expect(connect).toHaveBeenCalledTimes(2);
      put.mockClear();
      vi.mocked(connect).mockReset().mockRejectedValue(denied());
      const second = handler(event('Create'));
      await vi.runAllTimersAsync();
      await second;
      expect(answered().json.Status).toBe('FAILED');
      expect(connect).toHaveBeenCalledTimes(CONNECT_ATTEMPTS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers FAILED when it cannot connect at all', async () => {
    vi.mocked(connect).mockRejectedValue(new Error('unable to accept connection'));
    await handler(event('Create'));
    expect(answered().json).toMatchObject({ Status: 'FAILED', PhysicalResourceId: READER });
  });

  // The role goes with the stack and the cluster stays, so a Delete has nothing to connect for.
  it('answers a Delete with SUCCESS and sends no statement', async () => {
    await handler(event('Delete'));
    expect(connect).not.toHaveBeenCalled();
    expect(answered().json).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: READER });
  });

  // Thrown, so Lambda's async retry sends the answer again while the event is young enough.
  it('throws when the response itself is refused', async () => {
    vi.mocked(connect).mockResolvedValue({ query: fakeCluster().query, end } as never);
    put.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(handler(event('Create'))).rejects.toThrow(/403/);
  });
});
