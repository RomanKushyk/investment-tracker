import { describe, expect, it } from 'vitest';

import { COUPON_FREQUENCY, SCHEDULE_LABEL } from './schedule-labels';

describe('SCHEDULE_LABEL', () => {
  it('maps payout schedules to the Attributes fact label (design copy)', () => {
    expect(SCHEDULE_LABEL.monthly).toBe('Monthly');
    expect(SCHEDULE_LABEL.semiannual).toBe('Semi-annual');
    expect(SCHEDULE_LABEL.maturity).toBe('At maturity');
    expect(SCHEDULE_LABEL.none).toBe('None (price only)');
  });
});

describe('COUPON_FREQUENCY', () => {
  it('maps payout schedules to the Coupon fact frequency word', () => {
    expect(COUPON_FREQUENCY.semiannual).toBe('semi-annual');
    expect(COUPON_FREQUENCY.quarterly).toBe('quarterly');
    expect(COUPON_FREQUENCY.monthly).toBe('monthly');
    expect(COUPON_FREQUENCY.maturity).toBe('at maturity');
  });
});
