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
/** An ID token whose payload carries `claims`, base64url and unpadded as a JWT's is. */
const jwt = (claims: object) => {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const payload = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
};
const ID_TOKEN = (idToken: string): RelayAnswer => ({
  kind: 'tokens',
  tokens: { idToken, accessToken: 'access', expiresIn: 3600 },
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
    expect(await session.signOut()).toEqual({});
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

  // The access token registers a passkey; it is issued, refreshed and expired with the ID token.
  it('hands out the access token of the same pair, refreshed on the same schedule', async () => {
    let now = 0;
    const relay = scripted(TOKENS('1'), TOKENS('2'));
    const session = createSession({ relay, locks: webLocks(), now: () => now });
    await session.restore();
    expect(await session.getAccessToken()).toBe('access.1');

    now = 3_541_000;
    expect(await Promise.all([session.getAccessToken(), session.getIdToken()])).toEqual([
      'access.2',
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

  it('asks the relay once however often the page restores it', async () => {
    const relay = scripted(TOKENS('1'));
    const session = createSession({ relay, locks: webLocks() });
    await Promise.all([session.restore(), session.restore()]);
    await session.restore();
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('asks nothing more once a sign-in, a sign-out or a refused refresh has settled it', async () => {
    const relay = scripted(TOKENS('1'), { kind: 'signedOut' });
    const session = createSession({ relay, locks: webLocks() });
    await session.respond(verifier);
    await session.restore();
    await session.signOut();
    await session.restore();
    expect(relay.mock.calls.map(([route]) => route)).toEqual(['respond', 'sign-out']);

    const refused = scripted(REFUSED('notAuthorized'));
    const signedOut = createSession({ relay: refused, locks: webLocks() });
    await signedOut.restore();
    await signedOut.restore();
    expect(refused).toHaveBeenCalledTimes(1);
  });

  // Offline says nothing about the cookie, so the load reads signed out and the next reader —
  // the shell on the next route, or `/sign-in` — asks again and can still find the session.
  it('asks again after a load the relay never answered', async () => {
    const relay = scripted(REFUSED('offline'), TOKENS('1'));
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect([session.status(), session.unanswered()]).toEqual(['signedOut', true]);
    await session.restore();
    expect([session.status(), session.unanswered()]).toEqual(['signedIn', false]);
    await session.restore();
    expect(relay).toHaveBeenCalledTimes(2);

    // A token asked for is a reader too.
    const asked = createSession({
      relay: scripted(REFUSED('failed'), TOKENS('2')),
      locks: webLocks(),
    });
    await asked.restore();
    expect(await asked.getIdToken()).toBe('id.2');
  });

  it('reads the address from the ID token and forgets it on sign-out', async () => {
    const session = createSession({
      relay: scripted(ID_TOKEN(jwt({ sub: 's', email: 'name@example.com' })), {
        kind: 'signedOut',
      }),
      locks: webLocks(),
    });
    expect(session.address()).toBeUndefined();
    await session.restore();
    expect(session.address()).toBe('name@example.com');
    await session.signOut();
    expect(session.address()).toBeUndefined();
  });

  it('names no address it cannot read, and reads one past ASCII', async () => {
    for (const [idToken, address] of [
      ['id.1', undefined],
      ['h.%%%.s', undefined],
      [jwt({ sub: 's' }), undefined],
      [jwt({ email: 42 }), undefined],
      [jwt({ email: '' }), undefined],
      [jwt({ email: 'ôwner@приклад.укр' }), 'ôwner@приклад.укр'],
    ] as const) {
      const session = createSession({ relay: scripted(ID_TOKEN(idToken)), locks: webLocks() });
      await session.restore();
      expect(session.status()).toBe('signedIn');
      expect(session.address()).toBe(address);
    }
  });

  it('sends one sign-out however often it is asked while one runs', async () => {
    const relay = scripted(TOKENS('1'), { kind: 'signedOut' });
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect(await Promise.all([session.signOut(), session.signOut()])).toEqual([{}, {}]);
    expect(relay.mock.calls.map(([route]) => route)).toEqual(['refresh', 'sign-out']);
  });
});

describe('Google', () => {
  const scripted = (...answers: RelayAnswer[]) =>
    vi.fn<RelayCall>(async () => answers.shift() ?? REFUSED('failed'));
  /** Records every lock asked for, and runs its call at once. */
  const recordingLocks = (names: string[]) =>
    ({
      request: (name: string, call: () => unknown) => {
        names.push(name);
        return call();
      },
    }) as unknown as Locks;

  // THE ANSWER EVERY LOAD ALREADY ASKS FOR SAYS IT; an answer that does not say leaves it unknown.
  it('knows whether Google is on from the refresh answer that says so, and from nothing else', async () => {
    const cases: [RelayAnswer, boolean | undefined][] = [
      [
        {
          kind: 'tokens',
          tokens: { idToken: 'id.1', accessToken: 'access.1', expiresIn: 3600 },
          google: true,
        },
        true,
      ],
      [{ kind: 'refused', reason: 'notAuthorized', google: false }, false],
      [{ kind: 'refused', reason: 'notAuthorized', google: true }, true],
      [TOKENS('1'), undefined],
      [REFUSED('offline'), undefined],
    ];
    for (const [answer, google] of cases) {
      const session = createSession({ relay: scripted(answer), locks: webLocks() });
      expect(session.google()).toBeUndefined();
      await session.restore();
      expect([answer, session.google()]).toEqual([answer, google]);
    }
  });

  it('completes a Google sign-in inside the lock, signed in by its tokens', async () => {
    const relay = scripted(REFUSED('notAuthorized'), TOKENS('g'));
    const names: string[] = [];
    const session = createSession({ relay, locks: recordingLocks(names) });
    await session.restore();
    expect(await session.complete({ code: 'c', state: 's' })).toEqual(TOKENS('g'));
    expect(relay.mock.calls.at(-1)).toEqual(['google/complete', { code: 'c', state: 's' }]);
    expect(names).toEqual(['quirenote-auth', 'quirenote-auth']);
    expect(session.status()).toBe('signedIn');
    expect(await session.getIdToken()).toBe('id.g');
  });

  it('stays signed out when the relay refuses the code', async () => {
    const session = createSession({
      relay: scripted(REFUSED('notAuthorized'), REFUSED('notAuthorized')),
      locks: webLocks(),
    });
    await session.restore();
    expect(await session.complete({ code: 'c', state: 's' })).toEqual(REFUSED('notAuthorized'));
    expect(session.status()).toBe('signedOut');
  });

  it('hands a sign-out’s logout endpoint back to whoever signed out', async () => {
    const logout = 'https://auth.test/logout?client_id=c';
    const session = createSession({
      relay: scripted(TOKENS('1'), { kind: 'signedOut', logout }),
      locks: webLocks(),
    });
    await session.restore();
    expect(await session.signOut()).toEqual({ logout });
    expect(session.status()).toBe('signedOut');
  });
});
