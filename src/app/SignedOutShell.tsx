import { Fragment, type ReactNode } from 'react';
import { NavLink } from 'react-router';

import { LanguageControl } from '../components/LanguageControl';
import { Card } from '../components/ui/Card';
import { TAP_44 } from '../components/ui/tap-target';
import { useT } from '../i18n/useT';
import { LEGAL_LINKS } from './legal-links';
import { Mark } from './Sidebar';

/** A page with no portfolio behind it (*Two shells, one breakpoint*): the mark and the language
 *  control over one card, top-anchored so a change in its height moves no button, and the privacy
 *  notice's and the terms' links under it (*Legal documents*). `wide` is the documents' own
 *  measure; `notice="tab"` opens the links beside a page that must stay. */
export function SignedOutShell({
  wide = false,
  notice = 'here',
  children,
}: {
  wide?: boolean;
  notice?: 'here' | 'tab';
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="flex h-[57px] items-center justify-between border-b border-hairline bg-page px-9 max-md:px-3">
        <div className="flex items-center gap-2">
          <Mark className="size-[22px] flex-none" />
          <span className="font-body text-[15px] font-semibold tracking-[-0.03em] text-ink">
            quirenote
          </span>
        </div>
        <LanguageControl />
      </header>
      <main className="flex flex-col items-center px-3 pt-16 pb-12 max-md:pt-4 max-md:pb-4">
        <Card
          radius={24}
          className={`flex w-full flex-col p-7 max-md:p-[22px] ${wide ? 'max-w-[680px]' : 'max-w-[440px]'}`}
        >
          {children}
        </Card>
        <div className="mt-4 text-center">
          {LEGAL_LINKS.map(([to, document], i) => (
            <Fragment key={to}>
              {i > 0 && (
                <span aria-hidden className="mx-2 text-[12px] leading-[18px] text-muted">
                  ·
                </span>
              )}
              <NavLink
                to={to}
                {...(notice === 'tab' && { target: '_blank', rel: 'noopener' })}
                className={`text-[12px] leading-[18px] text-muted underline underline-offset-2 transition-colors hover:text-ink ${TAP_44}`}
              >
                {t[document].link}
                {notice === 'tab' && <span className="sr-only"> {t.privacy.newTab}</span>}
              </NavLink>
            </Fragment>
          ))}
        </div>
      </main>
    </div>
  );
}
