import { ChevronLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router';

import { SignedOutShell } from '../../app/SignedOutShell';
import { session, useSessionStatus } from '../../auth/app';
import { TAP_44 } from '../../components/ui/tap-target';
import { useSettingsCopy } from '../../hooks/queries';
import { useFormat } from '../../hooks/useFormat';
import type { Block } from '../../i18n/messages';
import { rich } from '../../i18n/rich';
import { useT } from '../../i18n/useT';
import { Title } from '../sign-in/parts';

const LINK = 'text-accent underline underline-offset-2';

/** A sentence of a document, its links in place; one into the app stays in it. */
function Sentence({ text }: { text: string }) {
  return rich(text, (label, href, key) =>
    href.startsWith('/') ? (
      <Link key={key} to={href} className={LINK}>
        {label}
      </Link>
    ) : (
      <a key={key} href={href} className={LINK}>
        {label}
      </a>
    ),
  );
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

/** `/privacy`'s and `/terms`'s one frame (*Legal documents*): a page with no portfolio behind it, so
 *  the signed-out shell for every reader, and nothing waits on the session or reads data. Signed
 *  in, a language chosen here is the account's, as in the portfolio shell. `after` adds what one
 *  section carries below its text. */
export function LegalDocument({
  title,
  updated,
  dated,
  intro,
  sections,
  after,
}: {
  title: string;
  /** The day the text last changed, `YYYY-MM-DD`. */
  updated: string;
  /** The line that prints it. */
  dated: (date: string) => string;
  intro: string[];
  sections: Record<string, { title: string; body: Block[] }>;
  after?: (id: string) => ReactNode;
}) {
  const t = useT();
  const f = useFormat();
  const entries = Object.entries(sections);
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
      <div data-document className="flex flex-col">
        <div className="mb-3">
          <Link
            to="/"
            className={`inline-flex items-center gap-1 text-[12px] leading-[18px] text-muted transition-colors hover:text-ink ${TAP_44}`}
          >
            <ChevronLeft aria-hidden className="size-3.5 flex-none" strokeWidth={2} />
            {t.privacy.back}
          </Link>
        </div>
        <Title>{title}</Title>
        <p className="text-[12px] leading-[18px] text-muted">{dated(f.date(updated))}</p>
        {intro.map((paragraph, i) => (
          <p key={i} className={i === 0 ? 'mt-3' : 'mt-2'}>
            {paragraph}
          </p>
        ))}

        <nav aria-label={t.privacy.contents} className="mt-5">
          <div aria-hidden className="mb-2 text-[10px] tracking-[.12em] text-muted uppercase">
            {t.privacy.contents}
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-5 leading-[21px] text-muted">
            {entries.map(([id, section]) => (
              <li key={id}>
                <a href={`#${id}`} className={LINK}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {entries.map(([id, section], i) => (
          <section key={id} id={id} aria-labelledby={`${id}-title`} className="mt-7 scroll-mt-4">
            <h3
              id={`${id}-title`}
              className="font-display text-[15px] leading-[22.5px] font-semibold text-ink"
            >
              {i + 1}. {section.title}
            </h3>
            <Body blocks={section.body} />
            {after?.(id)}
          </section>
        ))}
      </div>
    </SignedOutShell>
  );
}
