import { Check, ChevronRight, CircleAlert, Copy, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { tabStorage, useGoogle, useSessionStatus } from '../auth/app';
import { arrivedReauthentication, forgetReauthentication } from '../auth/google';
import type { PasskeyList } from '../auth/passkey';
import { Block, Dash, PlaceholderScreen } from '../components/loading/Placeholder';
import { Button } from '../components/ui/Button';
import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useHold } from '../hooks/loading';
import { useFormat } from '../hooks/useFormat';
import { useMe } from '../hooks/queries';
import { usePasskeys } from '../hooks/usePasskeys';
import { useT } from '../i18n/useT';
import type { MeData } from '../lib/repository';
import { usedUp } from '../auth/signed-out';
import { SignOutEverywhere, type Ways } from './profile/SignOutEverywhere';
import { Divider, SectionLabel, SettingRow } from './Settings';

// THE OWN ACCOUNT (`design/extensions/own-account.dc.html`, T1–T4 and T6), read on demand from
// `GET /me`; the passkeys are the relay's list. Signed out, or before the session is known, the
// shell stands alone and nothing is asked, as a screen behind the view.
type Arrived = ReturnType<typeof arrivedReauthentication>;

export function Profile() {
  const signedIn = useSessionStatus() === 'signedIn';
  const location = useLocation();
  const navigate = useNavigate();
  // BACK FROM GOOGLE, read at mount and the entry used up at once, so a reload opens nothing (T10).
  const [arrived, setArrived] = useState(() => arrivedReauthentication(location.state));
  useEffect(() => {
    if (arrivedReauthentication(location.state)) void navigate(...usedUp(location));
  }, [location, navigate]);
  // A page that loads here is no trip to Google: one the tab still marks was abandoned, so a later
  // callback in it is a sign-in's (T10). The callback forgets its own before landing.
  useEffect(() => forgetReauthentication(tabStorage()), []);
  // Held here, outside the account: signing out everywhere empties the page before it leaves, and
  // the dialog stays busy meanwhile. A fresh key per open resets it while a closed one exits.
  const [everywhere, setEverywhere] = useState<{
    n: number;
    open: boolean;
    email: string;
    ways: Ways;
    arrived?: Arrived;
  }>({ n: 0, open: false, email: '', ways: { password: true, google: false, passkey: false } });
  return (
    <>
      {signedIn && (
        <Account
          arrived={arrived}
          onSignOutEverywhere={(email, ways, from) => {
            setArrived(undefined);
            setEverywhere(({ n }) => ({ n: n + 1, open: true, email, ways, arrived: from }));
          }}
        />
      )}
      {everywhere.n > 0 && (
        <SignOutEverywhere
          key={everywhere.n}
          open={everywhere.open}
          email={everywhere.email}
          ways={everywhere.ways}
          arrived={everywhere.arrived}
          onClose={closeEverywhere}
        />
      )}
    </>
  );

  function closeEverywhere() {
    setEverywhere((was) => (was.open ? { ...was, open: false } : was));
  }
}

const CARD = 'animate-in p-[22px] duration-300 fade-in slide-in-from-bottom-1';

