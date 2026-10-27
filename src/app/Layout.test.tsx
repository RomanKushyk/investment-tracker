// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createBrowserRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  useSessionStatus: () => 'signedIn',
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
vi.mock('../hooks/queries', () => ({ useSettingsCopy: () => {}, useViewDayRollover: () => {} }));
vi.mock('../hooks/useReminders', () => ({ useReminderToast: () => {} }));
vi.mock('../components/loading/LoadingStatus', () => ({ LoadingStatus: () => null }));
vi.mock('./SidebarRail', () => ({ SidebarRail: () => null }));
// The header's trigger and the two shells' account controls, each a «Вийти» of `useSignOut`'s.
vi.mock('./AppHeader', async () => {
  const { Dialog } = await import('radix-ui');
  return { AppHeader: () => <Dialog.Trigger>menu</Dialog.Trigger> };
});
vi.mock('./Sidebar', async () => {
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
    Sidebar: () => <Account shell="panel" />,
    SidebarDrawer: () => (
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>nav</Dialog.Title>
          <Account shell="drawer" />
        </Dialog.Content>
      </Dialog.Portal>
    ),
  };
});

const { Layout } = await import('./Layout');

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
const openDrawer = () => act(() => void fireEvent.click(screen.getByText('menu')));
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

describe("the drawer's history", () => {
  // The hardware Back closes the drawer and stays on the route, through one entry it pushes.
  it('pushes one marker on open and spends it on close', async () => {
    mount();
    await openDrawer();
    expect(marked(), 'the open pushed no marker').toBe(true);
    await escape();
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked(), 'the close left the marker current').toBe(false);
  });

  it('spends the marker when crossing 768 with the drawer open', async () => {
    mount();
    await openDrawer();
    await cross(true);
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked()).toBe(false);
  });
});

