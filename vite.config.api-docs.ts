import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The API reference, built separately so that "not in production" needs no flag: `pnpm
// build` is the app and nothing else, and deploy-frontend.yml runs this one on every
// branch but `main`.
//
// TWO CONFIGS, NOT TWO INPUTS ON ONE. Measured: a single Rollup graph over both entries
// hoists what they share into a common chunk, and the APP entry's name changes with it —
// so it would differ on dev from `main`, and dev has to be a place where what production
// ships can be verified. Separate graphs reach each other's modules not at all. A single
// config would also need a flag to suppress the entry on production, which is the shape
// this design exists to avoid.
export default defineConfig({
  build: {
    // The app's build ran first and emptied dist/. This one adds to it.
    emptyOutDir: false,
    // public/ is the app build's to write. Without this the second build copies it
    // again, over the first build's output.
    copyPublicDir: false,
    rollupOptions: {
      // Absolute: Rollup resolves a relative input against process.cwd(), not Vite's
      // root, and this repository is ESM so there is no __dirname.
      input: fileURLToPath(new URL('./api-docs.html', import.meta.url)),
    },
  },
});
