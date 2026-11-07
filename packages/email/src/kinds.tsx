import type { ReactNode } from 'react';

import { kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';
import type { Lang } from '@quirenote/core/money';

import { CODE, INVITATION } from './copy';
import { Action, Credential, Note, Paragraph } from './layout';

/** Cognito fills its code, or the temporary password, into this placeholder. */
const COGNITO_CODE = '{####}';

export type Params = {
  /** `expiresAt` is the instant the temporary password lapses; it is shown in Kyiv time. */
  invitation: { origin: string; email: string; expiresAt: Date };
  code: { origin: string };
};
export type Kind = keyof Params;

export type Message = { subject: string; preheader: string; footer: string; content: ReactNode };

// Dates are dd.MM.yyyy in both languages (*Language, numbers, fonts*).
const kyivDay = (instant: Date) => kyivDateIso(instant).split('-').reverse().join('.');

export const KIND: { [K in Kind]: (language: Lang, params: Params[K]) => Message } = {
  invitation(language, { origin, email, expiresAt }) {
    const copy = INVITATION[language];
    return {
      subject: copy.subject,
      preheader: copy.preheader(kyivDay(expiresAt)),
      footer: copy.footer,
      content: (
        <>
          <Paragraph>{copy.intro}</Paragraph>
          <Credential
            rows={[
              { label: copy.address, value: email },
              { label: copy.password, value: COGNITO_CODE, secret: true },
            ]}
          />
          <Paragraph>{copy.validity(`${kyivDay(expiresAt)}, ${kyivTimeHm(expiresAt)}`)}</Paragraph>
          <Action language={language} label={copy.action} href={`${origin}/sign-in`} />
          <Note lead={copy.noteLead}>{copy.note}</Note>
        </>
      ),
    };
  },
  code(language) {
    const copy = CODE[language];
    return {
      subject: copy.subject,
      preheader: copy.preheader,
      footer: copy.footer,
      content: (
        <>
          <Paragraph>{copy.intro}</Paragraph>
          <Credential rows={[{ label: copy.code, value: COGNITO_CODE, secret: true }]} />
          <Note lead={copy.noteLead}>{copy.note}</Note>
        </>
      ),
    };
  },
};
