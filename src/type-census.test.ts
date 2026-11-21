import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { ruleBody, stripCss } from './__fixtures__/palette';
import { REPO, skipped } from './repo-root';

// THE TYPE CENSUS (*Language, numbers, fonts*): every size, line height and tracking is a role of
// `type.md`'s table, carried by a `--text-<role>` token, and nothing renders under 11 px.
// A CLASS IS JUDGED BY THE CSS TAILWIND GENERATES FOR IT, through the app's own stylesheet, so an
// arbitrary value, a property, a variable or a local token override reads as what it does. The
// strings come through TypeScript, so a comment is not a hit and a cva map or a const is; every
// string inside one `className`, or one template, is one set, so a recipe pairs across `${…}`.
// Inline styles (a `style` prop or a `…Style` option) and SVG attributes are read as values,
// through conditionals, casts and the const a name binds in its scope.
//
// A LABEL RECIPE AND ITS CASE ARE WRITTEN IN ONE CLASS STRING: a recipe composed from a const and
// a template reads as two sets and is refused. TRUST BOUNDARY: the census guards drift in ordinary
// code, not evasion. It cannot see a value imported from another module, a parameter's default,
// a recipe that holds on one ternary branch or breakpoint only, or a weight in a cva variant.
//
// THE ALLOW-LIST IS PER FILE, KEYED BY THE OFFENDING CLASS AND COUNTED, and compared exactly: a new
// offence fails, a size swapped for another fails, and so does an entry that no longer needs its
// count, so the list can only shrink. #740 and #741 empty it.

const ROOT = 'src';
const MODULE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;
const SWEPT = ['src/app/', 'src/components/ui/'];

/** `type.md` § Signed, as the theme declares it (prettier writes the leading zero). */
const ROLES: Record<string, { size: string; line: string; tracking?: string; weight?: string }> = {
  label: { size: '11px', line: '14px' },
  'label-caps': { size: '11px', line: '14px', tracking: '0.12em', weight: '500' },
  'label-figure': { size: '11px', line: '14px', tracking: '0.04em', weight: '600' },
  small: { size: '12px', line: '16px' },
  body: { size: '13px', line: '18px' },
  table: { size: '13px', line: '18px' },
  sub: { size: '15px', line: '20px', weight: '600' },
  h3: { size: '17px', line: '22px', weight: '600' },
  kpi: { size: '22px', line: '26px', tracking: '-0.01em', weight: '600' },
  title: { size: '26px', line: '32px', weight: '600' },
  // The display row's collapsed-header capital.
  'display-header': { size: '18px', line: '23px', tracking: '-0.01em', weight: '600' },
  // The display row's hero figure.
  'display-hero': { size: '36px', line: '44px', tracking: '-0.01em', weight: '600' },
  // K2's unit, a share of the figure it stands beside, taking no line box of its own.
  unit: { size: '70%', line: '0', tracking: '0em', weight: '500' },
};
const ROLE = `(${Object.keys(ROLES).join('|')})`;

/** What each type property may read: the role's own token, in the form Tailwind writes it. */
const CLASS_VALUE: Record<string, RegExp> = {
  'font-size': new RegExp(`^var\\(--text-${ROLE}\\)$`),
  'line-height': new RegExp(`^var\\(--tw-leading, var\\(--text-${ROLE}--line-height\\)\\)$`),
  'letter-spacing': new RegExp(`^var\\(--tw-tracking, var\\(--text-${ROLE}--letter-spacing\\)\\)$`),
};
const STYLE_VALUE: Record<string, RegExp> = {
  fontSize: new RegExp(`^var\\(--text-${ROLE}\\)$`),
  lineHeight: new RegExp(`^var\\(--text-${ROLE}--line-height\\)$`),
  letterSpacing: new RegExp(`^var\\(--text-${ROLE}--letter-spacing\\)$`),
};

/** A numeric `fontSize` outside a style (SVG text, chart ticks) may only be a role's or the
 *  display row's px. */
const FONT_SIZES = new Set([11, 12, 13, 15, 17, 18, 22, 24, 26, 30, 32, 36, 46]);

/** The fields' iOS 16 below md (`index.css`): the one size off the table, at its two sites. */
const FIELDS: Record<string, Record<string, number>> = {
  'src/components/ui/DatePicker.tsx': { 'max-md:text-base': 1 },
  'src/components/ui/Select.tsx': { 'max-md:text-base': 1 },
};