function Account({
  arrived,
  onSignOutEverywhere,
}: {
  arrived: Arrived;
  onSignOutEverywhere: (email: string, ways: Ways, arrived?: Arrived) => void;
}) {
  const t = useT();
  const answered = useMe();
  const passkeys = usePasskeys();
  const google = useGoogle();
  // A list Google's session cannot read counts as no passkey: Google is a proof the account holds.
  const ways = (me: MeData): Ways => ({
    password: me.passwordSet,
    google: google === true && me.googleLinked,
    passkey: passkeys?.kind === 'passkeys' && passkeys.passkeys.length > 0,
  });
  // The dialog reopens once the account and its list have landed, which its first state reads.
  useEffect(() => {
    if (arrived && answered !== undefined && passkeys !== undefined) {
      onSignOutEverywhere(answered.email, ways(answered), arrived);
    }
  });
  // Nothing new for 300 ms, then every box held, and held for a while once shown: a page that
  // flashes reads slower than it is.
  const held = useHold(answered === undefined);
  if (answered === undefined && !held) return null;
  const me = held ? undefined : answered;

  const page = (
    <div>
      <ScreenHeader title={t.profile.title} subtitle={t.profile.subtitle} />
      <div className="flex flex-col gap-3.5">
        <Card radius={24} className={`${CARD} delay-75`}>
          <AccountCard me={me} />
        </Card>
        <Card radius={24} className={`${CARD} delay-150`}>
          <DataCard me={me} />
        </Card>
        <Card radius={24} className={`${CARD} delay-200`}>
          <SectionLabel>{t.profile.sections.sessions}</SectionLabel>
          <SettingRow
            title={t.profile.signOutEverywhere.title}
            helper={t.profile.signOutEverywhere.helper}
          >
            {me ? (
              <Button variant="outline" onClick={() => onSignOutEverywhere(me.email, ways(me))}>
                {t.profile.signOutEverywhere.open}
              </Button>
            ) : (
              <Block
                kind="link"
                className="h-10 w-[128px] rounded-[10px] max-md:h-11 max-md:rounded-[11px]"
              />
            )}
          </SettingRow>
        </Card>
        {/* Last, since its list is a read of its own: a list that lands moves nothing below it. */}
        <Card radius={24} className={`${CARD} delay-300`}>
          <SectionLabel>{t.profile.sections.signIn}</SectionLabel>
          {google === true && (
            <>
              <Facts>
                <Fact name="google" label={t.profile.google}>
                  {me && (me.googleLinked ? t.profile.linked : t.profile.notLinked)}
                </Fact>
              </Facts>
              <Divider />
            </>
          )}
          {/* Held until the account lands, whatever the list has answered. */}
          <Passkeys list={me === undefined ? undefined : passkeys} held={me === undefined} />
        </Card>
      </div>
    </div>
  );
  return me === undefined ? <PlaceholderScreen>{page}</PlaceholderScreen> : page;
}

function AccountCard({ me }: { me: MeData | undefined }) {
  const t = useT();
  const f = useFormat();
  return (
    <>
      <SectionLabel>{t.profile.sections.account}</SectionLabel>
      <Facts>
        <Fact name="email" label={t.profile.email}>
          {me?.email}
        </Fact>
        {/* A role is shown where it names a privilege: the super-admin's alone (the owner's ruling). */}
        {me?.role === 'super_admin' && (
          <Fact name="role" label={t.profile.role}>
            {t.profile.superAdmin}
          </Fact>
        )}
        <Fact name="since" label={t.profile.since}>
          {me && f.date(me.memberSince)}
        </Fact>
      </Facts>
      <Divider />
      <Facts>
        <Fact name="id" label={t.profile.id}>
          {me ? (
            <AccountId id={me.userId} />
          ) : (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Dash className="min-w-[36ch] font-mono text-xs" />
              <Block kind="copy" className="h-[30px] w-[114px] rounded-[8px]" />
            </span>
          )}
        </Fact>
      </Facts>
    </>
  );
}

