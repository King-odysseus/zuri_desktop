/** Smoke test: boot the React renderer through the real Electron main process. */

import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import '../src/main/bootstrap.js';
import { captureConsoleErrors, createReporter, reloadAndWait, useScratchProfile, waitForFirstWindow, waitForLoad } from './lib/app-launch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = createReporter();
useScratchProfile();
const consoleCapture = captureConsoleErrors();
// The budget covers the worst honest case below: waiting out a build that is
// running at the same moment, then loading the window again until the app shows.
// A healthy run finishes in a few seconds, so this only bounds a stuck one.
const hardStop = setTimeout(() => {
  console.log('FAIL smoke: app did not settle within 240 s');
  app.exit(1);
}, 240000);

// `npm test` builds before this step, and vite empties dist-react as it starts, so a
// build that has not run yet leaves nothing to load. Say that plainly instead of
// booting a window straight into a bare ERR_FILE_NOT_FOUND.
//
// The folder can also be empty because a build is running at this very moment: vite
// clears the output folder before it writes anything, and a second `npm run react:build`
// in the same checkout does the same. Waiting for the entry to come back tells "not
// built" apart from "being rebuilt". Output that is already there is read with no wait
// at all, so one clean build behaves exactly as it did before.
const buildEntry = path.join(root, 'dist-react', 'index.html');
const BUILD_WAIT_MS = 40000;

async function waitForBuild() {
  for (let waited = 0; waited < BUILD_WAIT_MS; waited += 500) {
    if (fs.existsSync(buildEntry)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${buildEntry} is missing - run "npm run react:build" first`);
}

/**
 * True once React has put something inside #root.
 *
 * The element itself proves nothing: a page whose module script was missing still
 * has an empty root div. Only a child means the bundle ran, which is the state
 * this step is about.
 * @param {import('electron').BrowserWindow} window
 * @param {number} [budgetMs]
 * @returns {Promise<boolean>}
 */
async function waitForPaint(window, budgetMs = 10000) {
  for (let waited = 0; waited < budgetMs; waited += 250) {
    try {
      const painted = await window.webContents.executeJavaScript(
        `document.querySelector('#root') !== null && document.querySelector('#root').childElementCount > 0`,
      );
      if (painted) return true;
    } catch {
      // A document caught mid-navigation has no page to run script in yet. That
      // is the same answer as "not painted": wait and look again.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const boot = waitForBuild().then(() => app.whenReady());

boot.then(async () => {
  const window = await waitForFirstWindow();
  await waitForLoad(window);

  // main.js opens its window as soon as Electron is ready, which can be before the
  // build check above has finished. A build that starts in that gap empties
  // dist-react, so the first load can land in Electron's own error page even though
  // the bundle arrives a moment later. Worse, the html can be back while the script
  // it points at is still being written, which loads as a page with no app in it and
  // looks the same from the outside. So reload until React has painted, and let the
  // checks below report the app rather than a folder caught mid-write.
  let painted = await waitForPaint(window);
  for (let attempt = 0; attempt < 3 && !painted; attempt += 1) {
    await waitForBuild();
    await reloadAndWait(window);
    painted = await waitForPaint(window);
  }

  const ready = await window.webContents.executeJavaScript(`({
    root: document.querySelector('#root') !== null,
    script: document.querySelector('script[type="module"]') !== null,
    painted: document.querySelector('#root') !== null && document.querySelector('#root').childElementCount > 0,
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
    // The root div survives a script that never loaded, so require the paint as
    // well: otherwise a page with no app in it passes as a mounted one.
    if (!ready.painted) throw new Error('the page loaded but React painted nothing');
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