/** What still carries a pre-role size, and which slice sweeps it. */
const ALLOWED: Record<string, Record<string, number>> = {
  // #740: the portfolio screens, the forms, the charts and the segmented control.
  'src/components/charts/SeasonalityBars.tsx': { 'fontSize=10': 2 },
  'src/components/forms/AssetForm.tsx': {
    'leading-normal': 1,
    'text-[11px]': 8,
    'text-[13px]': 4,
    'text-xs': 1,
    'tracking-[.06em]': 2,
    'uppercase without the caps recipe': 3,
  },
  'src/screens/Allocation.tsx': {
    'text-[10px]': 2,
    'text-[11px]': 1,
    'text-[12.5px]': 1,
    'text-[13px]': 2,
    'text-xs': 2,
    'tracking-[.12em]': 2,
    'uppercase without the caps recipe': 2,
  },
  'src/screens/Balances.tsx': { 'text-[11.5px]': 2, 'text-[12.5px]': 1, 'text-xs': 2 },
  'src/screens/DailyQuotes.tsx': { 'text-[13px]': 2, 'text-[26px]': 1, 'text-xs': 3 },
  'src/screens/Overview.tsx': {
    'leading-[1.5]': 1,
    'text-[10px]': 3,
    'text-[13.5px]': 2,
    'text-[13px]': 3,
    'text-xs': 3,
    'tracking-[.12em]': 3,
    'uppercase without the caps recipe': 3,
  },
  'src/screens/Payouts.tsx': {
    'text-[10px]': 1,
    'text-[11.5px]': 1,
    'text-[12.5px]': 1,
    'text-[13px]': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/Portfolio.tsx': {
    'leading-normal': 1,
    'text-[10px]': 2,
    'text-[11.5px]': 2,
    'text-[12.5px]': 1,
    'text-[13px]': 1,
    'tracking-[.12em]': 2,
    'uppercase without the caps recipe': 2,
  },
  'src/screens/Profile.tsx': {
    'leading-[18px]': 3,
    'text-[12px]': 3,
    'text-[13px]': 3,
    'text-xs': 2,
  },
  'src/screens/Seasonality.tsx': {
    'leading-[1.5]': 3,
    'text-[10px]': 3,
    'text-[11.5px]': 1,
    'text-[13.5px]': 3,
    'tracking-[.12em]': 3,
    'uppercase without the caps recipe': 3,
  },
  'src/screens/Settings.tsx': {
    'leading-normal': 1,
    'text-[10px]': 1,
    'text-[11px]': 1,
    'text-[13px]': 2,
    'text-xs': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/TransactionPanel.tsx': {
    'leading-4': 2,
    'text-[10px]': 2,
    'text-[11px]': 14,
    'text-[12.5px]': 1,
    'text-[13px]': 1,
    'text-lg': 1,
    'text-xs': 2,
    'tracking-[.06em]': 1,
    'tracking-[.08em]': 2,
    'uppercase without the caps recipe': 3,
  },
  'src/screens/Yield.tsx': { 'text-[11.5px]': 3, 'text-[12.5px]': 1 },
  'src/screens/daily-quotes/CouponDueCard.tsx': {
    'leading-[1.45]': 1,
    'leading-[1.4]': 1,
    'leading-[1.5]': 1,
    'text-[10px]': 2,
    'text-[11px]': 5,
    'text-[13px]': 3,
    'text-xs': 2,
    'tracking-[.08em]': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 2,
  },
  'src/screens/daily-quotes/FetchQuotesButton.tsx': { 'text-[11px]': 1 },
  'src/screens/daily-quotes/PendingChange.tsx': {
    'text-[12.5px]': 2,
    'text-[13px]': 1,
    'text-[19px]': 1,
  },
  'src/screens/daily-quotes/QuoteRow.tsx': {
    'text-[10px]': 2,
    'text-[11px]': 7,
    'text-[13px]': 2,
    'text-[9px]': 1,
    'text-sm': 1,
    'text-xs': 1,
    'tracking-[.08em]': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 2,
  },
  'src/screens/daily-quotes/YieldTeaser.tsx': { 'text-[12.5px]': 2, 'text-[13px]': 1 },
  'src/screens/placeholders.tsx': {
    'text-[10px]': 8,
    'text-[11.5px]': 3,
    'text-[12.5px]': 4,
    'text-[13px]': 4,
    'text-[26px]': 1,
    'text-lg': 1,
    'text-xs': 1,
    'tracking-[.08em]': 1,
    'tracking-[.12em]': 7,
    'uppercase without the caps recipe': 8,
  },
  'src/screens/portfolio/AssetDialogs.tsx': { 'leading-normal': 1, 'text-[13px]': 1, 'text-lg': 1 },
  'src/screens/profile/DeleteAccount.tsx': {
    'leading-[16.5px]': 1,
    'leading-[18px]': 1,
    'max-md:text-[16px]': 1,
    'text-[11px]': 1,
    'text-[12px]': 1,
    'text-[13px]': 1,
  },
  'src/screens/profile/Reauthentication.tsx': {
    'leading-6': 1,
    'leading-[16.5px]': 1,
    'leading-[18px]': 2,
    'leading-[19.5px]': 2,
    'text-[11px]': 1,
    'text-[12px]': 2,
    'text-[13px]': 2,
    'text-[18px]': 1,
  },
  'src/screens/settings/CsvExportRow.tsx': {
    'leading-normal': 1,
    'leading-relaxed': 2,
    'text-[11px]': 2,
    'text-[13px]': 1,
    'text-xs': 1,
  },
  'src/screens/settings/DangerZone.tsx': {
    'leading-normal': 1,
    'text-[11px]': 1,
    'text-[13px]': 2,
    'text-lg': 1,
  },
  'src/screens/settings/ImportDialog.tsx': {
    'leading-[1.55]': 1,
    'leading-[1.9]': 1,
    'leading-normal': 4,
    'leading-relaxed': 4,
    'text-[10px]': 6,
    'text-[11.5px]': 2,
    'text-[11px]': 5,
    'text-[12.5px]': 2,
    'text-[13px]': 4,
    'text-lg': 2,
    'text-xs': 2,
    'tracking-[.08em]': 3,
    'tracking-[.12em]': 3,
    'uppercase without the caps recipe': 6,
  },
  'src/screens/settings/ImportRow.tsx': {
    'leading-normal': 2,
    'leading-snug': 1,
    'text-[11px]': 1,
    'text-[13px]': 3,
    'text-xs': 2,
  },
  // #741: sign-in, legal and the super-admin pages.
  'src/screens/AdminUsers.tsx': {
    'leading-[16.5px]': 2,
    'text-[10px]': 1,
    'text-[11px]': 3,
    'text-[12.5px]': 2,
    'text-[13px]': 2,
    'text-[15px]': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/ArchiveAdmin.tsx': {
    'leading-normal': 1,
    'text-[11px]': 3,
    'text-[13px]': 1,
    'text-xs': 1,
  },
  'src/screens/admin-users/ConfirmRuling.tsx': {
    'leading-6': 1,
    'leading-[16.5px]': 1,
    'leading-[18px]': 2,
    'max-md:text-[16px]': 1,
    'text-[11px]': 1,
    'text-[13px]': 1,
    'text-lg': 1,
    'text-xs': 2,
  },
  'src/screens/archive/Coverage.tsx': {
    'leading-[14px]': 1,
    'leading-[15px]': 1,
    'leading-[18px]': 2,
    'text-[10px]': 3,
    'text-[11px]': 3,
    'text-xs': 2,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/archive/Repairs.tsx': {
    'leading-6': 1,
    'leading-[16.5px]': 2,
    'leading-[18.75px]': 2,
    'leading-[18px]': 7,
    'text-[10px]': 1,
    'text-[11px]': 2,
    'text-[12.5px]': 2,
    'text-[13px]': 1,
    'text-lg': 1,
    'text-xs': 7,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/archive/RunLog.tsx': {
    'leading-[16.5px]': 5,
    'leading-[17px]': 3,
    'leading-[18.75px]': 2,
    'leading-[18px]': 2,
    'text-[10px]': 1,
    'text-[11.5px]': 3,
    'text-[11px]': 7,
    'text-[12.5px]': 2,
    'text-[13px]': 2,
    'text-xs': 2,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/archive/SpotCheck.tsx': {
    'leading-[18.75px]': 2,
    'text-[10px]': 1,
    'text-[11px]': 1,
    'text-[12.5px]': 2,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/legal/LegalDocument.tsx': {
    'leading-[18px]': 2,
    'leading-[21px]': 1,
    'leading-[22.5px]': 1,
    'text-[10px]': 1,
    'text-[12px]': 2,
    'text-[15px]': 1,
    'tracking-[.12em]': 1,
    'uppercase without the caps recipe': 1,
  },
  'src/screens/privacy/Privacy.tsx': { 'leading-[18px]': 2, 'text-[12px]': 2 },
  'src/screens/sign-in/Answer.tsx': {
    'leading-[18px]': 2,
    'leading-[19.5px]': 2,
    'text-[12px]': 2,
    'text-[13px]': 2,
  },
  'src/screens/sign-in/Apply.tsx': {
    'leading-[18px]': 2,
    'leading-[19.5px]': 2,
    'text-[12px]': 2,
    'text-[13px]': 2,
  },
  'src/screens/sign-in/GoogleButton.tsx': {
    'leading-5': 1,
    'leading-[16.5px]': 1,
    'text-[11px]': 1,
    'text-[14px]': 1,
  },
  'src/screens/sign-in/GoogleCallback.tsx': { 'leading-[19.5px]': 2, 'text-[13px]': 2 },
  'src/screens/sign-in/SignIn.tsx': { 'leading-[19.5px]': 7, 'text-[13px]': 7 },
  'src/screens/sign-in/parts.tsx': {
    'leading-[16.5px]': 3,
    'leading-[19.5px]': 2,
    'leading-[39px]': 2,
    'text-[11px]': 3,
    'text-[13px]': 3,
    'text-[26px]': 2,
  },
};

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return MODULE.test(e.name) && !TEST.test(e.name) ? [rel] : [];
  });

