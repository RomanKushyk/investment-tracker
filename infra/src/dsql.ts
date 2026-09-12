// One connection to the cluster, for the two handlers that need one.
//
// It lived inside `capture.ts` while capture was the only thing that talked to
// DSQL. The migration runner is the second, and a second copy of this would be
// a second `ssl` policy and a second answer to which environment variable names
// the endpoint — both of which are the kind of divergence that is discovered on
// the cluster rather than in a test.
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

export async function connect(): Promise<Client> {
  const hostname = process.env.DSQL_ENDPOINT!;
  const region = process.env.AWS_REGION_NAME ?? process.env.AWS_REGION!;

  // IAM auth: the token is the password and is short-lived, so it is minted per
  // invocation and never stored. This is also why the browser can never talk to
  // DSQL directly — it cannot hold AWS credentials — and why every read and
  // write goes through Lambda by construction.
  const token = await new DsqlSigner({ hostname, region }).getDbConnectAdminAuthToken();

  const client = new Client({
    host: hostname,
    port: 5432,
    database: 'postgres', // DSQL provides exactly one database per cluster
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}
