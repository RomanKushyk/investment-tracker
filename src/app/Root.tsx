import { Outlet } from 'react-router';

import { useAnswer } from '../auth/app';
import { useDocumentLang } from '../i18n/useDocumentLang';
import { AnswerScreen } from '../screens/sign-in/Answer';
import { useTheme } from './theme';

/** Above both shells, so each root attribute has one owner whichever shell is mounted. A refused
 *  caller's answer takes the place of the route that asked, and mounts neither signed-in shell. */
export function Root() {
  useTheme();
  useDocumentLang();
  const held = useAnswer();
  return held ? <AnswerScreen held={held} /> : <Outlet />;
}
