import { flushSync } from 'react-dom';
import { RouterProvider as CoreRouterProvider, type RouterProviderProps } from 'react-router';

/** `react-router/dom`'s provider, which `main.tsx` mounts: the core one handed React DOM's
 *  `flushSync`, without which a `{ flushSync: true }` navigation commits in a transition. */
export function RouterProvider(props: Omit<RouterProviderProps, 'flushSync'>) {
  return <CoreRouterProvider flushSync={(commit) => void flushSync(commit)} {...props} />;
}
