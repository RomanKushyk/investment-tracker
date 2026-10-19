// @vitest-environment jsdom
// The widget's events, read off a stubbed Turnstile: what each one tells the form, and how often.
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Turnstile, TurnstileOptions } from '../../auth/turnstile';
import { useSettings } from '../../state/settings';
import { BotCheck, type BotCheckProps } from './BotCheck';

const stub = vi.hoisted(() => {
  // Before the settings store is imported, which persists to it.
  const kept = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  } as Storage;
  return {
    api: undefined as Turnstile | undefined,
    /** Held back by a test that leaves before the script runs. */
    loading: undefined as Promise<Turnstile | undefined> | undefined,
  };
});
vi.mock('../../auth/turnstile', () => ({
  loadTurnstile: () => stub.loading ?? Promise.resolve(stub.api),
}));

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));

let rendered: TurnstileOptions[];
let api: {
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

const events = () => ({
  onToken: vi.fn(),
  onExpired: vi.fn(),
  onFailed: vi.fn(),
  onInteractive: vi.fn(),
  onUnavailable: vi.fn(),
});

async function mount(over: Partial<BotCheckProps> = {}) {
  const on = events();
  const props: BotCheckProps = { sitekey: 'site-key', action: 'apply', reset: 0, ...on, ...over };
  const view = render(<BotCheck {...props} />);
  await act(async () => {});
  return {
    on,
    rerender: async (next: Partial<BotCheckProps>) => {
      view.rerender(<BotCheck {...props} {...next} />);
      await act(async () => {});
    },
    unmount: view.unmount,
  };
}
const last = () => rendered.at(-1)!;

beforeEach(() => {
  rendered = [];
  let n = 0;
  api = {
    render: vi.fn((_el: HTMLElement, options: TurnstileOptions) => {
      rendered.push(options);
      return `w${++n}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  stub.api = api as unknown as Turnstile;
  stub.loading = undefined;
  useSettings.setState({ theme: 'dark', language: 'uk' });
});
afterEach(cleanup);

describe('the widget', () => {
  it('renders Managed and flexible, in the app’s theme and language, for this action', async () => {
    await mount();
    expect(last()).toMatchObject({
      sitekey: 'site-key',
      action: 'apply',
      theme: 'dark',
      language: 'uk',
      size: 'flexible',
      'refresh-expired': 'auto',
    });
  });

  // Turnstile has no update: a change is a remove and a render.
  it('renders again in the new language, removing the old one', async () => {
    await mount();
    await act(async () => useSettings.setState({ language: 'en' }));
    expect(api.remove).toHaveBeenCalledWith('w1');
    expect(last().language).toBe('en');
  });

  it('is removed with the form', async () => {
    const { unmount } = await mount();
    unmount();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });

  it('resets when the form raises its count, and not before', async () => {
    const { rerender } = await mount();
    expect(api.reset).not.toHaveBeenCalled();
    await rerender({ reset: 1 });
    expect(api.reset).toHaveBeenCalledWith('w1');
  });
});

describe('what the widget tells the form', () => {
  it('hands up each token', async () => {
    const { on } = await mount();
    act(() => last().callback('token-1'));
    expect(on.onToken).toHaveBeenCalledWith('token-1');
  });

  // "the error callback can be invoked multiple times for the same underlying issue".
  // EVERY ONE, the retries included: a press made after the first failure waits on the next, and
  // the form, not the widget, decides what is said once.
  it('hands up every failure, a retry and a timeout included, and marks each handled', async () => {
    const { on } = await mount();
    act(() => {
      expect(last()['error-callback']('600010')).toBe(true);
      expect(last()['error-callback']('600010')).toBe(true);
      last()['timeout-callback']();
    });
    expect(on.onFailed).toHaveBeenCalledTimes(3);
  });

  // Retry: No in Cloudflare's table: a refused sitekey or host is no failure a retry clears.
  for (const code of ['110100', '110200', '400020', '200100']) {
    it(`reads ${code} as unavailable, not as a failure`, async () => {
      const { on } = await mount();
      act(() => void last()['error-callback'](code));
      expect(on.onUnavailable).toHaveBeenCalledOnce();
      expect(on.onFailed).not.toHaveBeenCalled();
    });
  }

  it('reads an unsupported browser as unavailable', async () => {
    const { on } = await mount();
    act(() => last()['unsupported-callback']());
    expect(on.onUnavailable).toHaveBeenCalledOnce();
  });

  it('says when it shows its checkbox, and when a token expires', async () => {
    const { on } = await mount();
    act(() => {
      last()['before-interactive-callback']();
      last()['expired-callback']();
    });
    expect(on.onInteractive).toHaveBeenCalledOnce();
    expect(on.onExpired).toHaveBeenCalledOnce();
  });
});

describe('a form that leaves before the script runs', () => {
  it('has nothing rendered into it once the script arrives', async () => {
    let arrive: (api: Turnstile) => void = () => {};
    stub.loading = new Promise((settle) => (arrive = settle));
    const on = events();
    const view = render(<BotCheck sitekey="site-key" action="apply" reset={0} {...on} />);
    view.unmount();
    await act(async () => arrive(api as unknown as Turnstile));
    expect(api.render).not.toHaveBeenCalled();
    expect(on.onUnavailable).not.toHaveBeenCalled();
  });

  // StrictMode mounts, unmounts and mounts again before the script settles: one widget, not two.
  it('renders one widget under StrictMode', async () => {
    render(
      <StrictMode>
        <BotCheck sitekey="site-key" action="apply" reset={0} {...events()} />
      </StrictMode>,
    );
    await act(async () => {});
    expect(api.render).toHaveBeenCalledOnce();
    expect(api.remove).not.toHaveBeenCalled();
  });
});

describe('no widget', () => {
  it('is unavailable when the script never ran', async () => {
    stub.api = undefined;
    const { on } = await mount();
    expect(on.onUnavailable).toHaveBeenCalledOnce();
  });

  // An invalid sitekey throws from `render` rather than reaching the error callback.
  it('is unavailable when the widget refuses to render', async () => {
    api.render.mockImplementation(() => {
      throw new Error('Invalid sitekey');
    });
    const { on } = await mount();
    expect(on.onUnavailable).toHaveBeenCalledOnce();
  });
});
