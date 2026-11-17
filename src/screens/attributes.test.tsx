// @vitest-environment jsdom
// /attributes draws each asset as wave 7's item (attributes-item.md § Signed): a header that says
// what it is, one hero figure, one progress bar and three facts in a fixed order. With no value or
// no range the bar is not drawn (open-values-shell-controls.md, the «Атрибути» bar's unsigned cases).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import type { Asset } from '@quirenote/core/types';
import type { AttributeCard, MarketCard } from '@quirenote/core/view/attributes';
import type { ViewBody } from '@quirenote/core/view/serve';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewKey } from '../hooks/queries';
import { uk } from '../i18n/messages';
import { viewOf, type AllTables } from '../__fixtures__/stored-view';

// No feed is held, so no bond solves a YTM: each shows its stored rate.
vi.mock('../hooks/useInzhurAssets', () => ({
  useInzhurAssets: () => ({ data: undefined, lastGood: undefined }),
}));
vi.mock('../lib/api', () => ({ repo: {} }));

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
const SEED: AllTables = {
  assets: seed.assets,
  snapshots: seed.snapshots,
  transactions: seed.transactions,
};
// The seed's own day: …8976 has 212 days to go, …6475 303, as the signed renders print.
const TODAY = '2026-07-28';
const f = makeFormat('uk');
const a = uk.analytics.attributes;

beforeAll(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
});
afterEach(cleanup);

const withAsset = (id: string, patch: Partial<Asset>): AllTables => ({
  ...SEED,
  assets: SEED.assets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
});

/** The served body with one market card's figures replaced, for the states the seed never reaches. */
function withMarket(body: ViewBody, id: string, patch: Partial<MarketCard>): ViewBody {
  const cards = body.view.attributes.cards.map((c): AttributeCard =>
    c.asset.id === id && c.kind === 'market' ? { ...c, ...patch } : c,
  );
  return { ...body, view: { ...body.view, attributes: { cards } } };
}

