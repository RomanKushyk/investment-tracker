import type { CSSProperties, ReactNode } from 'react';
import { Body, Button, Head, Hr, Html, Img, Link, Preview, Section, Text } from 'react-email';

import type { Lang } from '@quirenote/core/money';

import { SHARED } from './copy';
import { PALETTE } from './palette';

const L = PALETTE.light;
const D = PALETTE.dark;
const SANS = "Manrope, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

// The spec's role table: mail sets the body at 16, not the app's 13.
const BODY: CSSProperties = { fontSize: 16, lineHeight: '24px', margin: '16px 0 0', color: L.ink };
const SMALL: CSSProperties = { fontSize: 13, lineHeight: '18px', color: L.muted };
const LABEL: CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 600,
  letterSpacing: '.04em',
  color: L.muted,
  margin: 0,
};

/** The shape system's radius, round(short side × 0.26). */
const radius = (side: number) => Math.round(side * 0.26);

// Light is inline, so a client that drops <style> still paints it; dark wins by !important.
// Body copies its background onto a classless inner cell, so the page rule reaches it by position.
const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
@media (prefers-color-scheme:dark){
.qn-page,.qn-page>table>tbody>tr>td{background:${D.page}!important}
.qn-card{background:${D.card}!important;border-color:${D.hairline}!important}
.qn-ink{color:${D.ink}!important}
.qn-muted{color:${D.muted}!important}
.qn-panel{background:${D.panel}!important}
.qn-rule{border-color:${D.hairline}!important}
.qn-button{background:${D.accent}!important;border-color:${D.accent}!important;color:${D['accent-fg']}!important}
.qn-link{color:${D.accent}!important}
.qn-mark-light{display:none!important}
.qn-mark-dark{display:block!important}
}
@media (max-width:599px){
.qn-outer{padding:0!important}
.qn-card{border-radius:0!important;border-left-width:0!important;border-right-width:0!important}
.qn-inner{padding:16px!important}
.qn-h1{margin-top:24px!important;font-size:22px!important;line-height:28px!important}
}`;

export function Layout(props: {
  language: Lang;
  origin: string;
  subject: string;
  preheader: string;
  footer: string;
  content: ReactNode;
}) {
  const { language, origin, subject, preheader, footer, content } = props;
  const shared = SHARED[language];
  const mark = (theme: 'light' | 'dark') => (
    <Img
      className={`qn-mark-${theme}`}
      src={`${origin}/email/mark-${theme}.png`}
      width="40"
      height="40"
      alt="Quirenote"
      // `mso-hide` is Outlook's own property, which React's style type does not list.
      style={theme === 'dark' ? ({ display: 'none', msoHide: 'all' } as CSSProperties) : undefined}
    />
  );
  return (
    <Html lang={language} dir="ltr">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{subject}</title>
        <style>{STYLE}</style>
      </Head>
      <Body
        className="qn-page"
        lang={language}
        dir="ltr"
        style={{ margin: 0, padding: 0, background: L.page, fontFamily: SANS }}
      >
        <Preview useTitleTag={false}>{preheader}</Preview>
        <div
          lang={language}
          dir="ltr"
          role="article"
          aria-roledescription="email"
          aria-label={subject}
        >
          <span data-mso-marker="open" />
          <Section tdClassName="qn-outer" style={{ maxWidth: 600, padding: 24 }}>
            <Section
              className="qn-card"
              tdClassName="qn-inner"
              style={{
                background: L.card,
                border: `1px solid ${L.hairline}`,
                borderRadius: 20,
                borderCollapse: 'separate',
                padding: 32,
              }}
            >
              <table
                role="presentation"
                cellPadding="0"
                cellSpacing="0"
                border={0}
                data-skip-in-text="true"
              >
                <tbody>
                  <tr>
                    <td style={{ width: 40, paddingRight: 10, verticalAlign: 'middle' }}>
                      {mark('light')}
                      {mark('dark')}
                    </td>
                    <td
                      className="qn-ink"
                      style={{
                        verticalAlign: 'middle',
                        fontSize: 17,
                        fontWeight: 600,
                        color: L.ink,
                      }}
                    >
                      quirenote
                    </td>
                  </tr>
                </tbody>
              </table>
              <h1
                className="qn-ink qn-h1"
                style={{
                  margin: '32px 0 0',
                  fontSize: 26,
                  lineHeight: '32px',
                  fontWeight: 600,
                  color: L.ink,
                }}
              >
                {subject}
              </h1>
              <Paragraph>{shared.greeting}</Paragraph>
              {content}
              <Paragraph style={{ marginTop: 24 }}>
                {shared.closing[0]}
                <br />
                {shared.closing[1]}
              </Paragraph>
              <Hr
                className="qn-rule"
                style={{
                  margin: '24px 0 16px',
                  border: 'none',
                  borderTop: `1px solid ${L.hairline}`,
                }}
              />
              <Text className="qn-muted" data-text-footer="true" style={{ ...SMALL, margin: 0 }}>
                {footer}
              </Text>
              <Text
                className="qn-muted"
                data-text-footer="true"
                style={{ ...SMALL, margin: '8px 0 0' }}
              >
                Quirenote ·{' '}
                <Link
                  className="qn-muted"
                  href={origin}
                  style={{ color: L.muted, textDecoration: 'underline' }}
                >
                  <span data-skip-in-text="true">{new URL(origin).host}</span>
                </Link>
              </Text>
            </Section>
          </Section>
          <span data-mso-marker="close" />
        </div>
      </Body>
    </Html>
  );
}

export function Paragraph(props: { children: ReactNode; style?: CSSProperties }) {
  return (
    <Text className="qn-ink" style={{ ...BODY, ...props.style }}>
      {props.children}
    </Text>
  );
}

/** The labelled values of a message, as live text in a panel: the address in the body face,
 *  a password or code in the mono stack. */
export function Credential(props: { rows: { label: string; value: string; secret?: boolean }[] }) {
  const PAD = 16;
  const GAP = 12;
  const height =
    PAD * 2 +
    props.rows.reduce((sum, row) => sum + 16 + (row.secret ? 28 : 24), 0) +
    GAP * (props.rows.length - 1);
  return (
    <Section
      className="qn-panel"
      style={{
        marginTop: 16,
        background: L.panel,
        borderRadius: radius(height),
        borderCollapse: 'separate',
        padding: `${PAD}px 20px`,
      }}
    >
      {props.rows.map((row, i) => (
        <div key={row.label} style={{ marginTop: i === 0 ? 0 : GAP }}>
          <p className="qn-muted" style={LABEL}>
            {row.label}
          </p>
          <p
            className="qn-ink"
            style={
              row.secret
                ? {
                    margin: 0,
                    fontFamily: MONO,
                    fontSize: 22,
                    lineHeight: '28px',
                    fontWeight: 700,
                    letterSpacing: '.08em',
                    color: L.ink,
                  }
                : { margin: 0, fontSize: 16, lineHeight: '24px', color: L.ink }
            }
          >
            {row.value}
          </p>
        </div>
      ))}
    </Section>
  );
}

/** The one primary action, and under it, always, the full URL as a link. */
export function Action(props: { language: Lang; label: string; href: string }) {
  return (
    <>
      <Section style={{ marginTop: 24 }}>
        <Button
          className="qn-button"
          data-action="true"
          href={props.href}
          style={{
            background: L.accent,
            border: `1px solid ${L.accent}`,
            borderRadius: radius(44),
            color: L['accent-fg'],
            fontSize: 16,
            lineHeight: '20px',
            fontWeight: 600,
            padding: '11px 24px',
          }}
        >
          {props.label}
        </Button>
      </Section>
      <Text className="qn-muted" style={{ ...SMALL, margin: '10px 0 0' }}>
        <span data-skip-in-text="true">{SHARED[props.language].orOpen} </span>
        <Link
          className="qn-link"
          href={props.href}
          style={{ color: L.accent, textDecoration: 'underline' }}
        >
          {props.href}
        </Link>
      </Text>
    </>
  );
}

/** The “if it was not you” block: a rule above, the lead in bold. */
export function Note(props: { lead: string; children: ReactNode }) {
  return (
    <div
      className="qn-rule"
      style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${L.hairline}` }}
    >
      <Text className="qn-ink" style={{ ...BODY, margin: 0 }}>
        <strong>{props.lead}</strong> {props.children}
      </Text>
    </div>
  );
}
