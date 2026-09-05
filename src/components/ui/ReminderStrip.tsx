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

// S6 (design/extensions/reminders.dc.html) — the banner strip above the screen
// content on `/` and `/overview`. Severity IS the container: a tint background
// with its -tint-text carrying icon, text and ✕; no border, no shadow.
// `neg-tint` is minted for the overdue severity and used nowhere else.
// `info` reads the INFO family, not the gain one (#91): gain and loss belong to
// deltas, and a reminder is not a delta. It borrowed `pos-tint` only because the
// palette had no informational rank until the parchment session minted one.
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
          // Both actions lead to the daily ritual (the quotes screen). The
          // design's `white-space:nowrap` holds from `sm` up; at the 360px rail
          // layout the content column is ~200px, so the link must be allowed to
          // wrap or the row would push the page into horizontal scroll.
          <Link
            to="/"
            // NO tap-target class, and that is deliberate. This link is inline
            // inside a sentence: an absolutely positioned pseudo-element
            // resolves against an inline element's FIRST line box, so on a
            // wrapped link the overlay lands somewhere nobody chose — and WCAG
            // 2.5.8 exempts a target "inline in a sentence" for exactly that
            // reason, because the line height belongs to the prose, not to the
            // control. Measured here it added 3px and reached toward the body
            // copy above; both are the wrong outcome.
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
        // A real box (no fill, no border, so nothing is redrawn): the overlay
        // version reached 9px into the text column beside it, which put a
        // dismiss under a tap on plain prose.
        className={`${TAP_44_BOX} flex-none cursor-pointer py-[2px] pr-[2px] pl-1.5 opacity-85 transition hover:opacity-100 active:scale-[.97]`}
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
          // Text, not an icon, so it keeps its own width and only grows to 44
          // in height — again a real box, because this control draws no fill.
          className="animate-in cursor-pointer self-start px-1 py-[2px] text-xs text-muted transition fade-in hover:opacity-85 active:scale-[.97] max-md:min-h-11"
        >
          {moreRemindersLabel(hidden, t)}
        </button>
      )}
    </div>
  );
}
