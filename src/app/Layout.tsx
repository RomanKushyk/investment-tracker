import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useDbSync } from '../hooks/useDbSync';
import { subscribeToBreakpoint, useIsDesktop } from '../hooks/useIsDesktop';
import { useReminderToast } from '../hooks/useReminders';
import { AppHeader } from './AppHeader';
import { NAV_TRIGGER_ID, SIDEBAR_COLLAPSE_ID } from './nav-ids';
import { Sidebar, SidebarDrawer } from './Sidebar';
import { SidebarRail } from './SidebarRail';
import { useSettings } from '../state/settings';

/** Marks the one history entry the drawer pushes, so Back can be told apart. */
interface DrawerHistoryState {
  quirenoteDrawer?: boolean;
}

export function Layout() {
  const { pathname } = useLocation();
  // HERE BECAUSE THE LAYOUT SPANS EVERY PORTFOLIO ROUTE: the toast fires once on app open, and
  // another tab's dataset change reaches this one on any route. Theme and language are `Root`'s.
  useReminderToast();
  useDbSync();

  // `desktop` is read from the media query rather than expressed only in CSS, because
  // a drawer needs a focus trap and a focus trap has to know which shell is mounted.
  const desktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // `persist` reads localStorage synchronously, so the first render already carries the
  // stored value and the focus effect below sees no change on load.
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

  // EITHER CONTROL DISAPPEARS WHEN IT IS ACTIVATED, so focus falls to `<body>` and a
  // keyboard user Tabs from the top of the document to get the navigation back; it
  // moves to whichever trigger replaced it. Compares against the PREVIOUS value rather
  // than a mounted flag, so it is inert on the first render and under StrictMode's
  // second invocation.
  const prevCollapsed = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    document.getElementById(collapsed ? NAV_TRIGGER_ID : SIDEBAR_COLLAPSE_ID)?.focus();
  }, [collapsed]);

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
      {/* `dvh`, not `vh`: `100vh` is the height with the toolbars RETRACTED, so a
          `min-h-screen` shell sits under the chrome. */}
      <div className="flex min-h-dvh">
        {desktop && (
          <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(true)}>
            <SidebarRail onExpand={() => setCollapsed(false)} />
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
