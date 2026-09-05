import { useState } from 'react';

import type { Dataset } from '../../core/backup/json';
import { useDataset, useSettings } from '../../state/settings';
import { useT } from '../../i18n/useT';
import { TAP_44 } from '../../components/ui/tap-target';

// S5 dataset switch (design/extensions/settings.dc.html) — FILLED segmented
// control (D114): track `ink`, `card` sliding chip, no thumb shadow. It was
// `panel`/`card` and a twin of the sidebar currency toggle, which D114 makes
// the one exception. Sliding-thumb motion 300ms soft (D7; reduced-motion collapses via
// the global kill-switch). Flip = confirm-free but explained by the row's
// helper copy: setDataset persists the flag into kubushka-settings
// synchronously and location.reload()s (G4) — the brief pre-reload lockout
// disables both segments so a second click can't race the navigation.
export function DatasetSwitch() {
  const t = useT();
  const dataset = useDataset();
  const setDataset = useSettings((s) => s.setDataset);
  const [switching, setSwitching] = useState(false);

  function flip(next: Dataset) {
    if (next === dataset || switching) return;
    setSwitching(true);
    setDataset(next); // persists, then reloads (G4)
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
      // A GRID, NOT A FLEX ROW, and that is what equalises the segments. «Демо»
      // is four mono characters and «Живий» five, so a flex track sized them
      // 72.8 and 80 while the chip is a fixed `calc(50% - 6px)` = 76.4 — it
      // overhung one by 3.6px and started 2.6px late on the other. `flex-1` does
      // NOT fix it: this track shrink-wraps its content, so there is no free
      // space for a grow factor to distribute. Two `1fr` columns in an
      // auto-width grid all take the widest content, which is exactly how the
      // theme (`grid-cols-3`) and language (`grid-cols-2`) controls avoid the
      // same problem — measured, their segments are equal to the hundredth and
      // their chips sit at offset 0. The currency pair gets away with flex only
      // because «₴ UAH» and «$ USD» are the same length.
      //
      // It was invisible until D114: a `card` chip on a `panel` track was
      // nearly the same colour and hid the misalignment; on an `ink` track it
      // does not.
      data-filled-track
      className={`relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1 transition ${switching ? 'opacity-50' : ''}`}
    >
      {/* sliding thumb (D7): both segments share the same mono-font width, so
          translateX(100% + gap) lands it exactly under the other one */}
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
