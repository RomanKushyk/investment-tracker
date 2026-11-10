import { useNavigate } from 'react-router';

import { leaveThroughLogout, session } from '../../auth/app';
import { SIGNED_OUT } from '../../auth/signed-out';
import { useT } from '../../i18n/useT';
import {
  Footer,
  Header,
  Primary,
  Reauthentication,
  Row,
  Title,
  type ActOutcome,
  type Ways,
} from './Reauthentication';

// «ВИЙТИ НА ВСІХ ПРИСТРОЯХ»: the confirmation, the shared step, then every session ends.

export function SignOutEverywhere({
  open,
  email,
  ways,
  arrived,
  onClose,
}: {
  open: boolean;
  email: string;
  ways: Ways;
  arrived?: 'confirmed' | 'refused';
  onClose: () => void;
}) {
  const t = useT();
  const s = t.profile.signOutEverywhere;
  const navigate = useNavigate();

  async function act(): Promise<ActOutcome> {
    const out = await session.signOutEverywhere();
    if (out.kind === 'signedOut') {
      // The page is signed out now and leaves as a sign-out does.
      if (leaveThroughLogout(out.logout, '/sign-in')) return { kind: 'left' };
      await navigate('/sign-in', { flushSync: true, state: SIGNED_OUT });
      return { kind: 'landed' };
    }
    return out.kind === 'reauthenticate' ? out : { kind: 'failed' };
  }

  return (
    <Reauthentication
      open={open}
      email={email}
      ways={ways}
      arrived={arrived}
      onClose={onClose}
      lines={s.reauth}
      purpose="signOutEverywhere"
      act={act}
      confirm={(proceed, cancel) => (
        <>
          <Header title={<Title>{s.confirm.title}</Title>} lead={s.confirm.body} />
          <Footer>
            <Row cancel={cancel}>
              <Primary busy={false} onPress={proceed}>
                {s.confirm.continue}
              </Primary>
            </Row>
          </Footer>
        </>
      )}
    />
  );
}
