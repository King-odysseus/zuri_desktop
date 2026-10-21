/**
 * Firstrun: launches the app against the real user data folder and asserts it
 * reaches a usable empty state with no API key configured. Provider keys live in
 * userData/zuri/secrets.json (see src/main/secrets.js), so "no key" means that file
 * and the settings file have both never been written. Run via `npm run firstrun`.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import '../src/main/main.js';
import {
  captureConsoleErrors,
  createReporter,
  waitForFirstWindow,
  waitForLoad,
} from './lib/app-launch.js';

const report = createReporter();
const consoleCapture = captureConsoleErrors();

const hardStop = setTimeout(() => {
  console.log('FAIL firstrun: app did not settle within 30 s');
  app.exit(1);
}, 30000);

app.whenReady().then(async () => {
  const window = await waitForFirstWindow();
  await waitForLoad(window);

  const userData = app.getPath('userData');
  const settingsPath = path.join(userData, 'settings.json');
  const secretsPath = path.join(userData, 'zuri', 'secrets.json');

  report.check('user data folder exists', () => {
    if (!fs.existsSync(userData)) throw new Error(`${userData} does not exist`);
    return userData;
  });

  const workspacePath = path.join(userData, 'workspace');
  report.check('workspace folder exists before anything is saved', () => {
    if (!fs.existsSync(workspacePath)) throw new Error(`${workspacePath} does not exist`);
    if (!fs.statSync(workspacePath).isDirectory()) throw new Error(`${workspacePath} is not a folder`);
    return workspacePath;
  });

  report.check('no API key is configured yet', () => {
    if (fs.existsSync(settingsPath)) {
      throw new Error(`settings.json already exists at ${settingsPath}`);
    }
    if (fs.existsSync(secretsPath)) {
      throw new Error(`a provider key is already stored at ${secretsPath}`);
    }
  });

  const heading = await window.webContents.executeJavaScript(
    `document.getElementById('chat-empty-title')?.textContent?.trim() ?? ''`,
  );

  report.check('empty state is usable without setup', () => {
    if (heading === '') throw new Error('the window rendered no heading');
    return `heading "${heading}"`;
  });

  report.check('no console errors during first run', () => {
    if (consoleCapture.errors.length > 0) throw new Error(consoleCapture.errors.join(' | '));
  });

  console.log(`settings path: ${settingsPath}`);

  clearTimeout(hardStop);
  console.log(report.exitCode() === 0 ? 'PASS firstrun' : `FAIL firstrun: ${report.failures()} assertion(s) failed`);
  app.exit(report.exitCode());
}).catch((error) => {
  clearTimeout(hardStop);
  console.log(`FAIL firstrun: ${error.message}`);
  app.exit(1);
});
