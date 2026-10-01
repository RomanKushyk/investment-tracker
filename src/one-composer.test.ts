import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// A figure a screen computes for itself is one `/view` does not have, so each screen takes its
// figures from ONE composer call, held on the source; arithmetic on what it returns is review's.

interface Rule {
  /** `module#export`, the module relative to `@quirenote/core/`. */
  composer: string;
  /** Inside `useMemo`, where the screen re-renders per frame or the composer is costly. */
  memo: boolean;
  /** Every other name it takes from the package, each with why the composer does not own it. */
  allow: Record<string, string>;
}

const EMPTIES = {
  'types#Asset': 'the stable empty arrays the memo keys on',
  'types#Snapshot': 'the stable empty arrays the memo keys on',
  'types#Transaction': 'the stable empty arrays the memo keys on',
};

const RULES: Record<string, Rule> = {
  'src/screens/Overview.tsx': {
    composer: 'view/overview#overviewView',
    memo: true,
    allow: {
      ...EMPTIES,
      'money#toUsd': 'currency conversion stays in the component',
    },
  },
  'src/screens/Yield.tsx': {
    composer: 'view/yield#yieldView',
    memo: true,
    allow: {
      ...EMPTIES,
      'view/yield#cumulativeYieldSeriesIn': 'the curve is one value per asset per date: #189',
    },
  },
  'src/screens/Seasonality.tsx': {
    composer: 'view/seasonality#seasonalityView',
    memo: true,
    allow: { ...EMPTIES },
  },
  'src/screens/Attributes.tsx': {
    composer: 'view/attributes#attributesView',
    memo: true,
    allow: {
      ...EMPTIES,
      'view/attributes#PayoutScheduleFact': 'the type the schedule label is worded from',
    },
  },
  'src/screens/Payouts.tsx': {
    composer: 'view/payouts#payoutsView',
    memo: false,
    allow: {},
  },
  'src/screens/Portfolio.tsx': {
    composer: 'view/portfolio#portfolioView',
    memo: false,
    allow: { 'types#Asset': 'labels and the row actions' },
  },
  'src/screens/Allocation.tsx': {
    composer: 'view/allocation#allocationView',
    memo: false,
    allow: { 'types#Asset': 'labels', 'types#ColorKey': 'the bar paint table' },
  },
  'src/screens/Balances.tsx': {
    composer: 'view/balances#balancesView',
    memo: false,
    allow: {
      'view/balances#paginateSnapshots': 'the table is one row per snapshot: #189',
      'view/balances#buildBalanceRow': 'the table is one row per snapshot: #189',
      'view/balances#pageHasEarlyQuote': 'the table is one row per snapshot: #189',
    },
  },
  'src/hooks/useCapitalCard.ts': {
    composer: 'view/capital#capitalView',
    memo: false,
    allow: { 'money#toUsd': 'currency conversion stays in the component' },
  },
  'src/hooks/usePeriodWindow.tsx': {
    composer: 'view/window#windowView',
    memo: false,
    allow: { ...EMPTIES, 'period#PeriodOption': 'the period it hands each screen' },
  },
};

const CORE = '@quirenote/core/';

const parse = (rel: string) =>
  ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

interface Imported {
  key: string;
  local: string;
  aliased: boolean;
  typeOnly: boolean;
}

/** Every name a file takes from the package by `module#export`, type-only included; a namespace,
 *  default, re-export or dynamic import gets a key of its own, so none passes unlisted. */
