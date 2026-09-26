import { Outlet } from 'react-router';

import { useDocumentLang } from '../i18n/useDocumentLang';
import { useTheme } from './theme';

/** Above both shells, so each root attribute has one owner whichever shell is mounted. */
export function Root() {
  useTheme();
  useDocumentLang();
  return <Outlet />;
}
