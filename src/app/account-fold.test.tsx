import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

// `auth/app.ts` reads `location.hostname` as it loads, and `Sidebar` reaches it.
vi.stubGlobal('location', new URL('http://localhost:3300/'));
afterAll(() => vi.unstubAllGlobals());

const { AccountFold } = await import('./Sidebar');
const { hasAuthEnvironment } = await import('../auth/app');

const fold = (rows: 'held' | 'shown' | 'entry' | 'closed') =>
  renderToStaticMarkup(
    <AccountFold rows={rows}>
      <a href="/sign-in">x</a>
    </AccountFold>,
  );

describe("the account's place in a footer band", () => {
  // The entry fades into the held slot as the signed-in rows do: a held slot is invisible and
  // inert, so an entry drawn into one could be neither seen nor reached.
  it('shows the entry as it shows the signed-in rows, visible and reachable', () => {
    for (const rows of ['shown', 'entry'] as const) {
      expect(fold(rows), rows).not.toMatch(/\binert\b/);
      expect(fold(rows), rows).not.toMatch(/\binvisible\b/);
      expect(fold(rows), rows).toMatch(/\bfade-in\b/);
      expect(fold(rows), rows).toMatch(/grid-rows-\[1fr\]/);
    }
  });

  it('holds the slot open but invisible and inert until the relay answers', () => {
    expect(fold('held')).toMatch(/\binert\b/);
    expect(fold('held')).toMatch(/\binvisible\b/);
    expect(fold('held')).toMatch(/grid-rows-\[1fr\]/);
  });

  it('closes the slot only where there is nothing to sign in to', () => {
    expect(fold('closed')).toMatch(/grid-rows-\[0fr\]/);
  });

  // The dev server's host has an environment; any host the relay does not admit has none.
  it('knows from the host whether there is anything to sign in to', async () => {
    expect(hasAuthEnvironment).toBe(true);
    vi.resetModules();
    vi.stubGlobal('location', new URL('https://preview.example.com/'));
    const elsewhere = await import('../auth/app');
    expect(elsewhere.hasAuthEnvironment).toBe(false);
  });
});
