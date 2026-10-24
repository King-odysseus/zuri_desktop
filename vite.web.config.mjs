import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The cloud dashboard is a separate React app from the desktop renderer:
// web/ builds into server/public so the Node server ships the bundle itself.
// base stays absolute ('/') because the app is served from the domain root.
// Paths are taken from the project folder's real path for the same reason as
// vite.config.mjs: a Windows 8.3 short name in the current directory would
// leave root short while the entry html resolves long, and the html asset name
// becomes a chain of "..".
const projectDir = realpathSync(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  base: '/',
  root: resolve(projectDir, 'web'),
  // Tailwind v4 plus the Flowbite React plugin, so the site can use the same
  // component primitives as the desktop app instead of two divergent systems.
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(projectDir, 'server', 'public'),
    emptyOutDir: true,
  },
});
