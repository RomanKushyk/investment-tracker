import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProxyOptions } from 'vite';

/** Beside the owner's other local secrets, outside the repository, so no commit can carry it. */
export const BYPASS_FILE = join(homedir(), '.quirenote', 'bot-check-bypass.txt');

/** The dev API's test bypass, when this machine holds it; none otherwise (*Auth model*). */
export function readBypass(): string | undefined {
  try {
    return readFileSync(BYPASS_FILE, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The relay admits only a same-site caller, which localhost is not; through the proxy it is
 *  same-origin. The bypass is added here, on the way, so the page never holds it. */
export function relayProxy(bypass: string | undefined): ProxyOptions {
  return {
    target: 'https://api.dev.quirenote.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/relay/, ''),
    ...(bypass === undefined ? {} : { headers: { 'x-bot-check-bypass': bypass } }),
  };
}
