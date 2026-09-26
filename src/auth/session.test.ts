import { describe, expect, it, vi } from 'vitest';

import type { RelayAnswer, RelayCall, RelayRoute } from './relay';
import { createSession, type Locks } from './session';

const TOKENS = (id: string): RelayAnswer => ({
  kind: 'tokens',
  tokens: { idToken: `id.${id}`, accessToken: `access.${id}`, expiresIn: 3600 },
});
const REFUSED = (reason: 'notAuthorized' | 'failed' | 'offline'): RelayAnswer => ({
  kind: 'refused',
  reason,
});

// ONE JAR EVERY TAB SHARES and families that rotate, fork in the grace window and end when revoked
// (COGNITO-POOL-PARAMS.md, "What rotation does…"); a request reads the jar sent, writes it landed.
function browser(latencies: number[]) {
  const jar: { refresh?: string; origin?: string } = {};
  const familyOf = new Map<string, string>();
  const live = new Map<string, string>();
  const graced = new Map<string, string>();
  const ended = new Set<string>();
  let serial = 0;
  let inFlight = 0;
  let peak = 0;

  const issue = (family: string) => {
    const token = `${family}.${++serial}`;
    familyOf.set(token, family);
    live.set(family, token);
    return token;
  };
  const end = (...tokens: (string | undefined)[]) => {
    for (const token of tokens) if (token) ended.add(familyOf.get(token) ?? '');
  };

  function reach(route: RelayRoute, sent: typeof jar): [RelayAnswer, () => void] {
    if (route === 'respond') {
      const token = issue(`f${++serial}`);
      end(sent.refresh, sent.origin);
      return [TOKENS(token), () => Object.assign(jar, { refresh: token, origin: token })];
    }
    if (route === 'sign-out') {
      end(sent.refresh, sent.origin);
      return [
        { kind: 'signedOut' },
        () => Object.assign(jar, { refresh: undefined, origin: undefined }),
      ];
    }
    const presented = sent.refresh;
    const family = presented ? familyOf.get(presented) : undefined;
    const usable =
      presented &&
      family &&
      !ended.has(family) &&
      (live.get(family) === presented || graced.get(family) === presented);
    if (!usable) return [REFUSED('notAuthorized'), () => (jar.refresh = undefined)];
    if (live.get(family) === presented) graced.set(family, presented);
    const token = issue(family);
    return [TOKENS(token), () => (jar.refresh = token)];
  }

  const relay: RelayCall = async (route) => {
    const [answer, land] = reach(route, { ...jar });
    peak = Math.max(peak, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, latencies.shift() ?? 0));
    land();
    inFlight--;
    return answer;
  };

  return {
    relay,
    get peak() {
      return peak;
    },
    signedInEarlier() {
      const token = issue(`f${++serial}`);
      Object.assign(jar, { refresh: token, origin: token });
    },
  };
}

/** Web Locks' exclusive mode, one queue per name, first come first served. */
function webLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: (name: string, callback: () => Promise<unknown>) => {
      const run = (tails.get(name) ?? Promise.resolve()).then(() => callback());
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  } as unknown as Locks;
}

/** What the browser would do with no lock at all: run at once. */
const noLocks = { request: (_: string, callback: () => unknown) => callback() } as unknown as Locks;

const verifier = { challenge: 'PASSWORD_VERIFIER', session: 's', responses: {} };

async function reloadIsSignedIn(relay: RelayCall, locks: Locks) {
  const reload = createSession({ relay, locks });
  await reload.restore();
  return reload.status();
}

describe('two tabs loading together', () => {
  // The second request carries the cookie the first rotated out; inside the grace window it forks
  // the family, and the cookie keeps whichever answer lands last — here the dead child.
  const race = () => browser([20, 5, 0]);

  it('are both signed in, and the browser still is on the next load', async () => {
    const world = race();
    world.signedInEarlier();
    const locks = webLocks();
    const [a, b] = [
      createSession({ relay: world.relay, locks }),
      createSession({ relay: world.relay, locks }),
    ];

    await Promise.all([a.restore(), b.restore()]);

    expect([a.status(), b.status()]).toEqual(['signedIn', 'signedIn']);
    expect(await reloadIsSignedIn(world.relay, locks)).toBe('signedIn');
    expect(world.peak).toBe(1);
  });

  it('lose the session when nothing serialises them, which is why the lock exists', async () => {
    const world = race();
    world.signedInEarlier();
    const [a, b] = [
      createSession({ relay: world.relay, locks: noLocks }),
      createSession({ relay: world.relay, locks: noLocks }),
    ];

    await Promise.all([a.restore(), b.restore()]);

    expect(await reloadIsSignedIn(world.relay, noLocks)).toBe('signedOut');
  });
});