const parse = (rel: string, text: string) =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));

type Value = string | number;

/** The literal values an expression can take, or null where it reads something else. */
function valuesOf(n: ts.Node | undefined, sf: ts.SourceFile, depth = 0): Value[] | null {
  if (n === undefined || depth > 8) return null;
  if (ts.isJsxExpression(n)) return valuesOf(n.expression, sf, depth + 1);
  if (ts.isNumericLiteral(n)) return [Number(n.text)];
  if (ts.isStringLiteralLike(n)) return [n.text];
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) {
    const v = valuesOf(n.operand, sf, depth + 1);
    return v && v.map((x) => (typeof x === 'number' ? -x : `-${x}`));
  }
  if (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isTypeAssertionExpression(n)
  ) {
    return valuesOf(n.expression, sf, depth + 1);
  }
  const both = (a: ts.Node, b: ts.Node) => {
    const x = valuesOf(a, sf, depth + 1);
    const y = valuesOf(b, sf, depth + 1);
    return x && y && [...x, ...y];
  };
  if (ts.isConditionalExpression(n)) return both(n.whenTrue, n.whenFalse);
  if (ts.isBinaryExpression(n) && /^(\?\?|\|\||&&)$/.test(n.operatorToken.getText(sf))) {
    return both(n.left, n.right);
  }
  if (ts.isIdentifier(n)) {
    // The nearest binding of the name, scope by scope: a const reads through, anything else
    // (a parameter, a `let`, a destructured name) is a value the census cannot see.
    for (let s: ts.Node | undefined = n.parent; s; s = s.parent) {
      if (ts.isFunctionLike(s) && s.parameters.some((p) => binds(p.name, n.text))) return null;
      const statements =
        ts.isSourceFile(s) || ts.isBlock(s) || ts.isModuleBlock(s) ? s.statements : [];
      for (const st of statements) {
        if (!ts.isVariableStatement(st)) continue;
        const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const d of st.declarationList.declarations) {
          if (!binds(d.name, n.text)) continue;
          return isConst && ts.isIdentifier(d.name) ? valuesOf(d.initializer, sf, depth + 1) : null;
        }
      }
    }
    return null;
  }
  return null;
}

