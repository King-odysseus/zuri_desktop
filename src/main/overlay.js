/**
 * overlay.js - the floating quick-ask window.
 *
 * The brief asks for a way to talk to Zuri while working in another Windows
 * application, so the overlay is a second, small BrowserWindow pinned above every
 * other window rather than a panel inside the main one (decision 15: a panel in the
 * main renderer disappears the moment the main window loses focus).
 *
 * One window per app, created lazily: `openOverlay()` on launch when the
 * `overlayEnabled` setting is on, and again if the person turns it on later.
 * Escape hides it, and it is destroyed with the main window so closing Zuri still
 * quits (main.js quits on `window-all-closed`).
 */

import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM main process (package.json sets "type": "module"), so __dirname is built here.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** The overlay reuses the built React entry until a dedicated compact route exists. */
export const OVERLAY_ENTRY = path.join(moduleDir, '..', '..', 'dist-react', 'index.html');
const PRELOAD_ENTRY = path.join(moduleDir, 'preload.js');
const ICON_ENTRY = path.join(moduleDir, 'assets', 'zuri-icon.png');

// The overlay opens large enough to show a short exchange, then remains freely
// resizable so people can keep the conversation visible while they work.
const CARD_WIDTH = 620;
const CARD_HEIGHT = 280;
const MIN_CARD_WIDTH = 420;
const MIN_CARD_HEIGHT = 180;

// Space around the card inside the window, matching the padding .zuri-overlay-root
// gives the card in app.css, so the card keeps the design size.
//
// The card's soft shadow is painted by CSS, and CSS cannot draw outside its own
// window, so this margin is the shadow's room. Too small and the blur is sliced off
// at the window edge, which reads as a grey box with sharp corners behind a round
// card. 40 leaves room to spare for the shadow in app.css: an 8px offset plus a 28px
// blur reaches 36px, so the fade finishes inside the window instead of being cut off
// along a straight line.
const MARGIN = 40;

const WIDTH = CARD_WIDTH + MARGIN * 2;
const HEIGHT = CARD_HEIGHT + MARGIN * 2;

/** @type {BrowserWindow | null} */
let overlayWindow = null;

/**
 * The work area Electron reports for the display the pointer is on, falling back to
 * the primary display. `workArea` rather than `bounds` so the overlay never lands
 * under the Windows taskbar.
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function targetWorkArea() {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point) ?? screen.getPrimaryDisplay();
  return display.workArea;
}

/**
 * Where the card sits: top right of that display's work area, the corner people
 * expect a floating assistant in and the one furthest from the taskbar. One margin
 * in from both edges keeps the card's shadow off the screen edge.
 * @returns {{ x: number, y: number }}
 */
function overlayPosition() {
  const area = targetWorkArea();
  return {
    x: Math.round(area.x + area.width - WIDTH - MARGIN),
    y: Math.round(area.y + MARGIN),
  };
}

/**
 * Whether the overlay window exists and has not been destroyed.
 * @returns {boolean}
 */
export function isOverlayOpen() {
  return overlayWindow !== null && !overlayWindow.isDestroyed();
}

/**
 * Build the overlay window. Split from openOverlay() so the "already open" check
 * lives in one place.
 * @returns {BrowserWindow}
 */
function createOverlayWindow() {
  const { x, y } = overlayPosition();
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: MIN_CARD_WIDTH + MARGIN * 2,
    minHeight: MIN_CARD_HEIGHT + MARGIN * 2,
    x,
    y,
    show: false,
    // A frameless card: the page draws its own rounded surface, title and close.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // The OS shadow is a rectangle painted behind a transparent window, so on a round
    // card it shows as straight edges and square corners outside the CSS shadow. The
    // card paints its own soft shadow (see .zuri-overlay-panel), so this is off.
    hasShadow: false,
    resizable: true,
    // Dragging happens through the card's header (-webkit-app-region: drag).
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // Above other applications' windows, which is the whole point of the overlay.
    alwaysOnTop: true,
    // A quick-ask card is not a task: leaving it out of the taskbar keeps Alt+Tab for
    // the main window and the work it is floating over.
    skipTaskbar: true,
    title: 'Zuri quick ask',
    icon: ICON_ENTRY,
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.ZURI_DEVTOOLS === '1',
    },
  });

  // The level keeps it above normal windows even when they take focus.
  window.setAlwaysOnTop(true, 'floating');
  window.loadFile(OVERLAY_ENTRY, { search: '?overlay=1' });

  // Shown on ready-to-show rather than immediately, so the first frame the person
  // sees is the painted card and not an empty transparent rectangle.
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  // Escape dismisses the overlay without a round trip through the renderer: the
  // person is mid-task elsewhere and expects the card to go away at once.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    hideOverlay();
  });

  window.on('closed', () => {
    overlayWindow = null;
  });

  return window;
}

/**
 * Show the overlay, creating it the first time. An overlay that already exists is
 * brought forward instead of being replaced, so an unfinished question survives the
 * window being hidden or hidden behind.
 * @returns {BrowserWindow}
 */
export function openOverlay() {
  if (isOverlayOpen()) {
    overlayWindow.show();
    overlayWindow.focus();
    return overlayWindow;
  }

  overlayWindow = createOverlayWindow();
  return overlayWindow;
}

/**
 * Hide the overlay but keep it, so the next open is instant and keeps its text.
 * @returns {void}
 */
export function hideOverlay() {
  if (!isOverlayOpen()) return;
  overlayWindow.hide();
}

/**
 * Destroy the overlay. Used when the setting is switched off and when the main
 * window closes, so no window outlives the app's main screen.
 * @returns {void}
 */
export function closeOverlay() {
  if (!isOverlayOpen()) return;
  overlayWindow.destroy();
  overlayWindow = null;
}

/**
 * Show or hide the overlay to match a stored setting. This is the single place the
 * `overlayEnabled` flag turns into a window, so launch and the Settings toggle
 * behave the same.
 * @param {unknown} enabled
 * @returns {void}
 */
export function setOverlayEnabled(enabled) {
  if (enabled === true) openOverlay();
  else closeOverlay();
}

/**
 * Apply the stored setting on launch: read once, open once. Anything other than a
 * literal `true` leaves the overlay closed, so a settings.json written by an older
 * build cannot open a window the person never asked for.
 * @param {{ overlayEnabled?: unknown } | null} [settings]
 * @returns {void}
 */
export function startOverlayFromSettings(settings) {
  setOverlayEnabled(settings?.overlayEnabled === true);
}