describe('a sign-in finishing while another tab refreshes', () => {
  // Either order at Cognito loses the new session unless the calls take turns: the refresh writes
  // an ended family's token over the new cookie, or its 401 clears it.
  const orders = [
    { order: 'the refresh reached Cognito first', refreshFirst: true, latencies: [20, 5, 0] },
    { order: 'the revocation reached Cognito first', refreshFirst: false, latencies: [5, 20, 0] },
  ];

  it.each(orders)('stays signed in when $order', async ({ refreshFirst, latencies }) => {
    const world = browser([...latencies]);
    world.signedInEarlier();
    const locks = webLocks();
    const [x, y] = [
      createSession({ relay: world.relay, locks }),
      createSession({ relay: world.relay, locks }),
    ];

    const both = refreshFirst
      ? [x.restore(), y.respond(verifier)]
      : [y.respond(verifier), x.restore()];
    await Promise.all(both);

    expect(y.status()).toBe('signedIn');
    expect(await reloadIsSignedIn(world.relay, locks)).toBe('signedIn');
    expect(world.peak).toBe(1);
  });

  it.each(orders)('loses it with no lock when $order', async ({ refreshFirst, latencies }) => {
    const world = browser([...latencies]);
    world.signedInEarlier();
    const [x, y] = [
      createSession({ relay: world.relay, locks: noLocks }),
      createSession({ relay: world.relay, locks: noLocks }),
    ];

    await Promise.all(
      refreshFirst ? [x.restore(), y.respond(verifier)] : [y.respond(verifier), x.restore()],
    );

    expect(await reloadIsSignedIn(world.relay, noLocks)).toBe('signedOut');
  });

  it('takes a turn for sign-out too', async () => {
    const world = browser([20, 5]);
    world.signedInEarlier();
    const locks = webLocks();
    const [x, y] = [
      createSession({ relay: world.relay, locks }),
      createSession({ relay: world.relay, locks }),
    ];

    await Promise.all([x.restore(), y.signOut()]);

    expect(world.peak).toBe(1);
  });
});

describe('one tab', () => {
  const scripted = (...answers: RelayAnswer[]) => {
    const relay = vi.fn<RelayCall>(async () => answers.shift() ?? REFUSED('failed'));
    return relay;
  };

  it('reads a refused refresh as signed out, and a failed one as unknown turned out', async () => {
    for (const [answer, status] of [
      [TOKENS('1'), 'signedIn'],
      [REFUSED('notAuthorized'), 'signedOut'],
      [REFUSED('offline'), 'signedOut'],
      [REFUSED('failed'), 'signedOut'],
    ] as const) {
      const session = createSession({ relay: scripted(answer), locks: webLocks() });
      expect(session.status()).toBe('unknown');
      await session.restore();
      expect(session.status()).toBe(status);
    }
  });

  it('signs in on a respond that carries tokens, and not on one that carries a challenge', async () => {
    const challenge: RelayAnswer = {
      kind: 'challenge',
      challenge: { challenge: 'NEW_PASSWORD_REQUIRED', session: 's', parameters: {} },
    };
    const session = createSession({ relay: scripted(challenge, TOKENS('1')), locks: webLocks() });
    expect(await session.respond(verifier)).toEqual(challenge);
    expect(session.status()).toBe('unknown');
    await session.respond(verifier);
    expect(session.status()).toBe('signedIn');
    expect(await session.getIdToken()).toBe('id.1');
  });

  it('tells its subscribers when the status moves', async () => {
    const session = createSession({ relay: scripted(TOKENS('1')), locks: webLocks() });
    const heard = vi.fn();
    session.subscribe(heard);
    await session.restore();
    expect(heard).toHaveBeenCalled();
  });

  it('keeps the tokens when the relay cannot confirm a sign-out', async () => {
    const session = createSession({
      relay: scripted(TOKENS('1'), REFUSED('failed'), { kind: 'signedOut' }),
      locks: webLocks(),
    });
    await session.restore();
    expect(await session.signOut()).toBe(false);
    expect(session.status()).toBe('signedIn');
    expect(await session.signOut()).toBe(true);
    expect(session.status()).toBe('signedOut');
    expect(await session.getIdToken()).toBeUndefined();
  });

  it('refreshes once for every caller when the ID token has under a minute left', async () => {
    let now = 0;
    const relay = scripted(TOKENS('1'), TOKENS('2'));
    const session = createSession({ relay, locks: webLocks(), now: () => now });
    await session.restore();

    now = 3_540_000;
    expect(await session.getIdToken()).toBe('id.1');
    expect(relay).toHaveBeenCalledTimes(1);

    now = 3_541_000;
    expect(await Promise.all([session.getIdToken(), session.getIdToken()])).toEqual([
      'id.2',
      'id.2',
    ]);
    expect(relay).toHaveBeenCalledTimes(2);
  });

  it('hands out no token once it has expired and the refresh could not run', async () => {
    let now = 0;
    const session = createSession({
      relay: scripted(TOKENS('1'), REFUSED('offline')),
      locks: webLocks(),
      now: () => now,
    });
    await session.restore();

    now = 3_600_000;
    expect(await session.getIdToken()).toBeUndefined();
    expect(session.status()).toBe('signedIn');
  });
});
