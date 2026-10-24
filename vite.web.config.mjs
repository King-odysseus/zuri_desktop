import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The cloud dashboard is a separate React app from the desktop renderer:
// web/ builds into server/public so the Node server ships the bundle itself.
// base stays absolute ('/') because the app is served from the domain root.
export default defineConfig({
  base: '/',
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./server/public', import.meta.url)),
    emptyOutDir: true,
  },
});
