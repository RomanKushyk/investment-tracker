import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// A figure a screen computes for itself is one `/view` does not have, so each screen takes its
// figures from the one view query, through ONE selector defined at module level and held on the
// source (*Core is pure*); arithmetic on what a selector returns is review's.

interface Rule {
  /** Every name it takes from the package that is not a type, each with why the slice does not own it. */
  allow: Record<string, string>;
}

const RULES: Record<string, Rule> = {
  'src/screens/Overview.tsx': {
    allow: { 'money#toUsd': 'currency conversion stays in the component' },
  },
  'src/screens/Yield.tsx': { allow: {} },
  'src/screens/Seasonality.tsx': { allow: {} },
  'src/screens/Attributes.tsx': {
    allow: {
      'view/attributes#derivedYtmPct':
        'the YTM overlay: the feed is the device’s, and the server never holds it',
    },
  },
  'src/screens/Payouts.tsx': { allow: {} },
  'src/screens/Portfolio.tsx': { allow: {} },
  'src/screens/Allocation.tsx': { allow: {} },
  'src/screens/Balances.tsx': {
    allow: {
      'view/balances#pageHasNotHeldQuote':
        'the footnote asks whether the page it shows holds a marked cell',
    },
  },
  'src/hooks/useCapitalCard.ts': {
    allow: { 'money#toUsd': 'currency conversion stays in the component' },
  },
  'src/hooks/usePeriodWindow.tsx': { allow: {} },
};

const CORE = '@quirenote/core/';

