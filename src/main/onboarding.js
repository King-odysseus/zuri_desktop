/**
 * onboarding.js - the main-process half of the first-run setup card.
 *
 * The card asks two things (name and theme) and offers a Zuri account; a provider
 * key is now an optional extra that only Settings collects. This module is the one
 * place that turns those answers into stored state, so the window and
 * scripts/firstrun.js run the same code: `zuri:onboarding:complete` calls
 * runOnboardingSetup, and so does the headless check.
 *
 * It answers in the store's `{ ok, data | error }` shape so the IPC handler can
 * hand main's answer straight to the renderer without reshaping it. The key goes
 * to secrets.js and comes back as a boolean, never as the key itself.
 */
import { resolveStorePath, saveSettings } from './store.js';
import { DEFAULT_PROVIDER, setKey } from './secrets.js';

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

  // A key is optional: the first-run card now signs people into their Zuri account
  // instead of asking for a provider key, and an account carries the plan. setKey
  // refuses an empty string, so an absent key means there is nothing to store
  // rather than a failure.
  const key = typeof payload?.key === 'string' ? payload.key.trim() : '';
  const provider =
    typeof payload?.provider === 'string' && payload.provider.trim() !== ''
      ? payload.provider.trim()
      : DEFAULT_PROVIDER;
  const storedKey =
    key === '' ? { ok: true, data: { provider, hasKey: false } } : await setKey(provider, key);
  if (storedKey.ok !== true) return storedKey;

  return {
    ok: true,
    data: {
      name,
      theme,
      provider: storedKey.data.provider,
      hasKey: storedKey.data.hasKey === true,
      settingsPath: resolveStorePath('settings'),
    },
  };
}
