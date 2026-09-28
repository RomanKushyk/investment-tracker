import { isValidElement, type ComponentType } from 'react';
import { matchRoutes, type RouteObject } from 'react-router';
import { afterAll, describe, expect, it, vi } from 'vitest';

// `auth/app.ts` reads `location.hostname` as it loads, and every shell module imports it, so each
// module that reaches it comes in after the stub.
vi.stubGlobal('location', new URL('http://localhost:3300/'));
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('./routes');
const { Root } = await import('./app/Root');
const { Layout } = await import('./app/Layout');
const { AppFailure, NotFound, ScreenFailure } = await import('./app/Boundaries');
const { DailyQuotes } = await import('./screens/DailyQuotes');
const { Transactions } = await import('./screens/Transactions');
const { Overview } = await import('./screens/Overview');
const { Balances } = await import('./screens/Balances');
const { Payouts } = await import('./screens/Payouts');
const { Yield } = await import('./screens/Yield');
const { Attributes } = await import('./screens/Attributes');
const { Seasonality } = await import('./screens/Seasonality');
const { Portfolio } = await import('./screens/Portfolio');
const { Allocation } = await import('./screens/Allocation');
const { Settings } = await import('./screens/Settings');
const { SignIn } = await import('./screens/sign-in/SignIn');
const { Apply } = await import('./screens/sign-in/Apply');

const typeOf = (element: RouteObject['element']): unknown =>
  isValidElement(element) ? element.type : undefined;

/** The routes a path walks through, root first. */
function chain(path: string): RouteObject[] {
  const matches = matchRoutes(routes, path);
  expect(matches, `${path} matches nothing`).not.toBeNull();
  return matches!.map((m) => m.route);
}

/** The pathless route between `Layout` and the screens, which carries their boundary. */
function isScreenBoundary(route: RouteObject): boolean {
  return (
    route.path === undefined &&
    route.element === undefined &&
    typeOf(route.errorElement) === ScreenFailure
  );
}

describe('an unknown path', () => {
  // Without a `*` the router answers 404 on the root route and replaces the whole app.
  it.each(['/nope', '/sign-in/x', '/apply/x', '/overview/x', '/a/b/c'])(
    '%s lands on the not-found route inside the shell',
    (path) => {
      const [root, layout, boundary, leaf] = chain(path);
      expect(typeOf(root!.element)).toBe(Root);
      expect(typeOf(layout!.element)).toBe(Layout);
      expect(isScreenBoundary(boundary!), 'the catch-all is not under the screens’ boundary').toBe(
        true,
      );
      expect(leaf!.path).toBe('*');
      expect(typeOf(leaf!.element)).toBe(NotFound);
    },
  );
});

describe('the boundaries', () => {
  it('put the app-failure state on the root route', () => {
    expect(routes).toHaveLength(1);
    expect(typeOf(routes[0]!.element)).toBe(Root);
    expect(typeOf(routes[0]!.errorElement)).toBe(AppFailure);
  });

  // Below `Layout`, so a screen that throws keeps the sidebar; the shell itself has none, so a
  // throw in it reaches the root's.
  it('put every screen below one boundary that is itself below Layout', () => {
    const layout = routes[0]!.children!.find((r) => typeOf(r.element) === Layout)!;
    expect(layout.errorElement).toBeUndefined();
    expect(layout.children).toHaveLength(1);
    const boundary = layout.children![0]!;
    expect(isScreenBoundary(boundary)).toBe(true);
    const leaves = boundary.children!;
    expect(leaves).toHaveLength(12);
    for (const leaf of leaves) {
      expect(leaf.children, `${leaf.path} nests further`).toBeUndefined();
      expect(leaf.errorElement, `${leaf.path} catches its own throw`).toBeUndefined();
    }
  });
});

describe('the routes that exist', () => {
  const SCREENS: [string, ComponentType][] = [
    ['/', DailyQuotes],
    ['/transactions', Transactions],
    ['/overview', Overview],
    ['/balances', Balances],
    ['/payouts', Payouts],
    ['/yield', Yield],
    ['/attributes', Attributes],
    ['/seasonality', Seasonality],
    ['/portfolio', Portfolio],
    ['/allocation', Allocation],
    ['/settings', Settings],
  ];

  it.each(SCREENS)('%s still renders its screen, under the boundary', (path, Screen) => {
    const walked = chain(path);
    expect(walked).toHaveLength(4);
    expect(typeOf(walked[1]!.element)).toBe(Layout);
    expect(isScreenBoundary(walked[2]!)).toBe(true);
    expect(typeOf(walked[3]!.element)).toBe(Screen);
  });

  it.each([
    ['/sign-in', SignIn],
    ['/apply', Apply],
  ] as [string, ComponentType][])('%s still renders outside the shell', (path, Screen) => {
    const walked = chain(path);
    expect(walked).toHaveLength(2);
    expect(typeOf(walked[1]!.element)).toBe(Screen);
  });
});
