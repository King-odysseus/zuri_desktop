/** Smoke test: boot the React renderer through the real Electron main process. */

import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import '../src/main/bootstrap.js';
import { captureConsoleErrors, createReporter, useScratchProfile, waitForFirstWindow, waitForLoad } from './lib/app-launch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = createReporter();
useScratchProfile();
const consoleCapture = captureConsoleErrors();
const hardStop = setTimeout(() => {
  console.log('FAIL smoke: app did not settle within 60 s');
  app.exit(1);
}, 60000);

// `npm test` builds before this step, and vite empties dist-react as it starts, so a
// build that has not run yet leaves nothing to load. Say that plainly instead of
// booting a window straight into a bare ERR_FILE_NOT_FOUND.
const buildEntry = path.join(root, 'dist-react', 'index.html');
const boot = fs.existsSync(buildEntry)
  ? app.whenReady()
  : Promise.reject(new Error(`${buildEntry} is missing - run "npm run react:build" first`));

boot.then(async () => {
  const window = await waitForFirstWindow();
  await waitForLoad(window);
  const ready = await window.webContents.executeJavaScript(`({
    root: document.querySelector('#root') !== null,
    script: document.querySelector('script[type="module"]') !== null,
    hasRequire: typeof require !== 'undefined',
    hasProcess: typeof process !== 'undefined',
  })`);

  report.check('one Electron window opens', () => {
    const count = BrowserWindow.getAllWindows().length;
    if (count !== 1) throw new Error(`expected 1 window, found ${count}`);
    return '1 window';
  });
  report.check('the window loads dist-react', () => {
    const expected = path.join(root, 'dist-react', 'index.html').replace(/\\/g, '/').toLowerCase();
    const loaded = new URL(window.webContents.getURL()).pathname.replace(/^\//, '').toLowerCase();
    if (loaded !== expected) throw new Error(window.webContents.getURL());
    return window.webContents.getURL();
  });
  report.check('React mounts in an isolated renderer', () => {
    if (!ready.root || !ready.script) throw new Error('React root or module script is missing');
    if (ready.hasRequire || ready.hasProcess) throw new Error('Node globals leaked into the renderer');
  });
  // The app is a workspace, so it opens filling the screen width rather than a
  // fixed 1200x800 box. Windows counts the resize frame in the bounds, so the
  // window may be a few pixels wider than the work area but never narrower.
  // The reporter's checks are synchronous, so wait for the maximised state here.
  for (let attempt = 0; attempt < 30 && !window.isMaximized(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  report.check('the window opens filling the screen width', () => {
    if (!window.isMaximized()) throw new Error('window did not open maximised');
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    const bounds = window.getBounds();
    if (bounds.width < width) throw new Error('window ' + bounds.width + ' narrower than work area ' + width);
    return 'maximised, ' + bounds.width + ' wide on a ' + width + ' wide work area';
  });
  report.check('the renderer has no console errors', () => {
    if (consoleCapture.errors.length > 0) throw new Error(consoleCapture.errors.join(' | '));
  });

  clearTimeout(hardStop);
  app.exit(report.exitCode());
}).catch((error) => {
  clearTimeout(hardStop);
  console.log(`FAIL smoke: ${error.message}`);
  app.exit(1);
});
