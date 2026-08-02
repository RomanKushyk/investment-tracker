// Pure helpers for the Settings→Portfolio targets editor (S4) — per-screen
// glue, imports core only (D8: structured tokens out, no English).
// Covered by targets.test.ts.
import { percentInputSchema } from '../../core/schemas';

// One raw %-input → 0–100 target share, or null when invalid. Exactly the
// AssetForm Target grammar (spaces, comma or dot decimals) via the shared
// core schema, so the two target editors can never disagree.
export function parseTargetPct(raw: string): number | null {
  const parsed = percentInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface TargetRowState {
  id: string;
  // Parsed draft (stored value when the row has no draft); null = invalid
  // input → the row shows the error treatment.
  value: number | null;
  // What the live preview/Σ use: the valid entry, else the STORED target —
  // an unparseable keystroke never zeroes the bar or the sum (the S4 error
  // mock reads Σ 92 with "3%" typed because the stored 3 still counts).
  effective: number;
  // Valid and different from stored — feeds the per-asset save patches.
  changed: boolean;
}

export function targetRowStates(
  assets: readonly { id: string; targetPct: number }[],
  drafts: Readonly<Record<string, string>>,
): TargetRowState[] {
  return assets.map((a) => {
    const raw = drafts[a.id];
    if (raw === undefined) return { id: a.id, value: a.targetPct, effective: a.targetPct, changed: false };
    const value = parseTargetPct(raw);
    return {
      id: a.id,
      value,
      effective: value ?? a.targetPct,
      changed: value !== null && value !== a.targetPct,
    };
  });
}

// Σ of the effective targets, normalized to 2 dp so float noise from valid
// decimal entries (33.3+33.3+33.4 → 100.00000000000001) can't fake a warn
// state (D13 display-rounding policy). Demo fixture: 40+40+17+3 = 100.
export function targetsSum(rows: readonly { effective: number }[]): number {
  const sum = rows.reduce((a, r) => a + r.effective, 0);
  return Math.round(sum * 100) / 100;
}

// Structured status token (D8): 'ok' iff Σ is exactly 100 (post-normalize);
// everything else is 'warn' — a nudge, never a save blocker (brief S4).
export function sumStatus(sum: number): 'ok' | 'warn' {
  return sum === 100 ? 'ok' : 'warn';
}

// Per-asset patches for the explicit Save (useUpdateAsset per asset) — only
// rows whose valid value actually differs from the stored one.
export function changedTargets(
  rows: readonly TargetRowState[],
): { id: string; targetPct: number }[] {
  return rows.flatMap((r) =>
    r.changed && r.value !== null ? [{ id: r.id, targetPct: r.value }] : [],
  );
}
