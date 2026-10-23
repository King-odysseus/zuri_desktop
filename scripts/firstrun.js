/**
 * Firstrun: run the first-run setup step with no window and check what it stored.
 *
 * The setup card asks for three answers - a name, a theme and a provider key - and hands them over on
 * `zuri:onboarding:complete`, which main answers with runOnboardingSetup
 * (src/main/onboarding.js). This script calls that same function, so what it checks
 * is the code the window runs, not a second copy of it.
 *
 * It writes into a scratch store root instead of the real userData/zuri: a check
 * must never overwrite the name, theme or key of whoever runs it. The scratch
 * folder is cleared first, so every run starts with nothing stored, and the path
 * printed at the end is the settings.json this run wrote and read back.
 * Run via `npm run firstrun`.
 */

import { app } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runOnboardingSetup } from '../src/main/onboarding.js';
import { hasKey } from '../src/main/secrets.js';
import { resolveStorePath, setStoreRoot } from '../src/main/store.js';

const NAME = 'First Run Check';
const THEME = 'light';
const PROVIDER = 'anthropic';
// Key-shaped, but not a key: secrets.js only checks length and spacing, and nothing
// here ever calls a provider with it.
const KEY = 'sk-ant-firstrun-check-not-a-real-key';

const SCRATCH_ROOT = path.join(os.tmpdir(), 'zuri-firstrun');

/** @type {string[]} */
const failures = [];

/**
 * Record one assertion. Details stay on the line so a failure says what it saw.
 * @param {string} label
 * @param {boolean} passed
 * @param {string} [detail]
 */
function check(label, passed, detail = '') {
  const suffix = detail === '' ? '' : ` - ${detail}`;
  if (passed) {
    console.log(`ok   ${label}${suffix}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL ${label}${suffix}`);
}

/**
 * The settings file as text, or null when setup never got as far as writing it.
 * @param {string} settingsPath
 * @returns {Promise<string|null>}
 */
async function readSettingsFile(settingsPath) {
  try {
    return await fs.readFile(settingsPath, 'utf8');
  } catch {
    return null;
  }
}

app.whenReady().then(async () => {
  // A clean folder every run is what makes this a *first* run rather than a second
  // one that happens to find yesterday's answers still in place.
  await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
  await fs.mkdir(SCRATCH_ROOT, { recursive: true });
  setStoreRoot(SCRATCH_ROOT);

  const settingsPath = resolveStorePath('settings');

  const setup = await runOnboardingSetup({
    name: NAME,
    theme: THEME,
    provider: PROVIDER,
    key: KEY,
  });
  check(
    'setup completes',
    setup.ok === true,
    setup.ok === true ? '' : (setup.error?.message ?? 'no reason given'),
  );

  // The name is what the top bar and the account row show, so an empty one is
  // refused rather than stored as a blank line.
  const refused = await runOnboardingSetup({
    name: '   ',
    theme: THEME,
    provider: PROVIDER,
    key: KEY,
  });
  check(
    'setup refuses a blank name',
    refused.ok === false,
    refused.ok === false ? refused.error.code : 'it was accepted',
  );

  const raw = await readSettingsFile(settingsPath);
  check('settings.json is written', raw !== null, settingsPath);

  /** @type {Record<string, unknown>} */
  let stored = {};
  if (raw !== null) {
    try {
      stored = JSON.parse(raw);
    } catch {
      check('settings.json is valid JSON', false, 'it could not be parsed');
    }
  }

  check('settings.json holds the name', stored.name === NAME, String(stored.name));
  check('settings.json holds the theme', stored.theme === THEME, String(stored.theme));
  check(`a key is stored for ${PROVIDER}`, hasKey(PROVIDER) === true);
  // The key belongs to secrets.json; settings.json is read by the renderer, so a
  // key in it would be a key in the renderer.
  check('settings.json does not hold the key', raw !== null && !raw.includes(KEY));

  if (failures.length === 0) {
    console.log(`settings path: ${settingsPath}`);
    console.log('PASS firstrun');
    app.exit(0);
    return;
  }

  console.log(`FAIL firstrun: ${failures.length} assertion(s) failed`);
  app.exit(1);
}).catch((error) => {
  console.log(`FAIL firstrun: ${error.message}`);
  app.exit(1);
});