/** Whether a binding, a destructuring pattern included, declares the name. */
function binds(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name, text));
}

/** Every literal string under a node, a template's parts included. */
function stringsUnder(n: ts.Node): string[] {
  const out: string[] = [];
  const visit = (m: ts.Node) => {
    if (ts.isStringLiteralLike(m) || ts.isTemplateHead(m)) out.push(m.text);
    else if (ts.isTemplateMiddleOrTemplateTail(m)) out.push(m.text);
    ts.forEachChild(m, visit);
  };
  visit(n);
  return out;
}

const TYPE_PROP = /^(fontSize|font-size|lineHeight|line-height|letterSpacing|letter-spacing|font)$/;
/** A custom property that sets type: a role token, or the leading, tracking or weight hook. */
const TYPE_VAR = /^--(text-|tw-(leading|tracking|font-weight)$)/;
/** A prop or option that becomes an inline style. */
const STYLE_KEY = /^(style|[a-z]\w*Style)$/;
const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A property's name, a computed `['--x' as string]` read through to its string. */
function keyOf(name: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const v = valuesOf(name.expression, sf);
    if (v?.length === 1) return String(v[0]);
  }
  return name.getText(sf);
}

/** The class sets a module spells, and the offences of its type props. */
function readModule(sf: ts.SourceFile): { sets: string[][]; props: string[] } {
  const sets: string[][] = [];
  const props: string[] = [];
  const tokens = (strings: string[]) => strings.join(' ').split(/\s+/).filter(Boolean);
  const prop = (name: string, value: ts.Node | undefined, inStyle: boolean) => {
    const key = camel(name);
    if (inStyle && TYPE_VAR.test(name)) return void props.push(`style ${name}`);
    if (!TYPE_PROP.test(name)) return;
    if (key === 'font') return void props.push(`${name}=…`);
    const values = valuesOf(value, sf);
    if (values === null) {
      const shown = value && ts.isJsxExpression(value) ? value.expression : value;
      return void props.push(`${name}=${shown?.getText(sf) ?? ''}`);
    }
    for (const v of values) {
      const px = Number(String(v).replace(/px$/, ''));
      const ok = inStyle
        ? STYLE_VALUE[key].test(String(v))
        : key === 'fontSize' && FONT_SIZES.has(px);
      if (!ok) props.push(`${name}=${v}`);
    }
  };
  const visit = (n: ts.Node, inStyle: boolean) => {
    if (
      ts.isJsxAttribute(n) &&
      ts.isIdentifier(n.name) &&
      /^(className|class)$/.test(n.name.text)
    ) {
      if (n.initializer) sets.push(tokens(stringsUnder(n.initializer)));
      return;
    }
    if (ts.isTemplateExpression(n)) return void sets.push(tokens(stringsUnder(n)));
    if (ts.isStringLiteralLike(n)) return void sets.push(tokens([n.text]));
    if (ts.isJsxAttribute(n)) {
      const name = ts.isIdentifier(n.name) ? n.name.text : n.name.getText(sf);
      if (STYLE_KEY.test(name)) {
        ts.forEachChild(n, (c) => visit(c, true));
        return;
      }
      prop(name, n.initializer, false);
    }
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      const name = keyOf(n.name, sf);
      // An option that becomes an inline style: sonner's `style`, recharts' `contentStyle`.
      if (ts.isPropertyAssignment(n) && STYLE_KEY.test(name)) return visit(n.initializer, true);
      prop(name, ts.isPropertyAssignment(n) ? n.initializer : n.name, inStyle);
      // A style's values are CSS, not class lists.
      if (ts.isShorthandPropertyAssignment(n) || inStyle) return;
    }
    ts.forEachChild(n, (c) => visit(c, inStyle && !ts.isJsxElement(c)));
  };
  visit(sf, false);
  return { sets, props };
}

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

