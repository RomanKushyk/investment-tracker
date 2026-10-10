import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES, MAX_OPS, OP_NAMES, mergePatch, opIssues, opSchema } from './ops';

const BUY = {
  id: 'b',
  date: '2026-03-02',
  type: 'buy',
  assetId: 'a',
  amount: 1000,
  quantity: 10,
} as const;

const ASSET = {
  id: 'a',
  name: 'REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'dividends',
  expectedPct: 10,
  targetPct: 25,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-03-02',
  createdAt: '2026-03-02T09:00:00',
  inzhur: { kind: 'fund', ref: 'reit' },
} as const;

const issuesOf = (op: unknown) => {
  const parsed = opSchema.safeParse(op);
  return parsed.success ? [] : opIssues(parsed.error.issues, op);
};

describe('the op vocabulary', () => {
  it('is exactly the eleven, with no account op among them', () => {
    expect(OP_NAMES).toEqual([
      'asset.add',
      'asset.patch',
      'asset.delete',
      'asset.prune',
      'transaction.add',
      'transaction.patch',
      'transaction.delete',
      'snapshot.patch',
      'snapshot.delete',
      'snapshot.move',
      'dataset.clear',
    ]);
  });

  it('takes each op by the name OP_NAMES gives it, in that order', () => {
    expect(opSchema.options.map((o) => o.shape.op.value)).toEqual(OP_NAMES);
  });

  it('names a day that is no date as the import does, wherever an op takes one', () => {
    expect(issuesOf({ op: 'snapshot.delete', date: '2026-02-30' })).toEqual([
      { field: 'date', code: 'expected-date' },
    ]);
    expect(issuesOf({ op: 'snapshot.move', from: '2026-02-30', to: 'x' })).toEqual([
      { field: 'from', code: 'expected-date' },
      { field: 'to', code: 'expected-date' },
    ]);
  });

  it('refuses an op it does not name, at `op`', () => {
    expect(issuesOf({ op: 'account.add', account: {} })).toEqual([
      { field: 'op', code: 'invalid' },
    ]);
    // A day is patched, never replaced: a replacement deletes what its sender did not send (#397).
    expect(issuesOf({ op: 'snapshot.put', snapshot: { date: '2026-03-03', quotes: {} } })).toEqual([
      { field: 'op', code: 'invalid' },
    ]);
  });

  it('refuses a key an op does not take', () => {
    expect(issuesOf({ op: 'asset.delete', id: 'x', force: true })).toEqual([
      { code: 'unknown-key', value: 'force' },
    ]);
  });

  it('names a row’s fault as the import does, below the row', () => {
    const noCount: Record<string, unknown> = { ...BUY };
    delete noCount.quantity;
    expect(issuesOf({ op: 'transaction.add', transaction: noCount })).toEqual([
      { field: 'quantity', code: 'units-missing-on-position-row' },
    ]);
    expect(issuesOf({ op: 'snapshot.patch', date: '2026-02-30', patch: { quotes: {} } })).toEqual([
      { field: 'date', code: 'expected-date' },
    ]);
    expect(
      issuesOf({
        op: 'snapshot.patch',
        date: '2026-07-24',
        patch: { quotes: {}, savedAt: '2026-13-01T00:00:00' },
      }),
    ).toEqual([{ field: 'savedAt', code: 'expected-datetime' }]);
    // The day is the patch's key, so a patch cannot move it; `snapshot.move` does.
    expect(
      issuesOf({
        op: 'snapshot.patch',
        date: '2026-07-24',
        patch: { quotes: {}, date: '2026-07-25' },
      }),
    ).toEqual([{ code: 'unknown-key', value: 'date' }]);
    expect(
      issuesOf({ op: 'asset.add', asset: { id: 'a', name: 'x', surplus: 1 } }).find(
        (i) => i.code === 'unknown-key',
      ),
    ).toEqual({ code: 'unknown-key', value: 'surplus' });
  });

  // A quote's key is an asset id, not a field name: `quotes.date` is a quote, not a date (#352).
  it('codes a quote by its place, whatever asset id keys it', () => {
    for (const key of ['reit', 'date', 'savedAt', 'amount']) {
      const patch = { quotes: { [key]: 'abc' } };
      expect(issuesOf({ op: 'snapshot.patch', date: '2026-07-24', patch }), key).toEqual([
        { field: `quotes.${key}`, code: 'invalid' },
      ]);
    }
  });

  it('accepts every op in its own shape', () => {
    const ops = [
      { op: 'asset.add', asset: ASSET },
      { op: 'asset.patch', id: 'a', patch: { name: 'x', maturity: null } },
      { op: 'asset.delete', id: 'a' },
      { op: 'asset.prune', id: 'a' },
      { op: 'transaction.add', transaction: BUY },
      { op: 'transaction.patch', id: 'b', patch: { quantity: null } },
      { op: 'transaction.delete', id: 'b' },
      { op: 'snapshot.patch', date: '2026-03-03', patch: { quotes: { a: 10, b: null } } },
      { op: 'snapshot.delete', date: '2026-03-03' },
      { op: 'snapshot.move', from: '2026-03-03', to: '2026-03-04' },
      { op: 'dataset.clear' },
    ];
    for (const op of ops) expect([op.op, issuesOf(op)]).toEqual([op.op, []]);
  });

  it('bounds one request at a hundred ops and a mebibyte', () => {
    expect([MAX_OPS, MAX_BODY_BYTES]).toEqual([100, 1_048_576]);
  });
});

describe('mergePatch is RFC 7396', () => {
  // Appendix A, every row.
  it.each([
    [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
    [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
    [{ a: 'b' }, { a: null }, {}],
    [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
    [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
    [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
    [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
    [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
    [
      ['a', 'b'],
      ['c', 'd'],
      ['c', 'd'],
    ],
    [{ a: 'b' }, ['c'], ['c']],
    [{ a: 'foo' }, null, null],
    [{ a: 'foo' }, 'bar', 'bar'],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: 'b', c: null }, { a: 'b' }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])('%j patched by %j is %j', (target, patch, result) => {
    expect(mergePatch(target, patch)).toEqual(result);
  });

  it('returns a fresh value and leaves the target as it was', () => {
    const target = { a: { b: 'c' } };
    const merged = mergePatch(target, { a: { d: 'e' } });
    expect(merged).toEqual({ a: { b: 'c', d: 'e' } });
    expect(target).toEqual({ a: { b: 'c' } });
  });

  it('reads only the target’s own members', () => {
    expect(mergePatch({}, { constructor: { a: 1 } })).toEqual({ constructor: { a: 1 } });
  });

  it('refuses a patch naming __proto__ rather than setting a prototype', () => {
    expect(() => mergePatch({}, JSON.parse('{"__proto__":{"x":1}}'))).toThrow(RangeError);
  });
});
