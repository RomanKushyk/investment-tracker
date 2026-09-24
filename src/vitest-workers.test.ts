import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import vitestConfig, { maxWorkersFor } from '../vitest.config';

describe('the worker cap', () => {
  it('caps sixteen cores at four', () => {
    expect(maxWorkersFor(16)).toBe(4);
  });

  it("keeps vitest's own default below the cap, so a four-core CI runner keeps three", () => {
    expect(maxWorkersFor(4)).toBe(3);
  });

  it('runs one worker on a single core', () => {
    expect(maxWorkersFor(1)).toBe(1);
  });

  it('is what the config hands vitest', () => {
    expect(vitestConfig.test?.maxWorkers).toBe(maxWorkersFor(availableParallelism()));
  });
});
