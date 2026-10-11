// What this device keeps of the public feeds, in the browser's own storage: the last good Inzhur
// payload and its parse record (*Persistence today*). They name nothing of the account, so they are
// not behind the API and a sign-out leaves them. A value the browser refuses to hold, or hands back
// unreadable, is no cache: the feed is fetched again on a press.

export function readMeta<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeMeta(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or refused: the fetch that produced the value still stands.
  }
}
