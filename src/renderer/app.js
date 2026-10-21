/**
 * Renderer entry. Sets the theme from <html data-theme>, starts the three-column
 * shell, restores the stored chats and marks the document ready. It must stay
 * silent: any console output during load fails smoke.
 */

import { initChats } from './ui/chats.js';
import { initContextPanel } from './ui/contextPanel.js';
import { initRouter } from './ui/router.js';
import { fillSidebarUser, initShell } from './ui/shell.js';
import { initTopbar, readSettings } from './ui/topbar.js';

const LIGHT_THEME = 'light';
const DARK_THEME = 'dark';

/**
 * Set the theme the token layer reads from <html data-theme>.
 * Dark is the default until settings are read, so an unknown value falls back to it
 * rather than leaving the document without a theme.
 * @param {string} theme
 */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
}

// index.html ships data-theme="dark" so the first frame is the design's default.
applyTheme(document.documentElement.dataset.theme);

// Read settings once, before anything is built, and apply the stored theme to the
// document: every element the user sees is painted after this point, so the app
// never shows the default theme over a light-theme choice.
const settings = await readSettings();
applyTheme(settings.theme);

initTopbar({ settings });
initShell();
// The sidebar's account row shows the same saved name as the top bar's avatar.
fillSidebarUser(settings.name);
// Awaited so the sidebar and transcript are painted before the page reports ready:
// the thread list is the first thing the user sees, and a check that reads the page
// must not catch it half drawn.
await initChats();
// The Context panel's detected-files card, filled from main once the thread list is
// up. Not awaited: the panel is a summary beside the conversation, and a slow disk
// read must not hold the page's ready mark.
void initContextPanel();
// The central column's router, started after the chats so the Chat view it points
// at already has its thread list. Every sidebar destination now opens a view.
initRouter();
document.documentElement.dataset.appReady = 'true';
