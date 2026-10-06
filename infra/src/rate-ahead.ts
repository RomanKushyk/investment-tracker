// The official rate stored ahead: from `NBU_RATE_SET_BY` NBU has set tomorrow's rate, so each firing
// stores it, and today's when missing, so the read `served` makes finds it. Then it publishes the age
// of the rate a request would be served, as a number (*Alerting*).
//
// A FAILED FETCH DOES NOT THROW: the next firing asks again, and the age is what says none
// answered. Thrown, one slow afternoon would trip `RateAheadErrorAlarm`.
import { daysBetween, kyivDateIso } from '@quirenote/core/dates';
import { rateDatesDue } from './dates';
import { connect } from './dsql';
import type { SqlClient } from './migrate';
import { createOfficialRate, latestRate } from './official-rate';

export interface RateAge {
  metric: 'rateAgeDays';
  value: number;
}

export async function rateAhead(
  client: SqlClient,
  rates: ReturnType<typeof createOfficialRate>,
  now: Date,
): Promise<RateAge> {
  for (const date of rateDatesDue(now)) {
    if ((await latestRate(client, date))?.date !== date) await rates.ensure(client, date);
  }
  const today = kyivDateIso(now);
  const served = await latestRate(client, today);
  // AN ABSENT AGE IS AN ERROR, NOT A ZERO: zero is the healthy side of `RateAgeAlarm`.
  if (served === undefined) throw new Error(`no official rate is stored on or before ${today}`);
  // The log line IS the metric: `RateAgeMetricFilter` reads `$.value` off it.
  const line: RateAge = { metric: 'rateAgeDays', value: daysBetween(served.date, today) };
  console.log(JSON.stringify(line));
  return line;
}

export async function handler(): Promise<RateAge> {
  const client = await connect();
  try {
    // BUILT PER INVOCATION, not per environment: Lambda retries a failed asynchronous invocation
    // within minutes, possibly in the same warm environment, where a kept spacing would skip it.
    return await rateAhead(client, createOfficialRate(), new Date());
  } finally {
    await client.end().catch((err: unknown) => console.error('rate-ahead disconnect failed', err));
  }
}
