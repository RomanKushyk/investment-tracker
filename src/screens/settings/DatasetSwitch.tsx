import { useState } from 'react';

import type { Dataset } from '@quirenote/core/backup/json';
import { useDataset, useSettings } from '../../state/settings';
import { useT } from '../../i18n/useT';
import { TAP_44 } from '../../components/ui/tap-target';

// FILLED segmented control, the one the sidebar currency toggle is the exception
// to. Flip is confirm-free but explained by the row's helper copy: `setDataset`
// persists the flag synchronously and reloads, and the pre-reload lockout
// disables both segments so a second click cannot race the navigation.
export function DatasetSwitch() {
  const t = useT();
  const dataset = useDataset();
  const setDataset = useSettings((s) => s.setDataset);
  const [switching, setSwitching] = useState(false);

  function flip(next: Dataset) {
    if (next === dataset || switching) return;
    setSwitching(true);
    setDataset(next); // persists, then reloads
  }

  const segment = (d: Dataset, label: string) => (
    <button
      type="button"
      aria-pressed={dataset === d}
      disabled={switching}
      onClick={() => flip(d)}
      className={`relative z-10 cursor-pointer rounded-[7px] px-[22px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${dataset === d ? 'text-ink' : 'text-page hover:opacity-85'}`}
    >
      {label}
    </button>
  );

  return (
    <div
      // A GRID, NOT A FLEX ROW, and that is what equalises the segments: the two
      // labels are different lengths, so a flex track sizes them apart while the chip
      // is a fixed fraction and overhangs one. `flex-1` does NOT fix it — this track
      // shrink-wraps its content, so there is no free space for a grow factor to
      // distribute. Two `1fr` columns take the widest content, which is how the theme
      // and language controls avoid the same problem. A flex track survives only a pair
      // equal-width in every dictionary: these two are in English and are not in
      // Ukrainian, which is the reading the grid removes.
      //
      // It was invisible while the chip and the track were near the same colour.
      data-filled-track
      className={`relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1 transition ${switching ? 'opacity-50' : ''}`}
    >
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-[7px] bg-card transition-transform duration-300 ease-soft"
        style={{ transform: dataset === 'demo' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('demo', t.datasetSwitch.demo)}
      {segment('live', t.datasetSwitch.live)}
    </div>
  );
}