/** Every declaration a rendered class writes, `!important` off. */
const declarationsIn = (css: string) =>
  [...css.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
    prop: m[1],
    value: m[2].replace(/\s*!important$/, '').trim(),
  }));

interface Judged {
  /** Writes a size, line height or tracking off its role, the `font` shorthand, or a type token. */
  off: boolean;
  label: 'caps' | 'figure' | null;
  upper: boolean;
  /** Changes case some other way: `normal-case`, `[text-transform:none]`. */
  recase: boolean;
  weight: boolean;
}

function judge(ds: DesignSystem, cache: Map<string, Judged | null>, tokens: string[]) {
  const fresh = [...new Set(tokens)].filter((t) => !cache.has(t));
  ds.candidatesToCss(fresh).forEach((css, i) => {
    if (css === null) return void cache.set(fresh[i], null);
    const j: Judged = { off: false, label: null, upper: false, recase: false, weight: false };
    for (const { prop, value } of declarationsIn(css)) {
      if (prop in CLASS_VALUE && !CLASS_VALUE[prop].test(value)) j.off = true;
      if (prop === 'font' || /^--(text-|tw-leading$|tw-tracking$)/.test(prop)) j.off = true;
      if (prop === 'font-size' && value === 'var(--text-label-caps)') j.label = 'caps';
      if (prop === 'font-size' && value === 'var(--text-label-figure)') j.label = 'figure';
      if (prop === 'text-transform' && value === 'uppercase') j.upper = true;
      else if (prop === 'text-transform') j.recase = true;
      if (prop === 'font-weight' && !/^var\(--tw-font-weight, var\(--text-/.test(value)) {
        j.weight = true;
      }
      // A role reads its weight through this hook, so setting it changes the role's weight.
      if (prop === '--tw-font-weight') j.weight = true;
    }
    cache.set(fresh[i], j);
  });
}

/** Copy, not a class list: a capital or non-Latin letter outside brackets, or a sentence's end. */
const isCopy = (set: string[]) =>
  set.some((t) => {
    const bare = t.replace(/\[[^\]]*\]|\([^)]*\)/g, '');
    return /[A-Z]|[^ -~]/.test(bare) || /[.,;!?]$/.test(bare);
  });

