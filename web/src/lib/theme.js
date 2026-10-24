// One attribute on <html> swaps every token, exactly like the desktop app.
const THEME_KEY = 'zuri-theme';

/** @returns {'dark' | 'light'} */
export function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

/** @param {'dark' | 'light'} theme */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

/** @param {'dark' | 'light'} theme */
export function themeLabel(theme) {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
