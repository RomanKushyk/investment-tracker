// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stripCss } from '../__fixtures__/palette';
import { RouterProvider } from '../__fixtures__/router';
import { useEditMode } from '../hooks/useEditMode';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
}));

// A push while the logout loads fires `navigateerror`, then its own `navigate`, and the load lands; a
// traversal cancels it, with `navigateerror` only before any push; a Stop fires `navigateerror` alone.
const load = vi.hoisted(() => ({ pending: false, cancelled: false, pushed: false }));
// The viewport side of 768, and whoever listens for a crossing.
const shell = vi.hoisted(() => ({ desktop: false, crossing: new Set<() => void>() }));
// What `GET /me` and the relay have answered, which the dock draws by.
const who = vi.hoisted(() => ({
  role: 'user' as 'user' | 'super_admin' | undefined,
  status: 'signedIn' as 'signedIn' | 'signedOut' | 'unknown',
  pending: undefined as number | undefined,
}));

vi.mock('../auth/app', () => ({
  hasAuthEnvironment: true,
  // Sets out through the logout, minus the `location.assign` the page never makes.
  leaveThroughLogout: () => {
    load.pending = true;
    return true;
  },
  session: {
    restore: () => Promise.resolve(),
    signOut: () => Promise.resolve({ logout: 'https://auth.test/logout?client_id=c' }),
    signingOut: () => false,
  },
  useSessionStatus: () => who.status,
  useSessionSigningOut: () => false,
  useSessionUnanswered: () => false,
}));
vi.mock('../hooks/useIsDesktop', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    shell.crossing.add(listener);
    return () => void shell.crossing.delete(listener);
  };
  return {
    useIsDesktop: () => useSyncExternalStore(subscribe, () => shell.desktop),
    subscribeToBreakpoint: subscribe,
  };
});
vi.mock('../hooks/queries', () => ({
  useAccountRead: () => {},
  useSettingsCopy: () => {},
  useViewDayRollover: () => {},
  useViewPending: () => false,
  useRole: () => who.role,
  usePendingCount: (enabled: boolean) => (enabled ? who.pending : undefined),
  COUNT_PAGE: 100,
}));
vi.mock('../hooks/useReminders', () => ({ useReminderToast: () => {} }));
vi.mock('../components/loading/LoadingStatus', () => ({ LoadingStatus: () => null }));
vi.mock('./SidebarRail', () => ({ SidebarRail: () => null }));
vi.mock('./AppHeader', () => ({ AppHeader: () => null }));
// The real dock, whose «Ще» is the sheet's trigger, and the two shells' account controls, each a
// «Вийти» of `useSignOut`'s.
vi.mock('./Sidebar', async (original) => {
  const { Dialog } = await import('radix-ui');
  const { useSignOut } = await import('../hooks/useSignOut');
  function Account({ shell: name }: { shell: string }) {
    const { rows, leaving, leave } = useSignOut();
    return (
      <button type="button" data-testid={name} onClick={() => void leave()}>
        {`${rows}:${leaving ? 'busy' : 'idle'}`}
      </button>
    );
  }
  return {
    ...(await original<typeof import('./Sidebar')>()),
    Sidebar: () => <Account shell="panel" />,
    MoreSheet: () => (
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>nav</Dialog.Title>
          <Account shell="sheet" />
        </Dialog.Content>
      </Dialog.Portal>
    ),
  };
});

const { Layout } = await import('./Layout');
const { NAV_TRIGGER_ID } = await import('./nav-ids');
const here = dirname(fileURLToPath(import.meta.url));

const navigation = () => (globalThis as unknown as { navigation: EventTarget }).navigation;
const marked = () =>
  (history.state as { quirenoteDrawer?: boolean } | null)?.quirenoteDrawer === true;
let push: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;

// Over jsdom's own history, as `main.tsx` mounts it: the router's entries and the marker share one stack.
function mount(page = <p>screen</p>) {
  const router = createBrowserRouter([
    { element: <Layout />, children: [{ path: '*', element: page }] },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

// jsdom traverses on a task, so `popstate` comes after the call that asked for it.
const settle = () => act(() => new Promise((done) => setTimeout(done, 20)));
const more = () => document.getElementById(NAV_TRIGGER_ID)!;
const openSheet = () => act(() => void fireEvent.click(more()));
const dock = () => screen.queryByRole('navigation', { name: 'Навігація' });
const escape = () => act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }));
const signOut = (from: string) => act(() => void fireEvent.click(screen.getByTestId(from)));
const cross = async (desktop: boolean) => {
  shell.desktop = desktop;
  await act(() => shell.crossing.forEach((listener) => listener()));
};
// The user's Stop, which leaves the page here; told from a push a microtask later.
const stop = () =>
  act(async () => {
    load.pending = false;
    navigation().dispatchEvent(new Event('navigateerror'));
  });