/** `file | offence | count` for every offence a file carries, sorted. */
function hits(ds: DesignSystem, sources: { rel: string; sf: ts.SourceFile }[]): string[] {
  const cache = new Map<string, Judged | null>();
  return sources
    .flatMap(({ rel, sf }) => {
      const { sets, props } = readModule(sf);
      const counts = new Map<string, number>();
      const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
      props.forEach(add);
      for (const set of sets) {
        if (isCopy(set)) continue;
        judge(ds, cache, set);
        const judged = set.map((t) => [t, cache.get(t)] as const);
        // Copy whose words are mostly not classes: «… an uppercase letter».
        if (set.length >= 3 && judged.filter(([, j]) => j).length * 2 < set.length) continue;
        for (const [t, j] of judged) if (j?.off) add(t);
        const at = (f: (j: Judged) => boolean) => judged.filter(([, j]) => j && f(j));
        const label = at((j) => j.label !== null).length > 0;
        const caps = at((j) => j.label === 'caps').length > 0;
        const upper = at((j) => j.upper).length > 0;
        if (caps && !upper) add('caps recipe without uppercase');
        if (upper && !caps) add('uppercase without the caps recipe');
        if (label) for (const [t] of at((j) => j.recase || j.weight)) add(`${t} on a label`);
      }
      return [...counts].map(([k, n]) => `${rel} | ${k} | ${n}`);
    })
    .sort();
}

// Read straight into the parser, as the reader census asks of a guard that parses.
const SOURCES = walk(ROOT).map((rel) => ({
  rel,
  sf: ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  ),
}));

const expected = (list: Record<string, Record<string, number>>) =>
  Object.entries(list).flatMap(([rel, counts]) =>
    Object.entries(counts).map(([k, n]) => `${rel} | ${k} | ${n}`),
  );

const CSS = stripCss(readFileSync(join(REPO, 'src/index.css'), 'utf8'), 'index.css');
const THEME = ruleBody(CSS, '@theme');

/** Each type declaration in a stylesheet that does not read a role token. */
const stylesheetOffences = (css: string) =>
  [...css.matchAll(/(?<![\w-])(font|font-size|line-height|letter-spacing):\s*([^;]+);/g)]
    .filter((m) => !STYLE_VALUE[camel(m[1])]?.test(m[2].trim()))
    .map((m) => `${m[1]}: ${m[2].trim()}`);

