import { useState } from 'react';

import type { Dataset } from '../../core/backup/json';
import { useDataset, useSettings } from '../../state/settings';

// S5 dataset switch (design/extensions/settings.dc.html) — light-surface twin
// of the sidebar currency toggle: track `panel`, thumb `card` with the card
// shadow, sliding-thumb motion 300ms soft (D7; reduced-motion collapses via
// the global kill-switch). Flip = confirm-free but explained by the row's
// helper copy: setDataset persists the flag into kubushka-settings
// synchronously and location.reload()s (G4) — the brief pre-reload lockout
// disables both segments so a second click can't race the navigation.
export function DatasetSwitch() {
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
      className={`relative z-10 cursor-pointer rounded-[7px] px-[22px] py-1.5 text-xs font-bold transition active:scale-[.97] ${dataset === d ? 'text-ink' : 'text-muted hover:opacity-85'}`}
    >
      {label}
    </button>
  );

  return (
    <div
      className={`border-panel-border bg-panel relative flex gap-1 rounded-[12px] border p-1 transition ${switching ? 'opacity-50' : ''}`}
    >
      {/* sliding thumb (D7): both segments share the same mono-font width, so
          translateX(100% + gap) lands it exactly under the other one */}
      <div
        aria-hidden
        className="bg-card absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-[7px] shadow-[0_1px_3px_rgba(38,38,42,.06)] transition-transform duration-300 ease-soft"
        style={{ transform: dataset === 'demo' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('demo', 'Demo')}
      {segment('live', 'Live')}
    </div>
  );
}