const sameDocument = () =>
  Object.assign(new Event('navigate'), { destination: { sameDocument: true } });

beforeEach(() => {
  load.pending = false;
  load.cancelled = false;
  load.pushed = false;
  shell.desktop = false;
  who.role = 'user';
  who.status = 'signedIn';
  who.pending = undefined;
  history.replaceState(null, '', '/allocation');
  vi.stubGlobal('navigation', new EventTarget());
  const realPush = History.prototype.pushState;
  const realBack = History.prototype.back;
  push = vi.spyOn(history, 'pushState').mockImplementation(function (this: History, ...args) {
    if (load.pending) {
      load.pushed = true;
      navigation().dispatchEvent(new Event('navigateerror'));
    }
    navigation().dispatchEvent(sameDocument());
    realPush.apply(this, args);
  });
  back = vi.spyOn(history, 'back').mockImplementation(function (this: History) {
    if (load.pending) {
      load.pending = false;
      load.cancelled = true;
      if (!load.pushed) navigation().dispatchEvent(new Event('navigateerror'));
    }
    navigation().dispatchEvent(sameDocument());
    realBack.call(this);
  });
});
afterEach(async () => {
  cleanup();
  await settle();
  // Back to a page restored from the back/forward cache ends a latch a test left set.
  dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the sheet's history", () => {
  // The hardware Back closes the sheet and stays on the route, through one entry it pushes.
  it('pushes one marker on open and spends it on close', async () => {
    mount();
    await openSheet();
    expect(marked(), 'the open pushed no marker').toBe(true);
    await escape();
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked(), 'the close left the marker current').toBe(false);
  });

  it('spends the marker when crossing 768 with the sheet open', async () => {
    mount();
    await openSheet();
    await cross(true);
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked()).toBe(false);
  });
});