// While the page leaves through Cognito's logout the drawer makes no history act: a traversal would
// cancel the logout, and a push would read as a Stop (`account-way-in-and-out.dc.html`, T4).
describe("the drawer while the page leaves through Cognito's logout", () => {
  it('closes without cancelling the logout', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await escape();
    await settle();
    expect(screen.queryByTestId('drawer'), 'the drawer stayed open').toBeNull();
    expect(load.cancelled, 'closing the drawer cancelled the logout').toBe(false);
  });

  it('opens on a busy «Вийти»', async () => {
    shell.desktop = true;
    mount();
    await signOut('panel');
    await cross(false);
    await openDrawer();
    expect(push, 'the open pushed while the page leaves').not.toHaveBeenCalled();
    expect(screen.getByTestId('drawer').textContent, "the drawer's «Вийти» is not busy").toBe(
      'shown:busy',
    );
  });

  it('reopens on a busy «Вийти» after closing', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await escape();
    await settle();
    await openDrawer();
    expect(screen.getByTestId('drawer').textContent).toBe('shown:busy');
    expect(load.cancelled).toBe(false);
  });

  it('crosses 768 without cancelling the logout, the panel busy', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await cross(true);
    await settle();
    expect(load.cancelled, 'crossing 768 cancelled the logout').toBe(false);
    expect(screen.getByTestId('panel').textContent).toBe('shown:busy');
  });

  // Found still here, the drawer's marker is put back in step, so the next Back is the drawer's
  // again: closed, a marker left current would swallow it; open, a missing one would leave the route.
  it('spends a marker left current once a Stop leaves the page here', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await escape();
    await settle();
    expect(marked(), 'the close spent the marker while the page leaves').toBe(true);
    await stop();
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(marked(), 'the marker outlived the Stop').toBe(false);
    expect(load.cancelled).toBe(false);
  });

  it('pushes the marker an open drawer lacks once a Stop leaves the page here', async () => {
    shell.desktop = true;
    mount();
    await signOut('panel');
    await cross(false);
    await openDrawer();
    expect(push, 'the open pushed while the page leaves').not.toHaveBeenCalled();
    await stop();
    expect(push).toHaveBeenCalledTimes(1);
    expect(marked(), 'the open drawer has no marker after the Stop').toBe(true);
  });

  // A route change leaves the pause running; when a Stop ends it, the router's entry sits on top of
  // the marker and the drawer is closed: nothing is left to put in step.
  it('keeps the pause across a route change and makes no history act when a Stop ends it', async () => {
    const router = mount();
    await openDrawer();
    await signOut('drawer');
    await act(() => router.navigate('/overview'));
    await stop();
    await settle();
    expect(back, 'the route change walked back').not.toHaveBeenCalled();
    expect(marked(), 'a marker was pushed over the new route').toBe(false);
    expect(router.state.location.pathname).toBe('/overview');
  });

  // A route change ends the slot's latch, not the load: the drawer still makes no history act.
  it('closes and crosses 768 without cancelling the logout after a route change', async () => {
    const router = mount();
    await openDrawer();
    await signOut('drawer');
    await act(() => router.navigate('/overview'));
    await openDrawer();
    await escape();
    await settle();
    expect(load.cancelled, 'closing the drawer after a route change cancelled the logout').toBe(
      false,
    );
    await openDrawer();
    await cross(true);
    await settle();
    expect(load.cancelled, 'crossing 768 after a route change cancelled the logout').toBe(false);
  });

  it('spends a marker left current when Back restores the page', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await escape();
    await settle();
    expect(marked(), 'the close spent the marker while the page leaves').toBe(true);
    await act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await settle();
    expect(marked(), 'the marker outlived the restore').toBe(false);
  });

  // The user's Back cancels the load and pops the marker: the page is here, and the drawer's own.
  it("takes the drawer's history back after a Back while the page leaves", async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await act(() => history.back());
    await settle();
    expect(screen.queryByTestId('drawer'), 'Back left the drawer open').toBeNull();
    push.mockClear();
    await openDrawer();
    expect(push, 'the drawer stayed without its marker').toHaveBeenCalledTimes(1);
    expect(marked()).toBe(true);
  });

  // A load the page starts in place of the logout, as a reload, still takes the page: no Stop.
  // The tap REPLACED the marker; the entry it wrote is spent once a Stop finds the page here.
  it('spends the entry a tap on its own route wrote once a Stop leaves the page here', async () => {
    const router = mount();
    await openDrawer();
    await signOut('drawer');
    await act(() => router.navigate('/allocation', { replace: true }));
    await settle();
    expect(back, 'the drawer walked back over the logout').not.toHaveBeenCalled();
    await stop();
    await settle();
    expect(back, 'the entry the tap wrote outlived the Stop').toHaveBeenCalledTimes(1);
  });

  it('walks back no further once a Back has left the entry a tap on its own route wrote', async () => {
    const router = mount();
    await openDrawer();
    await signOut('drawer');
    await act(() => router.navigate('/allocation', { replace: true }));
    await act(() => history.back());
    await settle();
    expect(back, "the drawer walked back after the user's Back").toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/allocation');
  });

  it('keeps the pause when another load replaces the logout', async () => {
    mount();
    await openDrawer();
    await signOut('drawer');
    await escape();
    await settle();
    await act(async () => {
      navigation().dispatchEvent(new Event('navigateerror'));
      navigation().dispatchEvent(
        Object.assign(new Event('navigate'), { destination: { sameDocument: false } }),
      );
    });
    await settle();
    expect(back, 'the drawer walked back over the replacing load').not.toHaveBeenCalled();
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

describe('the drawer over unsaved work', () => {
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
    await openDrawer();
    await escape();
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(marked(), 'the close left the marker current').toBe(false);
  });

  it('closes by Back without reloading the page or asking', async () => {
    await arrive();
    await openDrawer();
    await act(() => history.back());
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(screen.queryByTestId('drawer'), 'Back left the drawer open').toBeNull();
    expect(marked()).toBe(false);
  });

  it('closes by crossing 768 without reloading the page or asking', async () => {
    await arrive();
    await openDrawer();
    await cross(true);
    await settle();
    expect(go, 'the close reloaded the page').not.toHaveBeenCalled();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(marked()).toBe(false);
  });

  it('asks before a link in the open drawer leaves the route', async () => {
    const router = await arrive();
    await openDrawer();
    await act(() => router.navigate('/portfolio'));
    expect(edit()).toBe('/allocation:editing:asking');
    await press('keep');
    expect(edit()).toBe('/allocation:editing:quiet');
    await act(() => router.navigate('/portfolio'));
    await press('discard');
    await settle();
    expect(edit()).toBe('/portfolio:idle:quiet');
  });

  it('asks before Back leaves the route with the drawer closed', async () => {
    await arrive();
    await act(() => history.back());
    await settle();
    expect(edit()).toBe('/allocation:editing:asking');
    await press('keep');
    await settle();
    expect(edit()).toBe('/allocation:editing:quiet');
    expect(location.pathname).toBe('/allocation');
  });

  // A drawer link to the route on screen REPLACES the marker (NavLink's same-path default).
  it('closes on a tap on its own route and spends the entry the tap wrote', async () => {
    const router = await arrive();
    await press('discard');
    await openDrawer();
    await act(() => router.navigate('/allocation', { replace: true }));
    await settle();
    expect(screen.queryByTestId('drawer'), 'the tap left the drawer open').toBeNull();
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
    await openDrawer();
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
    expect(screen.queryByTestId('drawer')).toBeNull();
  });

  // Forward lands on the entry the tap wrote: another key, the same URL, the same index.
  it('keeps the work when Forward pops to an entry of the same URL', async () => {
    const router = await arrive();
    await press('discard');
    await openDrawer();
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
  it('leaves the route on the next Back after the drawer closes, asking first', async () => {
    await arrive();
    await openDrawer();
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
