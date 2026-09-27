import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { arrivedSignedOut, SIGNED_OUT, usedUp } from './signed-out';

// `/sign-in` SAYS SO ONCE, ON THE ARRIVAL A SIGN-OUT CAUSES (`design/extensions/sign-out-landing.dc.html`,
// T4). The memory router keeps its entries and their state as the browser's history does; a reload is
// a new router opened on the entry the old one stood on, state and all, as the browser keeps
// `history.state`.
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

  it('replaced the entry rather than adding one, so Back leaves and Forward says nothing', async () => {
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