// While the page leaves through Cognito's logout the sheet makes no history act: a traversal would
// cancel the logout, and a push would read as a Stop.
describe("the sheet while the page leaves through Cognito's logout", () => {
  it('closes without cancelling the logout', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await escape();
    await settle();
    expect(screen.queryByTestId('sheet'), 'the sheet stayed open').toBeNull();
    expect(load.cancelled, 'closing the sheet cancelled the logout').toBe(false);
  });

  it('opens on a busy «Вийти»', async () => {
    shell.desktop = true;
    mount();
    await signOut('panel');
    await cross(false);
    await openSheet();
    expect(push, 'the open pushed while the page leaves').not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet').textContent, "the sheet's «Вийти» is not busy").toBe(
      'shown:busy',
    );
  });

  it('reopens on a busy «Вийти» after closing', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await escape();
    await settle();
    await openSheet();
    expect(screen.getByTestId('sheet').textContent).toBe('shown:busy');
    expect(load.cancelled).toBe(false);
  });

  it('crosses 768 without cancelling the logout, the panel busy', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await cross(true);
    await settle();
    expect(load.cancelled, 'crossing 768 cancelled the logout').toBe(false);
    expect(screen.getByTestId('panel').textContent).toBe('shown:busy');
  });

  // Found still here, the sheet's marker is put back in step, so the next Back is the sheet's
  // again: closed, a marker left current would swallow it; open, a missing one would leave the route.
  it('spends a marker left current once a Stop leaves the page here', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await escape();
    await settle();
    expect(marked(), 'the close spent the marker while the page leaves').toBe(true);
    await stop();
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked(), 'the marker outlived the Stop').toBe(false);
    expect(load.cancelled).toBe(false);
  });

  it('pushes the marker an open sheet lacks once a Stop leaves the page here', async () => {
    shell.desktop = true;
    mount();
    await signOut('panel');
    await cross(false);
    await openSheet();
    expect(push, 'the open pushed while the page leaves').not.toHaveBeenCalled();
    await stop();
    expect(push).toHaveBeenCalledTimes(1);
    expect(marked(), 'the open sheet has no marker after the Stop').toBe(true);
  });

  // A route change leaves the pause running; when a Stop ends it, the router's entry sits on top of
  // the marker and the sheet is closed: nothing is left to put in step.
  it('keeps the pause across a route change and makes no history act when a Stop ends it', async () => {
    const router = mount();
    await openSheet();
    await signOut('sheet');
    await act(() => router.navigate('/overview'));
    await stop();
    await settle();
    expect(back, 'the route change walked back').not.toHaveBeenCalled();
    expect(marked(), 'a marker was pushed over the new route').toBe(false);
    expect(router.state.location.pathname).toBe('/overview');
  });

  // A route change ends the slot's latch, not the load: the sheet still makes no history act.
  it('closes and crosses 768 without cancelling the logout after a route change', async () => {
    const router = mount();
    await openSheet();
    await signOut('sheet');
    await act(() => router.navigate('/overview'));
    await openSheet();
    await escape();
    await settle();
    expect(load.cancelled, 'closing the sheet after a route change cancelled the logout').toBe(
      false,
    );
    await openSheet();
    await cross(true);
    await settle();
    expect(load.cancelled, 'crossing 768 after a route change cancelled the logout').toBe(false);
  });

  it('spends a marker left current when Back restores the page', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await escape();
    await settle();
    expect(marked(), 'the close spent the marker while the page leaves').toBe(true);
    await act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await settle();
    expect(marked(), 'the marker outlived the restore').toBe(false);
  });

  // The user's Back cancels the load and pops the marker: the page is here, and the sheet's own.
  it("takes the sheet's history back after a Back while the page leaves", async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await act(() => history.back());
    await settle();
    expect(screen.queryByTestId('sheet'), 'Back left the sheet open').toBeNull();
    push.mockClear();
    await openSheet();
    expect(push, 'the sheet stayed without its marker').toHaveBeenCalledTimes(1);
    expect(marked()).toBe(true);
  });

  // A load the page starts in place of the logout, as a reload, still takes the page: no Stop.
  // The tap REPLACED the marker; the entry it wrote is spent once a Stop finds the page here.
  it('spends the entry a tap on its own route wrote once a Stop leaves the page here', async () => {
    const router = mount();
    await openSheet();
    await signOut('sheet');
    await act(() => router.navigate('/allocation', { replace: true }));
    await settle();
    expect(back, 'the sheet walked back over the logout').not.toHaveBeenCalled();
    await stop();
    await settle();
    expect(back, 'the entry the tap wrote outlived the Stop').toHaveBeenCalledTimes(1);
  });

  it('walks back no further once a Back has left the entry a tap on its own route wrote', async () => {
    const router = mount();
    await openSheet();
    await signOut('sheet');
    await act(() => router.navigate('/allocation', { replace: true }));
    await act(() => history.back());
    await settle();
    expect(back, "the sheet walked back after the user's Back").toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/allocation');
  });

  it('keeps the pause when another load replaces the logout', async () => {
    mount();
    await openSheet();
    await signOut('sheet');
    await escape();
    await settle();
    await act(async () => {
      navigation().dispatchEvent(new Event('navigateerror'));
      navigation().dispatchEvent(
        Object.assign(new Event('navigate'), { destination: { sameDocument: false } }),
      );
    });
    await settle();
    expect(back, 'the sheet walked back over the replacing load').not.toHaveBeenCalled();
  });
});

// The real edit guard over unsaved work, as `/allocation` mounts it.
function Editing() {
  const { pathname } = useLocation();
  const { editing, start, asking, keepEditing, discard } = useEditMode(true);
  return (
    <>
      <p data-testid="edit">{`${pathname}:${editing ? 'editing' : 'idle'}:${asking ? 'asking' : 'quiet'}`}</p>
      <button type="button" onClick={start}>
        edit
      </button>
      <button type="button" onClick={keepEditing}>
        keep
      </button>
      <button type="button" onClick={discard}>
        discard
      </button>
    </>
  );
}

