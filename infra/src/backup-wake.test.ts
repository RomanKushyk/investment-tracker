import { describe, expect, it, vi } from 'vitest';

import { handler, wake } from './backup-wake';
import { connect } from './dsql';
import type { SqlClient } from './migrate';

vi.mock('./dsql', async (actual) => ({
  ...(await actual<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

/** Records every statement; `failOn` makes that one reject, as an unreachable cluster would. */
const recording = (failOn?: string) => {
  const sent: string[] = [];
  const client: SqlClient = {
    query: async (text: string) => {
      sent.push(text);
      if (text === failOn) throw new Error(`refused: ${text}`);
      return { rows: [] };
    },
  };
  return { client, sent };
};

describe('wake', () => {
  // READ-ONLY AND ROLLED BACK: the session is the whole point, so it writes nothing it would
  // have to answer for on a cluster that holds every user's data.
  it('opens one read-only transaction, selects one and rolls it back', async () => {
    const { client, sent } = recording();
    await wake(client);
    expect(sent).toEqual(['START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK']);
  });

  // A WAKE THAT DID NOT HAPPEN MUST THROW: Lambda retries a failed asynchronous invocation, and
  // a swallowed error would spend tonight's backup on an Idle cluster.
  it.each(['START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK'])(
    'lets a failed %s out',
    async (statement) => {
      const { client } = recording(statement);
      await expect(wake(client)).rejects.toThrow(`refused: ${statement}`);
    },
  );
});

describe('handler', () => {
  it('lets a failed connection out', async () => {
    vi.mocked(connect).mockRejectedValueOnce(new Error('08006 connection refused'));
    await expect(handler()).rejects.toThrow('08006 connection refused');
  });

  it('closes the session after a wake', async () => {
    const { client, sent } = recording();
    const end = vi.fn(async () => {});
    vi.mocked(connect).mockResolvedValueOnce({ ...client, end } as never);
    await handler();
    expect(sent).toEqual(['START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK']);
    expect(end).toHaveBeenCalledTimes(1);
  });

  // The query's error is the one that says why; a disconnect failing after it must not replace it.
  it('closes the session after a failed query, and keeps the query’s error', async () => {
    const { client } = recording('SELECT 1');
    const end = vi.fn(async () => {
      throw new Error('disconnect failed');
    });
    vi.mocked(connect).mockResolvedValueOnce({ ...client, end } as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(handler()).rejects.toThrow('refused: SELECT 1');
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});
