// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Modified from Amplify JS, packages/auth/src/providers/cognito/utils/srp/: one module, native
// BigInt and WebCrypto in place of its jsbn port and @aws-crypto/sha256-js, no device keys.

/** The 3072-bit group Cognito uses (RFC 5054 appendix A), generator 2. */
const N = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
    'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
);
const g = 2n;

const encoder = new TextEncoder();

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
  }
  return result;
}

/** Java's `BigInteger.toByteArray()` in hex, which is what Cognito hashes: even length, and a
 *  leading `00` when the high bit is set. Every value here is non-negative. */
function paddedHex(n: bigint): string {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return /^[89a-f]/.test(hex) ? `00${hex}` : hex;
}

function bytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (data: Uint8Array<ArrayBuffer>) =>
  toHex(await crypto.subtle.digest('SHA-256', data));

const bigFromHex = (hex: string) => BigInt(`0x${hex}`);

/** 128 random bytes, as Amplify draws them; N is longer, so no reduction is needed. */
function randomA(): bigint {
  return bigFromHex(toHex(crypto.getRandomValues(new Uint8Array(128)).buffer));
}

/** The client's opening: `srpA` goes to `/auth/start`, and `a` stays here for the claim. */
export function srpStart(a = randomA()): { a: bigint; srpA: string } {
  return { a, srpA: modPow(g, a, N).toString(16) };
}

export interface ClaimInput {
  a: bigint;
  /** The pool id after its region and underscore. */
  poolName: string;
  /** `USER_ID_FOR_SRP`, never the address: it is what the verifier was made from. */
  userId: string;
  password: string;
  srpB: string;
  salt: string;
  secretBlock: string;
  timestamp: string;
}

/** `PASSWORD_CLAIM_SIGNATURE`: proves the password without sending it. */
export async function passwordClaim(input: ClaimInput): Promise<string> {
  const A = modPow(g, input.a, N);
  const B = bigFromHex(input.srpB);
  // RFC 5054 §2.6 and SRP-6a: the client aborts on either, or a hostile server learns the key.
  if (B % N === 0n) throw new Error('SRP: B is zero modulo N');
  const u = bigFromHex(await sha256(bytes(paddedHex(A) + paddedHex(B))));
  if (u === 0n) throw new Error('SRP: u is zero');

  const k = bigFromHex(await sha256(bytes(paddedHex(N) + paddedHex(g))));
  const identity = await sha256(
    encoder.encode(`${input.poolName}${input.userId}:${input.password}`),
  );
  const x = bigFromHex(await sha256(bytes(paddedHex(bigFromHex(input.salt)) + identity)));
  const S = modPow(B - k * modPow(g, x, N), input.a + u * x, N);

  // HKDF-SHA256 to 16 bytes; Amplify appends the 0x01 counter to its info by hand, WebCrypto adds it.
  const ikm = await crypto.subtle.importKey('raw', bytes(paddedHex(S)), 'HKDF', false, [
    'deriveBits',
  ]);
  const key = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytes(paddedHex(u)),
      info: encoder.encode('Caldera Derived Key'),
    },
    ikm,
    128,
  );

  const block = Uint8Array.from(atob(input.secretBlock), (c) => c.charCodeAt(0));
  const message = new Uint8Array([
    ...encoder.encode(input.poolName),
    ...encoder.encode(input.userId),
    ...block,
    ...encoder.encode(input.timestamp),
  ]);
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, message));
  return btoa(String.fromCharCode(...signature));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** `TIMESTAMP`, in the shape Cognito signs: `ddd MMM D HH:mm:ss UTC YYYY`, the day unpadded. */
export function cognitoTimestamp(now = new Date()): string {
  const time = `${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(now.getUTCSeconds())}`;
  return `${DAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()} ${time} UTC ${now.getUTCFullYear()}`;
}
