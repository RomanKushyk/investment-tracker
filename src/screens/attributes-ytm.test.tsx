// @vitest-environment jsdom
// The Attributes screen's one figure the server cannot serve: a bond's YTM at purchase is solved
// against the Inzhur feed, which only this device holds (*External sources*). The screen overlays it
// on the view's card when a feed is held, and shows the stored rate when not.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ParsedFeed } from '@quirenote/core/inzhur/parse';
import { makeFormat } from '@quirenote/core/money';
import { derivedYtmPct } from '@quirenote/core/view/attributes';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewKey } from '../hooks/queries';
import { uk } from '../i18n/messages';
import { viewOf } from '../lib/local-view';

const held = vi.hoisted(() => ({ feed: undefined as { feed: unknown } | undefined }));
vi.mock('../hooks/useInzhurAssets', () => ({
  useInzhurAssets: () => ({ data: undefined, lastGood: held.feed }),
}));
vi.mock('../lib/repository', () => ({ repo: {}, openStore: async () => undefined }));

const linked = TEST_LEDGERS.find((l) => l.name === 'linked')!.input;
const bond = linked.assets[0];
const f = makeFormat('uk');

beforeAll(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
});
afterEach(() => {
  cleanup();
  held.feed = undefined;
});

async function screenOn(today: string) {
  const { Attributes } = await import('./Attributes');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What the device derives from its rows, which hold no feed: its card carries no YTM of its own.
  client.setQueryData(
    viewKey,
    viewOf(
      { assets: linked.assets, snapshots: linked.snapshots, transactions: linked.transactions },
      today,
    ),
  );
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Attributes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

// The buy is dated 12.08.2026; on the 20th it is held, on the 1st it is yet to come.
const HELD_ON = '2026-08-20';
const AHEAD_OF = '2026-08-01';

describe('the YTM at purchase', () => {
  const solved = derivedYtmPct(bond, linked.transactions, linked.feed as ParsedFeed);

  it('is a fixture whose solved rate differs from the stored one at the precision shown', () => {
    expect(solved).toBeDefined();
    expect(f.pctPlain(solved!)).not.toBe(f.pctPlain(bond.expectedPct));
  });

  it('shows the rate solved against the feed when a feed is held, beside the stored one', async () => {
    held.feed = { feed: linked.feed };
    const text = (await screenOn(HELD_ON)).textContent;
    expect(text).toContain(`${f.pctPlain(solved!)} ${uk.analytics.perYear}`);
    expect(text).toContain(uk.analytics.prose.ytmDerived(f.pctPlain(bond.expectedPct)));
  });

  it('shows the stored rate when no feed is held', async () => {
    const text = (await screenOn(HELD_ON)).textContent;
    expect(text).toContain(`${f.pctPlain(bond.expectedPct)} ${uk.analytics.perYear}`);
    expect(text).not.toContain(uk.analytics.prose.ytmDerived(f.pctPlain(bond.expectedPct)));
  });

  // A purchase dated ahead counts in no figure until its day (*Metric families and windows*), the
  // price solved against it included.
  it('solves nothing for a purchase that is dated ahead', async () => {
    held.feed = { feed: linked.feed };
    const text = (await screenOn(AHEAD_OF)).textContent;
    expect(text).toContain(`${f.pctPlain(bond.expectedPct)} ${uk.analytics.perYear}`);
    expect(text).not.toContain(uk.analytics.prose.ytmDerived(f.pctPlain(bond.expectedPct)));
  });
});