/** Every `--text-*` the stylesheet declares, wherever it stands. */
const textTokens = (block: string) =>
  [...block.matchAll(/(--text-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);

let DS: DesignSystem;
beforeAll(async () => {
  // Built from the app's own stylesheet, as `glass-material.test.ts` builds it.
  DS = await __unstable__loadDesignSystem(CSS, { base: join(REPO, 'src') });
});

describe('the type census', () => {
  // The unit's size is a share of its parent's, so the floor holds only where the parent is a kpi
  // or display figure: `Amount` alone draws it.
  it('finds the unit role in Amount alone', () => {
    const users = SOURCES.filter(({ sf }) =>
      readModule(sf).sets.some((set) => set.includes('text-unit')),
    ).map((s) => s.rel);
    expect(users).toEqual(['src/components/ui/Amount.tsx']);
  });

  // And `Amount` only where its parent is one: the 360 header's capital and the KPI cards' values.
  it('finds Amount only beside a kpi or display figure', () => {
    const users = SOURCES.filter(({ rel, sf }) =>
      sf.statements.some(
        (s) =>
          ts.isImportDeclaration(s) &&
          ts.isStringLiteral(s.moduleSpecifier) &&
          posix.join(posix.dirname(rel), s.moduleSpecifier.text) === 'src/components/ui/Amount',
      ),
    ).map((s) => s.rel);
    expect(users.sort()).toEqual([
      'src/app/AppHeader.tsx',
      'src/screens/Overview.tsx',
      'src/screens/Payouts.tsx',
    ]);
  });

  it('reads the app, and the allow-list names files that exist and none it has swept', () => {
    // VACUITY ANCHOR: an empty walk would pass every assertion below.
    expect(SOURCES.length).toBeGreaterThan(150);
    const present = new Set(SOURCES.map((s) => s.rel));
    for (const rel of [...Object.keys(ALLOWED), ...Object.keys(FIELDS)]) {
      expect(present, rel).toContain(rel);
    }
    for (const rel of Object.keys(ALLOWED)) {
      expect(
        SWEPT.some((dir) => rel.startsWith(dir)),
        `${rel} is swept`,
      ).toBe(false);
    }
  });

  it('declares the role table in the one theme, and no text token anywhere else', () => {
    const want: [string, string][] = [];
    for (const [role, r] of Object.entries(ROLES)) {
      want.push([`--text-${role}`, r.size], [`--text-${role}--line-height`, r.line]);
      if (r.tracking) want.push([`--text-${role}--letter-spacing`, r.tracking]);
      if (r.weight) want.push([`--text-${role}--font-weight`, r.weight]);
    }
    expect(CSS.match(/@theme\b/g)).toHaveLength(1);
    expect(textTokens(THEME).sort()).toEqual(want.sort());
    expect(textTokens(CSS)).toHaveLength(want.length);
  });

  // The size alone until #741: a px line height inherits as a length, and an allowed file's bare
  // `text-[26px]` would take an 18 px line box.
  it("sets body's size from the body role", () => {
    const body = ruleBody(ruleBody(CSS, '@layer base'), 'body');
    expect(body).toMatch(/font-size:\s*var\(--text-body\);/);
    expect(body).not.toMatch(/line-height:/);
  });

  // The stylesheet sets type through the roles too; the fields' 16 below md is the one literal.
  it('sets no type off the roles in the stylesheet outside the theme', () => {
    const rest = CSS.replace(THEME, '');
    expect(stylesheetOffences(rest)).toEqual(['font-size: 16px']);
    expect(stylesheetOffences('th { line-height: var(--text-table--line-height); }')).toEqual([]);
    expect(stylesheetOffences('.x { line-height: 12px; font: 10px a; }')).toEqual([
      'line-height: 12px',
      'font: 10px a',
    ]);
    const applied = [...rest.matchAll(/@apply\s+([^;]+);/g)].map((m) => m[1]);
    const control = parse('src/index.css.ts', `const a = '${applied.join(' ')}';`);
    expect(hits(DS, [{ rel: 'src/index.css', sf: control }])).toEqual([]);
  });

  it('finds no size, line height or tracking outside the roles beyond the allow-list', () => {
    expect(hits(DS, SOURCES)).toEqual([...expected(ALLOWED), ...expected(FIELDS)].sort());
  });

  // The controls are inline and split at the needle, so this file reads as no class string.
  describe('the census can tell', () => {
    const control = (text: string) =>
      hits(DS, [{ rel: 'src/control.tsx', sf: parse('src/control.tsx', text) }]);

    it.each([
      ['an arbitrary size', '<b className="text-[1' + '3px]" />;', 'text-[13px]'],
      [
        'a size under the floor',
        "const c = 'max-md:text-[9." + "5px] text-ink';",
        'max-md:text-[9.5px]',
      ],
      ['a size by variable', "const c = 'text-(length:--" + "x)';", 'text-(length:--x)'],
      ['a size by property', "const c = 'md:[font-size:" + "9px]';", 'md:[font-size:9px]'],
      [
        'the font shorthand',
        "const c = '[font:500_10px/1_var(--font-" + "sans)]';",
        '[font:500_10px/1_var(--font-sans)]',
      ],
      [
        'a token overridden locally',
        '<div className="[--text-label:' + '9px]" />;',
        '[--text-label:9px]',
      ],
      ['a named size', '<b className={`p-1 text-' + 'xs ${x}`} />;', 'text-xs'],
      [
        'the field size off a field',
        "const c = 'font-mono max-md:!text-" + "base';",
        'max-md:!text-base',
      ],
      ['a line height', '<b className="text-body lead' + 'ing-[19px]" />;', 'leading-[19px]'],
      ['a named line height', "const c = 'lead" + "ing-normal';", 'leading-normal'],
      ['a line height by slash', "const c = 'text-body/" + "5';", 'text-body/5'],
      ['a tracking', "const c = { md: 'track" + "ing-[.08em]' };", 'tracking-[.08em]'],
      [
        'a tracking by property',
        "const c = '[letter-spacing:" + ".08em]';",
        '[letter-spacing:.08em]',
      ],
      ['an SVG size', '<text fontSize={1' + '0}>a</text>;', 'fontSize=10'],
      ['an SVG size spelt as CSS', '<text font-size="' + '9">a</text>;', 'font-size=9'],
      ['a size in a conditional', '<text fontSize={wide ? 11 : ' + '9}>a</text>;', 'fontSize=9'],
      [
        'a size in a const',
        'const TICK = ' + '9; <text fontSize={(TICK as number)}>a</text>;',
        'fontSize=9',
      ],
      ['a tick size', 'const t = { fontSize: 10' + '.5 };', 'fontSize=10.5'],
      ['a size by shorthand', 'const fontSize = ' + '9; const t = { fontSize };', 'fontSize=9'],
      ['a size in rem', "const s = { fontSize: '0.6" + "rem' };", 'fontSize=0.6rem'],
      ['a style size off the roles', '<b style={{ fontSize: 1' + '8 }} />;', 'fontSize=18'],
      [
        'a token of the wrong kind',
        "<b style={{ fontSize: 'var(--text-label-caps--letter-" + "spacing)' }} />;",
        'fontSize=var(--text-label-caps--letter-spacing)',
      ],
      ['a style size it cannot read', '<b style={{ fontSize: si' + 'ze }} />;', 'fontSize=size'],
      ['a style line height', "<b style={{ lineHeight: '1" + "2px' }} />;", 'lineHeight=12px'],
      [
        'a style token override',
        "<b style={{ '--text-lab" + "el': '9px' }} />;",
        'style --text-label',
      ],
      [
        'caps without its recipe',
        "const c = 'upper" + "case';",
        'uppercase without the caps recipe',
      ],
      [
        'the recipe without caps',
        "const c = 'text-label-" + "caps';",
        'caps recipe without uppercase',
      ],
      [
        'a weight on a recipe',
        '<b className={`text-label-figure ${on ? "font-' + 'bold" : ""}`} />;',
        'font-bold on a label',
      ],
      [
        'an arbitrary weight on a recipe',
        "const c = 'text-label-caps uppercase font-[" + "650]';",
        'font-[650] on a label',
      ],
      [
        'a case change on a recipe',
        "const c = 'text-label-caps uppercase max-md:normal-" + "case';",
        'max-md:normal-case on a label',
      ],
      [
        'a weight by variable on a recipe',
        "const c = 'text-label-caps uppercase [--tw-font-" + "weight:800]';",
        '[--tw-font-weight:800] on a label',
      ],
      [
        'a style passed on as an option',
        'const o = { style: { fontSize: 1' + '3 } };',
        'fontSize=13',
      ],
      ['a chart content style', '<Tip contentStyle={{ fontSize: 1' + '3 }} />;', 'fontSize=13'],
      [
        'a const shadowed by a parameter',
        'const size = 11; function T({ size }) { return <text fontSize={si' + 'ze} />; }',
        'fontSize=size',
      ],
      [
        'a const in its own block',
        'function A() { const s = ' +
          '9; return <text fontSize={s} />; } function B() { const s = 11; return <text fontSize={s} />; }',
        'fontSize=9',
      ],
      [
        'a computed style key',
        "<b style={{ ['--text-lab" + "el' as string]: '9px' }} />;",
        'style --text-label',
      ],
    ] as const)('%s', (_what, text, offence) => {
      expect(control(text)).toEqual([`src/control.tsx | ${offence} | 1`]);
    });

    it('names the size, so one swapped for another is a new offence', () => {
      expect(control("const a = 'text-[1" + "3px]'; const b = 'text-[9" + "px]';")).toEqual([
        'src/control.tsx | text-[13px] | 1',
        'src/control.tsx | text-[9px] | 1',
      ]);
    });

    it.each([
      ['a role', '<b className="text-body font-semibold" />;'],
      [
        'the caps recipe across a template',
        '<b className={`text-label-caps ${on ? "uppercase" : "uppercase"}`} />;',
      ],
      ['a colour', "const c = 'text-muted hover:text-ink';"],
      ['a colour at an alpha', "const c = 'text-ink/60';"],
      ['an unknown word', "const c = 'text-tiny lorem';"],
      ['a role size in SVG', '<text fontSize={11}>a</text>;'],
      ['a role token in a style', "<b style={{ fontSize: 'var(--text-small)' }} />;"],
      ['a comment', '// text-[10px] tracking-[.08em]\nconst a = 1;'],
      ['a style var unrelated to type', "<b style={{ '--tw-enter-translate-y': '4px' }} />;"],
      ['copy that says uppercase', "const m = 'Password must contain an uppercase letter.';"],
      ['lowercase copy that says uppercase', "const m = 'must contain an uppercase letter';"],
      ['a case in a style', "<b style={{ textTransform: 'uppercase' }} />;"],
      [
        'role tokens in an option style',
        "const o = { style: { fontSize: 'var(--text-body)', lineHeight: 'var(--text-body--line-height)' } };",
      ],
      ['a const in scope', 'function A() { const size = 11; return <text fontSize={size} />; }'],
    ])('and leaves %s alone', (_what, text) => {
      expect(control(text)).toEqual([]);
    });
  });
});
