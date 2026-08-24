import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useDbSync } from '../hooks/useDbSync';
import { subscribeToBreakpoint, useIsDesktop } from '../hooks/useIsDesktop';
import { useReminderToast } from '../hooks/useReminders';
import { AppHeader, NAV_TRIGGER_ID, SIDEBAR_COLLAPSE_ID } from './AppHeader';
import { Sidebar, SidebarDrawer } from './Sidebar';
import { useDocumentLang } from '../i18n/useDocumentLang';
import { useTheme } from './theme';

/** Marks the one history entry the drawer pushes, so Back can be told apart. */
interface DrawerHistoryState {
  quirenoteDrawer?: boolean;
}

export function Layout() {
  const { pathname } = useLocation();
  // S6's single app-open reminder toast lives here: the layout is the one mount
  // point that spans every route, so the toast fires once on app open and never
  // again on navigation.
  useReminderToast();
  // Same reason this lives here rather than in a component: the layout is the
  // one mount point that spans every route, so `data-theme` has exactly one
  // owner for the whole life of the page (index.html's head script owns the
  // first paint and nothing else).
  useTheme();
  // Same one-mount-point reasoning: <html lang> is a root attribute too.
  useDocumentLang();
  // Same reason: another tab replacing or clearing the dataset must reach this
  // tab whatever route it is sitting on (P4/D24).
  useDbSync();

  // THE TWO SHELLS (phase 6, G-1), and the two pieces of state that pick one.
  // `desktop` is read from the media query rather than expressed only in CSS,
  // because a drawer needs a focus trap and a focus trap has to know which shell
  // is actually mounted.
  const desktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // NOT PERSISTED, deliberately. Nothing in the brief asks for it, and a stored
  // collapse would mean a new settings field, its `partialize` entry and its
  // migration — scope this phase was not given. It is a per-session choice and
  // it behaves like one.
  const [collapsed, setCollapsed] = useState(false);

  // D1 — a route change closes the drawer. Tapping a nav pill and being left
  // looking at the nav is the commonest way a drawer feels broken.
  //
  // ADJUSTED DURING RENDER, not in an effect. The two are not equivalent here —
  // an effect runs AFTER the commit, so the drawer would paint once over the new
  // route and then close, and `react-hooks/set-state-in-effect` rejects the
  // shape for exactly that reason. This is React's documented pattern for state
  // that has to follow other state: compare against the value the last render
  // saw, and correct before anything is shown.
  //
  // The RAW setter here, never `toggleDrawer`: render must stay free of history
  // side effects, and for a route change not spending the marker is the right
  // answer anyway — by then the router has pushed its own entry on top of it, so
  // popping would walk back to the route the user just left. The marker is left
  // buried, which costs nothing: its URL is the previous route's, which is where
  // Back was going.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  // CROSSING THE BREAKPOINT IS THE OTHER CASE, and folding it into the line
  // above was a bug. `drawerOpen` left true behind a shell that no longer
  // renders the drawer would spring it open again on the way back down — but
  // more than that, NOTHING IS PUSHED ON TOP OF THE MARKER HERE, so it stays the
  // CURRENT entry. Measured: rotate to landscape with the drawer open and
  // `history.state` still carried `quirenoteDrawer`, so the next Back press was
  // swallowed popping a synthetic entry with the same URL and appeared to do
  // nothing.
  //
  // Handled by SUBSCRIBING to the same media query the shell reads, rather than
  // by comparing values during render: a change callback is a place where both
  // `setState` and `history.back()` are allowed, and add/remove is symmetric, so
  // StrictMode's double-subscribe still fires it once. The guard is
  // self-checking — the marker is the current entry exactly when the drawer was
  // open, so a crossing with it closed does nothing at all.
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

  // The control that collapses the rail is INSIDE the rail, so activating it
  // makes it `inert`; the control that expands it is unmounted by its own click.
  // Either way the activated element disappears and focus falls to `<body>`,
  // leaving a keyboard user to Tab from the top of the document to get the
  // navigation back. Measured: `document.activeElement` was `BODY`. So focus
  // moves to whichever trigger replaced it.
  //
  // Compares against the PREVIOUS value rather than using a mounted flag: that
  // makes it inert on the first render and inert again under StrictMode's second
  // invocation, so nothing steals focus on page load.
  const prevCollapsed = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    document.getElementById(collapsed ? NAV_TRIGGER_ID : SIDEBAR_COLLAPSE_ID)?.focus();
  }, [collapsed]);

  // D2 — the hardware Back button closes the drawer INSTEAD OF LEAVING THE
  // ROUTE. On Android that is the first thing a thumb reaches for, and losing
  // the screen underneath is a surprising price for dismissing a menu.
  //
  // The mechanism is one synthetic history entry, pushed when the drawer opens.
  // It keeps the URL (no third argument to `pushState`) and it SPREADS the
  // router's own state rather than replacing it, so react-router's `idx`/`key`
  // survive and popping back to the real entry is a no-op navigation to the same
  // location instead of a confused one.
  //
  // A HANDLER AND NOT AN EFFECT, and that distinction is the whole reason this
  // works. Written as an effect it pushed the marker TWICE on every open in
  // development: StrictMode deliberately runs an effect's body, then its cleanup,
  // then its body again — so the push ran twice and the pop once, and the stack
  // grew a dead entry per open. Measured, not guessed: `history.state` still
  // carried the marker after Escape had closed the drawer. Handlers run when the
  // user acts, exactly once, in both modes.
  function toggleDrawer(next: boolean) {
    if (next) {
      window.history.pushState({ ...window.history.state, quirenoteDrawer: true }, '');
    } else if ((window.history.state as DrawerHistoryState | null)?.quirenoteDrawer === true) {
      // Closing by Escape, by the scrim or by the trigger has to SPEND the entry
      // it pushed. The guard keeps this from firing when the marker is not the
      // current entry: after a route change the router's own entry sits on top
      // of it, and popping then would walk back to the route just left.
      window.history.back();
    }
    setDrawerOpen(next);
  }

  // Back has already popped the marker by the time this runs, so it only mirrors
  // that into state — never `history.back()` a second time. Always listening,
  // because a pop with the drawer already closed is a no-op and gating it on
  // `drawerOpen` would only add a subscribe/unsubscribe cycle per open.
  useEffect(() => {
    const onPop = () => setDrawerOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Below the breakpoint the header is the sidebar's stand-in and is always
  // there; at and above it, it appears only while the rail is collapsed.
  const showHeader = !desktop || collapsed;

  return (
    <RadixDialog.Root open={drawerOpen} onOpenChange={toggleDrawer}>
      {/* `dvh`, not `vh` (G-3): on iOS Safari `100vh` is the height the viewport
          has with the toolbars RETRACTED, so a `min-h-screen` shell is taller
          than what is actually visible and its bottom sits under the chrome. */}
      <div className="flex min-h-dvh">
        {desktop && <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(true)} />}
        {/* The safe-area insets live on this column, once, rather than on the
            header and every screen separately: `viewport-fit=cover` extends the
            page under a notch, so the inline edges have to be paid back exactly
            where the content column begins. The header is then full-bleed WITHIN
            the safe area, which is where a header belongs. */}
        <div className="flex min-w-0 flex-1 flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          {showHeader && (
            <AppHeader
              mode={desktop ? 'expand' : 'drawer'}
              open={drawerOpen}
              onExpand={() => setCollapsed(false)}
            />
          )}
          <main className="min-w-0 flex-1 px-9 pt-8 pb-12 max-md:px-3 max-md:pt-4">
            {/* keyed by route so every screen change animates in softly (D7) */}
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
