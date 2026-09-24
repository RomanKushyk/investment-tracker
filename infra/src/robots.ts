// Every external source the capture reads comes through here, each hop checked against its host's
// robots.txt before it is sent, the first included (docs/DECISIONS.md, *External sources*).
import robotsParser from 'robots-parser';

/** The name a site's robots.txt addresses this crawler by (RFC 9309 §2.2.1). */
const PRODUCT_TOKEN = 'quirenote-price-capture';

/** On every request, the robots.txt read included: it is what a site's rules name this crawler
 *  by, and Inzhur's CloudFront answers 403 to a request with no User-Agent at all. */
const USER_AGENT = `${PRODUCT_TOKEN}/1.0 (+https://quirenote.com)`;

/** The Fetch standard's limit, the one `redirect: 'follow'` enforces. */
const MAX_REDIRECTS = 20;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** How every refusal's message starts: the capture's journal settles a day on it. */
export const REFUSED = 'robots.txt disallows';

/** Never retried, because a retry cannot change the rule. `httpStatus` is the redirect that
 *  pointed at the refused URL, absent when the first request was the one refused. */
export class RobotsRefusal extends Error {
  readonly httpStatus: number | undefined;

  constructor(url: string, httpStatus: number | undefined) {
    super(`${REFUSED} ${url}`);
    this.name = 'RobotsRefusal';
    this.httpStatus = httpStatus;
  }
}

type Rules = ReturnType<typeof robotsParser>;

/** Per origin, and only a definitive answer: an unreachable file is read again by the next
 *  attempt rather than refusing every one after it. */
const rulesByOrigin = new Map<string, Rules>();

/** Called as each invocation starts: a warm container keeps this module, and with it the files
 *  an earlier run read. */
export function forgetRobots(): void {
  rulesByOrigin.clear();
}

async function rulesFor(origin: string, signal: AbortSignal): Promise<Rules> {
  const cached = rulesByOrigin.get(origin);
  if (cached) return cached;

  const url = `${origin}/robots.txt`;
  let status: number;
  let body: string;
  try {
    // Redirects left to the platform: §2.3.1.2 recommends following them, across hosts too,
    // and what is found still rules the origin asked about.
    const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
    status = response.status;
    body = await response.text();
  } catch (err) {
    throw new Error(
      `robots.txt for ${origin} unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // §2.3.1.3: a 4xx is "unavailable", and the crawler MAY access any resource. Not a 429, which
  // Google reads as a server error: a rate limit is no licence to crawl more.
  const rules =
    status >= 200 && status < 300
      ? robotsParser(url, body)
      : status >= 400 && status < 500 && status !== 429
        ? robotsParser(url, '')
        : undefined;
  // §2.3.1.4: anything else is "unreachable", a complete disallow. Thrown as a failed attempt,
  // since the next one may read the file.
  if (!rules) throw new Error(`robots.txt for ${origin} unreachable: HTTP ${status}`);
  rulesByOrigin.set(origin, rules);
  return rules;
}

/** `fetch` with the hops followed by hand, so each is checked before it is requested. */
export async function robotsFetch(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  let redirectedBy: number | undefined;
  for (let redirects = 0; ; redirects += 1) {
    const rules = await rulesFor(new URL(current).origin, signal);
    // `!== true`, failing closed: the parser answers `undefined` for a URL outside its origin.
    if (rules.isAllowed(current, USER_AGENT) !== true) {
      throw new RobotsRefusal(current, redirectedBy);
    }

    // `manual` hands back the 3xx itself, where the platform's default requests the target first.
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
    });
    const location = response.headers.get('location');
    if (!REDIRECT.has(response.status) || location === null) return response;

    await response.body?.cancel();
    if (redirects === MAX_REDIRECTS) {
      throw new Error(`more than ${MAX_REDIRECTS} redirects from ${url}`);
    }
    redirectedBy = response.status;
    current = new URL(location, current).href;
  }
}
