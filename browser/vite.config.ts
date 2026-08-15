import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `__dirname` doesn't exist in an ESM config (this package is `"type":
// "module"`), so the directory is derived from `import.meta.url` instead —
// the standard substitute, and one that needs no Node version newer than
// this repo already requires.
const root = dirname(fileURLToPath(import.meta.url));

// This app has exactly one purpose: show `kaafil-js/client` doing real HTTP
// work against tokens the server half minted. That needs a root, a fixed
// dev port (so a URL from the README or a screenshot doesn't go stale), and
// nothing else — the SDK is ESM with zero runtime dependencies, so there is
// no CJS interop, no polyfill, and no bundler special-casing to add here.
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
