import { Outlet, useLocation } from 'react-router';

import { useDbSync } from '../hooks/useDbSync';
import { useReminderToast } from '../hooks/useReminders';
import { Sidebar } from './Sidebar';

export function Layout() {
  const { pathname } = useLocation();
  // S6's single app-open reminder toast lives here: the layout is the one mount
  // point that spans every route, so the toast fires once on app open and never
  // again on navigation.
  useReminderToast();
  // Same reason: another tab replacing or clearing the dataset must reach this
  // tab whatever route it is sitting on (P4/D24).
  useDbSync();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-9 max-sm:px-3 pt-8 pb-12">
        {/* keyed by route so every screen change animates in softly (D7) */}
        <div key={pathname} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