function DataCard({ me }: { me: MeData | undefined }) {
  const t = useT();
  const f = useFormat();
  return (
    <>
      <SectionLabel>{t.profile.sections.data}</SectionLabel>
      <Facts>
        <Fact name="assets" label={t.profile.assets}>
          {me && String(me.assets)}
        </Fact>
        <Fact name="transactions" label={t.profile.transactions}>
          {me && String(me.transactions)}
        </Fact>
        {/* None yet reads «—» in the value's own ink: an answer, not a box held. */}
        <Fact name="firstActivity" label={t.profile.firstActivity}>
          {me && (me.firstTransaction === undefined ? '—' : f.date(me.firstTransaction))}
        </Fact>
      </Facts>
      <Divider />
      <SettingRow title={t.profile.copyData.title} helper={t.profile.copyData.helper}>
        {me ? (
          <Link to="/settings" className={buttonVariants({ variant: 'outline' })}>
            {t.profile.copyData.open}
            <ChevronRight size={16} aria-hidden />
          </Link>
        ) : (
          <Block
            kind="link"
            className="h-10 w-[175px] rounded-[10px] max-md:h-11 max-md:rounded-[11px]"
          />
        )}
      </SettingRow>
    </>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-2.5">{children}</dl>;
}

/** A key with its value beside it, and under it below the breakpoint. Held, the value is «—». */
function Fact({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div
      data-fact={name}
      className="grid items-baseline gap-x-4 gap-y-0.5 md:grid-cols-[220px_minmax(0,1fr)]"
    >
      <dt className="text-[12px] leading-[18px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[13px] font-semibold">{children ?? <Dash />}</dd>
    </div>
  );
}

// «Скопійовано» once the write resolves, never on the click (Primer's copy pattern); a refusal
// says so on the button and leaves the ID selected, to copy by hand. Both last 2 s and are spoken.
const SHOWN_MS = 2000;

function AccountId({ id }: { id: string }) {
  const t = useT();
  const value = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<{ state: 'copied' | 'failed'; at: number }>();
  useEffect(() => {
    if (shown === undefined) return;
    const timer = setTimeout(() => setShown(undefined), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const copy = () => {
    // Called in the press itself, where the browser counts the gesture; a throw is a refusal too.
    let written: Promise<void>;
    try {
      written = navigator.clipboard.writeText(id);
    } catch (err) {
      written = Promise.reject(err);
    }
    void written.then(
      () => setShown({ state: 'copied', at: Date.now() }),
      () => {
        const selection = document.getSelection();
        if (value.current !== null && selection !== null) {
          const range = document.createRange();
          range.selectNodeContents(value.current);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        setShown({ state: 'failed', at: Date.now() });
      },
    );
  };

  const [Icon, label, status] =
    shown?.state === 'copied'
      ? [Check, t.profile.copied, t.profile.copiedStatus]
      : shown?.state === 'failed'
        ? [CircleAlert, t.profile.copyFailed, t.profile.copyFailedStatus]
        : [Copy, t.profile.copy, ''];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span ref={value} className="font-mono text-xs font-normal">
        {id}
      </span>
      <Button variant="outline" size="sm" weight="semibold" onClick={copy}>
        <Icon
          size={14}
          aria-hidden
          className={shown?.state === 'failed' ? 'text-neg' : undefined}
        />
        {label}
      </Button>
      {/* The line stays; its words are a new node each time, so a second press is said again. */}
      <span data-copy-status role="status" className="sr-only">
        <span key={shown?.at}>{status}</span>
      </span>
    </span>
  );
}

function Passkeys({ list, held }: { list: PasskeyList | undefined; held: boolean }) {
  const t = useT();
  const f = useFormat();
  // Laid out unseen while a list that answers soon is out, so landing moves nothing it showed.
  const shown = useHold(list === undefined) || held;
  const note =
    list?.kind === 'google'
      ? t.profile.passkeys.google
      : list?.kind === 'failed'
        ? t.profile.passkeys.failed
        : list?.kind === 'passkeys' && list.passkeys.length === 0
          ? t.profile.passkeys.none
          : '';
  return (
    <>
      <div className="mb-2.5 text-[13px] font-semibold">{t.profile.passkeys.title}</div>
      {list === undefined ? (
        <div className={`flex flex-col gap-2 ${shown ? '' : 'invisible'}`}>
          {[0, 1, 2].map((i) => (
            <Block key={i} kind="passkey" className="h-[61.5px] w-full rounded-[16px]" />
          ))}
        </div>
      ) : (
        list.kind === 'passkeys' &&
        list.passkeys.length > 0 && (
          <ul className="flex flex-col gap-2">
            {list.passkeys.map((p, i) => (
              <li
                key={i}
                data-passkey
                className="flex items-center gap-3 rounded-[16px] bg-panel px-3.5 py-3"
              >
                <KeyRound size={16} aria-hidden className="flex-none text-muted" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">
                    {p.name === '' ? t.profile.passkeys.unnamed : p.name}
                  </div>
                  <div className="text-[12px] leading-[18px] text-muted">
                    {t.profile.passkeys.created(f.date(p.createdAt))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
      {/* In place before the list lands, so a note that arrives after the page is announced. */}
      <div data-passkeys-note role="status" className="text-[12px] leading-[18px] text-muted">
        {note}
      </div>
    </>
  );
}
