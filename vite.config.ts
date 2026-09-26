import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import pkg from './package.json';

export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  // Strict on purpose: a refusal to boot names a port conflict at once, where
  // Vite's default walk to the next free port is found by measuring the wrong
  // instance. `preview` inherits it. Second checkout: `pnpm dev --port N`.
  server: {
    port: 3300,
    strictPort: true,
    // The relay admits only a same-site caller, which localhost is not; through the proxy it is
    // same-origin. Not `/auth`: Cognito's callback, `/auth/callback`, is this app's page (#273).
    proxy: {
      '/relay': {
        target: 'https://api.dev.quirenote.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/relay/, ''),
      },
    },
  },
  // Single source of truth for the sidebar version badge — see docs/reference/VERSIONING.md.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
