import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clients: [] as Record<string, unknown>[],
  signers: [] as Record<string, unknown>[],
  open: vi.fn(async () => {}),
  readerToken: vi.fn(async () => 'reader-token'),
  adminToken: vi.fn(async () => 'admin-token'),
  session: vi.fn(),
  assume: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = mocks.open;
    constructor(options: Record<string, unknown>) {
      mocks.clients.push(options);
    }
  },
}));
vi.mock('@aws-sdk/dsql-signer', () => ({
  DsqlSigner: class {
    getDbConnectAuthToken = mocks.readerToken;
    getDbConnectAdminAuthToken = mocks.adminToken;
    constructor(options: Record<string, unknown>) {
      mocks.signers.push(options);
    }
  },
}));
vi.mock('@aws-sdk/credential-providers', () => ({ fromTemporaryCredentials: mocks.assume }));

const READER_ROLE = 'arn:aws:iam::123456789012:role/quirenote-backend-archive-reader';
const NOW = new Date('2026-10-05T12:00:00Z');
const session = (minutesLeft: number) => ({
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  expiration: new Date(NOW.getTime() + minutesLeft * 60_000),
});

// A fresh module per test: the reader's session is cached at module scope.
let dsql: typeof import('./dsql');
beforeEach(async () => {
  vi.resetModules();
  dsql = await import('./dsql');
  mocks.clients.length = 0;
  mocks.signers.length = 0;
  mocks.session.mockResolvedValue(session(60));
  mocks.assume.mockReturnValue(mocks.session);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('AWS_REGION_NAME', 'eu-north-1');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'quirenote-backend-user-prod-ViewFunction-AbC123');
  vi.stubEnv('DSQL_ENDPOINT', 'user.dsql.eu-north-1.on.aws');
  vi.stubEnv('ARCHIVE_ENDPOINT', 'archive.dsql.eu-north-1.on.aws');
  vi.stubEnv('ARCHIVE_READER_ROLE_ARN', READER_ROLE);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.open.mockReset();
  mocks.readerToken.mockClear();
  mocks.adminToken.mockClear();
  mocks.session.mockReset();
  mocks.assume.mockReset();
});

describe('connectAsArchiveReader', () => {
  // The reader's own token kind, signed by the reader role: an admin token for a custom role, or
  // the function's own credentials, is refused at the door.
  it('connects as archive_reader with a DbConnect token the assumed reader role signs', async () => {
    await dsql.connectAsArchiveReader();
    expect(mocks.assume).toHaveBeenCalledWith({
      params: {
        RoleArn: READER_ROLE,
        RoleSessionName: 'quirenote-backend-user-prod-ViewFunction-AbC123',
      },
      clientConfig: { region: 'eu-north-1' },
    });
    expect(mocks.signers).toEqual([
      {
        hostname: 'archive.dsql.eu-north-1.on.aws',
        region: 'eu-north-1',
        credentials: session(60),
      },
    ]);
    expect(mocks.readerToken).toHaveBeenCalledTimes(1);
    expect(mocks.adminToken).not.toHaveBeenCalled();
    expect(mocks.clients).toEqual([
      {
        host: 'archive.dsql.eu-north-1.on.aws',
        port: 5432,
        database: 'postgres',
        user: 'archive_reader',
        password: 'reader-token',
        ssl: { rejectUnauthorized: true },
      },
    ]);
  });

  it('assumes the reader role once while its session lasts, and again near its end', async () => {
    await dsql.connectAsArchiveReader();
    await dsql.connectAsArchiveReader();
    expect(mocks.session).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 56 * 60_000));
    await dsql.connectAsArchiveReader();
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });

  it('keeps the session after a transport failure, which a new one would not cure', async () => {
    mocks.open.mockRejectedValueOnce(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    );
    await dsql.connectAsArchiveReader().catch(() => undefined);
    await dsql.connectAsArchiveReader();
    expect(mocks.session).toHaveBeenCalledTimes(1);
  });

  // A role recreated, or its sessions revoked, refuses the kept session: the next connect assumes anew.
  it.each(['08006', '28000'])(
    'assumes the reader role again after a connect refused %s',
    async (code) => {
      mocks.open.mockRejectedValueOnce(Object.assign(new Error('access denied'), { code }));
      await dsql.connectAsArchiveReader().catch(() => undefined);
      await dsql.connectAsArchiveReader();
      expect(mocks.session).toHaveBeenCalledTimes(2);
    },
  );

  it('names the session archive-reader outside Lambda', async () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
    await dsql.connectAsArchiveReader();
    expect(mocks.assume.mock.calls[0][0].params.RoleSessionName).toBe('archive-reader');
  });

  // `28000`: the role is missing on the cluster, or no mapping admits the reader role. The log line
  // is the metric a filter will count once the reader's function exists.
  it('raises ArchiveReaderRefused on 28000, and logs the metric line', async () => {
    const refusal = Object.assign(new Error('unable to accept connection, access denied'), {
      code: '28000',
    });
    mocks.open.mockRejectedValueOnce(refusal);
    const thrown = await dsql.connectAsArchiveReader().catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(dsql.ArchiveReaderRefused);
    expect(thrown).toMatchObject({ name: 'ArchiveReaderRefused', code: '28000', cause: refusal });
    expect(vi.mocked(console.log).mock.calls).toEqual([
      [JSON.stringify({ metric: 'archiveReaderRefused', value: 1 })],
    ]);
  });

  // `08006` carries the same message and is IAM's denial or the wrong token kind, not the mapping.
  it.each([
    ['08006', 'unable to accept connection, access denied'],
    ['ECONNRESET', 'read ECONNRESET'],
  ])('passes a %s through untouched, uncounted', async (code, message) => {
    const other = Object.assign(new Error(message), { code });
    mocks.open.mockRejectedValueOnce(other);
    await expect(dsql.connectAsArchiveReader()).rejects.toBe(other);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('codeOf', () => {
  // A SQLSTATE or nothing: a code that is Node's, or no code at all, must not read as the server's.
  it.each([
    [Object.assign(new Error('x'), { code: '28000' }), '28000'],
    [Object.assign(new Error('x'), { code: '40001' }), '40001'],
    [Object.assign(new Error('x'), { code: 'ECONNRESET' }), undefined],
    [Object.assign(new Error('x'), { code: 'EPIPE' }), undefined],
    [Object.assign(new Error('x'), { code: 'XX000' }), 'XX000'],
    [Object.assign(new Error('x'), { code: 28000 }), undefined],
    [new Error('x'), undefined],
    ['28000', undefined],
  ])('reads %o as %s', (err, code) => {
    expect(dsql.codeOf(err)).toBe(code);
  });
});

describe('connect', () => {
  it('still connects to its own cluster as admin, with no role assumed', async () => {
    await dsql.connect();
    expect(mocks.assume).not.toHaveBeenCalled();
    expect(mocks.adminToken).toHaveBeenCalledTimes(1);
    expect(mocks.readerToken).not.toHaveBeenCalled();
    expect(mocks.signers).toEqual([
      { hostname: 'user.dsql.eu-north-1.on.aws', region: 'eu-north-1' },
    ]);
    expect(mocks.clients).toMatchObject([{ host: 'user.dsql.eu-north-1.on.aws', user: 'admin' }]);
  });
});
