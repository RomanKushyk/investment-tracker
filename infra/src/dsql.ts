// One connection to the cluster, for every handler that needs one. A second copy
// would be a second `ssl` policy and a second answer to which environment variable
// names the endpoint — a divergence discovered on the cluster rather than in a test.
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

export async function connect(): Promise<Client> {
  const hostname = process.env.DSQL_ENDPOINT!;
  const region = process.env.AWS_REGION_NAME ?? process.env.AWS_REGION!;

  // IAM auth: the token is the password and is short-lived, so it is minted per
  // invocation and never stored. It is also why the browser can never talk to DSQL
  // directly — it cannot hold AWS credentials — so every read and write goes via Lambda.
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
