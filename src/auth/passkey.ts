import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

import { ANSWER_MS } from './relay';

export type CognitoAnswer =
  { kind: 'ok'; body: Record<string, unknown> } | { kind: 'refused'; reason: 'offline' | 'failed' };

export type CognitoCall = (operation: string, body: object) => Promise<CognitoAnswer>;

/** Cognito's own endpoint, for the calls an access token authorizes, which take no client secret;
 *  Amplify JS's transport, an unsigned JSON POST naming the operation, never cached. */
export function createCognito({
  region,
  fetch,
}: {
  region: string | undefined;
  fetch: typeof globalThis.fetch;
}): CognitoCall {
  return async (operation, body) => {
    if (region === undefined) return { kind: 'refused', reason: 'failed' };
    // A signed-in page waits on the list to leave, so a stalled answer ends as a relay's does.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANSWER_MS);
    let text: string;
    try {
      const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
          'cache-control': 'no-store',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status !== 200) return { kind: 'refused', reason: 'failed' };
      text = await response.text();
    } catch {
      return { kind: 'refused', reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
    // `CompleteWebAuthnRegistration` answers 200 with an empty body.
    try {
      const parsed: unknown = text === '' ? {} : JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return { kind: 'ok', body: parsed as Record<string, unknown> };
      }
    } catch {
      // Falls through to the refusal below.
    }
    return { kind: 'refused', reason: 'failed' };
  };
}

export interface PasskeyDeps {
  cognito: CognitoCall;
  getAccessToken: () => Promise<string | undefined>;
  /** The OS dialog that makes a passkey: resolves with it as JSON, rejects however it did not. */
  register: (options: PublicKeyCredentialCreationOptionsJSON) => Promise<unknown>;
}

/** Whether Cognito lists a passkey for the signed-in account; undefined when it cannot say. */
export async function hasPasskey(deps: PasskeyDeps): Promise<boolean | undefined> {
  const token = await deps.getAccessToken();
  if (!token) return undefined;
  const answer = await deps.cognito('ListWebAuthnCredentials', {
    AccessToken: token,
    MaxResults: 1,
  });
  if (answer.kind !== 'ok' || !Array.isArray(answer.body.Credentials)) return undefined;
  return answer.body.Credentials.length > 0;
}

export type Registration = 'created' | 'notCreated' | 'offline' | 'failed';

/** Start, the OS dialog, complete. While the token is fresh, as after a sign-in, Start is the one
 *  fetch before the dialog: Safari before 17.4 opens it only after one fetch and no other wait. */
export async function addPasskey(
  deps: PasskeyDeps,
  /** `false` once the offer has been left, and no dialog opens. */
  stillHere: () => boolean,
): Promise<Registration> {
  const token = await deps.getAccessToken();
  if (!token) return 'failed';
  const start = await deps.cognito('StartWebAuthnRegistration', { AccessToken: token });
  if (start.kind === 'refused') return start.reason;
  const options = start.body.CredentialCreationOptions;
  if (typeof options !== 'object' || options === null) return 'failed';
  if (!stillHere()) return 'notCreated';

  let credential: unknown;
  try {
    credential = await deps.register(options as PublicKeyCredentialCreationOptionsJSON);
  } catch {
    // Cancelled, timed out, or nowhere to keep one: WebAuthn does not tell them apart.
    return 'notCreated';
  }
  const done = await deps.cognito('CompleteWebAuthnRegistration', {
    AccessToken: token,
    Credential: credential,
  });
  return done.kind === 'ok' ? 'created' : done.reason;
}
