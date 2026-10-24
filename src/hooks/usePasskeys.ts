import { useQuery } from '@tanstack/react-query';

import { passkeyDeps } from '../auth/app';
import { listPasskeys, type PasskeyList } from '../auth/passkey';

/** The account's passkeys, with no window: read at every mount and every focus, since a passkey
 *  registered on another device or in another tab is news this tab cannot otherwise learn. A Google
 *  session's answer is data; a failed read is `failed` while no list is held, and never thrown,
 *  since the account stays. */
export function usePasskeys(): PasskeyList | undefined {
  const { data, error } = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => {
      const list = await listPasskeys(passkeyDeps);
      if (list.kind === 'failed') throw new Error('the relay did not list the passkeys');
      return list;
    },
    staleTime: 0,
    retry: false,
    networkMode: 'always',
  });
  if (data !== undefined) return data;
  return error === null ? undefined : { kind: 'failed' };
}
