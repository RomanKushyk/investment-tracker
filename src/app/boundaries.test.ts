import { StrictMode, createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Outlet,
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
  type RouteObject,
} from 'react-router';
import { afterAll, describe, expect, it, vi } from 'vitest';

// `auth/app.ts` reads `location.hostname` as it loads, and `SignedOutShell` reaches it through
// `Sidebar`, so every module that reaches it comes in after the stub.
vi.stubGlobal('location', new URL('http://localhost:3300/'));
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../routes');
const { Root } = await import('./Root');
const { Layout } = await import('./Layout');
const { AppFailure, NotFound } = await import('./Boundaries');
const { uk } = await import('../i18n/messages');

// The real tree with its elements as markers, since `Root` and `Layout` read stores with no server
// snapshot; a server render runs no boundary, so the throw is handed to the router as its error.
function stubbed(route: RouteObject): RouteObject {
  const type = isValidElement(route.element) ? route.element.type : undefined;
  let element = route.element;
  if (type === Root) element = createElement('div', { 'data-stub': 'root' }, createElement(Outlet));
  else if (type === Layout)
    element = createElement('div', { 'data-stub': 'shell' }, createElement(Outlet));
  else if (element && type !== NotFound) element = createElement('p', { 'data-stub': 'screen' });
  return { ...route, element, children: route.children?.map(stubbed) } as RouteObject;
}

const PROBE = new Error('probe #278: the message a user must not see');
const STACK_LINE = PROBE.stack!.split('\n')[1]!.trim();

/** Renders `path`, with the probe thrown at the route `at` picks from the ones it walks. */
async function render(path: string, at?: (walked: RouteObject[]) => RouteObject) {
  const handler = createStaticHandler(routes.map(stubbed));
  const context = await handler.query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error(`${path} answered a Response`);
  const errors = at ? { [at(context.matches.map((m) => m.route)).id!]: PROBE } : context.errors;
  const state = { ...context, errors };
  const router = createStaticRouter(handler.dataRoutes, state);
  return renderToStaticMarkup(
    createElement(StaticRouterProvider, { router, context: state, hydrate: false }),
  );
}

/** What no state may show: the error, its stack, the router's own fallback, a status code. */
function expectNoDetail(html: string) {
  expect(html).not.toContain(PROBE.message);
  expect(html).not.toContain(STACK_LINE);
  expect(html).not.toMatch(/<pre\b/);
  expect(html).not.toContain('Unexpected Application Error');
  expect(html).not.toContain('Hey developer');
  expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\b[45]\d\d\b/);
}

describe('not found', () => {
  it.each(['/nope', '/sign-in/x'])(
    '%s renders inside the shell, with a way back to /',
    async (path) => {
      const html = await render(path);
      expect(html).toContain('data-stub="shell"');
      expect(html).not.toContain('data-stub="screen"');
      // Not found moves no focus, as no route change does.
      expect(html).toMatch(
        new RegExp(`<h2(?![^>]*tabindex)[^>]*>${uk.boundary.notFound.title}</h2>`),
      );
      expect(html).toContain(uk.boundary.notFound.lead);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/"[^>]*>${uk.boundary.notFound.home}</a>`));
      expectNoDetail(html);
    },
  );
});

describe('a screen that throws', () => {
  it('shows the failed-screen state inside the shell', async () => {
    const html = await render('/', (walked) => walked[2]!);
    expect(html).toContain('data-stub="shell"');
    expect(html).not.toContain('data-stub="screen"');
    // The title takes focus, so the failure is announced.
    expect(html).toMatch(new RegExp(`<h2[^>]*tabindex="-1"[^>]*>${uk.boundary.failed.title}</h2>`));
    expect(html).toContain(uk.boundary.failed.lead);
    expect(html).toMatch(new RegExp(`<button[^>]*>${uk.boundary.failed.reload}</button>`));
    expectNoDetail(html);
  });
});

describe('the app failing', () => {
  it('shows the app-failure state in place of Root, on a portfolio route and outside it', async () => {
    for (const path of ['/overview', '/sign-in']) {
      const html = await render(path, (walked) => walked[0]!);
      expect(html, path).not.toContain('data-stub="root"');
      expect(html, path).not.toContain('data-stub="shell"');
      expect(html, path).toMatch(
        new RegExp(`<h2[^>]*tabindex="-1"[^>]*>${uk.boundary.failed.title}</h2>`),
      );
      expect(html, path).toContain(uk.boundary.failed.lead);
      expectNoDetail(html);
    }
  });

  // How `main.tsx` renders it when the database cannot open: no router, no query client.
  it('renders on its own, with the signed-out bar', () => {
    const html = renderToStaticMarkup(createElement(StrictMode, null, createElement(AppFailure)));
    expect(html).toContain(uk.boundary.failed.title);
    expect(html).toContain(uk.boundary.failed.lead);
    expect(html).toMatch(new RegExp(`<button[^>]*>${uk.boundary.failed.reload}</button>`));
    expect(html).toContain(`aria-label="${uk.settings.language.ariaLabel}"`);
    expectNoDetail(html);
  });
});
