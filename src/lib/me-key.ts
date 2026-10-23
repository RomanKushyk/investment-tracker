// The account's own read, `GET /me`: its own module, so the client that patches the settings it
// carries and the hooks that read it name one key, whichever of them a test replaces.
export const meKey = ['me'] as const;
