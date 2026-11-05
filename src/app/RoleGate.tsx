import { Navigate, Outlet, useLocation, useMatches } from 'react-router';

import { useRoleGate } from '../hooks/queries';
import { NotFound } from './Boundaries';
import { ADMIN_LANDING } from './admin-home';

/** The `handle` of a route whose screen reads the portfolio. */
export const PORTFOLIO = { portfolio: true } as const;

const isPortfolio = (handle: unknown) => (handle as typeof PORTFOLIO | undefined)?.portfolio;

/** Between the screens' boundary and the screens: no screen is chosen until `GET /me` names the
 *  role, and a failed read is the failed screen with the shell kept (*Not found and failures*). A
 *  portfolio route is a user's alone, denied to every other role; the super-admin's `/` is its own
 *  home. */
export function RoleGate() {
  const role = useRoleGate();
  const { pathname } = useLocation();
  const portfolio = useMatches().some((match) => isPortfolio(match.handle));
  if (role === 'pending') return null;
  if (role === 'super_admin' && pathname === '/') return <Navigate to={ADMIN_LANDING} replace />;
  if (portfolio && role !== 'user' && role !== 'signedOut') return <NotFound />;
  return <Outlet />;
}
