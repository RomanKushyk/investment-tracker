import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';

import { session } from '../auth/app';
import { LoadingStatus } from '../components/loading/LoadingStatus';
import { useSettingsCopy, useViewDayRollover } from '../hooks/queries';
import { subscribeToBreakpoint, useIsDesktop } from '../hooks/useIsDesktop';
import { useReminderToast } from '../hooks/useReminders';
import { AppHeader } from './AppHeader';
import { NAV_TRIGGER_ID, SIDEBAR_COLLAPSE_ID, SIDEBAR_ID } from './nav-ids';
import { Sidebar, SidebarDrawer } from './Sidebar';
import { SidebarRail } from './SidebarRail';
import { useSettings } from '../state/settings';

/** Marks the one history entry the drawer pushes, so Back can be told apart. */
interface DrawerHistoryState {
  quirenoteDrawer?: boolean;
}

export function Layout() {
  const { pathname } = useLocation();
  // HERE BECAUSE THE LAYOUT SPANS EVERY PORTFOLIO ROUTE: the toast fires once on app open, whatever
  // screen the person lands on. Theme and language are `Root`'s.
  useReminderToast();
  // The view is cut at the day, so a tab left open past midnight reads it again.
  useViewDayRollover();
  // A change to a setting is sent to the account while this shell is mounted (*Persistence today*).
  useSettingsCopy();
  // The footer band offers a sign-out only once the relay says someone is signed in. Asked on
  // every load, the session being the browser's, and again on each route until it answers:
  // once it has, `restore` asks nothing.
  useEffect(() => {
    void session.restore();
  }, [pathname]);

  // `desktop` is read from the media query rather than expressed only in CSS, because
  // a drawer needs a focus trap and a focus trap has to know which shell is mounted.
  const desktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // `persist` reads localStorage synchronously, so the first render carries the device's copy;
  // the account's answer may change it after (*Persistence today*).
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const setCollapsed = useSettings((s) => s.setSidebarCollapsed);

  // A route change closes the drawer, ADJUSTED DURING RENDER and not in an effect: an
  // effect runs after the commit, so the drawer would paint once over the new route
  // and then close. The RAW setter, never `toggleDrawer` — render must stay free of
  // history side effects, and the router has already pushed its own entry on top of
  // the marker, so popping would walk back to the route just left.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  // CROSSING THE BREAKPOINT IS THE OTHER CASE, and it cannot fold into the line above:
  // NOTHING IS PUSHED ON TOP OF THE MARKER HERE, so it stays the CURRENT entry and the
  // next Back press is swallowed popping a synthetic entry with the same URL.
  //
  // Handled by SUBSCRIBING rather than by comparing values during render: a change
  // callback is a place where both `setState` and `history.back()` are allowed, and
  // add/remove is symmetric, so StrictMode's double-subscribe still fires it once.
  //
  // The close stays OUTSIDE the marker guard: `drawerOpen` left true behind a shell
  // that no longer renders the drawer springs it open again on the way back down.
  useEffect(
    () =>
      subscribeToBreakpoint(() => {
        if ((window.history.state as DrawerHistoryState | null)?.quirenoteDrawer === true) {
          window.history.back();
        }
        setDrawerOpen(false);
      }),
    [],
  );

  // THE SIDEBAR'S CONTROLS DISAPPEAR WHEN THE RAIL FLIPS, so focus held in it falls to
  // `<body>` and a keyboard user Tabs from the top of the document to get the navigation
  // back; it moves to whichever trigger replaced them. A press names that trigger, and so
  // does a flip with focus inside the sidebar, whoever moved the rail: the account's answer
  // does too, and removes the panel with the link that held focus. An answer with focus
  // elsewhere leaves it there. The name is set in a store listener, which runs before the
  // commit while the focused control is still in the document. The effect spends the name
  // it finds, so it is inert on the first render and under StrictMode's second invocation.
  const focusAfter = useRef<string | undefined>(undefined);
  useEffect(
    () =>
      useSettings.subscribe((state, previous) => {
        if (state.sidebarCollapsed === previous.sidebarCollapsed) return;
        if (document.getElementById(SIDEBAR_ID)?.contains(document.activeElement)) {
          focusAfter.current = state.sidebarCollapsed ? NAV_TRIGGER_ID : SIDEBAR_COLLAPSE_ID;
        }
      }),
    [],
  );
  useEffect(() => {
    if (focusAfter.current === undefined) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = undefined;
  }, [collapsed]);

  function pressRail(next: boolean) {
    focusAfter.current = next ? NAV_TRIGGER_ID : SIDEBAR_COLLAPSE_ID;
    setCollapsed(next);
  }

  // The hardware Back button closes the drawer INSTEAD OF LEAVING THE ROUTE, through
  // one synthetic history entry. It keeps the URL and SPREADS the router's own state,
  // so `idx`/`key` survive and popping back is a no-op navigation. A HANDLER AND NOT
  // AN EFFECT: StrictMode runs an effect's body, cleanup, then body again, so the push
  // ran twice and the pop once and the stack grew a dead entry per open.
  function toggleDrawer(next: boolean) {
    if (next) {
      window.history.pushState({ ...window.history.state, quirenoteDrawer: true }, '');
    } else if ((window.history.state as DrawerHistoryState | null)?.quirenoteDrawer === true) {
      // Closing has to SPEND the entry it pushed, and THE GUARD KEEPS IT FROM FIRING
      // WHEN THE MARKER IS NOT THE CURRENT ENTRY: after a route change the router's own
      // entry sits on top, and popping would walk back to the route just left.
      window.history.back();
    }
    setDrawerOpen(next);
  }

  // Back has already popped the marker, so this only mirrors it into state — never
  // `history.back()` again. Always listening: a pop with the drawer closed is a no-op.
  useEffect(() => {
    const onPop = () => setDrawerOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const showHeader = !desktop || collapsed;

  return (
    <RadixDialog.Root open={drawerOpen} onOpenChange={toggleDrawer}>
      {/* Outside every screen, so it is not under a busy root; mounted empty, so its text is a change. */}
      <LoadingStatus />
      {/* `dvh`, not `vh`: `100vh` is the height with the toolbars RETRACTED, so a
          `min-h-screen` shell sits under the chrome. */}
      <div className="flex min-h-dvh">
        {desktop && (
          <Sidebar collapsed={collapsed} onCollapse={() => pressRail(true)}>
            <SidebarRail onExpand={() => pressRail(false)} />
          </Sidebar>
        )}
        {/* The safe-area insets live on this column ONCE rather than on the header and
            every screen: `viewport-fit=cover` extends the page under a notch, so the
            inline edges are paid back where the content column begins. */}
        <div className="flex min-w-0 flex-1 flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          {showHeader && <AppHeader desktop={desktop} open={drawerOpen} />}
          <main className="min-w-0 flex-1 px-9 pt-8 pb-12 max-md:px-3 max-md:pt-4">
            {/* keyed by route, so every screen change animates in */}
            <div key={pathname} className="animate-in duration-300 fade-in slide-in-from-bottom-2">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {!desktop && <SidebarDrawer />}
    </RadixDialog.Root>
  );
}
