import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-es-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';
import spec from '../../docs/reference/openapi.json';

// The committed document IS the module, so nothing sits between the generator and the
// page that could drift — infra/src/openapi.test.ts already pins those bytes.
//
// The prebuilt bundle rather than the `swagger-ui` package: that one externalises React
// and reads `createRoot` off the `react-dom` root export, which React 19 moved to
// `react-dom/client`, so the page died with an empty body. This one bundles its own
// React. The deep specifier is required — the package root is a Node shim resolving
// `__dirname`, meaningless in a browser chunk.
//
// `spec` rather than `url`, and `queryConfigEnabled` off, so the page holds one document
// and cannot be re-pointed at a foreign one through the query string.
//
// The page enforces nothing; the API does. Both admin operations declare CognitoJwt and
// the authorizer answers ahead of the handler, while the sign-up route declares an empty
// `security` because it creates the row the others are checked against.
//
// Selecting the prod server from the dev page and submitting fails as an opaque
// `Failed to fetch`: the prod API allows only the production origins. That is the
// intended boundary, not a fault of the page.
SwaggerUIBundle({
  dom_id: '#swagger-ui',
  spec,
  queryConfigEnabled: false,
});