function coreImports(sf: ts.SourceFile): Imported[] {
  const out: Imported[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text.startsWith(CORE)
    ) {
      const mod = n.moduleSpecifier.text.slice(CORE.length);
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
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      n.arguments[0].text.startsWith(CORE)
    ) {
      const mod = n.arguments[0].text.slice(CORE.length);
      out.push({ key: `${mod}#import()`, local: '', aliased: false, typeOnly: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const identifiers = (sf: ts.SourceFile, name: string): ts.Identifier[] => {
  const out: ts.Identifier[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === name && !ts.isImportSpecifier(n.parent)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

const insideUseMemo = (n: ts.Node): boolean => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (
      ts.isCallExpression(p) &&
      ts.isIdentifier(p.expression) &&
      p.expression.text === 'useMemo'
    ) {
      return true;
    }
  }
  return false;
};

describe.each(Object.entries(RULES))('%s', (rel, rule) => {
  const sf = parse(rel);
  const imported = coreImports(sf);
  const composerName = rule.composer.split('#')[1];

  it('parses', () => {
    // Not in the public typings; `stripTs` reads the same field.
    const diagnostics = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
    expect(diagnostics).toEqual([]);
  });

  it('imports its composer and nothing from the package that is a figure', () => {
    expect([...new Set(imported.map((i) => i.key))].sort()).toEqual(
      [rule.composer, ...Object.keys(rule.allow)].sort(),
    );
  });

  // `today` comes from useToday; a clock read here is one the server cannot reproduce.
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

  it('calls its composer once, by its own name', () => {
    const entry = imported.find((i) => i.key === rule.composer);
    expect(entry?.aliased, 'the composer is imported under another name').toBe(false);
    const uses = identifiers(sf, composerName);
    expect(uses, `${composerName} is used ${uses.length} times`).toHaveLength(1);
    const call = uses[0].parent;
    expect(
      ts.isCallExpression(call) && call.expression === uses[0],
      `${composerName} is referenced but not called`,
    ).toBe(true);
    expect(
      insideUseMemo(call),
      `${composerName}'s call ${rule.memo ? 'left' : 'entered'} useMemo`,
    ).toBe(rule.memo);
  });
});

// What computes a portfolio figure: these modules whole, and every name of `dates` and
// `inzhur/parse` but their clock and feed plumbing. A new figure module must join it.
const FIGURE =
  /^(?:(?:derive|accrual|xirr|period|inzhur\/dcf|view\/[^#]+)#.+|dates#(?!(?:todayIso|kyivDateIso|kyivTimeHm|msUntilNextKyivHour)$).+|inzhur\/parse#(?!(?:parseAssetsFeed|scheduleFacts|sameRef|NO_UNITS|matchAssets)$).+)$/;

// Every other file in src/ that takes a figure, by name, with why it is not a route's.
const QUOTES = 'the `/` route, where quotes are entered: none of the eight';
const each = (why: string, ...names: string[]) => Object.fromEntries(names.map((n) => [n, why]));
const NOT_A_ROUTE: Record<string, Record<string, string>> = {
  'src/components/ui/PeriodControl.tsx': {
    'period#PERIOD_OPTIONS': 'the options it lists',
    'period#resolveWindow': "its hints; window.test.ts holds them equal to windowView's",
  },
  'src/state/settings.ts': { 'period#PERIOD_OPTIONS': 'validates a stored period' },
  'src/screens/DailyQuotes.tsx': each(
    QUOTES,
    'accrual#couponReminderId',
    'accrual#dueCoupons',
    'dates#dayBefore',
    'derive#investedByAsset',
    'derive#latestQuotes',
    'derive#ledgerUnits',
    'derive#unitsByAsset',
  ),
  'src/screens/daily-quotes/CouponDueCard.tsx': each(QUOTES, 'accrual#rollNextCoupon'),
  'src/screens/daily-quotes/QuoteRow.tsx': each(QUOTES, 'derive#yieldSinceStart'),
  'src/screens/daily-quotes/YieldTeaser.tsx': each(QUOTES, 'derive#yieldSinceStart'),
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
  'src/screens/portfolio/AssetDialogs.tsx': {
    'view/portfolio#cascadeCounts': 'the delete dialog counts the rows a deletion takes',
  },
};

describe('the rules cover every composer and every caller', () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
    });

  it('every file in src/ that calls a composer has a rule', () => {
    const callers = walk('src').filter((rel) =>
      coreImports(parse(rel)).some(
        (i) => !i.typeOnly && i.key.startsWith('view/') && /View$/.test(i.key.split('#')[1]),
      ),
    );
    expect(callers.sort()).toEqual(Object.keys(RULES).sort());
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

  it('every composer the package exports belongs to exactly one rule', () => {
    const exported = walk('packages/core/src/view')
      .filter((rel) => rel.endsWith('.ts'))
      .flatMap((rel) => {
        const mod = rel.replace(/^packages\/core\/src\//, '').replace(/\.ts$/, '');
        return parse(rel)
          .statements.filter(
            (s): s is ts.FunctionDeclaration =>
              ts.isFunctionDeclaration(s) &&
              !!s.name &&
              /View$/.test(s.name.text) &&
              !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
          )
          .map((s) => `${mod}#${s.name!.text}`);
      })
      // The union of the others, not a screen's.
      .filter((key) => key !== 'view/build#buildView');
    expect(exported.sort()).toEqual(
      Object.values(RULES)
        .map((r) => r.composer)
        .sort(),
    );
  });
});