describe('the sheet over unsaved work', () => {
  let go: ReturnType<typeof vi.spyOn>;
  const press = (name: string) => act(() => void fireEvent.click(screen.getByText(name)));
  const edit = () => screen.getByTestId('edit').textContent;
  // On `/allocation` after `/portfolio`, editing, so a Back has a route to leave for.
  const arrive = async () => {
    history.replaceState(null, '', '/portfolio');
    const router = mount(<Editing />);
    await act(() => router.navigate('/allocation'));
    await press('edit');
    return router;
  };

  beforeEach(() => {
    const realGo = History.prototype.go;
    // `go(0)` reloads the document (HTML, `history.go`), which jsdom cannot: recorded, not run.
    go = vi.spyOn(history, 'go').mockImplementation(function (this: History, delta?: number) {
      if (delta) realGo.call(this, delta);
    });
  });

  it('closes by Escape without reloading the page or asking', async () => {
    await arrive();
    await openSheet();
    await escape();
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(marked(), 'the close left the marker current').toBe(false);
  });

  it('closes by Back without reloading the page or asking', async () => {
    await arrive();
    await openSheet();
    await act(() => history.back());
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(screen.queryByTestId('sheet'), 'Back left the sheet open').toBeNull();
    expect(marked()).toBe(false);
  });

  it('closes by crossing 768 without reloading the page or asking', async () => {
    await arrive();
    await openSheet();
    await cross(true);
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(marked()).toBe(false);
  });

  it('asks before a link in the open sheet leaves the route', async () => {
    const router = await arrive();
    await openSheet();
    await act(() => router.navigate('/portfolio'));
    expect(edit()).toBe('/allocation:editing:asking');
    await press('keep');
    expect(edit()).toBe('/allocation:editing:quiet');
    await act(() => router.navigate('/portfolio'));
    await press('discard');
    await settle();
    expect(edit()).toBe('/portfolio:idle:quiet');
  });

  it('asks before Back leaves the route with the sheet closed', async () => {
    await arrive();
    await act(() => history.back());
    await settle();
    expect(edit()).toBe('/allocation:editing:asking');
    await press('keep');
    await settle();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(location.pathname).toBe('/allocation');
  });

  // A sheet link to the route on screen REPLACES the marker (NavLink's same-path default).
  it('closes on a tap on its own route and spends the entry the tap wrote', async () => {
    const router = await arrive();
    await press('discard');
    await openSheet();
    await act(() => router.navigate('/allocation', { replace: true }));
    await settle();
    expect(screen.queryByTestId('sheet'), 'the tap left the sheet open').toBeNull();
    expect(back, 'the entry the tap wrote stayed on the stack').toHaveBeenCalledTimes(1);
    await press('edit');
    await act(() => history.back());
    await settle();
    expect(
      go.mock.calls.filter(([delta]: unknown[]) => !delta),
      'Back reloaded the page',
    ).toEqual([]);
    expect(edit()).toBe('/allocation:editing:asking');
  });

  it('asks before a tap on its own route, and closes on Discard', async () => {
    const router = await arrive();
    await openSheet();
    await act(() => router.navigate('/allocation', { replace: true }));
    expect(edit()).toBe('/allocation:editing:asking');
    await press('discard');
    await settle();
    expect(
      go.mock.calls.filter(([delta]: unknown[]) => !delta),
      'the close reloaded the page',
    ).toEqual([]);
    expect(back, 'the entry the tap wrote stayed on the stack').toHaveBeenCalledTimes(1);
    expect(edit()).toBe('/allocation:idle:quiet');
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  // Forward lands on the entry the tap wrote: another key, the same URL, the same index.
  it('keeps the work when Forward pops to an entry of the same URL', async () => {
    const router = await arrive();
    await press('discard');
    await openSheet();
    await act(() => router.navigate('/allocation', { replace: true }));
    await settle();
    await press('edit');
    await act(() => history.forward());
    await settle();
    expect(go, 'Forward reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
  });

  it('keeps the work when Back pops to an earlier entry of the same URL', async () => {
    const router = await arrive();
    await press('discard');
    await act(() => router.navigate('/allocation'));
    await press('edit');
    await act(() => history.back());
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
  });

  // The close spent the marker, so the next Back is the route's own and the guard asks first.
  it('leaves the route on the next Back after the sheet closes, asking first', async () => {
    await arrive();
    await openSheet();
    await escape();
    await settle();
    await act(() => history.back());
    await settle();
    expect(edit()).toBe('/allocation:editing:asking');
    await press('discard');
    await settle();
    expect(edit()).toBe('/portfolio:idle:quiet');
    expect(location.pathname).toBe('/portfolio');
  });
});

// Below md the dock carries the role's screens and «Ще», the sheet's one trigger
// (mobile-bar-and-sheet.md § Signed; open-values-shell-controls.md § Signed, E1).
describe('the dock', () => {
  const tabs = () =>
    Array.from(dock()!.querySelectorAll('a, button')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    );
  const placeholders = () => dock()!.querySelectorAll('[data-placeholder]').length;

  it("draws a user's four screens and «Ще», the route's own tab current", async () => {
    history.replaceState(null, '', '/overview');
    mount();
    expect(tabs()).toEqual(['Огляд', 'Розподіл', 'Дохідність', 'Атрибути', 'Ще']);
    expect(screen.getByRole('link', { name: 'Огляд' }).getAttribute('aria-current')).toBe('page');
    expect(more().hasAttribute('data-current'), '«Ще» marked on a dock route').toBe(false);
    expect(placeholders()).toBe(0);
  });

  // The current page's link is in the sheet; «Ще» says it holds it, by its look and its name, never
  // by a second `aria-current` (WAI-ARIA 1.2: one current element in a set).
  it('marks «Ще» on a route the dock does not hold', async () => {
    history.replaceState(null, '', '/balances');
    mount();
    expect(dock()!.querySelector('[aria-current]')).toBeNull();
    expect(more().hasAttribute('data-current')).toBe(true);
    expect(more().getAttribute('aria-label')).toBe('Ще, зокрема поточна сторінка');
  });

  it('carries the one `NAV_TRIGGER_ID` and opens the sheet', async () => {
    mount();
    expect(document.querySelectorAll(`#${NAV_TRIGGER_ID}`)).toHaveLength(1);
    expect(more().textContent).toBe('Ще');
    await openSheet();
    expect(screen.getByTestId('sheet')).not.toBeNull();
  });

  it("stands at a user's layout with four placeholders while `/me` is out", async () => {
    who.role = undefined;
    mount();
    expect(placeholders()).toBe(4);
    expect(dock()!.querySelectorAll('a')).toHaveLength(0);
    expect(tabs()).toEqual(['Ще']);
  });

  it('is «Ще» alone signed out', async () => {
    who.role = undefined;
    who.status = 'signedOut';
    mount();
    expect(placeholders()).toBe(0);
    expect(tabs()).toEqual(['Ще']);
  });

  it("draws the super-admin's two screens with the count, then «Ще»", async () => {
    who.role = 'super_admin';
    who.pending = 3;
    mount();
    expect(tabs()).toEqual(['Архів цін', 'Користувачі, 3', 'Ще']);
    expect(placeholders()).toBe(0);
  });

  // shell.md § Mobile: a focused control never sits under the dock (WCAG 2.4.11), so the root's
  // scroll padding is the dock's height, 6 + 48 + 6 (its glass edge is a shadow), its 12 inset,
  // and the focus ring's 2 offset + 2 outline past the control's box.
  it("pads the root's scroll by the dock's height, its inset and the ring", async () => {
    mount();
    const nav = dock()!;
    expect(nav.className.split(/\s+/)).toContain('p-1.5');
    for (const tab of nav.querySelectorAll('a, button')) {
      expect(tab.className.split(/\s+/)).toContain('h-12');
    }
    expect(nav.hasAttribute('data-dock')).toBe(true);
    const css = stripCss(readFileSync(join(here, '../index.css'), 'utf8'), 'index.css');
    const rule = /:root:has\(\[data-dock\]\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/scroll-padding-bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('is not drawn at 768 and up', async () => {
    shell.desktop = true;
    mount();
    expect(dock()).toBeNull();
    await cross(false);
    expect(dock()).not.toBeNull();
    await cross(true);
    expect(dock()).toBeNull();
  });
});

// motion.md: "The shell never moves: the sidebar, header, dock and glow stay put".
describe('the backdrop', () => {
  it('stays mounted across a route change', async () => {
    shell.desktop = true;
    const router = mount();
    await act(() => router.navigate('/overview'));
    const backdrop = document.querySelector('[data-backdrop]');
    expect(backdrop, 'the shell mounts no backdrop').not.toBeNull();
    await act(() => router.navigate('/balances'));
    expect(document.querySelector('[data-backdrop]')).toBe(backdrop);
    expect(backdrop!.isConnected).toBe(true);
  });
});
