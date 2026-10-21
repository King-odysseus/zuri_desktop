/**
 * Shared plumbing for the acceptance scripts that drive a real Electron process.
 * Kept separate from the app so no test hook leaks into src/main.
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Point this run at a scratch Electron profile.
 *
 * src/main/main.js pins the app name to "Zuri", so without this every run on a
 * machine resolves userData to the same AppData/Roaming/Zuri folder and shares one
 * disk cache, one GPU cache and one set of Chromium profile locks. When two runs
 * overlap they fight over those files: Chromium logs "Unable to move the cache:
 * Access is denied" and a window can stall before its first paint for far longer
 * than a healthy one takes, which the load timeouts below then report as a broken
 * renderer. A run that owns its profile cannot be slowed by another run, the same
 * way the checks already give themselves a scratch store root for their JSON.
 *
 * Call it once, from the top of the script, before the app is ready.
 * @returns {string} the directory this run owns
 */
export function useScratchProfile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-profile-'));
  app.setPath('userData', directory);
  // Session data (cache, cookies, Local Storage) lives inside userData by default;
  // it is set explicitly so a future default cannot put it back in the shared place.
  app.setPath('sessionData', directory);

  app.on('quit', () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      // Windows can hold a handle on the profile for a moment after quit. Leaving
      // the folder behind only costs a temp directory, so it is not worth a failure.
      console.log('note: could not remove ' + directory + ': ' + error.message);
    }
  });

  return directory;
}

/**
 * Resolve with the first BrowserWindow, or reject if none appears in time.
 *
 * The budget is generous on purpose: this machine runs several Electron instances
 * at once, and a cold start that takes about 3 s idle takes longer while they all
 * compile. A renderer that never loads still fails, because the timeout is the only
 * way out of the wait.
 * @param {number} [timeoutMs]
 * @returns {Promise<BrowserWindow>}
 */
export function waitForFirstWindow(timeoutMs = 45000) {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      app.off('browser-window-created', onCreated);
      reject(new Error(`no window appeared within ${timeoutMs} ms`));
    }, timeoutMs);

    function onCreated(_event, window) {
      clearTimeout(timer);
      resolve(window);
    }

    app.on('browser-window-created', onCreated);
  });
}

/**
 * Resolve once the window's document has finished loading.
 * @param {BrowserWindow} window
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitForLoad(window, timeoutMs = 45000) {
  const contents = window.webContents;
  if (!contents.isLoadingMainFrame()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      // Say what was still in flight, so a slow machine reads differently from a
      // renderer that died: a crash leaves nothing loading, and says so.
      const url = contents.getURL() || "(no url yet)";
      const state = contents.isCrashed() ? "the renderer crashed" : "the main frame is still loading";
      reject(new Error(`renderer did not finish loading ${url} within ${timeoutMs} ms (${state})`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      contents.off('did-finish-load', onLoad);
      contents.off('did-fail-load', onFail);
    }

    function onLoad() {
      cleanup();
      resolve();
    }

    function onFail(_event, errorCode, errorDescription) {
      cleanup();
      reject(new Error(`renderer failed to load: ${errorDescription} (${errorCode})`));
    }

    contents.once('did-finish-load', onLoad);
    contents.once('did-fail-load', onFail);
  });
}

/**
 * Reload the window and resolve once the fresh document has loaded.
 * waitForLoad() alone is not enough here: straight after reload() the main frame
 * may not report itself as loading yet, so this listens for the load event itself.
 * @param {BrowserWindow} window
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function reloadAndWait(window, timeoutMs = 45000) {
  const contents = window.webContents;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`renderer did not reload within ${timeoutMs} ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      contents.off('did-finish-load', onLoad);
      contents.off('did-fail-load', onFail);
    }

    function onLoad() {
      cleanup();
      resolve();
    }

    function onFail(_event, errorCode, errorDescription) {
      cleanup();
      reject(new Error(`renderer failed to reload: ${errorDescription} (${errorCode})`));
    }

    contents.once('did-finish-load', onLoad);
    contents.once('did-fail-load', onFail);
    contents.reload();
  });
}

/**
 * Normalise Electron's console-message event across versions: older releases pass
 * (event, level, message, line, sourceId), newer ones a single details object.
 * @param {unknown[]} args
 * @returns {{ level: string, message: string, line: number|string, source: string }}
 */
function normaliseConsoleMessage(args) {
  const [first, second, third, fourth, fifth] = args;
  if (first && typeof first === 'object' && 'message' in first) {
    return {
      level: String(first.level ?? 'info'),
      message: String(first.message ?? ''),
      line: first.lineNumber ?? '',
      source: String(first.sourceId ?? ''),
    };
  }
  const levelNames = ['verbose', 'info', 'warning', 'error'];
  return {
    level: levelNames[second] ?? 'info',
    message: String(third ?? ''),
    line: fourth ?? '',
    source: String(fifth ?? ''),
  };
}

/**
 * Start collecting renderer errors. Call before the app is ready so messages
 * emitted during the first load are caught.
 * @returns {{ errors: string[] }}
 */
export function captureConsoleErrors() {
  const errors = [];

  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (...args) => {
      const entry = normaliseConsoleMessage(args);
      if (entry.level === 'error') {
        errors.push(`${entry.message} (${entry.source}:${entry.line})`);
      }
    });

    contents.on('preload-error', (_event, preloadPath, error) => {
      errors.push(`preload ${preloadPath}: ${error.message}`);
    });
  });

  return { errors };
}

/**
 * PASS/FAIL reporter in the format the spec asks for.
 * @returns {{ check: Function, skip: Function, exitCode: () => number, failures: () => number }}
 */
export function createReporter() {
  let failures = 0;

  return {
    check(name, run) {
      try {
        const detail = run();
        console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
      } catch (error) {
        failures += 1;
        console.log(`FAIL ${name}: ${error.message}`);
      }
    },
    skip(name, reason) {
      console.log(`SKIP ${name}: ${reason}`);
    },
    failures: () => failures,
    exitCode: () => (failures === 0 ? 0 : 1),
  };
}
