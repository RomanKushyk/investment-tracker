import { RouteOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '../components/ui/Button';
import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { useDocumentLang } from '../i18n/useDocumentLang';
import { useT } from '../i18n/useT';
import { FocusedTitle, Title } from '../screens/sign-in/parts';
import { SignedOutShell } from './SignedOutShell';
import { useTheme } from './theme';

// The app's own not-found and failure states (`boundaries.dc.html`). None shows the error: the
// router and React already log what a boundary catches, and a reader can do nothing with it.

/** An answer's block: a muted glyph, never `neg`, since nothing here is the reader's mistake. */
function Body({
  glyph: Glyph,
  title,
  lead,
  children,
}: {
  glyph: LucideIcon;
  title: ReactNode;
  lead: string;
  children: ReactNode;
}) {
  return (
    <>
      <Glyph aria-hidden className="mb-4 size-6 flex-none text-muted" strokeWidth={2} />
      {title}
      <p className="mb-[22px] text-[13px] leading-[19.5px] text-muted">{lead}</p>
      {children}
    </>
  );
}

/** Where the signed-out card sits: centred across, and at `md` `main`'s top padding once more, to
 *  land level with `SignedOutShell`'s. */
function InShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center md:pt-8">
      <Card
        radius={24}
        className="flex w-full max-w-[440px] animate-in flex-col p-[22px] duration-300 fade-in"
      >
        {children}
      </Card>
    </div>
  );
}

/** Both failures' words, the same for every unexpected problem. No router hook: the boot renders
 *  it outside the router. */
function Failed() {
  const t = useT();
  return (
    <Body
      glyph={TriangleAlert}
      title={<FocusedTitle>{t.boundary.failed.title}</FocusedTitle>}
      lead={t.boundary.failed.lead}
    >
      <Button className="w-full" onClick={() => window.location.reload()}>
        {t.boundary.failed.reload}
      </Button>
    </Body>
  );
}

/** The `*` route: moves no focus, as no route change does. */
export function NotFound() {
  const t = useT();
  return (
    <InShell>
      <Body
        glyph={RouteOff}
        title={<Title>{t.boundary.notFound.title}</Title>}
        lead={t.boundary.notFound.lead}
      >
        <Link to="/" className={buttonVariants({ className: 'w-full' })}>
          {t.boundary.notFound.home}
        </Link>
      </Body>
    </InShell>
  );
}

/** A screen that threw, with the shell kept; reaching another route clears it. */
export function ScreenFailure() {
  return (
    <InShell>
      <Failed />
    </InShell>
  );
}

/** A throw in `Root` or `Layout`, or a database that cannot open at boot: no shell to keep. It
 *  stands where `Root` would, so it owns the two root attributes `Root` would have. */
export function AppFailure() {
  useTheme();
  useDocumentLang();
  return (
    <SignedOutShell>
      <div className="flex animate-in flex-col duration-300 ease-soft fade-in slide-in-from-top-1">
        <Failed />
      </div>
    </SignedOutShell>
  );
}
