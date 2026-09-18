// `swagger-ui-dist` SHIPS NO TYPES, and `@types/swagger-ui-dist` is a stale 3.30.6
// against a 5.32 package — it also types only the package ROOT, the one specifier that
// must not be imported: the root is a Node shim resolving `__dirname`, so a bundler
// would pull `node:path` and `__dirname` into a browser chunk.
//
// The call signature is borrowed from `@types/swagger-ui`, which is current and
// describes this same API — the two packages are one library, one built for a bundler
// and one prebuilt. Borrowing keeps the options object honestly typed instead of `any`, which
// `@typescript-eslint/no-explicit-any` would reject here anyway.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  import type SwaggerUI from 'swagger-ui';

  // CommonJS: the file ends `module.exports = i.default`, so the callable is the
  // default export under Vite's interop, not a named `SwaggerUIBundle`.
  const SwaggerUIBundle: typeof SwaggerUI;
  export default SwaggerUIBundle;
}
