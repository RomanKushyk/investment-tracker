// Pure helpers for the targets editor: imports core only, no English out.
import { percentInputSchemaFor } from '../../core/schemas';
import type { Lang } from '../../core/money';

// One raw %-input → 0–100 target share, or null when invalid. Exactly the
// AssetForm Target grammar via the shared core schema, so the two target editors
// can never disagree — WHICH MEANS TAKING THE LANGUAGE, because the asset form's
// copy of that grammar does. Under Ukrainian `17,500` is 17.5 in one editor and
// was 17500 in the other.
export function parseTargetPct(raw: string, lang: Lang): number | null {
  const parsed = percentInputSchemaFor(lang).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface TargetRowState {
  id: string;
  // Parsed draft (stored value when the row has no draft); null = invalid input.
  value: number | null;
  // What the live preview and Σ use: the valid entry, else the STORED target — an
  // unparseable keystroke never zeroes the bar or the sum.
  effective: number;
  changed: boolean;
}

export function targetRowStates(
  assets: readonly { id: string; targetPct: number }[],
  drafts: Readonly<Record<string, string>>,
  lang: Lang,
): TargetRowState[] {
  return assets.map((a) => {
    const raw = drafts[a.id];
    if (raw === undefined)
      return { id: a.id, value: a.targetPct, effective: a.targetPct, changed: false };
    const value = parseTargetPct(raw, lang);
    return {
      id: a.id,
      value,
      effective: value ?? a.targetPct,
      changed: value !== null && value !== a.targetPct,
    };
  });
}

// Normalized to 2 dp so float noise from valid decimal entries cannot fake a
// warn state.
export function targetsSum(rows: readonly { effective: number }[]): number {
  const sum = rows.reduce((a, r) => a + r.effective, 0);
  return Math.round(sum * 100) / 100;
}

// 'ok' iff Σ is exactly 100 post-normalize; everything else is a nudge, never a save blocker.
export function sumStatus(sum: number): 'ok' | 'warn' {
  return sum === 100 ? 'ok' : 'warn';
}

export function changedTargets(
  rows: readonly TargetRowState[],
): { id: string; targetPct: number }[] {
  return rows.flatMap((r) =>
    r.changed && r.value !== null ? [{ id: r.id, targetPct: r.value }] : [],
  );
}
