import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE SEASONALITY TOOLTIP NAMES ITS ROWS FROM THE DICTIONARY. recharts prints a series'
// `dataKey` wherever the `<Bar>` carries no `name`, so the wiring is the fix, not the words.
//
// A source test: the suite is `environment: 'node'` with no jsdom, so there is no way to
// mount the chart here.
const here = dirname(fileURLToPath(import.meta.url));
/** COMMENTS STRIPPED BEFORE MATCHING: prose must not be able to pass or fail a test.
 *  QUOTE-EXACT AND LINE BY LINE, because dropping only whole-line `//` comments leaves the
 *  trailing ones and one apostrophe in prose then desynchronises every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// name={names.actual}` on the bare actual `<Bar>` leaves
 *  this red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}
const CHART = stripTs(readFileSync(join(here, 'SeasonalityBars.tsx'), 'utf8'));

// The props of every `<Bar …>` opening tag; `\s` after the name keeps `<BarChart>` out.
const BARS = [...CHART.matchAll(/<Bar\s([^>]*)>/g)].map((m) => m[1] ?? '');

function barProps(dataKey: string): string {
  const found = BARS.filter((props) => props.includes(`dataKey="${dataKey}"`));
  expect(found, `exactly one <Bar dataKey="${dataKey}">`).toHaveLength(1);
  return found[0] ?? '';
}

describe('the Seasonality tooltip rows', () => {
  it('takes both names from the dictionary helper', () => {
    expect(CHART).toMatch(/\bconst names = seasonalitySeriesNames\(t\);/);
  });

  it('gives each <Bar> its name, so the dataKey never reaches the screen', () => {
    expect(barProps('actual')).toMatch(/\bname=\{names\.actual\}/);
    expect(barProps('expected')).toMatch(/\bname=\{names\.expected\}/);
  });

  it('orders the rows by key, not by the translated name', () => {
    expect(CHART).toMatch(/<Tooltip\s[^>]*\bitemSorter="dataKey"/);
  });
});
