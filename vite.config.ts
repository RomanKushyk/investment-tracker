import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import pkg from './package.json';

export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  server: { port: 3000 },
  // Single source of truth for the sidebar version badge — see docs/VERSIONING.md.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
