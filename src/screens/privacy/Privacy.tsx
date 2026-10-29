import { REAUTHENTICATING } from '../../auth/google';
import { RETURNING } from '../../auth/signed-out';
import { INZHUR_LAST_FETCH_KEY, INZHUR_LAST_PARSE_KEY } from '../../hooks/useInzhurAssets';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { DRAFT_KEY, SETTINGS_KEY } from '../../lib/storage-keys';
import { LegalDocument } from '../legal/LegalDocument';

/** The day the notice's text last changed; it reads at the top (*Legal documents*). */
const UPDATED = '2026-10-29';

type Rows = Dict['privacy']['sections']['cookies']['rows'];

/** Each entry by its name, which is the code's and not translated; the copy says what it is for.
 *  The relay's cookies are named in `infra/src/auth-relay.ts`, the hand-offs in `src/auth/`. */
const ENTRIES: [name: string | undefined, row: keyof Rows][] = [
  ['__Host-Http-refresh', 'refresh'],
  ['__Host-Http-origin', 'origin'],
  ['__Host-Http-access', 'access'],
  ['__Host-Http-google', 'google'],
  // Named in the copy: it is Cognito's, on another host.
  [undefined, 'cognito'],
  [SETTINGS_KEY, 'settings'],
  [DRAFT_KEY, 'draft'],
  [`${INZHUR_LAST_FETCH_KEY}, ${INZHUR_LAST_PARSE_KEY}`, 'inzhur'],
  [`${RETURNING}, ${REAUTHENTICATING}`, 'handoff'],
];

/** The privacy notice, whole (WP260 ¶17). */
export function Privacy() {
  const p = useT().privacy;
  return (
    <LegalDocument
      title={p.title}
      updated={UPDATED}
      dated={p.updated}
      intro={p.intro}
      sections={p.sections}
      after={(id) =>
        id === 'cookies' && (
          <div className="mt-3 rounded-[16px] bg-panel px-4 py-1">
            {ENTRIES.map(([name, row], j) => (
              <div key={row} className={`py-2.5 ${j > 0 ? 'border-t border-hairline' : ''}`}>
                <div className="text-[12px] leading-[18px] font-semibold">
                  {name ?? p.sections.cookies.cognitoName}
                </div>
                <div className="text-[12px] leading-[18px] text-muted">
                  {p.sections.cookies.rows[row]}
                </div>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}
