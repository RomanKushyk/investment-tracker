// Multi-tab safety for the whole-dataset writes (*Persistence today*). Browser
// APIs, so src/lib and never src/core.
//
// TWO INDEPENDENT JOBS. `withDbLock` serializes the whole-dataset writes across
// tabs: Dexie's rw transaction is atomic within ONE tab, so two tabs each running
// clear+bulkAdd interleave and leave a mix of both datasets, and only a lock
// orders them. `postDbSync`/`onDbSync` tell the other tabs what they hold is
// stale, and ONE channel object posts and subscribes, because a BroadcastChannel
// never delivers to its own poster — so the acting tab cannot toast at itself.

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
    // Node (vitest) keeps the event loop alive for an open channel; browsers have no unref.
    (channel as { unref?: () => void } | null)?.unref?.();
  }
  return channel;
}

export function postDbSync(kind: DbSyncKind): void {
  syncChannel()?.postMessage({ kind } satisfies DbSyncMessage);
}

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
 * The two-phase request — try `ifAvailable`, then wait — is what makes
 * `onBlocked` knowable at all; a plain request cannot tell "acquired instantly"
 * from "queued". Where Web Locks are unavailable the write still runs: a missing
 * lock is a missing safeguard, never a blocked feature.
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
