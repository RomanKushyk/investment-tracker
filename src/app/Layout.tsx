import { Outlet, useLocation } from 'react-router';

import { Sidebar } from './Sidebar';

export function Layout() {
  const { pathname } = useLocation();
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
