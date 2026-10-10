// `PATCH /settings`: the account's settings written (*Persistence today*, *Cloud target*).
//
// A JSON merge patch (RFC 7396) of the fields the column stores, applied whole or refused whole
// (RFC 5789 §2). It moves no `data_version`: a settings write triggers no `/view` read, and a
// `/mutations` op, which bumps it, would make every other tab's `If-Match` stale. It takes no
// `Idempotency-Key`: a merge patch applied twice leaves the state it left once.
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import { PERIOD_OPTIONS } from '@quirenote/core/period';
import { LEAD_DAYS_MAX, LEAD_DAYS_MIN } from '@quirenote/core/reminders';
import {
  CURRENCIES,
  LANGUAGES,
  SETTINGS_DEFAULTS,
  patchSettings,
  type AccountSettings,
  type SettingsIssue,
} from '@quirenote/core/settings';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import {
  INTERNAL,
  INVALID,
  TOO_LARGE,
  type ApiEvent,
  type ApiResult,
  type Declared,
  derived,
  readJson,
  respond,
} from './http';
import type { SqlClient } from './migrate';
import { RETRY_DELAYS_MS, retryable } from './provision';

export const SETTINGS_ROUTE = 'PATCH /settings';
export const MERGE_PATCH = 'application/merge-patch+json';

const SETTINGS = derived({
  statusCode: 200,
  name: 'settings',
  headers: [],
  example: { ...SETTINGS_DEFAULTS, language: 'en', period: '3m' },
});
/** RFC 5789 §2.2: a patch document the route does not take, naming the one it does. */
const UNSUPPORTED_MEDIA_TYPE = derived({
  statusCode: 415,
  name: 'unsupported_media_type',
  headers: ['accept-patch'],
  example: { error: 'unsupported_media_type' },
});
/** RFC 5789 §2.2's 422: a patch the route reads and cannot apply, each field named. */
const INVALID_SETTINGS = derived({
  statusCode: 422,
  name: 'invalid_settings',
  headers: [],
  example: {
    error: 'invalid_settings',
    issues: [
      { field: 'theme', code: 'unknown-key' },
      { field: 'period', code: 'invalid' },
    ],
  },
});

/** What the route can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `settings.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [SETTINGS_ROUTE]: [
    SETTINGS,
    INVALID,
    TOO_LARGE,
    UNSUPPORTED_MEDIA_TYPE,
    INVALID_SETTINGS,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    INTERNAL,
  ],
};

/** `null` resets a field, which OpenAPI 3.0 asks the enum to list as well as `nullable`. */
const nullable = (schema: { enum?: readonly unknown[]; [keyword: string]: unknown }) => ({
  ...schema,
  nullable: true,
  ...(schema.enum === undefined ? {} : { enum: [...schema.enum, null] }),
});

// One schema for each of the account's settings, and the compiler asks for a new one.
const PROPERTIES: Record<keyof AccountSettings, object> = {
  defaultCurrency: nullable({ type: 'string', enum: CURRENCIES }),
  language: nullable({ type: 'string', enum: LANGUAGES }),
  autoQuoteSuggest: nullable({ type: 'boolean' }),
  couponSuggest: nullable({ type: 'boolean' }),
  remindersEnabled: nullable({ type: 'boolean' }),
  reminderLeadDays: nullable({ type: 'integer', minimum: LEAD_DAYS_MIN, maximum: LEAD_DAYS_MAX }),
  dismissedReminders: nullable({ type: 'array', items: { type: 'string' } }),
  collapsedNavGroups: nullable({ type: 'array', items: { type: 'string' } }),
  sidebarCollapsed: nullable({ type: 'boolean' }),
  period: nullable({ type: 'string', enum: PERIOD_OPTIONS }),
};

export const BODY = {
  required: true,
  content: {
    [MERGE_PATCH]: {
      schema: { type: 'object', additionalProperties: false, properties: PROPERTIES },
    },
  },
} as const;

export interface SettingsDeps {
  user: SqlClient;
  sleep: (ms: number) => Promise<void>;
}

// The write is conditional on the text the merge was made from, the repo's own idiom for a
// read-modify-write (`BUMP`): a row another writer changed first matches nothing, and the merge is
// made again from what it holds. `IS NOT DISTINCT FROM` because the column is NULL until a first write.
const READ = `SELECT settings FROM app_user WHERE user_id = $1`;
const WRITE = `UPDATE app_user SET settings = $2::text
                WHERE user_id = $1 AND settings IS NOT DISTINCT FROM $3::text
            RETURNING user_id`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Media types are case-insensitive and may carry parameters (RFC 9110 §8.3.1). */
const mediaTypeOf = (event: ApiEvent): string | undefined =>
  event.headers?.['content-type']?.split(';')[0].trim().toLowerCase();

const refused = (issues: SettingsIssue[]) =>
  respond(INVALID_SETTINGS, {}, JSON.stringify({ error: 'invalid_settings', issues }));

export async function settings(deps: SettingsDeps, event: ApiEvent): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    // The request's own checks follow the gate (AIP-211), the type before the content.
    if (mediaTypeOf(event) !== MERGE_PATCH) {
      return respond(
        UNSUPPORTED_MEDIA_TYPE,
        { 'accept-patch': MERGE_PATCH },
        JSON.stringify({ error: 'unsupported_media_type' }),
      );
    }
    const read = readJson(event);
    if ('statusCode' in read) return read;
    // A merge patch that is no object would replace the target (RFC 7396 §2): not here.
    if (!isObject(read.value)) return INVALID;

    const { userId } = gate.caller;
    let current = gate.caller.settings;
    for (let attempt = 0; ; attempt += 1) {
      const patched = patchSettings(current, read.value);
      if ('issues' in patched) return refused(patched.issues);
      // A column holds 1 MiB at most, which is also the most a request carries: past it a write
      // would fail inside the cluster as a 500.
      if (patched.text !== null && Buffer.byteLength(patched.text, 'utf8') > MAX_BODY_BYTES) {
        return TOO_LARGE;
      }
      try {
        // Nothing to write when the merge changes nothing, so a repeated patch costs no write.
        if (
          patched.text === current ||
          (await deps.user.query(WRITE, [userId, patched.text, current])).rows.length > 0
        ) {
          return respond(SETTINGS, {}, JSON.stringify(patched.settings));
        }
      } catch (err) {
        // A serialization failure may have committed even so, and the merge made again from what
        // the row holds finds it done.
        if (!retryable(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      }
      if (attempt === RETRY_DELAYS_MS.length) {
        throw new Error('the settings changed under every attempt');
      }
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
      current = (await deps.user.query<{ settings: string | null }>(READ, [userId])).rows[0]
        .settings;
    }
  } catch (err) {
    console.error('settings failed', err);
    return INTERNAL;
  }
}
