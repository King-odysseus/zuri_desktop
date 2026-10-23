/**
 * tray-menu.js - what the notification-area icon holds.
 *
 * Windows draws this surface, not the renderer, so it is built from Electron's own
 * Tray, Menu and balloon APIs rather than a page that imitates a desktop. This
 * module keeps the menu rows and the wording as plain data, so the shape a person
 * sees can be checked without starting Electron: main.js turns each row into a
 * MenuItem and attaches its handler.
 *
 * Built from open-pencil "Tray menu" (0:13564): the menu with the overlay closed
 * (0:13569), the same menu while the overlay is showing (0:13635), the icon's
 * tooltip (0:13692) and the balloon Windows shows once the window is hidden
 * (0:13684).
 *
 * Three things the design draws have no native form on Windows. A menu item has no
 * second text line, no coloured pill and, on Windows, no icon beside its label, so the
 * header's name and status are two disabled rows, the green "On" chip becomes a
 * checked state on the status row, and the rows carry words without glyphs.
 * The design's menu also prefixes the status with "Autopilot"; Zuri has no single
 * autopilot switch (it is a mode per message), so the line reports the reminder
 * count it can actually stand behind.
 */

/** Hovering the icon names the app, as the design's tooltip does (0:13693). */
export const TRAY_TOOLTIP = 'Zuri';

/** The header's first line (0:13576, 0:13642). */
export const MENU_TITLE = 'Zuri';

/** The green pill beside the header (0:13579, 0:13645). */
export const STATUS_CHIP_LABEL = 'On';

/** The menu's first group, top to bottom (0:13581 to 0:13591). */
export const OPEN_LABEL = 'Open Zuri';
export const NEW_CHAT_LABEL = 'New chat';
export const TOGGLE_OVERLAY_LABEL = 'Toggle overlay';
export const HIDE_OVERLAY_LABEL = 'Hide overlay';
export const QUIT_LABEL = 'Quit';

/**
 * The shortcut hints the design prints at the right of its rows. They are shown,
 * not registered: a tray menu item is not a global shortcut, and the overlay's
 * shortcut belongs to whoever sets it, so `registerAccelerator` stays off in the
 * template built from these.
 */
export const NEW_CHAT_ACCELERATOR = 'Control+N';
export const OVERLAY_ACCELERATOR = 'Super+Space';

/** The balloon's first two lines (0:13689, 0:13690). */
export const BALLOON_TITLE = 'Zuri is running in the background';
export const BALLOON_BODY = 'Right-click the tray icon to open the menu.';

/**
 * Row ids, so main.js attaches a handler per row without matching on a label that
 * can be reworded.
 */
export const TRAY_ITEM_IDS = Object.freeze({
  title: 'tray-title',
  status: 'tray-status',
  open: 'tray-open',
  newChat: 'tray-new-chat',
  overlay: 'tray-toggle-overlay',
  quit: 'tray-quit',
});

/**
 * The header's second line (0:13577, 0:13643). The overlay wins when it is showing,
 * because that is the state a person is most likely to be asking about; otherwise
 * the line counts the reminders waiting, which is what the app is doing while it
 * sits in the notification area.
 * @param {{ overlayOpen?: boolean, remindersDue?: number }} [state]
 * @returns {string}
 */
export function statusText(state = {}) {
  if (state.overlayOpen === true) return 'Overlay showing';

  const count = Number.isFinite(state.remindersDue) ? Math.max(0, Math.round(state.remindersDue)) : 0;
  if (count === 0) return 'No reminders due';
  if (count === 1) return '1 reminder due';
  return `${count} reminders due`;
}

/**
 * The whole menu, as MenuItem options without handlers. Order and grouping are the
 * design's: header, divider, the three things Zuri can be asked to do, divider, Quit.
 * @param {{ overlayOpen?: boolean, remindersDue?: number }} [state]
 * @returns {Array<object>}
 */
export function trayMenuTemplate(state = {}) {
  const overlayOpen = state.overlayOpen === true;

  return [
    { id: TRAY_ITEM_IDS.title, label: MENU_TITLE, enabled: false },
    // The design's chip sits on this row and is drawn as a native check: the one
    // place a menu can say "on" without a coloured pill.
    { id: TRAY_ITEM_IDS.status, label: statusText(state), type: 'checkbox', checked: true, enabled: false },
    { type: 'separator' },
    { id: TRAY_ITEM_IDS.open, label: OPEN_LABEL },
    { id: TRAY_ITEM_IDS.newChat, label: NEW_CHAT_LABEL, accelerator: NEW_CHAT_ACCELERATOR, registerAccelerator: false },
    {
      id: TRAY_ITEM_IDS.overlay,
      label: overlayOpen ? HIDE_OVERLAY_LABEL : TOGGLE_OVERLAY_LABEL,
      // The overlay row carries the design's dot and "On" the same way: checked
      // while the floating card is on screen.
      type: 'checkbox',
      checked: overlayOpen,
      accelerator: OVERLAY_ACCELERATOR,
      registerAccelerator: false,
    },
    { type: 'separator' },
    { id: TRAY_ITEM_IDS.quit, label: QUIT_LABEL },
  ];
}

/**
 * The earliest reminder still to come, so the balloon can say how long the wait is
 * (0:13691). Anything that is not a reading date is skipped rather than throwing.
 * @param {Array<{ dueAt?: unknown }>} [reminders]
 * @returns {string | null} the ISO date closest to now
 */
export function earliestDueAt(reminders) {
  if (!Array.isArray(reminders)) return null;

  let earliest = null;
  for (const reminder of reminders) {
    const at = reminder?.dueAt;
    if (typeof at !== 'string' || at === '') continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) continue;
    if (earliest === null || when.getTime() < earliest.getTime()) earliest = when;
  }
  return earliest === null ? null : earliest.toISOString();
}

/**
 * The balloon's third line (0:13691), written the way the design writes it.
 * @param {unknown} at When the next reminder is due.
 * @param {Date} [now]
 * @returns {string} empty when there is no reminder to wait for
 */
export function nextReminderLine(at, now = new Date()) {
  if (typeof at !== 'string' || at === '') return '';
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';

  const minutes = Math.max(0, Math.round((when.getTime() - now.getTime()) / 60_000));
  if (minutes < 1) return 'Next reminder in under a minute';
  if (minutes < 60) return `Next reminder in ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `Next reminder in ${hours} h` : `Next reminder in ${hours} h ${rest} min`;
}

/**
 * The balloon Windows shows when the window is hidden (0:13684).
 * @param {{ nextReminderAt?: string | null, now?: Date }} [options]
 * @returns {{ title: string, content: string, next: string }}
 */
export function backgroundBalloon(options = {}) {
  return {
    title: BALLOON_TITLE,
    content: BALLOON_BODY,
    next: nextReminderLine(options.nextReminderAt ?? null, options.now ?? new Date()),
  };
}

/**
 * A balloon's text as one string, because Electron takes a single content line.
 * The next-reminder line is left out when there is nothing to wait for, rather than
 * printing a blank one.
 * @param {{ content: string, next?: string }} balloon
 * @returns {string}
 */
export function balloonContent(balloon) {
  const content = typeof balloon?.content === 'string' ? balloon.content : BALLOON_BODY;
  return typeof balloon?.next === 'string' && balloon.next !== '' ? `${content}\n${balloon.next}` : content;
}
