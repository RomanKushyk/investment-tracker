import { TERMS_VERSION } from '@quirenote/core/terms';

import { useT } from '../../i18n/useT';
import { LegalDocument } from './LegalDocument';

/** The terms of use, whole: the date they print is the version an application records
 *  (*Legal documents*). */
export function Terms() {
  const t = useT();
  const terms = t.terms;
  return (
    <LegalDocument
      title={terms.title}
      updated={TERMS_VERSION}
      dated={terms.updated}
      intro={terms.intro}
      sections={terms.sections}
    />
  );
}
