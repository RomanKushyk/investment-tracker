import { ChevronLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { session, useSessionStatus } from '../../auth/app';
import { REAUTHENTICATING } from '../../auth/google';
import { RETURNING } from '../../auth/signed-out';
import { TAP_44 } from '../../components/ui/tap-target';
import { useSettingsCopy } from '../../hooks/queries';
import { useFormat } from '../../hooks/useFormat';
import { INZHUR_LAST_FETCH_KEY, INZHUR_LAST_PARSE_KEY } from '../../hooks/useInzhurAssets';
import type { Block, Dict } from '../../i18n/messages';
import { rich } from '../../i18n/rich';
import { useT } from '../../i18n/useT';
import { DRAFT_KEY, SETTINGS_KEY } from '../../lib/storage-keys';
import { Title } from '../sign-in/parts';

/** The day the notice's text last changed; it reads at the top (*Legal documents*). */
const UPDATED = '2026-10-29';

type Rows = Dict['privacy']['sections']['cookies']['rows'];

/** Each entry by its name, which is the code's and not translated; the copy says what it is for.
 *  The relay's cookies are named in `infra/src/auth-relay.ts`, the hand-offs in `src/auth/`. */
const ENTRIES: [name: string | undefined, row: keyof Rows][] = [
  ['__Host-Http-refresh', 'refresh'],
  ['__Host-Http-origin', 'origin'],
  ['__Host-Http-access', 'access'],
  ['__Host-Http-google', 'google'],
  // Named in the copy: it is Cognito's, on another host.
  [undefined, 'cognito'],
  [SETTINGS_KEY, 'settings'],
  [DRAFT_KEY, 'draft'],
  [`${INZHUR_LAST_FETCH_KEY}, ${INZHUR_LAST_PARSE_KEY}`, 'inzhur'],
  [`${RETURNING}, ${REAUTHENTICATING}`, 'handoff'],
];

const LINK = 'text-accent underline underline-offset-2';

/** A sentence of the notice, its links in place. */
function Sentence({ text }: { text: string }) {
  return rich(text, (label, href, key) => (
    <a key={key} href={href} className={LINK}>
      {label}
    </a>
  ));
}

function Body({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, i) =>
    typeof block === 'string' ? (
      <p key={i} className="mt-2">
        <Sentence text={block} />
      </p>
    ) : (
      <ul key={i} className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
        {block.map((item, j) => (
          <li key={j}>
            <Sentence text={item} />
          </li>
        ))}
      </ul>
    ),
  );
}

/** The privacy notice, whole (WP260 ¶17). A page with no portfolio behind it, so the signed-out
 *  shell for every reader: nothing waits on the session, and it reads no data. Signed in, a
 *  language chosen here is the account's, as in the portfolio shell. */
export function Privacy() {
  const t = useT();
  const f = useFormat();
  const p = t.privacy;
  const sections = Object.entries(p.sections);
  // Loaded first, the page asks the relay who is signed in, as `/sign-in` does.
  useEffect(() => void session.restore(), []);
  useSettingsCopy(useSessionStatus() === 'signedIn');

  // A route change keeps the window's scroll, and a load scrolls to its `#id` before the sections
  // exist: arriving, the page goes to the section its address names, Back and Forward included;
  // with none, to its top, unless Back or Forward restores the place.
  const { hash } = useLocation();
  const [arrival] = useState({ hash, by: useNavigationType() });
  useLayoutEffect(() => {
    const section = arrival.hash && document.getElementById(arrival.hash.slice(1));
    if (section) section.scrollIntoView({ behavior: 'instant' });
    else if (arrival.by !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [arrival]);

  return (
    <SignedOutShell wide>
      {/* `index.css` scrolls the root smoothly while this is mounted, instantly under reduced
          motion. */}
      <div data-privacy className="flex flex-col">
        <div className="mb-3">
          <Link
            to="/"
            className={`inline-flex items-center gap-1 text-[12px] leading-[18px] text-muted transition-colors hover:text-ink ${TAP_44}`}
          >
            <ChevronLeft aria-hidden className="size-3.5 flex-none" strokeWidth={2} />
            {p.back}
          </Link>
        </div>
        <Title>{p.title}</Title>
        <p className="text-[12px] leading-[18px] text-muted">{p.updated(f.date(UPDATED))}</p>
        {p.intro.map((paragraph, i) => (
          <p key={i} className={i === 0 ? 'mt-3' : 'mt-2'}>
            {paragraph}
          </p>
        ))}

        <nav aria-label={p.contents} className="mt-5">
          <div aria-hidden className="mb-2 text-[10px] tracking-[.12em] text-muted uppercase">
            {p.contents}
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-5 leading-[21px] text-muted">
            {sections.map(([id, { title }]) => (
              <li key={id}>
                <a href={`#${id}`} className={LINK}>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map(([id, { title, body }], i) => (
          <section key={id} id={id} aria-labelledby={`${id}-title`} className="mt-7 scroll-mt-4">
            <h3
              id={`${id}-title`}
              className="font-display text-[15px] leading-[22.5px] font-semibold text-ink"
            >
              {i + 1}. {title}
            </h3>
            <Body blocks={body} />
            {id === 'cookies' && (
              <div className="mt-3 rounded-[16px] bg-panel px-4 py-1">
                {ENTRIES.map(([name, row], j) => (
                  <div key={row} className={`py-2.5 ${j > 0 ? 'border-t border-hairline' : ''}`}>
                    <div className="text-[12px] leading-[18px] font-semibold">
                      {name ?? p.sections.cookies.cognitoName}
                    </div>
                    <div className="text-[12px] leading-[18px] text-muted">
                      {p.sections.cookies.rows[row]}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </SignedOutShell>
  );
}
