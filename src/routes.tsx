import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

import { AppFailure, NotFound, ScreenFailure } from './app/Boundaries';
import { Layout } from './app/Layout';
import { PORTFOLIO, RoleGate } from './app/RoleGate';
import { Root } from './app/Root';
import { Loadable } from './components/loading/Loadable';
import { Allocation } from './screens/Allocation';
import { ArchiveAdmin } from './screens/ArchiveAdmin';
import { Attributes } from './screens/Attributes';
import { Balances } from './screens/Balances';
import { DailyQuotes } from './screens/DailyQuotes';
import { Transactions } from './screens/Transactions';
import { Overview } from './screens/Overview';
import { Payouts } from './screens/Payouts';
import { Portfolio } from './screens/Portfolio';
import { Terms } from './screens/legal/Terms';
import { Privacy } from './screens/privacy/Privacy';
import { Profile } from './screens/Profile';
import { Seasonality } from './screens/Seasonality';
import { Settings } from './screens/Settings';
import { Apply } from './screens/sign-in/Apply';
import { GoogleCallback } from './screens/sign-in/GoogleCallback';
import { SignIn } from './screens/sign-in/SignIn';
import { Yield } from './screens/Yield';
import {
  AllocationPlaceholder,
  AttributesPlaceholder,
  BalancesPlaceholder,
  DailyQuotesPlaceholder,
  OverviewPlaceholder,
  PayoutsPlaceholder,
  PortfolioPlaceholder,
  SeasonalityPlaceholder,
  TransactionsPlaceholder,
  YieldPlaceholder,
} from './screens/placeholders';

/** A screen that reads the portfolio waits behind the view, and holds its place while it does. */
const behindView = (placeholder: ReactNode, screen: ReactNode) => (
  <Loadable placeholder={placeholder}>{screen}</Loadable>
);

export const routes: RouteObject[] = [
  {
    element: <Root />,
    // A throw in `Root` or `Layout`, or on a signed-out page: there is no shell left to keep.
    errorElement: <AppFailure />,
    children: [
      // Outside `<Layout />`: the signed-out shell has no portfolio behind it.
      { path: 'sign-in', element: <SignIn /> },
      { path: 'apply', element: <Apply /> },
      // Cognito's redirect back from Google (`CallbackURLs`); `/auth/*` otherwise is the API's.
      { path: 'auth/callback', element: <GoogleCallback /> },
      // The privacy notice, the same page for every reader, signed in or not (*Legal documents*).
      { path: 'privacy', element: <Privacy /> },
      // The terms of use, in the same frame for the same reason.
      { path: 'terms', element: <Terms /> },
      {
        element: <Layout />,
        children: [
          {
            // Between the shell and the screens, so a screen that throws keeps the sidebar; the
            // gate chooses no screen until `GET /me` names the role.
            element: <RoleGate />,
            errorElement: <ScreenFailure />,
            children: [
              {
                index: true,
                handle: PORTFOLIO,
                element: behindView(<DailyQuotesPlaceholder />, <DailyQuotes />),
              },
              // The Transaction panel left `/` for a route of its own; `/` stays
              // the index, because it is the daily ritual and the app opens on it.
              {
                path: 'transactions',
                handle: PORTFOLIO,
                element: behindView(<TransactionsPlaceholder />, <Transactions />),
              },
              {
                path: 'overview',
                handle: PORTFOLIO,
                element: behindView(<OverviewPlaceholder />, <Overview />),
              },
              {
                path: 'balances',
                handle: PORTFOLIO,
                element: behindView(<BalancesPlaceholder />, <Balances />),
              },
              {
                path: 'payouts',
                handle: PORTFOLIO,
                element: behindView(<PayoutsPlaceholder />, <Payouts />),
              },
              {
                path: 'yield',
                handle: PORTFOLIO,
                element: behindView(<YieldPlaceholder />, <Yield />),
              },
              {
                path: 'attributes',
                handle: PORTFOLIO,
                element: behindView(<AttributesPlaceholder />, <Attributes />),
              },
              {
                path: 'seasonality',
                handle: PORTFOLIO,
                element: behindView(<SeasonalityPlaceholder />, <Seasonality />),
              },
              {
                path: 'portfolio',
                handle: PORTFOLIO,
                element: behindView(<PortfolioPlaceholder />, <Portfolio />),
              },
              {
                path: 'allocation',
                handle: PORTFOLIO,
                element: behindView(<AllocationPlaceholder />, <Allocation />),
              },
              // Settings reads no figure of the view: it waits for the role alone.
              { path: 'settings', element: <Settings /> },
              // The super-admin's archive panel reads the account and the archive, never the view.
              { path: 'admin/archive', element: <ArchiveAdmin /> },
              // The profile reads the account, not the view, and holds its own place for it.
              { path: 'profile', element: <Profile /> },
              // Every path nothing else matches, `/sign-in/x` too, inside the shell.
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];
