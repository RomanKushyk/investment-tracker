import { CircleAlert, Clock, Info, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import type { Reminder, ReminderSeverity } from '../../core/reminders';
import { useFormat } from '../../hooks/useFormat';
import { useReminders } from '../../hooks/useReminders';
import { useSettings } from '../../state/settings';
import {
  DISMISS_REMINDER_LABEL,
  moreRemindersLabel,
  REMINDER_ACTION,
  REMINDER_STRIP_CAP,
  reminderText,
} from './reminder-labels';

// S6 (design/extensions/reminders.dc.html) — the banner strip above the screen
// content on `/` and `/overview`. Severity IS the container: a tint background
// with its -tint-text carrying icon, text and ✕; no border, no shadow.
// `neg-tint` is minted for the overdue severity and used nowhere else.
const SEVERITY_PAINT: Record<ReminderSeverity, string> = {
  info: 'bg-pos-tint text-pos-tint-text',
  warn: 'bg-warn-tint text-warn-tint-text',
  overdue: 'bg-neg-tint text-neg-tint-text',
};

const SEVERITY_ICON: Record<ReminderSeverity, typeof Info> = {
  info: Info,
  warn: CircleAlert,
  overdue: Clock,
};

// Banner mount: fade + slide-from-top-1, staggered down the stack — the
// reference's ~60ms cadence expressed in the app's existing Tailwind delay
// ladder (same one Overview's asset rows use).
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
  const Icon = SEVERITY_ICON[reminder.severity];
  const action = withAction ? REMINDER_ACTION[reminder.kind] : undefined;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 ${SEVERITY_PAINT[reminder.severity]} ${
        exiting
          ? 'animate-out fade-out slide-out-to-top-1 fill-mode-forwards duration-200'
          : `animate-in fade-in slide-in-from-top-1 duration-300 ${STAGGER[index % STAGGER.length]}`
      }`}
    >
      <Icon size={16} strokeWidth={2.25} className="mt-[2px] flex-none" />
      <div className="min-w-0 flex-1 text-[13px] leading-[1.5]">
        {reminderText(reminder, assetName, f)}{' '}
        {action !== undefined && (
          // Both actions lead to the daily ritual (the quotes screen). The
          // design's `white-space:nowrap` holds from `sm` up; at the 360px rail
          // layout the content column is ~200px, so the link must be allowed to
          // wrap or the row would push the page into horizontal scroll.
          <Link
            to="/"
            className="font-bold underline decoration-transparent transition hover:decoration-current active:scale-[.97] sm:whitespace-nowrap"
          >
            {action}
          </Link>
        )}
      </div>
      <button
        type="button"
        aria-label={DISMISS_REMINDER_LABEL}
        onClick={onDismiss}
        className="flex-none cursor-pointer py-[2px] pr-[2px] pl-1.5 opacity-85 transition hover:opacity-100 active:scale-[.97]"
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// Dismiss exit: the banner fades/slides out first and the store records the id
// when the motion is over. The commit rides a TIMEOUT, never `animationend` — a
// throttled or occluded tab never fires that event, and a dismissal must be
// recorded whatever the compositor is doing. Reduced motion skips straight to
// the write.
const DISMISS_EXIT_MS = 220;

export function ReminderStrip({ place }: { place: 'daily-quotes' | 'overview' }) {
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
  // Empty and all-dismissed are the same state: nothing renders, zero height,
  // no placeholder — the screen is byte-identical to its pre-P3 self.
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
          className="text-muted animate-in fade-in cursor-pointer self-start px-1 py-[2px] text-xs transition hover:opacity-85 active:scale-[.97]"
        >
          {moreRemindersLabel(hidden)}
        </button>
      )}
    </div>
  );
}
