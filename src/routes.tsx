import { createBrowserRouter } from 'react-router';

import { Layout } from './app/Layout';
import { Root } from './app/Root';
import { Allocation } from './screens/Allocation';
import { Attributes } from './screens/Attributes';
import { Balances } from './screens/Balances';
import { DailyQuotes } from './screens/DailyQuotes';
import { Transactions } from './screens/Transactions';
import { Overview } from './screens/Overview';
import { Payouts } from './screens/Payouts';
import { Portfolio } from './screens/Portfolio';
import { Seasonality } from './screens/Seasonality';
import { Settings } from './screens/Settings';
import { Apply } from './screens/sign-in/Apply';
import { SignIn } from './screens/sign-in/SignIn';
import { Yield } from './screens/Yield';

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // Outside `<Layout />`: the signed-out shell has no portfolio behind it.
      { path: 'sign-in', element: <SignIn /> },
      { path: 'apply', element: <Apply /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <DailyQuotes /> },
          // The Transaction panel left `/` for a route of its own; `/` stays
          // the index, because it is the daily ritual and the app opens on it.
          { path: 'transactions', element: <Transactions /> },
          { path: 'overview', element: <Overview /> },
          { path: 'balances', element: <Balances /> },
          { path: 'payouts', element: <Payouts /> },
          { path: 'yield', element: <Yield /> },
          { path: 'attributes', element: <Attributes /> },
          { path: 'seasonality', element: <Seasonality /> },
          { path: 'portfolio', element: <Portfolio /> },
          { path: 'allocation', element: <Allocation /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
]);
