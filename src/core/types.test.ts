import { describe, expect, it } from 'vitest';

import {
  isPayout,
  movesPosition,
  PAYOUT_TYPES,
  POSITION_MOVING,
  targetsAsset,
  type TxType,
} from './types';

/** The three questions `types.ts` answers about a row, one column each. */
interface TypeAnswers {
  /** `targetsAsset` — does the row belong to an asset, or to the portfolio? */
  asset: boolean;
  /** `movesPosition` — may the row carry a quantity? */
  moves: boolean;
  /** `isPayout` — is the row a distribution, and so admit a withholding? */
  payout: boolean;
}

/**
 * Every type against every predicate, in ONE `Record<TxType, …>` rather than
 * three overlapping ones. A record and not a list, because a list can be
 * under-written and a record cannot: a ninth `TxType` has no row here and the
 * BUILD stops, before any assertion below gets to compare two sets that both
 * forgot it.
 */
const ANSWERS: Record<TxType, TypeAnswers> = {
  buy: { asset: true, moves: true, payout: false },
  sell: { asset: true, moves: true, payout: false },
  deposit: { asset: false, moves: false, payout: false },
  withdrawal: { asset: false, moves: false, payout: false },
  dividend_accrual: { asset: true, moves: false, payout: true },
  interest_payout: { asset: true, moves: false, payout: true },
  reinvest: { asset: true, moves: true, payout: false },
  redemption: { asset: true, moves: true, payout: false },
};

const TYPES = Object.keys(ANSWERS) as TxType[];

describe('a type-keyed site answers for every type, or it does not compile', () => {
  it('a synthetic ninth member of the union has no row, and that is the guard', () => {
    // THE ONLY PLACE IN THIS REPO THAT ADDS A NINTH TYPE. `ANSWERS` is short a
    // `transfer` row, so the line below is an error, and `@ts-expect-error`
    // turns it into the assertion.
    //
    // WHAT IT GUARDS, exactly, measured on `tsc --strict`: widen `ANSWERS` to
    // `Record<string, …>` and the assignment stops erring, so TS2578 fires on
    // the directive nothing used. It does NOT catch a `Partial` — a partial
    // source is still unassignable here, the directive stays used, and the
    // build breaks at `ANSWERS[type].asset` instead.
    //
    // The exhaustive SWITCHES this pairs with cannot be proved from a test: a
    // missing arm is an error in the file that holds it, which is exactly what
    // writing them against `never` buys. `pnpm typecheck` is that half.
    // The member is spelt so that it cannot BECOME a `TxType`: named after a
    // type someone might really add, the assignment would stop erring the day
    // they added it, and this line would read as an unused directive rather
    // than as the row `ANSWERS` is missing.
    // @ts-expect-error a ninth type has no row in ANSWERS, and that error is the guard
    const withNinth: Record<TxType | '__a-ninth-type', TypeAnswers> = ANSWERS;
    expect(Object.keys(withNinth)).toHaveLength(8);
  });

  it('targetsAsset: exactly deposit and withdrawal name no asset', () => {
    // Persistence today. The predicate used to be a NEGATION of a private list,
    // so a ninth type was "targets an asset" by default and the form would have
    // demanded one for a row that names none. It is a switch over all eight now.
    for (const type of TYPES) expect(targetsAsset(type), type).toBe(ANSWERS[type].asset);
  });

  it('movesPosition: exactly the four types W7 lets carry a quantity', () => {
    expect([...POSITION_MOVING]).toEqual(['buy', 'sell', 'reinvest', 'redemption']);
    for (const type of TYPES) expect(movesPosition(type), type).toBe(ANSWERS[type].moves);
  });

  it('isPayout: exactly the two types that may carry a withholding', () => {
    expect([...PAYOUT_TYPES]).toEqual(['dividend_accrual', 'interest_payout']);
    for (const type of TYPES) expect(isPayout(type), type).toBe(ANSWERS[type].payout);
  });
});
