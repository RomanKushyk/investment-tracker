// The pure half of `NumberField` — split out because a component file may
// export nothing but components (fast refresh), and because this is the part
// worth testing without a DOM.

export function digitsBefore(text: string, at: number): number {
  return (text.slice(0, at).match(/\d/g) ?? []).length;
}

/**
 * Where the caret goes once the text has been regrouped into `shown`: behind the
 * `n`th DIGIT, counted rather than offset, because regrouping adds and removes
 * marks before it. `fallback` answers when no digit does — a mark pressed in
 * front of the first one, where an offset is all there is to go on.
 */
export function caretAfterDigits(shown: string, n: number, fallback: number): number {
  if (n <= 0) return Math.min(Math.max(fallback, 0), shown.length);
  let seen = 0;
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] >= '0' && shown[i] <= '9' && ++seen === n) return i + 1;
  }
  return shown.length;
}

/** The stored value with one digit gone — the `n`th, or the one before it. */
export function withoutDigit(stored: string, n: number, forward: boolean): string {
  const index = forward ? n : n - 1;
  if (index < 0) return stored;
  let seen = -1;
  for (let i = 0; i < stored.length; i++) {
    if (stored[i] >= '0' && stored[i] <= '9' && ++seen === index) {
      return stored.slice(0, i) + stored.slice(i + 1);
    }
  }
  return stored;
}
