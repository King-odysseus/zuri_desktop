// One attribute on <html> swaps every token, exactly like the desktop app.
const THEME_KEY = 'zuri-theme';

// One browser can hold several Zuri accounts (a shared laptop, a family phone),
// so a choice belongs to an account on this device rather than to the device
// alone. The plain key above stays as the device default: it is what the landing
// page paints before anyone signs in, and what a signed-out visit remembers.
const THEME_USER_PREFIX = 'zuri-theme:user:';

/**
 * The storage key a choice belongs to: this account on this device when there is
 * one, the device default otherwise.
 * @param {string} [userId]
 * @returns {string}
 */
function themeKey(userId) {
  const id = typeof userId === 'string' ? userId.trim() : '';
  return id === '' ? THEME_KEY : `${THEME_USER_PREFIX}${id}`;
}

/**
 * A stored theme, or null when nothing usable is saved there.
 * @param {string} key
 * @returns {'dark' | 'light' | null}
 */
function readThemed(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch (error) {
    // Blocked storage (private mode, third-party cookies off) must not stop the
    // page booting: fall back to the default theme for this visit.
    console.warn('[zuri-cloud] theme preference unavailable', error?.message ?? error);
    return null;
  }
}

/**
 * Saved choice for this account, or light for a first visit.
 *
 * The page opens on paper-white surfaces by default. A dark screen is only ever
 * a choice the reader made with the bar's toggle, so a first visit never lands
 * on the navy canvas. A person who has never chosen on this device starts from
 * whatever the device is set to, which is also what they saw on the landing
 * page, so signing in does not flip the screen under them.
 * @param {string} [userId] The signed-in account, when there is one.
 * @returns {'dark' | 'light'}
 */
export function preferredTheme(userId) {
  return readThemed(themeKey(userId)) ?? readThemed(THEME_KEY) ?? 'light';
}

/** Paint a theme. Remembering the choice is saveTheme's job. @param {'dark' | 'light'} theme */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Remember a choice for this account on this device.
 *
 * A signed-in person's choice is written to their own key only, so the next
 * person to sign in on this browser still finds their own theme. A signed-out
 * visit has no account to belong to, so it updates the device default.
 * @param {'dark' | 'light'} theme
 * @param {string} [userId] The signed-in account, when there is one.
 */
export function saveTheme(theme, userId) {
  try {
    localStorage.setItem(themeKey(userId), theme);
  } catch (error) {
    // The theme still applies to this page; only the memory of it is lost.
    console.warn('[zuri-cloud] theme preference not saved', error?.message ?? error);
  }
}

/** @param {'dark' | 'light'} theme */
export function themeLabel(theme) {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
