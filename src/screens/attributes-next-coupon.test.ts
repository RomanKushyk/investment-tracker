import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { nextUnsettledCouponDate } from '@quirenote/core/accrual';
import type { Asset, Transaction } from '@quirenote/core/types';

// THE NEXT COUPON FACT SHOWS THE OCCURRENCE THE LEDGER HAS NOT SETTLED. The transaction form
// never moves `asset.nextCoupon`, so a payout recorded there leaves the pointer on a settled
// date while the coupon card offers the next one.
//
// A source test: the suite is `environment: 'node'` with no jsdom, so there is no way to
// mount the screen here.
const here = dirname(fileURLToPath(import.meta.url));
/** COMMENTS STRIPPED BEFORE MATCHING: the rationale in the screen names `a.nextCoupon`, and
 *  prose must not be able to pass or fail a test. QUOTE-EXACT AND LINE BY LINE, because
 *  dropping only whole-line `//` comments leaves the trailing ones and one apostrophe in prose
 *  then desynchronises every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// a.nextCoupon` in the screen leaves this green, and
 *  binding the fact to the pointer turns it red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}
const SCREEN = stripTs(readFileSync(join(here, 'Attributes.tsx'), 'utf8'));

// The seed's …8976 (`core/seed.ts`): semiannual, the pointer on 25.08.2026, maturing 25.02.2027.
const bond: Asset = {
  id: 'ovdp8976',
  name: 'OVDP UA4000238976',
  code: 'GB',
  colorKey: 'ovdp8976',
  yieldType: 'fixed_coupon',
  expectedPct: 16.4,
  targetPct: 17,
  payoutSchedule: 'semiannual',
  firstPurchase: '2026-02-05',
  createdAt: '2026-02-05T10:00:00',
  maturity: '2027-02-25',
  couponAmount: 1240,
  nextCoupon: '2026-08-25',
};

// A plain ledger row, as the transaction form writes it: nothing rolls the pointer.
function payout(id: string, date: string): Transaction {
  return { id, date, type: 'interest_payout', assetId: bond.id, amount: 1240 };
}

describe('the two readings the fact chooses between', () => {
  it('part company once a coupon is recorded from the form', () => {
    const answer = nextUnsettledCouponDate(bond, [payout('p1', '2026-08-25')]);
    expect(answer).toBe('2027-02-25');
    expect(answer, 'the pointer still sits on the settled occurrence').not.toBe(bond.nextCoupon);
  });

  it('leaves nothing to show once the schedule is spent', () => {
    const both = [payout('p1', '2026-08-25'), payout('p2', '2027-02-25')];
    expect(nextUnsettledCouponDate(bond, both)).toBeUndefined();
  });
});

describe('the Next coupon fact on /attributes', () => {
  it('never reads the stored pointer', () => {
    expect(
      SCREEN,
      'the screen reads `a.nextCoupon`, which a payout recorded from the form leaves on a ' +
        'settled date',
    ).not.toMatch(/\ba\.nextCoupon\b/);
  });

  it('renders the walk, and «—» when the walk answers nothing', () => {
    const fact = SCREEN.match(
      /<Fact label=\{t\.analytics\.attributes\.nextCoupon\}>([\s\S]*?)<\/Fact>/,
    );
    expect(fact, 'the Next coupon fact is gone').not.toBeNull();
    const shown = fact![1].match(/([\w.]+) \? f\.date\(\1\) : '—'/);
    expect(shown, 'the fact no longer renders one date or «—»').not.toBeNull();
    const name = shown![1];
    expect(
      SCREEN,
      `\`${name}\` is not the walk's answer for this asset over the whole ledger`,
    ).toMatch(
      new RegExp(
        `const ${name.replace(/\./g, '\\.')} = nextUnsettledCouponDate\\(a, transactions\\);`,
      ),
    );
  });
});
