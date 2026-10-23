/**
 * Second launch (open-pencil 0:13705).
 *
 * Zuri is one window and one process. A launch that finds Zuri already running hands
 * its request over and leaves, so the only job left here is bringing the window that
 * is already open back to the front: out of the taskbar if it was minimised, out of
 * the tray if it was hidden, then focused. Nothing is rebuilt, so the thread the user
 * was reading is still open when the window comes back.
 */

/**
 * Bring an existing window to the front, as the four states of 0:13705 draw it.
 * Kept free of Electron imports so scripts/selftest.js can drive it with a plain
 * object and assert the order of the calls.
 * @param {{ isDestroyed?: () => boolean, isMinimized: () => boolean, restore: () => void, show: () => void, focus: () => void } | null | undefined} window
 * @returns {boolean} whether a window was brought forward
 */
export function bringToFront(window) {
  if (window === null || window === undefined) return false;
  // A window that is already gone is not brought forward: calling into it would throw
  // and the launch that handed over would report a crash that never happened.
  if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return false;

  // Order matters. A minimised window has to leave the taskbar before focus means
  // anything, and a window the tray hid has to be shown or the focus lands on nothing.
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}
