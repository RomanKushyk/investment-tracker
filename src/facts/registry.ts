/**
 * Two kinds, because they rot differently. DERIVED is computable from the tree
 * now, so it is never written by hand. MEASURED came from outside and cannot be
 * recomputed, so it carries how it was taken.
 */
export type Fact =
  | { kind: 'derived'; compute: () => string | number }
  | {
      kind: 'measured';
      value: number;
      unit: string;
      at: string;
      method: string;
      /** How many readings. ONE is a legitimate answer and a visible one. */
      samples: number;
      reproduce: string;
    };

export const derived = (compute: () => string | number): Fact => ({ kind: 'derived', compute });

export function measured(spec: Omit<Extract<Fact, { kind: 'measured' }>, 'kind'>): Fact {
  // The type says `number` and `string`; these two values are what the type
  // cannot say. `samples: 0` and a prose date both typecheck.
  if (!Number.isFinite(spec.samples) || spec.samples < 1) {
    throw new Error(`measured fact needs samples >= 1, got ${String(spec.samples)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.at)) {
    throw new Error(`measured fact needs an ISO date in \`at\`, got ${String(spec.at)}`);
  }
  // The type says `string`, which allows '' — presence without substance.
  if (!spec.method.trim()) {
    throw new Error(
      `measured fact needs a non-empty \`method\`, got ${JSON.stringify(spec.method)}`,
    );
  }
  if (!spec.reproduce.trim()) {
    throw new Error(
      `measured fact needs a non-empty \`reproduce\`, got ${JSON.stringify(spec.reproduce)}`,
    );
  }
  return { kind: 'measured', ...spec };
}

export const renderFact = (f: Fact): string =>
  f.kind === 'derived' ? String(f.compute()) : `${f.value} ${f.unit}`;
