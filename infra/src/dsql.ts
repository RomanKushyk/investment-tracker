// One connection to the cluster, for every handler that needs one. A second copy
// would be a second `ssl` policy and a second answer to which environment variable
// names the endpoint — a divergence discovered on the cluster rather than in a test.
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

const regionOf = () => process.env.AWS_REGION_NAME ?? process.env.AWS_REGION!;

/** A SQLSTATE, or nothing. Node's errno codes, `EPIPE` among them, all begin with E, a letter no
 *  SQLSTATE class begins with. */
export const codeOf = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-DF-Z][0-9A-Z]{4}$/.test(code) ? code : undefined;
};

function client(hostname: string, user: string, token: string): Client {
  return new Client({
    host: hostname,
    port: 5432,
    database: 'postgres', // DSQL provides exactly one database per cluster
    user,
    password: token,
    ssl: { rejectUnauthorized: true },
  });
}

export async function connect(): Promise<Client> {
  const hostname = process.env.DSQL_ENDPOINT!;
  const region = regionOf();

  // IAM auth: the token is the password and is short-lived, so it is minted per
  // invocation and never stored. It is also why the browser can never talk to DSQL
  // directly — it cannot hold AWS credentials — so every read and write goes via Lambda.
  const token = await new DsqlSigner({ hostname, region }).getDbConnectAdminAuthToken();

  const c = client(hostname, 'admin', token);
  await c.connect();
  return c;
}

/** The archive turned the reader away with `28000`: `archive_reader` is missing there, or no
 *  mapping admits the reader role as it is now. An IAM denial answers `08006` instead. */
export class ArchiveReaderRefused extends Error {
  override name = 'ArchiveReaderRefused';
  readonly code = '28000';
}

type Credentials = Awaited<ReturnType<ReturnType<typeof fromTemporaryCredentials>>>;
let reader: { roleArn: string; credentials: Credentials } | undefined;

/** The reader role's session, kept for the life of the execution environment and assumed again
 *  within five minutes of its end, or after the archive refuses it. */
async function readerCredentials(roleArn: string, region: string): Promise<Credentials> {
  const ends = reader?.roleArn === roleArn ? reader.credentials.expiration?.getTime() : undefined;
  if (ends === undefined || ends - Date.now() < 5 * 60_000) {
    // Named for the function, so the archive's CloudTrail tells the two environments apart.
    const RoleSessionName = (process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'archive-reader').slice(0, 64);
    const assume = fromTemporaryCredentials({
      params: { RoleArn: roleArn, RoleSessionName },
      clientConfig: { region },
    });
    reader = { roleArn, credentials: await assume() };
  }
  return reader!.credentials;
}

/** The archive, read-only, from a user stack: `archive_reader`, with a `DbConnect` token signed by
 *  the reader role the ARCHIVE stack owns. Never admin. */
export async function connectAsArchiveReader(): Promise<Client> {
  const hostname = process.env.ARCHIVE_ENDPOINT!;
  const region = regionOf();
  const credentials = await readerCredentials(process.env.ARCHIVE_READER_ROLE_ARN!, region);
  const token = await new DsqlSigner({ hostname, region, credentials }).getDbConnectAuthToken();

  const c = client(hostname, 'archive_reader', token);
  try {
    await c.connect();
  } catch (err) {
    // A refused session is not kept: a role recreated, or its sessions revoked, needs a new one.
    // A transport failure keeps it, a new session being no cure for an unreachable cluster.
    const code = codeOf(err);
    if (code === '08006' || code === '28000') reader = undefined;
    if (code !== '28000') throw err;
    // The line is the metric, as the capture's are.
    console.log(JSON.stringify({ metric: 'archiveReaderRefused', value: 1 }));
    throw new ArchiveReaderRefused(
      'the archive refused archive_reader (28000): the role is missing there, or no mapping admits the reader role as it is now',
      { cause: err },
    );
  }
  return c;
}
