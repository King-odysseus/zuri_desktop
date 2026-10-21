/**
 * Shared plumbing for the acceptance scripts that drive a real Electron process.
 * Kept separate from the app so no test hook leaks into src/main.
 */

import { app, BrowserWindow } from 'electron';

/**
 * Resolve with the first BrowserWindow, or reject if none appears in time.
 * @param {number} [timeoutMs]
 * @returns {Promise<BrowserWindow>}
 */
export function waitForFirstWindow(timeoutMs = 15000) {
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
export function waitForLoad(window, timeoutMs = 15000) {
  const contents = window.webContents;
  if (!contents.isLoadingMainFrame()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`renderer did not finish loading within ${timeoutMs} ms`));
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
export function reloadAndWait(window, timeoutMs = 15000) {
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
