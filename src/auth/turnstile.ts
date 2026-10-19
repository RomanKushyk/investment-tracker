/** What a form asks of Cloudflare Turnstile. Explicit rendering, as Cloudflare advises for an SPA;
 *  the widget's own API, never a package's: none of them notices a script that never arrives. */
export type TurnstileOptions = {
  sitekey: string;
  action: string;
  theme: 'light' | 'dark';
  language: string;
  size: 'flexible';
  'refresh-expired': 'auto';
  callback: (token: string) => void;
  'expired-callback': () => void;
  /** Returning true tells Turnstile the error is handled, so it neither warns nor throws. */
  'error-callback': (code: string) => boolean;
  'timeout-callback': () => void;
  'before-interactive-callback': () => void;
  'unsupported-callback': () => void;
};

export type Turnstile = {
  render: (container: HTMLElement, options: TurnstileOptions) => string | undefined;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};

/** "Must be fetched from the exact URL shown above": no proxy, no copy. */
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const ONLOAD = 'quirenoteTurnstileLoaded';
/** A script that neither loads nor fails sends no event to wait for; this ends the wait. */
export const LOAD_MS = 15_000;

let loading: Promise<Turnstile | undefined> | undefined;

/** The widget's API once its script has run, or nothing. SETTLED BY THE `onload` CALLBACK, not the
 *  element's `load`, which a redirecting extension also fires; `ready()` throws for an async script. */
export function loadTurnstile(): Promise<Turnstile | undefined> {
  loading ??= new Promise((settle) => {
    const global = window as unknown as Record<string, unknown>;
    const done = (api: Turnstile | undefined) => {
      clearTimeout(timer);
      delete global[ONLOAD];
      settle(api);
    };
    const timer = setTimeout(() => done(undefined), LOAD_MS);
    global[ONLOAD] = () => done(global.turnstile as Turnstile | undefined);

    const script = document.createElement('script');
    script.src = `${SCRIPT}?onload=${ONLOAD}&render=explicit`;
    // A blocked request, by an ad blocker or the policy, fires `error` (Fetch, "should request be
    // blocked by Content Security Policy … network error").
    script.addEventListener('error', () => done(undefined));
    document.head.append(script);
  });
  return loading;
}
