// `swagger-ui-dist` SHIPS NO TYPES, and `@types/swagger-ui-dist` is a stale 3.30.6
// against a 5.32 package — it also types only the package ROOT, which is the one
// specifier that must not be imported: the root is a Node shim whose `absolute-path.js`
// calls `require('path').resolve(__dirname)`, so a bundler would try to pull `node:path`
// and `__dirname` into a browser chunk.
//
// So the call signature is borrowed from `@types/swagger-ui`, which IS current (5.32.0)
// and describes this same API — the two packages are the same library, one built for a
// bundler and one prebuilt. Borrowing rather than hand-writing keeps the options object
// honestly typed instead of `any`, which `@typescript-eslint/no-explicit-any` would
// reject here anyway, and it goes stale with the types package rather than silently.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  import type SwaggerUI from 'swagger-ui';

  // CommonJS: the file ends `module.exports = i.default`, so the callable is the
  // default export under Vite's interop, not a named `SwaggerUIBundle`.
  const SwaggerUIBundle: typeof SwaggerUI;
  export default SwaggerUIBundle;
}
