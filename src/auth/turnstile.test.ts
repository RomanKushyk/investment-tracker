// @vitest-environment jsdom
// The loader settles once, on whichever comes first: the script's own onload callback, its error,
// or the deadline for a script that neither arrives nor fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Loader = typeof import('./turnstile');
const fresh = async (): Promise<Loader> => {
  vi.resetModules();
  return import('./turnstile');
};
const scripts = () => [...document.head.querySelectorAll('script')];
const global = window as unknown as Record<string, unknown>;

beforeEach(() => {
  document.head.replaceChildren();
  delete global.turnstile;
});
afterEach(() => vi.useRealTimers());

describe('the Turnstile script', () => {
  it('is requested from the exact URL, rendering explicitly, with a callback to say it ran', async () => {
    const { loadTurnstile } = await fresh();
    void loadTurnstile();
    const [script] = scripts();
    const url = new URL(script.src);
    expect(url.origin + url.pathname).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js');
    expect(url.searchParams.get('render')).toBe('explicit');
    expect(typeof global[url.searchParams.get('onload') ?? '']).toBe('function');
  });

  it('settles with the widget API once its callback runs', async () => {
    const { loadTurnstile } = await fresh();
    const api = { render: vi.fn(), reset: vi.fn(), remove: vi.fn() };
    const loading = loadTurnstile();
    const name = new URL(scripts()[0].src).searchParams.get('onload')!;
    global.turnstile = api;
    (global[name] as () => void)();
    await expect(loading).resolves.toBe(api);
    expect(global[name]).toBeUndefined();
  });

  // An ad blocker or the policy turns the request into a network error, which fires `error`.
  it('settles with nothing when the request is blocked', async () => {
    const { loadTurnstile } = await fresh();
    const loading = loadTurnstile();
    scripts()[0].dispatchEvent(new Event('error'));
    await expect(loading).resolves.toBeUndefined();
  });

  // A redirect by an extension fires `load` with no API behind it: only the callback counts.
  it('takes no `load` for a script that ran, and settles with nothing at the deadline', async () => {
    vi.useFakeTimers();
    const { LOAD_MS, loadTurnstile } = await fresh();
    let settled: unknown = 'pending';
    void loadTurnstile().then((api) => (settled = api));
    scripts()[0].dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(LOAD_MS - 1);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeUndefined();
  });

  it('is requested once per page, however many widgets ask', async () => {
    const { loadTurnstile } = await fresh();
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
  });
});
