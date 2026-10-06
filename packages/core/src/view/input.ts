// What every composer reads, split by what each one needs: a composer takes the
// smallest intersection, so `buildView`'s one input satisfies every call.
import type { ParsedFeed } from '../inzhur/parse';
import type { PeriodOption } from '../period';
import type { Asset, Snapshot, Transaction } from '../types';

export interface LedgerInput {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
}

export interface PeriodInput {
  period: PeriodOption;
}

/** The caller's day, ISO. Core never reads a clock: the SPA passes its local date,
 *  the server the Kyiv one (`kyivDateIso`). */
export interface ClockInput {
  today: string;
}

/** The Inzhur feed the app already holds, if any — the YTM at purchase solves against
 *  its schedule. */
export interface FeedInput {
  feed?: ParsedFeed | undefined;
}

/** A linked bond's published payment dates, by asset id, each once and in order: the archive's
 *  latest terms within the span `/view` reads, which ends on the caller's day. A `Map`, so no id
 *  can name a prototype key. */
export interface PaymentDatesInput {
  paymentDates?: ReadonlyMap<string, readonly string[]> | undefined;
}

export type ViewInput = LedgerInput & ClockInput & FeedInput & PaymentDatesInput;