// One parse per file: the whole-tree tests below read every file of `src/` several times.
const parsed = new Map<string, ts.SourceFile>();
const parse = (rel: string): ts.SourceFile => {
  let sf = parsed.get(rel);
  if (!sf) {
    sf = ts.createSourceFile(
      rel,
      readFileSync(join(REPO, rel), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    parsed.set(rel, sf);
  }
  return sf;
};

interface Imported {
  key: string;
  local: string;
  aliased: boolean;
  typeOnly: boolean;
}

/** One key per way a file can take a module, so an allow-list over the keys has no unlisted route
 *  in; an import by a computed name keys as `?#import()`, a Vite glob as `?#import.meta.glob`. */
function importsOf(sf: ts.SourceFile, matches: (spec: string) => boolean): Imported[] {
  const local = (spec: string) => (spec.startsWith(CORE) ? spec.slice(CORE.length) : spec);
  const out: Imported[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier) &&
      matches(n.moduleSpecifier.text)
    ) {
      const mod = local(n.moduleSpecifier.text);
      if (ts.isExportDeclaration(n)) {
        out.push({ key: `${mod}#export`, local: '', aliased: false, typeOnly: n.isTypeOnly });
      } else {
        const clause = n.importClause;
        const typeOnly = !!clause?.isTypeOnly;
        if (clause?.name) {
          out.push({ key: `${mod}#default`, local: clause.name.text, aliased: true, typeOnly });
        }
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          out.push({ key: `${mod}#*`, local: bindings.name.text, aliased: true, typeOnly });
        } else if (bindings) {
          for (const el of bindings.elements) {
            out.push({
              key: `${mod}#${(el.propertyName ?? el.name).text}`,
              local: el.name.text,
              aliased: el.propertyName !== undefined,
              typeOnly: typeOnly || el.isTypeOnly,
            });
          }
        }
      }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      if (!arg || !ts.isStringLiteralLike(arg)) {
        out.push({ key: '?#import()', local: '', aliased: false, typeOnly: false });
      } else if (matches(arg.text)) {
        out.push({
          key: `${local(arg.text)}#import()`,
          local: '',
          aliased: false,
          typeOnly: false,
        });
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'glob' &&
      ts.isMetaProperty(n.expression.expression)
    ) {
      out.push({ key: '?#import.meta.glob', local: '', aliased: false, typeOnly: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const coreImports = (sf: ts.SourceFile) => importsOf(sf, (spec) => spec.startsWith(CORE));

describe.each(Object.entries(RULES))('%s', (rel, rule) => {
  const sf = parse(rel);

  it('parses', () => {
    // Not in the public typings; `stripTs` reads the same field.
    const diagnostics = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
    expect(diagnostics).toEqual([]);
  });

  it('takes nothing from the package that is a figure but what it gives a reason for', () => {
    const taken = coreImports(sf)
      .filter((i) => !i.typeOnly)
      .map((i) => i.key);
    expect([...new Set(taken)].sort()).toEqual(Object.keys(rule.allow).sort());
  });

  // The view's day is the screen's day; a clock read here is one the server cannot reproduce.
  it('reads no clock', () => {
    const isDate = (e: ts.Expression) => ts.isIdentifier(e) && e.text === 'Date';
    const reads: string[] = [];
    const visit = (n: ts.Node) => {
      const call = ts.isCallExpression(n) ? n.expression : undefined;
      if (
        (ts.isNewExpression(n) && isDate(n.expression) && !n.arguments?.length) ||
        (call !== undefined && isDate(call)) ||
        (call !== undefined &&
          ts.isPropertyAccessExpression(call) &&
          call.name.text === 'now' &&
          ts.isIdentifier(call.expression) &&
          ['Date', 'performance'].includes(call.expression.text))
      ) {
        reads.push(n.getText(sf));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(reads).toEqual([]);
  });
});

// What computes a portfolio figure: these modules whole, and every name of `dates` and
// `inzhur/parse` but their clock and feed plumbing. A new figure module must join it.
const FIGURE =
  /^(?:(?:derive|valuation|accrual|xirr|period|inzhur\/dcf|view\/[^#]+)#.+|dates#(?!(?:todayIso|kyivDateIso|kyivTimeHm|msUntilNextKyivHour)$).+|inzhur\/parse#(?!(?:parseAssetsFeed|scheduleFacts|sameRef|NO_UNITS|matchAssets|INZHUR_REFRESH_HOUR)$).+)$/;

// Every other file in src/ that takes a figure, by name, with why it is not a route's.
const QUOTES = 'the `/` route, where quotes are entered: none of the eight';
const each = (why: string, ...names: string[]) => Object.fromEntries(names.map((n) => [n, why]));
const NOT_A_ROUTE: Record<string, Record<string, string>> = {
  'src/components/ui/PeriodControl.tsx': {
    'period#PERIOD_OPTIONS': 'the options it lists',
    'period#resolveWindow': "its hints; window.test.ts holds them equal to windowView's",
  },
  'src/screens/DailyQuotes.tsx': {
    ...each(
      QUOTES,
      'accrual#couponReminderId',
      'accrual#dueCoupons',
      'dates#dayBefore',
      'derive#investedByAsset',
      'derive#ledgerUnits',
      'derive#unitsByAsset',
    ),
  },
  'src/screens/daily-quotes/CouponDueCard.tsx': each(QUOTES, 'accrual#rollNextCoupon'),
  'src/screens/archive/strip.ts': each(
    'the archive panel: calendar positions on its coverage axis, no portfolio figure',
    'dates#addDays',
    'dates#daysBetween',
  ),
  'src/screens/archive/Repairs.tsx': each(
    "the archive panel: the days a repair's range spans, echoed before it is sent",
    'dates#daysBetween',
  ),
  'src/screens/daily-quotes/QuoteRow.tsx': each(QUOTES, 'derive#yieldSinceStart'),
  'src/screens/daily-quotes/quotes.ts': each(QUOTES, 'derive#needsQuote'),
  'src/screens/daily-quotes/suggestions.ts': each(
    QUOTES,
    'accrual#couponPerPayment',
    'accrual#couponPeriodDays',
    'accrual#couponsInGap',
    'accrual#dailyAccrual',
    'accrual#suggestedQuote',
    'inzhur/dcf#checkQuote',
    'inzhur/parse#couponForecast',
  ),
  'src/screens/TransactionPanel.tsx': {
    'accrual#rollbackNextCoupon': 'the transaction form moves the coupon pointer back on a delete',
  },
  'src/hooks/slices.ts': {
    'period#PERIOD_OPTIONS': 'the options a screen with a period takes its slice by',
  },
  'src/hooks/queries.ts': {
    ...each(
      'the body of a portfolio with no rows, which the shell holds until the first read answers',
      'view/serve#dayQuotes',
      'view/serve#viewBody',
    ),
  },
  'src/lib/backup.ts': {
    'valuation#snapshotsOfPrices':
      "the CSV's days are the stored prices', as the importer reads them",
  },
};

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    // A fixture is test support: it composes figures to stand in for the API, and no screen imports it.
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

describe('no file computes a figure of its own', () => {
  // The server composes every figure (*Cloud target*), and a fixture stands in for it in tests, so
  // no screen, form or hook calls a composer.
  it('no file calls a composer', () => {
    const callers = walk('src').filter((rel) =>
      coreImports(parse(rel)).some(
        (i) => !i.typeOnly && i.key.startsWith('view/') && /View$/.test(i.key.split('#')[1]),
      ),
    );
    expect(callers).toEqual([]);
  });

  it('every other file in src/ takes only the figures it gives a reason for', () => {
    const taken: Record<string, string[]> = {};
    for (const rel of walk('src')) {
      if (rel in RULES) continue;
      const keys = coreImports(parse(rel))
        .filter((i) => !i.typeOnly && FIGURE.test(i.key))
        .map((i) => i.key);
      if (keys.length > 0) taken[rel] = [...new Set(keys)].sort();
    }
    const reasons = Object.fromEntries(
      Object.entries(NOT_A_ROUTE).map(([rel, names]) => [rel, Object.keys(names).sort()]),
    );
    expect(taken).toEqual(reasons);
  });
});

// Every figure reader takes its slice of one query. The module is where TypeScript resolves it, a
// file by its path and a package by its name, so no spelling of a specifier (an extension, an
// alias) leads around the list.
const QUERIES = ['src/hooks/queries.ts'];
// The imports that reach the portfolio: the client of the user API, the app's one instance of it,
// and the query cache.
const STORE = ['src/lib/repository.ts', 'src/lib/api.ts', '@tanstack/react-query'];
// Each file that calls `useView`, once: the screens, the forms and the hooks that read the view.
const VIEW_READERS = [
  'src/hooks/useCapitalCard.ts',
  'src/hooks/useFxRate.ts',
  'src/hooks/usePeriodWindow.tsx',
  'src/hooks/useReminders.ts',
  'src/screens/Allocation.tsx',
  'src/screens/Attributes.tsx',
  'src/screens/Balances.tsx',
  'src/screens/DailyQuotes.tsx',
  'src/screens/Overview.tsx',
  'src/screens/Payouts.tsx',
  'src/screens/Portfolio.tsx',
  'src/screens/Seasonality.tsx',
  'src/screens/TransactionPanel.tsx',
  'src/screens/Yield.tsx',
  'src/screens/portfolio/AssetDialogs.tsx',
];
// Every file that reaches the client or the query cache, and what for.
const STORE_READERS: Record<string, string> = {
  'src/hooks/queries.ts': 'the view queries and every write',
  'src/lib/api.ts':
    'the one client of the user API and the one query cache, made with their session',
  'src/main.tsx': 'the query client provider',
  'src/hooks/useInzhurAssets.ts': 'the Inzhur feed, a query of its own',
  'src/hooks/usePasskeys.ts': 'the relay’s passkey list, a query of its own',
};

const { options: OPTIONS } = ts.convertCompilerOptionsFromJson(
  ts.readConfigFile(join(REPO, 'tsconfig.json'), ts.sys.readFile).config.compilerOptions,
  REPO,
);
// Paths compare in one case where the file system ignores it, so `../lib/API` is `src/lib/api.ts`.
const canon = (path: string) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase());
const RESOLUTIONS = ts.createModuleResolutionCache(REPO, (f) => f, OPTIONS);
/** Where TypeScript resolves a specifier from a file: a repo file by its path, a package by name. */
const target = (spec: string, rel: string): string => {
  const r = ts.resolveModuleName(
    spec,
    join(REPO, rel),
    OPTIONS,
    ts.sys,
    RESOLUTIONS,
  ).resolvedModule;
  if (!r) {
    // A stylesheet or an image leads to no module; code TypeScript cannot follow is refused.
    if (/^[./]/.test(spec) && /(?:^|\/)[^/.]+$|\.[cm]?[jt]sx?$/.test(spec)) {
      throw new Error(`${rel} imports ${spec}, which TypeScript cannot resolve`);
    }
    return spec;
  }
  if (r.isExternalLibraryImport) return r.packageId?.name ?? spec;
  return canon(relative(REPO, r.resolvedFileName).split(sep).join('/'));
};

/** The names a file takes from the modules listed, type-only imports aside: a namespace import is
 *  `*`, a default `default`, a re-export `export`, a dynamic import `import()`. */
const importsFrom = (sf: ts.SourceFile, from: readonly string[]): string[] =>
  importsOf(sf, (spec) => from.map(canon).includes(target(spec, sf.fileName)))
    .filter((i) => !i.typeOnly)
    .map((i) => i.key.slice(i.key.lastIndexOf('#') + 1));

const callsTo = (sf: ts.SourceFile, name: string): ts.CallExpression[] => {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

/** The names a file binds at the top of its module: its imports, and what its `const`s, functions
 *  and classes declare. A selector bound anywhere else is made again on every render. */
const moduleLevelNames = (sf: ts.SourceFile): Set<string> => {
  const names = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && s.importClause) {
      const { name, namedBindings } = s.importClause;
      if (name) names.add(name.text);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) names.add(namedBindings.name.text);
      else if (namedBindings) for (const el of namedBindings.elements) names.add(el.name.text);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) {
      names.add(s.name.text);
    }
  }
  return names;
};

/** An identifier, or a read off one (`overviewOf[period]`, `slices.payouts`): a value that exists
 *  before any render. A function expression, an arrow or a call is made inside the render. */
const rootIdentifier = (e: ts.Expression): ts.Identifier | undefined => {
  if (ts.isIdentifier(e)) return e;
  if (ts.isElementAccessExpression(e) || ts.isPropertyAccessExpression(e)) {
    return rootIdentifier(e.expression);
  }
  return undefined;
};

const selectProperties = (sf: ts.SourceFile): ts.ObjectLiteralElementLike[] => {
  const out: ts.ObjectLiteralElementLike[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'select'
    ) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

describe('every screen reads one slice of the one view query', () => {
  const files = walk('src');

  it('the files that call useView are the readers listed, and no other', () => {
    const callers = files.filter((rel) => importsFrom(parse(rel), QUERIES).includes('useView'));
    expect(callers.sort()).toEqual([...VIEW_READERS].sort());
  });

  it.each(VIEW_READERS)('%s calls useView once, with a selector defined at module level', (rel) => {
    const sf = parse(rel);
    const calls = callsTo(sf, 'useView');
    expect(calls, `${rel} calls useView ${calls.length} times`).toHaveLength(1);
    const root = rootIdentifier(calls[0].arguments[0]);
    expect(root, 'the selector is made inside the render').toBeDefined();
    expect(moduleLevelNames(sf).has(root!.text), `${root!.text} is not bound at module level`).toBe(
      true,
    );
  });

  // `select` re-runs only when the data or the function changes (query-core's `queryObserver`), so
  // one built in a render re-runs on every render. Only `useView` hands one to a query, and it is
  // given one.
  it('no query is handed a select of its own', () => {
    const inline = files
      .filter((rel) => !QUERIES.includes(rel))
      .filter((rel) => selectProperties(parse(rel)).length > 0);
    expect(inline).toEqual([]);
  });

  it('the one place a select reaches a query is useView, which is given it', () => {
    const sf = parse(QUERIES[0]);
    expect(selectProperties(sf).map((p) => p.getText(sf))).toEqual(['select']);
  });

  it('the ledger queries and the hook that cut them are gone', () => {
    const sf = parse(QUERIES[0]);
    const exported = sf.statements.flatMap((s) => {
      if (
        !ts.canHaveModifiers(s) ||
        !ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return [];
      }
      if (ts.isVariableStatement(s)) {
        return s.declarationList.declarations.flatMap((d) =>
          ts.isIdentifier(d.name) ? [d.name.text] : [],
        );
      }
      return (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name
        ? [s.name.text]
        : [];
    });
    expect(exported).toEqual(
      expect.not.arrayContaining(['keys', 'useAssets', 'useSnapshots', 'useTransactions']),
    );
    expect(existsSync(join(REPO, 'src/hooks/useLedgerAsOfToday.ts'))).toBe(false);
  });

  it('only the files with a reason reach the client of the API or the query cache', () => {
    const reach = files.filter((rel) => importsFrom(parse(rel), STORE).length > 0);
    expect(reach.sort()).toEqual(Object.keys(STORE_READERS).sort());
  });

  it('no file re-exports the view queries or the store, which would hand them on unlisted', () => {
    const relays = files.filter((rel) =>
      importsFrom(parse(rel), [...QUERIES, ...STORE]).includes('export'),
    );
    expect(relays).toEqual([]);
  });

  it('no file imports a module by a computed name or a glob, which no allow-list could read', () => {
    const computed = files.filter((rel) =>
      importsOf(parse(rel), () => false).some((i) => i.key.startsWith('?#')),
    );
    expect(computed).toEqual([]);
  });

  // The quotes screen's day is the view's, so its due cards and its form change day in the render
  // the figures do; a clock of its own would be a value the query cannot see.
  it("the quotes screen takes today from the view's day, with no clock of its own", () => {
    const sf = parse('src/screens/DailyQuotes.tsx');
    expect(coreImports(sf).map((i) => i.key)).not.toContain('dates#todayIso');
    expect(importsFrom(sf, ['src/hooks/useToday.ts'])).toEqual([]);
  });
});
