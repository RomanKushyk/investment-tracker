/// <reference types="vite/client" />

// Injected at build time from package.json "version" (vite.config define) —
// see docs/reference/VERSIONING.md for when and how to bump it.
declare const __APP_VERSION__: string;
// The tree hash of packages/core/src at the commit built (scripts/derivation-id.ts), defined by
// vite.config.ts, vitest.config.ts and the Lambda bundle step, and by no other build (*Deployment*).
declare const __DERIVATION_ID__: string;
