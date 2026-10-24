// One attribute on <html> swaps every token, exactly like the desktop app.
const THEME_KEY = 'zuri-theme';

/**
 * Saved choice, or dark for a first visit.
 * @returns {'dark' | 'light'}
 */
export function preferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  } catch (error) {
    // Blocked storage (private mode, third-party cookies off) must not stop the
    // page booting: fall back to the default theme for this visit.
    console.warn('[zuri-cloud] theme preference unavailable', error?.message ?? error);
    return 'dark';
  }
}

/** @param {'dark' | 'light'} theme */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    // The theme still applies to this page; only the memory of it is lost.
    console.warn('[zuri-cloud] theme preference not saved', error?.message ?? error);
  }
}

/** @param {'dark' | 'light'} theme */
export function themeLabel(theme) {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