async function mount(body: ViewBody) {
  const { Attributes } = await import('./Attributes');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(viewKey, body);
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Attributes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

function item(root: HTMLElement, id: string) {
  const el = root.querySelector<HTMLElement>(`[data-asset="${id}"]`);
  if (!el) throw new Error(`no item for ${id}`);
  return {
    el,
    hero: el.querySelector<HTMLElement>('[data-hero]')!,
    caption: el.querySelector<HTMLElement>('[data-hero-caption]')!.textContent,
    bar: el.querySelector<HTMLElement>('[data-bar]'),
    fill: el.querySelector<HTMLElement>('[data-fill]'),
    tick: el.querySelector<HTMLElement>('[data-tick]'),
    facts: [...el.querySelectorAll('dt')].map((d) => d.textContent),
    fact: (label: string) =>
      [...el.querySelectorAll('dt')].find((d) => d.textContent === label)?.nextElementSibling
        ?.textContent,
  };
}

const pctOf = (style: string) => Number.parseFloat(style);

describe('the header', () => {
  it('says what each asset is, with no tag, and keeps a long name whole in its title', async () => {
    const root = await mount(viewOf(SEED, TODAY));
    const reit = item(root, 'reit').el;
    expect(reit.textContent).toContain(a.kindFund(uk.asset.yieldLong.div_cap));
    expect(item(root, 'ovdp8976').el.textContent).toContain(
      a.kindBond(uk.asset.yieldLong.fixed_coupon),
    );
    const name = reit.querySelector('h3')!;
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe('Inzhur REIT');
    expect(reit.querySelector('.size-\\[44px\\]'), 'the 44 px avatar').not.toBeNull();
  });
});

// The served return is a FRACTION, as `/yield` serves it; the expected return is in percent.
describe("a fund's hero and bar", () => {
  const fund = (patch: Partial<MarketCard>) =>
    mount(withMarket(viewOf(SEED, TODAY), 'reit', patch)).then((r) => item(r, 'reit'));

  it('leads with the actual annual return, in pos, captioned with the expected return', async () => {
    const reit = await fund({ actualAnnualized: 0.093, shortBasis: false });
    expect(reit.hero.textContent).toContain(f.pct(0.093, 1));
    expect(reit.hero.textContent).toContain(uk.analytics.perYear);
    expect(reit.hero.querySelector('.text-pos')).not.toBeNull();
    expect(reit.caption).toBe(a.actualCaption(f.pctPlain(14)));
  });

  it('greys the figure on a short basis', async () => {
    const reit = await fund({ actualAnnualized: 0.093, shortBasis: true });
    expect(reit.hero.querySelector('.text-muted')?.textContent).toBe(f.pct(0.093, 1));
    expect(reit.hero.querySelector('.text-pos')).toBeNull();
  });

  it('draws the actual against the expected tick on max(actual, expected) × 1.25', async () => {
    const reit = await fund({ actualAnnualized: 0.093, shortBasis: false });
    // Scale 17.5: the fill at 9.3 / 17.5, the tick at 14 / 17.5.
    expect(pctOf(reit.fill!.style.width)).toBeCloseTo((9.3 / 17.5) * 100, 6);
    expect(pctOf(reit.tick!.style.left)).toBeCloseTo(80, 6);
    expect(reit.bar!.textContent).toContain(a.barActual(f.pct(0.093, 1)));
    expect(reit.bar!.textContent).toContain(a.barExpected(f.pctPlain(14)));
  });

  it('puts the tick at the end when the actual outruns the expected', async () => {
    const reit = await fund({ actualAnnualized: 0.2, shortBasis: false });
    expect(pctOf(reit.fill!.style.width)).toBeCloseTo(80, 6);
    expect(pctOf(reit.tick!.style.left)).toBeCloseTo(56, 6);
  });

  it('draws no bar for a negative return, prints it in neg and keeps the caption', async () => {
    const reit = await fund({ actualAnnualized: -0.021, shortBasis: false });
    expect(reit.bar).toBeNull();
    expect(reit.hero.querySelector('.text-neg')?.textContent).toBe(f.pct(-0.021, 1));
    expect(reit.caption).toBe(a.actualCaption(f.pctPlain(14)));
  });

  it('reads «—» with no actual return yet, says so in the caption, and draws no bar', async () => {
    const reit = await fund({ actualAnnualized: undefined, shortBasis: false });
    expect(reit.bar).toBeNull();
    expect(reit.hero.textContent).toContain('—');
    expect(reit.caption).toBe(a.actualNotYet(f.pctPlain(14)));
  });
});

describe("a bond's hero and bar", () => {
  it('leads with the YTM at purchase', async () => {
    const bond = item(await mount(viewOf(SEED, TODAY)), 'ovdp8976');
    expect(bond.hero.textContent).toContain(f.pctPlain(16.4));
    expect(bond.hero.textContent).toContain(uk.analytics.perYear);
    expect(bond.caption).toBe(a.ytmAtPurchase);
  });

  it('runs from the first purchase to maturity, today ticked, with the days to go', async () => {
    const root = await mount(viewOf(SEED, TODAY));
    // 05.02.2026 → 25.02.2027 is 385 days, 212 of them still to come.
    const b8976 = item(root, 'ovdp8976');
    expect(pctOf(b8976.fill!.style.width)).toBeCloseTo((173 / 385) * 100, 6);
    expect(pctOf(b8976.tick!.style.left)).toBeCloseTo((173 / 385) * 100, 6);
    expect(b8976.bar!.textContent).toContain(f.date('2026-02-05'));
    expect(b8976.bar!.textContent).toContain(f.date('2027-02-25'));
    expect(b8976.bar!.textContent).toContain(a.daysToMaturity(212));
    // 02.06.2026 → 27.05.2027 is 359 days, 303 to come.
    const b6475 = item(root, 'ovdp6475');
    expect(pctOf(b6475.fill!.style.width)).toBeCloseTo((56 / 359) * 100, 6);
    expect(b6475.bar!.textContent).toContain(a.daysToMaturity(303));
  });

  it('fills the bar with no tick once matured, and its coupon facts read «—»', async () => {
    const root = await mount(viewOf(withAsset('ovdp6475', { maturity: '2026-07-01' }), TODAY));
    const bond = item(root, 'ovdp6475');
    expect(pctOf(bond.fill!.style.width)).toBe(100);
    expect(bond.tick).toBeNull();
    expect(bond.bar!.textContent).toContain(a.maturedOn(f.date('2026-07-01')));
    expect(bond.fact(a.coupon)).toBe('—');
    expect(bond.fact(a.nextCoupon)).toBe('—');
  });

  it('draws no bar with no stored maturity, and says the date is not given', async () => {
    const root = await mount(viewOf(withAsset('ovdp8976', { maturity: undefined }), TODAY));
    const bond = item(root, 'ovdp8976');
    expect(bond.bar).toBeNull();
    expect(bond.el.textContent).toContain(a.noMaturity);
  });

  // The first purchase is a stored attribute, editable apart from the ledger.
  it('draws no tick while today is before the first purchase, and still counts the days', async () => {
    const root = await mount(viewOf(withAsset('ovdp8976', { firstPurchase: '2026-08-12' }), TODAY));
    const bond = item(root, 'ovdp8976');
    expect(pctOf(bond.fill!.style.width)).toBe(0);
    expect(bond.tick).toBeNull();
    expect(bond.bar!.textContent).toContain(a.daysToMaturity(212));
  });

  it('draws no bar when the first purchase falls on the maturity day', async () => {
    const root = await mount(viewOf(withAsset('ovdp8976', { firstPurchase: '2027-02-25' }), TODAY));
    const bond = item(root, 'ovdp8976');
    expect(bond.bar).toBeNull();
    expect(bond.el.textContent).toContain(a.daysToMaturity(212));
  });

  it('draws no bar for a matured bond whose first purchase is after maturity', async () => {
    const root = await mount(
      viewOf(withAsset('ovdp6475', { maturity: '2026-07-01', firstPurchase: '2026-07-10' }), TODAY),
    );
    const bond = item(root, 'ovdp6475');
    expect(bond.bar).toBeNull();
    expect(bond.el.textContent).toContain(a.maturedOn(f.date('2026-07-01')));
  });

  it('draws no bar with no range, and keeps the days to maturity', async () => {
    const root = await mount(viewOf(withAsset('ovdp8976', { firstPurchase: '2027-03-01' }), TODAY));
    const bond = item(root, 'ovdp8976');
    expect(bond.bar).toBeNull();
    expect(bond.el.textContent).toContain(a.daysToMaturity(212));
  });
});

describe('the facts', () => {
  it('read in the signed order, and none repeats the hero or the bar', async () => {
    const root = await mount(viewOf(SEED, TODAY));
    const fund = [a.payoutSchedule, a.targetShare, a.firstPurchase];
    const bond = [a.coupon, a.targetShare, a.nextCoupon];
    expect(item(root, 'reit').facts).toEqual(fund);
    expect(item(root, 'energy').facts).toEqual(fund);
    expect(item(root, 'ovdp8976').facts).toEqual(bond);
    expect(item(root, 'ovdp6475').facts).toEqual(bond);
  });
});
