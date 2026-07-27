import { Outlet } from 'react-router';

import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-9 pt-8 pb-12">
        <Outlet />
      </main>
    </div>
  );
}
