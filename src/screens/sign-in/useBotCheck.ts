import { useRef, useState } from 'react';

import { botCheckSitekey } from '../../auth/app';
import type { BotCheckProps } from './BotCheck';

/** The widget's own two sentences: its failure, which its next pass clears, and no widget at all. */
export type BotCheckSentence = 'botCheckFailed' | 'botCheckUnavailable';

/** What a press came to. `sent` handed over a token; `waiting` holds the press for one; `pending`
 *  refused it before one came; `interactive` leaves it to the checkbox; `unavailable`, no widget. */
export type Pressed = 'sent' | 'waiting' | 'pending' | 'interactive' | 'unavailable';

/** `wait` holds a press until the token comes; `refuse` turns it away, for a start that must be the
 *  press's first wait, as a passkey start is in Safari before 17.4 (`bot-check.dc.html` T4). */
export type Policy = 'wait' | 'refuse';

/** A step's sentence once its widget passes: the widget's own two no longer hold, a route's refusal
 *  still does. */
export const afterPass = <S extends { reason: string }>(said: S | undefined) =>
  said?.reason === 'botCheckFailed' || said?.reason === 'pending' ? undefined : said;

/** One Turnstile widget's token and the states around it, for the step that renders it. Every
 *  token is single use: a press takes it, and `spent` resets the widget once the answer is in. */
export function useBotCheck(on: {
  /** The step's sentence now, so a failure the widget retries is said once. */
  saying: string | undefined;
  say: (reason: BotCheckSentence) => void;
  /** The widget passed; `afterPass` says which sentences go with it. */
  passed: () => void;
  /** A held press ended without a token, so the step is live again. */
  released: () => void;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [reset, setReset] = useState(0);
  const token = useRef<string>(undefined);
  /** A press that came before the token, sent when the token comes. */
  const waiting = useRef<(token: string) => void>(undefined);
  /** Managed shows its checkbox: the press asked for is the checkbox's. */
  const interactive = useRef(false);
  /** The widget's last word was a failure, after which it may never call again. An expiry renews
   *  itself (`refresh-expired: auto`). */
  const resting = useRef(false);

  const take = () => {
    const taken = token.current ?? '';
    token.current = undefined;
    interactive.current = false;
    resting.current = false;
    return taken;
  };

  /** Ends a press still waiting for a token the widget will not give. */
  const giveUp = () => {
    if (!waiting.current) return false;
    waiting.current = undefined;
    on.released();
    return true;
  };

  const press = (policy: Policy, send: (token: string) => void): Pressed => {
    if (botCheckSitekey === undefined) {
      send('');
      return 'sent';
    }
    if (unavailable) return 'unavailable';
    if (token.current !== undefined) {
      send(take());
      return 'sent';
    }
    if (interactive.current) return 'interactive';
    // A RESTING WIDGET IS ASKED AGAIN, so a token is always coming.
    if (resting.current) {
      resting.current = false;
      setReset((n) => n + 1);
    }
    if (policy === 'refuse') return 'pending';
    waiting.current = send;
    return 'waiting';
  };

  const props: Omit<BotCheckProps, 'action'> | undefined =
    botCheckSitekey === undefined
      ? undefined
      : {
          sitekey: botCheckSitekey,
          reset,
          onToken: (value) => {
            token.current = value;
            interactive.current = false;
            resting.current = false;
            on.passed();
            const held = waiting.current;
            if (held) {
              waiting.current = undefined;
              held(take());
            }
          },
          onExpired: () => {
            token.current = undefined;
            interactive.current = false;
          },
          onFailed: () => {
            token.current = undefined;
            interactive.current = false;
            resting.current = true;
            // EVERY FAILURE ENDS A WAIT; the sentence is said once across the widget's retries.
            const waited = giveUp();
            if (waited || on.saying !== 'botCheckFailed') on.say('botCheckFailed');
          },
          onInteractive: () => {
            token.current = undefined;
            interactive.current = true;
            resting.current = false;
            giveUp();
          },
          onUnavailable: () => {
            token.current = undefined;
            setUnavailable(true);
            if (giveUp()) on.say('botCheckUnavailable');
          },
        };

  return {
    props,
    press,
    /** EVERY ANSWER SPENDS THE TOKEN, a refusal's as much as a pass's. */
    spent: () => setReset((n) => n + 1),
    /** The step left: whatever the widget held belongs to a widget no longer there. */
    forget: () => {
      token.current = undefined;
      waiting.current = undefined;
      interactive.current = false;
      resting.current = false;
    },
  };
}

/** What a step holds of its widget. */
export type BotCheckOf = ReturnType<typeof useBotCheck>;
