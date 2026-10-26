import { describe, expect, it, vi } from 'vitest';

import type { RelayAnswer, RelayCall, RelayRoute } from './relay';
import { createSession, type Locks } from './session';

const TOKENS = (id: string): RelayAnswer => ({
  kind: 'tokens',
  tokens: { idToken: `id.${id}`, expiresIn: 3600 },
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
  tokens: { idToken, expiresIn: 3600 },
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

  // THE ACCOUNT THE TAB SHOWS, which each passkey call names: read from the same pair, never verified.
  it('names the account of the pair it holds, refreshed on the same schedule', async () => {
    let now = 0;
    const relay = scripted(ID_TOKEN(jwt({ sub: 'user-1' })), ID_TOKEN(jwt({ sub: 'user-2' })));
    const session = createSession({ relay, locks: webLocks(), now: () => now });
    await session.restore();
    expect(await session.getAccount()).toBe('user-1');
    now = 3_541_000;
    expect(await session.getAccount()).toBe('user-2');
    expect(relay).toHaveBeenCalledTimes(2);
  });

  it('names no account for a token that carries none', async () => {
    const session = createSession({ relay: scripted(ID_TOKEN(jwt({}))), locks: webLocks() });
    await session.restore();
    expect(await session.getAccount()).toBeUndefined();
  });

  // A COOKIE ANOTHER TAB REPLACED: this tab learns of it only when its own pair runs out and the
  // refresh answers for the other account. No sign-out happened here, so the count of them is no tell.
  it('counts an account change: a refresh that answers another account than the one held', async () => {
    let now = 0;
    const relay = scripted(
      ID_TOKEN(jwt({ sub: 'user-1' })),
      ID_TOKEN(jwt({ sub: 'user-2' })),
      ID_TOKEN(jwt({ sub: 'user-2' })),
    );
    const session = createSession({ relay, locks: webLocks(), now: () => now });
    await session.restore();
    expect(session.accountChanges()).toBe(0);

    now = 3_541_000;
    await session.getIdToken();
    expect(session.accountChanges()).toBe(1);

    now = 2 * 3_541_000;
    await session.getIdToken();
    expect(session.accountChanges()).toBe(1);
  });

  it('counts no change for the same account refreshed, or for a pair that names none', async () => {
    let now = 0;
    const relay = scripted(
      ID_TOKEN(jwt({ sub: 'user-1' })),
      ID_TOKEN(jwt({ sub: 'user-1' })),
      TOKENS('opaque'),
    );
    const session = createSession({ relay, locks: webLocks(), now: () => now });
    await session.restore();

    now = 3_541_000;
    await session.getIdToken();
    now = 2 * 3_541_000;
    await session.getIdToken();

    expect(relay).toHaveBeenCalledTimes(3);
    expect(session.accountChanges()).toBe(0);
  });

  it('counts no change when someone signs in after a sign-out: that one emptied the page', async () => {
    const relay = scripted(
      ID_TOKEN(jwt({ sub: 'user-1' })),
      { kind: 'signedOut' },
      ID_TOKEN(jwt({ sub: 'user-2' })),
    );
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    await session.signOut();
    await session.respond({});

    expect(session.status()).toBe('signedIn');
    expect(session.accountChanges()).toBe(0);
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

  it('counts a sign-out from the moment it begins, not from the relay answering', async () => {
    let answer: (answered: RelayAnswer) => void = () => undefined;
    const relay = vi.fn<RelayCall>((route) =>
      route === 'sign-out'
        ? new Promise<RelayAnswer>((resolve) => (answer = resolve))
        : Promise.resolve(TOKENS('1')),
    );
    const session = createSession({ relay, locks: noLocks });
    await session.restore();
    expect(session.signOuts()).toBe(0);

    const leaving = session.signOut();
    expect(session.signOuts()).toBe(1);
    expect(session.status()).toBe('signedIn');

    answer({ kind: 'signedOut' });
    await leaving;
    expect(session.signOuts()).toBe(1);
  });

  it('says a sign-out is running from the moment it begins until the relay answers', async () => {
    let answer: (answered: RelayAnswer) => void = () => undefined;
    const relay = vi.fn<RelayCall>((route) =>
      route === 'sign-out'
        ? new Promise<RelayAnswer>((resolve) => (answer = resolve))
        : Promise.resolve(TOKENS('1')),
    );
    const session = createSession({ relay, locks: noLocks });
    await session.restore();
    expect(session.signingOut()).toBe(false);

    const leaving = session.signOut();
    expect(session.signingOut()).toBe(true);
    expect(session.status()).toBe('signedIn');

    answer({ kind: 'signedOut' });
    await leaving;
    expect(session.signingOut()).toBe(false);
  });

  it('is signing out no longer once a sign-out the relay could not complete has answered', async () => {
    const session = createSession({
      relay: scripted(TOKENS('1'), REFUSED('failed')),
      locks: webLocks(),
    });
    await session.restore();
    expect(await session.signOut()).toBe(false);
    expect(session.signingOut()).toBe(false);
  });

  // A control mounted mid-run reads the store, so the store says when a sign-out begins, and when
  // the relay answers it — a failed one too, which changes no status.
  it('tells its subscribers when a sign-out begins and when the relay answers it', async () => {
    let answer: (answered: RelayAnswer) => void = () => undefined;
    const relay = vi.fn<RelayCall>((route) =>
      route === 'sign-out'
        ? new Promise<RelayAnswer>((resolve) => (answer = resolve))
        : Promise.resolve(TOKENS('1')),
    );
    const session = createSession({ relay, locks: noLocks });
    await session.restore();
    const told: boolean[] = [];
    session.subscribe(() => told.push(session.signingOut()));

    const leaving = session.signOut();
    expect(told, 'nobody was told the sign-out began').toEqual([true]);

    answer(REFUSED('failed'));
    await leaving;
    expect(told.at(-1), 'nobody was told the failed sign-out ended').toBe(false);
  });

  it('counts one sign-out however often it is asked while one runs, and a failed one too', async () => {
    const session = createSession({
      relay: scripted(TOKENS('1'), REFUSED('failed'), { kind: 'signedOut' }),
      locks: webLocks(),
    });
    await session.restore();
    await Promise.all([session.signOut(), session.signOut()]);
    expect(session.signOuts()).toBe(1);
    await session.signOut();
    expect(session.signOuts()).toBe(2);
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
          tokens: { idToken: 'id.1', expiresIn: 3600 },
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

describe('signing out everywhere', () => {
  const logout = 'https://auth.test/logout?client_id=c';
  const signedIn = ID_TOKEN(jwt({ sub: 'u-1', email: 'a@b.cd' }));
  const scripted = (...answers: RelayAnswer[]) =>
    vi.fn<RelayCall>(async () => answers.shift() ?? REFUSED('failed'));

  // THE RELAY ACTS ONLY FOR THE ACCOUNT THIS TAB SHOWS, as every passkey call names it; it writes
  // the cookies, so it takes the lock.
  it('names the account it holds, inside the lock, and is signed out by the answer', async () => {
    const relay = scripted(signedIn, { kind: 'signedOut', logout });
    const names: string[] = [];
    const locks = {
      request: (name: string, call: () => unknown) => {
        names.push(name);
        return call();
      },
    } as unknown as Locks;
    const session = createSession({ relay, locks });
    await session.restore();

    expect(await session.signOutEverywhere()).toEqual({ kind: 'signedOut', logout });
    expect(relay.mock.calls.at(-1)).toEqual(['sign-out/global', { sub: 'u-1' }]);
    expect(names).toEqual(['quirenote-auth', 'quirenote-auth']);
    expect(session.status()).toBe('signedOut');
    expect(await session.getIdToken()).toBeUndefined();
  });

  // A SESSION ALREADY OVER HERE is a 401 that says whether Google is on, its cookies cleared: an
  // answer the network lost, retried. Anything else ended nothing, and the pair stays.
  it.each<[string, RelayAnswer, unknown, 'signedIn' | 'signedOut']>([
    [
      'a session already over here, Google on',
      { kind: 'refused', reason: 'notAuthorized', google: true, logout },
      { kind: 'signedOut', logout },
      'signedOut',
    ],
    [
      'a session already over here, Google off',
      { kind: 'refused', reason: 'notAuthorized', google: false },
      { kind: 'signedOut' },
      'signedOut',
    ],
    [
      'a sign-in too old',
      { kind: 'refused', reason: 'reauthenticate' },
      { kind: 'reauthenticate' },
      'signedIn',
    ],
    ['a failure', REFUSED('failed'), { kind: 'failed' }, 'signedIn'],
    ['no connection', REFUSED('offline'), { kind: 'failed' }, 'signedIn'],
    ['throttled', { kind: 'refused', reason: 'throttled' }, { kind: 'failed' }, 'signedIn'],
  ])('reads %s', async (_, answer, outcome, status) => {
    const session = createSession({ relay: scripted(signedIn, answer), locks: webLocks() });
    await session.restore();
    expect(await session.signOutEverywhere()).toEqual(outcome);
    expect(session.status()).toBe(status);
  });

  // A SESSION ENDED WHILE THE DIALOG WAITED, by another device or the token's age: the page is
  // signed out, so it lands as one, and asking again could never succeed.
  it('reads a session the relay ended meanwhile as signed out, sending nothing', async () => {
    let clock = 0;
    const relay = scripted(signedIn, REFUSED('failed'), REFUSED('notAuthorized'));
    const session = createSession({ relay, locks: webLocks(), now: () => clock });
    await session.restore();
    expect(await session.signOutEverywhere()).toEqual({ kind: 'failed' });
    clock = 3_600_000;
    expect(await session.signOutEverywhere()).toEqual({ kind: 'signedOut' });
    expect(session.status()).toBe('signedOut');
    expect(relay.mock.calls.map(([route]) => route)).toEqual([
      'refresh',
      'sign-out/global',
      'refresh',
    ]);
  });

  // THE PRESS'S OWN REFRESH can bring the account another tab signed in: the request is for the
  // account the dialog proved, so it goes nowhere.
  it('sends nothing when its own refresh brings another account', async () => {
    let clock = 0;
    const another = ID_TOKEN(jwt({ sub: 'u-2', email: 'b@b.cd' }));
    const relay = scripted(signedIn, another, { kind: 'signedOut' });
    const session = createSession({ relay, locks: webLocks(), now: () => clock });
    await session.restore();
    clock = 3_600_000;
    expect(await session.signOutEverywhere()).toEqual({ kind: 'failed' });
    expect(relay.mock.calls.map(([route]) => route)).toEqual(['refresh', 'refresh']);
  });

  // A REFUSAL WITH THE COOKIES GONE, a sign-out in another tab, while the pair held here is fresh:
  // one refresh says whether this browser is still signed in.
  it.each<[string, RelayAnswer, unknown, 'signedIn' | 'signedOut']>([
    ['signed out', REFUSED('notAuthorized'), { kind: 'signedOut' }, 'signedOut'],
    ['still signed in', signedIn, { kind: 'failed' }, 'signedIn'],
  ])('asks once after a plain refusal: %s', async (_, refreshed, outcome, status) => {
    const relay = scripted(signedIn, REFUSED('notAuthorized'), refreshed);
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect(await session.signOutEverywhere()).toEqual(outcome);
    expect(session.status()).toBe(status);
    expect(relay.mock.calls.map(([route]) => route)).toEqual([
      'refresh',
      'sign-out/global',
      'refresh',
    ]);
  });

  // The cookie is another account's: the refresh brings it, and nothing is sent for it.
  it('sends nothing more when the refresh after a plain refusal brings another account', async () => {
    const another = ID_TOKEN(jwt({ sub: 'u-2', email: 'b@b.cd' }));
    const relay = scripted(signedIn, REFUSED('notAuthorized'), another);
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect(await session.signOutEverywhere()).toEqual({ kind: 'failed' });
    expect(session.accountChanges()).toBe(1);
    expect(relay.mock.calls.map(([route]) => route)).toEqual([
      'refresh',
      'sign-out/global',
      'refresh',
    ]);
  });

  it.each<[string, RelayAnswer, unknown]>([
    ['signed out by the relay', REFUSED('notAuthorized'), { kind: 'signedOut' }],
    ['a load the relay never answered', REFUSED('offline'), { kind: 'failed' }],
  ])('sends nothing for a tab that holds no account, %s', async (_, answer, outcome) => {
    const relay = scripted(answer, answer);
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect(await session.signOutEverywhere()).toEqual(outcome);
    expect(relay.mock.calls.map(([route]) => route).includes('sign-out/global')).toBe(false);
  });

  // IT IS A SIGN-OUT to every reader: an answer from before it is the leaving account's.
  it('counts as a sign-out from when it begins, running until the relay answers', async () => {
    let answer: (answered: RelayAnswer) => void = () => undefined;
    const relay = vi.fn<RelayCall>((route) =>
      route === 'sign-out/global'
        ? new Promise<RelayAnswer>((resolve) => (answer = resolve))
        : Promise.resolve(signedIn),
    );
    const session = createSession({ relay, locks: noLocks });
    await session.restore();
    const told: boolean[] = [];
    session.subscribe(() => told.push(session.signingOut()));

    const leaving = session.signOutEverywhere();
    expect(session.signOuts()).toBe(1);
    expect(session.signingOut()).toBe(true);
    expect(told).toEqual([true]);

    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(2));
    answer(REFUSED('failed'));
    await leaving;
    expect(session.signingOut()).toBe(false);
    expect(told.at(-1)).toBe(false);
    expect(session.status()).toBe('signedIn');
  });

  it('sends one however often it is asked while one runs', async () => {
    const relay = scripted(signedIn, { kind: 'signedOut' });
    const session = createSession({ relay, locks: webLocks() });
    await session.restore();
    expect(await Promise.all([session.signOutEverywhere(), session.signOutEverywhere()])).toEqual([
      { kind: 'signedOut' },
      { kind: 'signedOut' },
    ]);
    expect(relay.mock.calls.map(([route]) => route)).toEqual(['refresh', 'sign-out/global']);
    expect(session.signOuts()).toBe(1);
  });
});
