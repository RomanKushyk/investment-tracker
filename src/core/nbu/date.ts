// The one place that reads the National Bank's date format.
//
// Both NBU endpoints this project touches — the fair-value file and the
// exchange-rate directory — write dates as `dd.MM.yyyy`. Two copies of this
// parse would eventually disagree, and the disagreement would be silent: read
// as ISO, `10.08.2026` becomes a valid-looking date in a different month, and
// only for the first twelve days of each month.

/**
 * `dd.MM.yyyy` -> `yyyy-MM-dd`, or `undefined` if the value is not a real date.
 *
 * The round-trip check is what rejects `31.02.2026`: the shape regex proves the
 * fields are numbers of the right width, not that the day exists.
 */
export function nbuDateToIso(value: string | undefined): string | undefined {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value?.trim() ?? '');
  if (m === null) return undefined;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}
