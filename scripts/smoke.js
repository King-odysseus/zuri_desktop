/** Smoke test: boot the React renderer through the real Electron main process. */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/main/main.js';
import { captureConsoleErrors, createReporter, useScratchProfile, waitForFirstWindow, waitForLoad } from './lib/app-launch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = createReporter();
useScratchProfile();
const consoleCapture = captureConsoleErrors();
const hardStop = setTimeout(() => {
  console.log('FAIL smoke: app did not settle within 60 s');
  app.exit(1);
}, 60000);

app.whenReady().then(async () => {
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
