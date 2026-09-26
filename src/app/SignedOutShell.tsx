import type { ReactNode } from 'react';

import { LanguageControl } from '../components/LanguageControl';
import { Card } from '../components/ui/Card';
import { Mark } from './Sidebar';

/** A page with no portfolio behind it (*Two shells, one breakpoint*): the mark and the language
 *  control over one card, top-anchored so a change in its height moves no button. */
export function SignedOutShell({ children }: { children: ReactNode }) {
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
      <main className="flex justify-center px-3 pt-16 pb-12 max-md:pt-4 max-md:pb-4">
        <Card radius={24} className="flex w-full max-w-[440px] flex-col p-7 max-md:p-[22px]">
          {children}
        </Card>
      </main>
    </div>
  );
}
