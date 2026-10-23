import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The React/HeroUI renderer lives in src/renderer-react and builds to dist-react.
// base is relative because Electron loads the built
// index.html over file://, where absolute asset paths would not resolve.
export default defineConfig({
  base: './',
  root: fileURLToPath(new URL('./src/renderer-react', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist-react', import.meta.url)),
    emptyOutDir: true,
  },
});
