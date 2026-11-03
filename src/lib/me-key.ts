// The account's two reads, `GET /me` and `GET /me/account`: a module of their own, so the client
// and the hooks name one key each, whichever of them a test replaces. Two roots, not one nested in
// the other: an invalidation matches a key's prefix, and a write moves the profile's read alone.
export const meKey = ['me'] as const;
export const accountKey = ['account'] as const;
