import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  arrivedSignedOut,
  carrySignedOut,
  forgetSignedOut,
  logoutFor,
  returnedSignedOut,
  SIGNED_OUT,
  throughLogout,
  usedUp,
} from './signed-out';

// `/sign-in` SAYS SO ONCE, ON A SIGN-OUT'S ARRIVAL (`sign-out-landing.dc.html`, T4). A reload is
// a new router opened on the entry the old one stood on, state and all, as a browser's is.
const ROUTES = [{ path: '/overview' }, { path: '/sign-in' }, { path: '/apply' }];
type Router = ReturnType<typeof createMemoryRouter>;

const said = (router: Router) => arrivedSignedOut(router.state.location.state);
const reload = (router: Router) =>
  createMemoryRouter(ROUTES, { initialEntries: [router.state.location] });

async function signedOutArrival(): Promise<Router> {
  const router = createMemoryRouter(ROUTES, { initialEntries: ['/overview'] });
  await router.navigate('/sign-in', { state: SIGNED_OUT });
  return router;
}

async function usedUpArrival(): Promise<Router> {
  const router = await signedOutArrival();
  await router.navigate(...usedUp(router.state.location));
  return router;
}

describe('the fact a sign-out hands `/sign-in`', () => {
  it('is read from the state a sign-out navigates with, and from nothing else', () => {
    expect(arrivedSignedOut(SIGNED_OUT)).toBe(true);
    for (const other of [undefined, null, {}, { signedOut: 'true' }, { signedOut: 1 }, true]) {
      expect(arrivedSignedOut(other), JSON.stringify(other)).toBe(false);
    }
  });

  it('is said on the arrival a sign-out causes', async () => {
    expect(said(await signedOutArrival())).toBe(true);
  });

  // The trap the page exists to close: read once and left, the fact comes back on every reload.
  it('outlives a reload while the page leaves it in place', async () => {
    expect(said(reload(await signedOutArrival()))).toBe(true);
  });

  it('is not said on a visit no sign-out caused', async () => {
    expect(said(createMemoryRouter(ROUTES, { initialEntries: ['/sign-in'] })), 'by URL').toBe(
      false,
    );
    const fromApply = createMemoryRouter(ROUTES, { initialEntries: ['/apply'] });
    await fromApply.navigate('/sign-in');
    expect(said(fromApply), 'from `/apply`').toBe(false);
  });
});

describe('once `/sign-in` has used it up', () => {
  it('is still on the page it arrived at, search and hash kept', async () => {
    const router = createMemoryRouter(ROUTES, { initialEntries: ['/overview'] });
    await router.navigate('/sign-in?from=shell#top', { state: SIGNED_OUT });
    await router.navigate(...usedUp(router.state.location));
    const { pathname, search, hash } = router.state.location;
    expect({ pathname, search, hash }).toEqual({
      pathname: '/sign-in',
      search: '?from=shell',
      hash: '#top',
    });
  });

  it('is not said after a reload', async () => {
    expect(said(reload(await usedUpArrival()))).toBe(false);
  });

  it('replaced its entry rather than adding one: Back leaves, Forward says nothing', async () => {
    const router = await usedUpArrival();
    await router.navigate(-1);
    expect(router.state.location.pathname, 'Back stayed on `/sign-in`: a push').toBe('/overview');
    await router.navigate(1);
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(said(router)).toBe(false);
  });

  it('is not said on Back from a later page', async () => {
    const router = await usedUpArrival();
    await router.navigate('/apply');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(said(router)).toBe(false);
  });
});

// A SIGN-OUT THROUGH COGNITO'S LOGOUT loads `/sign-in` afresh from another origin, where router
// state cannot follow; this tab's session storage does, and is read until the page spends it.
describe('the fact carried across Cognito’s logout', () => {
  const store = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    };
  };
  const refusing = {
    getItem: () => {
      throw new DOMException('', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('', 'QuotaExceededError');
    },
    removeItem: () => {
      throw new DOMException('', 'SecurityError');
    },
  };

  it('is said once carried, until it is forgotten', () => {
    const tab = store();
    expect(returnedSignedOut(tab)).toBe(false);
    carrySignedOut(tab);
    expect(returnedSignedOut(tab)).toBe(true);
    expect(returnedSignedOut(tab), 'a read alone spent it').toBe(true);
    forgetSignedOut(tab);
    expect(returnedSignedOut(tab)).toBe(false);
  });

  it('is never said where the tab keeps no storage, and never throws there', () => {
    expect(() => carrySignedOut(refusing)).not.toThrow();
    expect(returnedSignedOut(refusing)).toBe(false);
    expect(() => forgetSignedOut(refusing)).not.toThrow();
    expect(returnedSignedOut(undefined)).toBe(false);
  });

  const LOGOUT = 'https://auth.test/logout?client_id=c';
  const SITE = 'https://dev.quirenote.com';

  it('leaves through the logout only with one to leave through, on a listed site', () => {
    expect(throughLogout(undefined, SITE, SITE, '/sign-in')).toBeUndefined();
    expect(throughLogout(LOGOUT, undefined, 'http://localhost:3300', '/sign-in')).toBeUndefined();
    expect(throughLogout(LOGOUT, SITE, SITE, '/apply')?.url).toBe(
      logoutFor(LOGOUT, SITE, '/apply'),
    );
  });

  // STORAGE IS THE ORIGIN'S: a flag left on another host would wait there to be said falsely.
  it('carries the fact to `/sign-in` only from the site Cognito lands on', () => {
    expect(throughLogout(LOGOUT, SITE, SITE, '/sign-in')?.carry).toBe(true);
    expect(throughLogout(LOGOUT, SITE, 'https://www.dev.quirenote.com', '/sign-in')?.carry).toBe(
      false,
    );
    expect(throughLogout(LOGOUT, SITE, SITE, '/apply')?.carry).toBe(false);
  });

  // COGNITO REDIRECTS TO `logout_uri` when it is "an authorized sign-out URL for the app client".
  it('sends the browser back to the page the sign-out leaves for, on the listed site', () => {
    expect(
      logoutFor('https://auth.test/logout?client_id=c', 'https://dev.quirenote.com', '/sign-in'),
    ).toBe(
      'https://auth.test/logout?client_id=c&logout_uri=https%3A%2F%2Fdev.quirenote.com%2Fsign-in',
    );
  });
});
