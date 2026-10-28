/**
 * onboarding.js - the main-process half of the first-run setup card.
 *
 * The card asks two things (name and theme) and offers a Zuri account. This module is the one
 * place that turns those answers into stored state, so the window and
 * scripts/firstrun.js run the same code: `zuri:onboarding:complete` calls
 * runOnboardingSetup, and so does the headless check.
 *
 * It answers in the store's `{ ok, data | error }` shape so the IPC handler can
 * hand main's answer straight to the renderer without reshaping it.
 */
import { resolveStorePath, saveSettings } from './store.js';

/** Long enough for a full name, short enough to stay one line in the top bar. */
export const SETUP_NAME_MAX_LENGTH = 60;

const THEMES = new Set(['light', 'dark']);

/** @param {string} code @param {string} message */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Validate the answers, store the name and theme, then store the key when one came.
 *
 * Settings are written before the key on purpose: a rejected key is the failure a
 * person can fix by retyping, and keeping the name and theme they already chose
 * means the retry only has to deal with the key.
 * @param {{ name?: string, theme?: string, provider?: string, key?: string, model?: string }} [payload]
 * @returns {Promise<{ ok: true, data: { name: string, theme: string, provider: string, hasKey: boolean, settingsPath: string } }
 *   | { ok: false, error: { code: string, message: string } }>}
 */
export async function runOnboardingSetup(payload = {}) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (name === '') {
    return failure('SETUP_NAME_REQUIRED', 'Add your name so Zuri knows what to call you.');
  }
  if (name.length > SETUP_NAME_MAX_LENGTH) {
    return failure(
      'SETUP_NAME_TOO_LONG',
      `Keep your name to ${SETUP_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }

  const theme = typeof payload?.theme === 'string' ? payload.theme.trim().toLowerCase() : '';
  if (!THEMES.has(theme)) {
    return failure('SETUP_INVALID_THEME', "theme must be 'light' or 'dark'");
  }

  // The model comes from the card's picker and is optional: the store's own default
  // applies when a caller (or the headless check) leaves it out.
  const model = typeof payload?.model === 'string' ? payload.model.trim() : '';

  const settings = await saveSettings({ name, theme, ...(model === '' ? {} : { model }) });
  if (settings.ok !== true) return settings;

  return {
    ok: true,
    data: {
      name,
      theme,
      provider: 'zuri-cloud',
      hasKey: false,
      settingsPath: resolveStorePath('settings'),
    },
  };
}
