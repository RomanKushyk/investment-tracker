// "The button font is Google Sans Medium" (Google's branding guidelines), for this button alone;
// each subset carries its `unicode-range`, so only the ones the label uses are fetched.
import '@fontsource/google-sans/500.css';

import type { ReactNode } from 'react';

import type { Dict } from '../../i18n/messages';
import googleG from './google-g.svg';

/** «або» and Google's own button (`auth-surface.dc.html` T1), and what is said under it; NOTHING
 *  while Google is off. The G is the bundle's, cropped to its own box. */
export function OrGoogle({
  on,
  busy,
  copy,
  onClick,
  children,
}: {
  on: boolean;
  busy: boolean;
  copy: Dict['auth']['google'];
  onClick: () => void;
  children?: ReactNode;
}) {
  if (!on) return null;
  return (
    <div className="flex animate-in flex-col duration-300 ease-soft fade-in">
      <div className="my-4 flex items-center gap-3 font-body text-[11px] leading-[16.5px] text-muted">
        <span aria-hidden className="h-px flex-1 bg-hairline" />
        {copy.or}
        <span aria-hidden className="h-px flex-1 bg-hairline" />
      </div>
      {/* 40 at radius 10, and below `md` 44 at 11 — the primary's own box (*Shape system*). */}
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className="inline-flex h-10 w-full items-center justify-center gap-[10px] rounded-[10px] border border-google-btn-border bg-google-btn-bg px-3 font-google text-[14px] leading-5 font-medium whitespace-nowrap text-google-btn-text transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-70 max-md:h-11 max-md:rounded-[11px]"
      >
        <img src={googleG} alt="" width={20} height={20} className="size-5 flex-none" />
        {copy.continue}
      </button>
      {children}
    </div>
  );
}
