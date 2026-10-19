import { useEffect, useEffectEvent, useRef } from 'react';

import { useResolvedTheme } from '../../app/theme';
import { type Turnstile, loadTurnstile } from '../../auth/turnstile';
import { useSettings } from '../../state/settings';

export type BotCheckProps = {
  sitekey: string;
  /** Checked by the route against the pass siteverify returns. */
  action: string;
  /** Raised to reset the widget: every answer spends its token. */
  reset: number;
  onToken: (token: string) => void;
  onExpired: () => void;
  /** Every failure, a retry's included: Turnstile's auto retry calls its error callback "multiple
   *  times for the same underlying issue", and the form says it once. */
  onFailed: () => void;
  /** Managed judged the visit risky and shows its checkbox. */
  onInteractive: () => void;
  /** No widget on this page: the script never ran, or no retry can change the answer. */
  onUnavailable: () => void;
};

/** Cloudflare's client-side codes marked Retry: No — a sitekey, host or browser the widget
 *  refuses. Every other code is the widget's to retry. */
const FINAL = /^(1101|1102|1105|4000)\d\d$|^200100$/;

/** Turnstile, Managed and `flexible`, in a slot reserved at the widget's 65 so the button below it
 *  stands at one place in every state (`bot-check.dc.html` T1, T7). */
export function BotCheck({
  sitekey,
  action,
  reset,
  onToken,
  onExpired,
  onFailed,
  onInteractive,
  onUnavailable,
}: BotCheckProps) {
  const theme = useResolvedTheme();
  const language = useSettings((s) => s.language);
  const slot = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string }>(undefined);

  const token = useEffectEvent((value: string) => onToken(value));
  const expired = useEffectEvent(() => onExpired());
  const failed = useEffectEvent(() => onFailed());
  const interactive = useEffectEvent(() => onInteractive());
  const unavailable = useEffectEvent(() => onUnavailable());

  // THEME AND LANGUAGE ARE RENDER OPTIONS, which Turnstile cannot change in place: a change
  // removes the widget and renders it again.
  useEffect(() => {
    let cancelled = false;
    let held: { api: Turnstile; id: string } | undefined;
    void loadTurnstile().then((api) => {
      const container = slot.current;
      if (cancelled) return;
      if (!api || !container) return unavailable();
      let id: string | undefined;
      try {
        id = api.render(container, {
          sitekey,
          action,
          theme,
          language,
          size: 'flexible',
          'refresh-expired': 'auto',
          callback: (value) => token(value),
          'expired-callback': () => expired(),
          'error-callback': (code) => {
            if (FINAL.test(code)) unavailable();
            else failed();
            return true;
          },
          'timeout-callback': () => failed(),
          'before-interactive-callback': () => interactive(),
          'unsupported-callback': () => unavailable(),
        });
      } catch {
        // An invalid sitekey throws rather than reaching the error callback.
        id = undefined;
      }
      if (id === undefined) return unavailable();
      held = { api, id };
      widget.current = held;
    });
    return () => {
      cancelled = true;
      if (held) held.api.remove(held.id);
      widget.current = undefined;
    };
  }, [sitekey, action, theme, language]);

  useEffect(() => {
    const held = widget.current;
    if (reset === 0 || !held) return;
    held.api.reset(held.id);
  }, [reset]);

  // A BLOCK, at 65: an inline frame would leave the line's gap under it. Below 300, the widget's
  // minimum, the slot reaches past the field by the difference, half on each side.
  return <div ref={slot} className="mx-[min(0px,calc((100%_-_300px)/2))] block h-[65px]" />;
}
