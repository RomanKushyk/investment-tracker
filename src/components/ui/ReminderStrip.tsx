import { CircleAlert, Clock, Info, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import type { Reminder, ReminderSeverity } from '../../core/reminders';
import { useFormat } from '../../hooks/useFormat';
import { useReminders } from '../../hooks/useReminders';
import { useSettings } from '../../state/settings';
import { TAP_44_BOX } from './tap-target';
import {
  moreRemindersLabel,
  reminderAction,
  REMINDER_STRIP_CAP,
  reminderText,
} from './reminder-labels';
import { useT } from '../../i18n/useT';

// The banner strip above the screen content on `/` and `/overview`
// (`design/extensions/reminders.dc.html`). SEVERITY IS THE CONTAINER: a tint
// background with its -tint-text carrying icon, text and ✕, no border and no
// shadow. `neg-tint` is minted for the overdue severity and used nowhere else,
// and `info` reads the INFO family rather than the gain one — gain and loss
// belong to deltas, and a reminder is not a delta (*Interaction rules*).
const SEVERITY_PAINT: Record<ReminderSeverity, string> = {
  info: 'bg-info-tint text-info-tint-text',
  warn: 'bg-warn-tint text-warn-tint-text',
  overdue: 'bg-neg-tint text-neg-tint-text',
};

const SEVERITY_ICON: Record<ReminderSeverity, typeof Info> = {
  info: Info,
  warn: CircleAlert,
  overdue: Clock,
};

// The drawing's cadence expressed in Tailwind's delay ladder, which is why the
// steps are uneven — the ladder has no rung at every multiple.
const STAGGER = ['', 'delay-75', 'delay-150', 'delay-200', 'delay-300'];

function ReminderBanner({
  reminder,
  assetName,
  withAction,
  index,
  exiting,
  onDismiss,
}: {
  reminder: Reminder;
  assetName: string;
  withAction: boolean;
  index: number;
  /** Dismissed a moment ago — playing its exit before the store drops it. */
  exiting: boolean;
  onDismiss: () => void;
}) {
  const f = useFormat();
  const t = useT();
  const Icon = SEVERITY_ICON[reminder.severity];
  const action = withAction ? reminderAction(t)[reminder.kind] : undefined;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 ${SEVERITY_PAINT[reminder.severity]} ${
        exiting
          ? 'animate-out duration-200 fill-mode-forwards fade-out slide-out-to-top-1'
          : `animate-in duration-300 fade-in slide-in-from-top-1 ${STAGGER[index % STAGGER.length]}`
      }`}
    >
      <Icon size={16} strokeWidth={2.25} className="mt-[2px] flex-none" />
      <div className="min-w-0 flex-1 text-[13px] leading-[1.5]">
        {reminderText(reminder, assetName, f, t)}{' '}
        {action !== undefined && (
          // The drawing's `nowrap` holds from `sm` up only: at 360 the content
          // column is too narrow for it, and an unwrappable link there pushes
          // the page into horizontal scroll.
          <Link
            to="/"
            // NO tap-target class, deliberately. This link is inline inside a
            // sentence, and an absolutely positioned pseudo-element resolves
            // against an inline element's FIRST line box — so on a wrapped link
            // the overlay lands somewhere nobody chose, and it reaches into the
            // body copy above. WCAG 2.5.8 exempts a target inline in a sentence
            // for that reason: the line height belongs to the prose.
            className="font-bold underline decoration-transparent transition hover:decoration-current active:scale-[.97] sm:whitespace-nowrap"
          >
            {action}
          </Link>
        )}
      </div>
      <button
        type="button"
        aria-label={t.reminders.dismiss}
        onClick={onDismiss}
        // A real box and not the overlay, which reached into the text column
        // beside it and put a dismiss under a tap on plain prose. Nothing is
        // redrawn: the control has no fill and no border.
        className={`${TAP_44_BOX} flex-none cursor-pointer py-[2px] pr-[2px] pl-1.5 opacity-85 transition hover:opacity-100 active:scale-[.97]`}
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// The commit rides a TIMEOUT, never `animationend`: a throttled or occluded tab
// never fires that event, and a dismissal must be recorded whatever the
// compositor is doing (*Interaction rules*).
const DISMISS_EXIT_MS = 220;

export function ReminderStrip({ place }: { place: 'daily-quotes' | 'overview' }) {
  const t = useT();
  const { reminders, names } = useReminders();
  const dismissReminder = useSettings((s) => s.dismissReminder);
  const [expanded, setExpanded] = useState(false);
  const [exiting, setExiting] = useState<string[]>([]);

  function dismiss(id: string) {
    if (exiting.includes(id)) return; // one exit per banner
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dismissReminder(id);
      return;
    }
    setExiting((ids) => [...ids, id]);
    window.setTimeout(() => {
      dismissReminder(id);
      setExiting((ids) => ids.filter((x) => x !== id));
    }, DISMISS_EXIT_MS);
  }

  // quote-missing is SUPPRESSED on `/` — the progress pill already says it.
  // Action links are an `/overview` affair for the same reason.
  const shown =
    place === 'overview' ? reminders : reminders.filter((r) => r.kind !== 'quote-missing');
  // Empty and all-dismissed are one state: nothing renders, zero height, no
  // placeholder — the screen is byte-identical to one that never had a strip.
  if (shown.length === 0) return null;

  const visible = expanded ? shown : shown.slice(0, REMINDER_STRIP_CAP);
  const hidden = shown.length - visible.length;

  return (
    <div className="mb-[22px] flex flex-col gap-2">
      {visible.map((r, i) => (
        <ReminderBanner
          key={r.id}
          reminder={r}
          assetName={r.assetId === undefined ? '' : (names[r.assetId] ?? '')}
          withAction={place === 'overview'}
          index={i}
          exiting={exiting.includes(r.id)}
          onDismiss={() => dismiss(r.id)}
        />
      ))}
      {hidden > 0 && (
        // A control, not a reminder: muted, untinted.
        <button
          type="button"
          onClick={() => setExpanded(true)}
          // Text, not an icon, so it keeps its own width and grows only in
          // height — again a real box, this control drawing no fill.
          className="animate-in cursor-pointer self-start px-1 py-[2px] text-xs text-muted transition fade-in hover:opacity-85 active:scale-[.97] max-md:min-h-11"
        >
          {moreRemindersLabel(hidden, t)}
        </button>
      )}
    </div>
  );
}
