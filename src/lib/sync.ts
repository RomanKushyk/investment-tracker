// Multi-tab safety for the whole-dataset writes (P4 `feat/backup-import`,
// DECISIONS D24). Infra, not domain: Web Locks and BroadcastChannel are
// browser APIs and therefore belong in src/lib, never in src/core (G1).
//
// Two independent jobs:
//  1. `withDbLock` serializes replace/clear/reset ACROSS TABS. Dexie's own rw
//     transaction is atomic within one tab, but two tabs each running
//     clear+bulkAdd can interleave their transactions and leave a mix of both
//     datasets — a lock is the only thing that orders them.
//  2. `postDbSync` / `onDbSync` tell the OTHER tabs that everything they hold
//     is stale, so they invalidate their queries instead of showing rows that
//     no longer exist. ONE channel object does both: a BroadcastChannel never
//     delivers to the object that posted, so the acting tab cannot hear its
//     own message and toast at itself.
//
// The mirror file (P4 `feat/file-mirror`) takes the same lock — the file must
// never be rewritten from a half-applied dataset.

export const DB_LOCK = 'quirenote-db';
export const SYNC_CHANNEL = 'quirenote-sync';

/** What changed under the other tabs. Both mean "re-read everything". */
export type DbSyncKind = 'replace' | 'clear';

export interface DbSyncMessage {
  kind: DbSyncKind;
}

let channel: BroadcastChannel | null | undefined;

function syncChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SYNC_CHANNEL);
    // Node (vitest) keeps the event loop alive for an open channel; browsers
    // have no unref and need none.
    (channel as { unref?: () => void } | null)?.unref?.();
  }
  return channel;
}

export function postDbSync(kind: DbSyncKind): void {
  syncChannel()?.postMessage({ kind } satisfies DbSyncMessage);
}

/** Subscribe to other tabs' whole-dataset writes. Returns an unsubscribe. */
export function onDbSync(handler: (message: DbSyncMessage) => void): () => void {
  const bus = syncChannel();
  if (!bus) return () => {};
  const listener = (event: MessageEvent) => handler(event.data as DbSyncMessage);
  bus.addEventListener('message', listener);
  return () => bus.removeEventListener('message', listener);
}

/**
 * Run `write` while holding the app's single database lock.
 *
 * `onBlocked` fires only when another tab already holds it — the S3 dialog
 * swaps "Replacing…" for "Waiting for another tab…" on it. The two-phase
 * request (try `ifAvailable`, then wait) is what makes that knowable at all;
 * a plain request cannot tell "acquired instantly" from "queued".
 *
 * Where Web Locks are unavailable the write still runs: a missing lock is a
 * missing safeguard, never a blocked feature.
 */
export async function withDbLock<T>(write: () => Promise<T>, onBlocked?: () => void): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return write();

  const attempt = await locks.request(DB_LOCK, { ifAvailable: true }, async (lock) =>
    lock ? { held: true as const, value: await write() } : { held: false as const },
  );
  if (attempt.held) return attempt.value;

  onBlocked?.();
  return locks.request(DB_LOCK, write);
}
