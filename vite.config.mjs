import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The React/HeroUI renderer lives in src/renderer-react and builds to dist-react.
// base is relative because Electron loads the built
// index.html over file://, where absolute asset paths would not resolve.
//
// Both paths come from the project folder's real path, not from the path this
// file was reached by. When a shell hands Node a Windows 8.3 short name (this
// machine's TEMP is C:\Users\MEGA-M~1\...), root stays short while rollup
// resolves the entry html to the long name; the two no longer share a prefix,
// the emitted html file name becomes a chain of "..", and the build stops.
// Taking the real path once makes both sides the same string.
const projectDir = realpathSync(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  base: './',
  root: resolve(projectDir, 'src', 'renderer-react'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(projectDir, 'dist-react'),
    emptyOutDir: true,
  },
});
