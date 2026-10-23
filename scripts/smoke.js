/**
 * Smoke: boots the real main process, waits for the main window, and checks the
 * shell and renderer are healthy with no console errors. Run via `npm run smoke`
 * (electron scripts/smoke.js), because it needs Electron's APIs.
 */

import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/main/main.js';
import { ICON_ENTRY } from '../src/main/main.js';
import { setStoreRoot } from '../src/main/store.js';
import { setWorkspaceRoot } from '../src/main/tools/index.js';
import {
  captureConsoleErrors,
  createReporter,
  reloadAndWait,
  useScratchProfile,
  waitForFirstWindow,
  waitForLoad,
} from './lib/app-launch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_ENTRY = path.join(root, 'src', 'renderer', 'index.html');
const SETTINGS_ENTRY = path.join(root, 'src', 'renderer', 'views', 'settings.html');
const FILES_ENTRY = path.join(root, 'src', 'renderer', 'views', 'files.html');
const ONBOARDING_ENTRY = path.join(root, 'src', 'renderer', 'views', 'onboarding.html');
const SIGNIN_ENTRY = path.join(root, 'src', 'renderer', 'views', 'sign-in.html');
const SIGNUP_ENTRY = path.join(root, 'src', 'renderer', 'views', 'sign-up.html');
const FORGOT_ENTRY = path.join(root, 'src', 'renderer', 'views', 'forgot-password.html');
const RESET_ENTRY = path.join(root, 'src', 'renderer', 'views', 'reset-password.html');
const REMINDER_DIALOG_ENTRY = path.join(root, 'src', 'renderer', 'views', 'reminder-dialog.html');
const AUTOMATION_DIALOG_ENTRY = path.join(root, 'src', 'renderer', 'views', 'automation-dialog.html');
const TASK_DIALOG_ENTRY = path.join(root, 'src', 'renderer', 'views', 'task-dialog.html');
const PRELOAD_ENTRY = path.join(root, 'src', 'main', 'preload.js');

const report = createReporter();
// This run gets its own Electron profile before the app is ready. The app pins its
// name, so the default profile is shared with every other run on the machine and
// overlapping runs stall each other on the same cache and profile locks.
useScratchProfile();
// Registered before the app is ready, so load-time messages are captured.
const consoleCapture = captureConsoleErrors();

// A guard against a hung run, not a speed budget: the suite opens and measures two
// dozen pages, and on a machine running other agents it has taken over a minute.
// The number is high enough that only a real hang reaches it.
const hardStop = setTimeout(() => {
  console.log('FAIL smoke: app did not settle within 180 s');
  app.exit(1);
}, 180000);

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resize the window and wait until the page has actually laid out at that frame.
 *
 * setContentSize applies the window size at once, but the renderer reflows on its
 * next frame. A fixed sleep after the call raced under load: the shell check once
 * measured a 606 px chat column because the page was still 1200 px wide when it
 * read the layout. Poll the page's own width instead of guessing at a delay.
 * @param {Electron.BrowserWindow} window
 * @param {number} width
 * @param {number} height
 */
async function resizeAndSettle(window, width, height) {
  window.setContentSize(width, height);
  for (let tick = 0; tick < 60; tick += 1) {
    const size = await window.webContents.executeJavaScript(
      '({ width: window.innerWidth, height: window.innerHeight })',
    );
    // innerWidth is the layout width: the window's frame and scrollbar are already out of it.
    if (size.width === width && size.height === height) return;
    await wait(50);
  }
  // The frame may be too large for this display and be clamped by the OS. The
  // checks below then report the real numbers rather than a timeout.
}

/**
 * Measure the dropdowns in one page.
 *
 * A native <select> hands its open list to Windows, and that popup is painted
 * outside the page: no stylesheet reaches it and no query can see it. The failure
 * worth measuring is therefore a select still drawing its own box. Each one must
 * be hidden behind a drawn `.select-trigger` (a button reading the chosen option
 * and reporting itself as one combobox), and a press on that control must open a
 * `.select-menu` element inside the page, laid over the control.
 *
 * The selector narrows the sweep to the view on screen. The shell keeps every view
 * it has visited in the document and hides the inactive ones, and a hidden view's
 * controls measure 0 wide, so a sweep of the whole document would report the Chat
 * view's composer chip as broken while Settings is open.
 * @param {Electron.BrowserWindow} window
 * @param {string} [selector] Scope for the sweep; every select in the page by default.
 * @returns {Promise<object>}
 */
async function measureDropdowns(window, selector = 'select') {
  return window.webContents.executeJavaScript(`(async () => {
    // Two frames let the menu paint before it is measured. Chromium throttles
    // animation frames when the window is occluded, and this run leaves other
    // windows open, so the wait falls back to a timer rather than hanging: the
    // checks below read geometry, and a throttled frame never arrives.
    const frame = () => new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(done));
      setTimeout(done, 250);
    });
    const text = (element) => (element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const selects = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));

    const controls = selects.map((select) => {
      const trigger = select.previousElementSibling;
      const chosen = select.options[select.selectedIndex] ?? null;
      const triggerBox = trigger?.getBoundingClientRect() ?? null;
      return {
        id: select.id,
        options: select.options.length,
        selectDisplay: getComputedStyle(select).display,
        hasTrigger: trigger?.classList.contains('select-trigger') === true,
        triggerTag: trigger?.tagName ?? '',
        triggerWidth: Math.round(triggerBox?.width ?? 0),
        // A view that the router is not showing still leaves its markup in the
        // document. A dropdown with no pixels cannot open anything, so it is not
        // measured: only the ones the page paints can hand a list to Windows.
        painted: triggerBox !== null && triggerBox.width > 0 && triggerBox.height > 0,
        triggerText: text(trigger),
        chosenText: text(chosen),
        role: trigger?.getAttribute('role') ?? '',
      };
    });
    const painted = controls.filter((control) => control.painted);

    // Read the list the first painted dropdown draws. elementFromPoint proves the
    // page paints it: a system popup is not in the document, so nothing would answer.
    const trigger = painted.length > 0 ? selects[controls.indexOf(painted[0])].previousElementSibling : null;
    let opened = { drawn: false, rows: 0 };
    if (trigger) {
      trigger.click();
      await frame();
      const menu = document.querySelector('.select-menu');
      const box = menu?.getBoundingClientRect() ?? null;
      const controlBox = trigger.getBoundingClientRect();
      opened = {
        drawn: menu !== null,
        rows: menu ? menu.querySelectorAll('.select-menu-option').length : 0,
        position: menu ? getComputedStyle(menu).position : '',
        inDocument: menu ? document.body.contains(menu) : false,
        overlapsControl: box
          ? box.left < controlBox.right && box.right > controlBox.left &&
            box.top < controlBox.bottom + 8 && box.bottom > controlBox.top
          : false,
        hitTest: box
          ? menu.contains(document.elementFromPoint(box.left + Math.min(box.width / 2, 20), box.top + 8))
          : false,
        // A control near the bottom of the window opens its list above itself, so
        // anchoring has to hold on either side of the control, not only below it.
        // ui/select.js ends such a list on the control's bottom edge rather than on
        // its top, so the chip is covered instead of left showing under the panel;
        // that is the third case, and it still counts as anchored to this control.
        anchored: box
          ? box.left < controlBox.right && box.right > controlBox.left &&
            ((box.top >= controlBox.bottom - 12 && box.top <= controlBox.bottom + 12) ||
              (box.bottom <= controlBox.top + 12 && box.bottom >= controlBox.top - 12) ||
              (box.top < controlBox.top &&
                box.bottom >= controlBox.bottom - 12 &&
                box.bottom <= controlBox.bottom + 12))
          : false,
        box: box ? [box.left, box.top, box.right, box.bottom].map(Math.round) : [],
        controlBox: [controlBox.left, controlBox.top, controlBox.right, controlBox.bottom].map(Math.round),
        expanded: trigger.getAttribute('aria-expanded'),
      };
      trigger.click();
      await frame();
      opened.leftOpen = document.querySelectorAll('.select-menu').length;
    }

    return {
      page: location.pathname.split('/').pop(),
      count: painted.length,
      controls: painted,
      opened,
      // A select with pixels of its own would still open the OS popup.
      undrawn: painted.filter((control) => control.selectDisplay !== 'none' || !control.hasTrigger).map((control) => control.id),
    };
  })()`);
}

/**
 * @param {string} label
 * @param {object} run
 */
function checkDropdowns(label, run) {
  report.check(`${label}: every dropdown is drawn, none opens a system popup`, () => {
    if (run.count === 0) throw new Error('the page has no <select> to measure');
    if (run.undrawn.length > 0) {
      throw new Error(`these selects still draw their own box: ${run.undrawn.join(', ')}`);
    }
    const wrong = run.controls.filter(
      (control) =>
        control.triggerTag !== 'BUTTON' ||
        control.triggerWidth === 0 ||
        control.role !== 'combobox' ||
        control.triggerText !== control.chosenText,
    );
    if (wrong.length > 0) {
      throw new Error(`${wrong.map((control) => control.id).join(', ')} do not read as one combobox holding the chosen option`);
    }
    if (!run.opened.drawn) throw new Error('the control opened no .select-menu');
    if (run.opened.rows !== run.controls[0].options) {
      throw new Error(`the menu drew ${run.opened.rows} rows for ${run.controls[0].options} options`);
    }
    if (run.opened.position !== 'fixed') throw new Error(`the menu is ${run.opened.position}, so a panel can clip it`);
    if (!run.opened.inDocument || !run.opened.anchored || !run.opened.hitTest) {
      throw new Error(
        `the open list is not the element the page paints over the control ` +
          `(inDocument ${run.opened.inDocument}, anchored ${run.opened.anchored}, ` +
          `hitTest ${run.opened.hitTest}, list ${JSON.stringify(run.opened.box)}, ` +
          `control ${JSON.stringify(run.opened.controlBox)})`,
      );
    }
    if (run.opened.expanded !== 'true') throw new Error('aria-expanded did not follow the open list');
    if (run.opened.leftOpen !== 0) throw new Error('the list stayed open after a second press');
    return `${run.count} select(s) ${run.controls.map((control) => control.id).join(', ')}, ${run.opened.rows}-row list at position ${run.opened.position}`;
  });
}

app.whenReady().then(async () => {
  const window = await waitForFirstWindow();
  await waitForLoad(window);

  // app.js marks the document ready only after its first round-trip to main, so
  // did-finish-load can arrive first. Poll briefly instead of reading the page
  // halfway through initialization.
  for (let tick = 0; tick < 50; tick += 1) {
    const ready = await window.webContents.executeJavaScript(
      `document.documentElement.dataset.appReady ?? ''`,
    );
    if (ready === 'true') break;
    await wait(100);
  }

  const bounds = window.getBounds();
  report.check(
    'window opens at 1200x800',
    () => `${bounds.width}x${bounds.height}`,
  );

  report.check('exactly one window is open', () => {
    const count = BrowserWindow.getAllWindows().length;
    if (count !== 1) throw new Error(`expected 1 window, found ${count}`);
    return `${count} window`;
  });

  report.check('window loads src/renderer/index.html', () => {
    const loadedPath = new URL(window.webContents.getURL()).pathname;
    const normalise = (value) => value.replace(/^\//, '').replace(/\//g, path.sep).toLowerCase();
    if (normalise(loadedPath) !== EXPECTED_ENTRY.replace(/\//g, path.sep).toLowerCase()) {
      throw new Error(`loaded ${window.webContents.getURL()}`);
    }
    return window.webContents.getURL();
  });

  const pageState = await window.webContents.executeJavaScript(`(() => ({
    ready: document.documentElement.dataset.appReady ?? '',
    theme: document.documentElement.dataset.theme ?? '',
    hasRequire: typeof require !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    tokensLoaded: getComputedStyle(document.documentElement).getPropertyValue('--zuri-bg-canvas').trim(),
    viewportWidth: window.innerWidth,
    columns: ['sidebar', 'chat', 'context-panel'].map((id) => {
      const element = document.getElementById(id);
      return {
        id,
        tag: element?.tagName ?? '',
        collapsed: element?.dataset.collapsed ?? '',
        width: Math.round(element?.getBoundingClientRect().width ?? 0),
      };
    }),
    toggles: Array.from(document.querySelectorAll('.shell-toggle')).map((button) => button.getAttribute('aria-controls')),
  }))()`);

  /** @param {string} name */
  const columnNamed = (name) => pageState.columns.find((column) => column.id === name);

  report.check('the shell is aside#sidebar, main#chat and aside#context-panel', () => {
    const expectedTags = { sidebar: 'ASIDE', chat: 'MAIN', 'context-panel': 'ASIDE' };
    const wrong = pageState.columns.filter((column) => column.tag !== expectedTags[column.id]);
    if (wrong.length > 0) {
      throw new Error(wrong.map((column) => `#${column.id} is ${column.tag || 'missing'}`).join(', '));
    }
    return pageState.columns.map((column) => `${column.tag.toLowerCase()}#${column.id} ${column.width}px`).join(', ');
  });

  // The two side panels collapse; #chat does not. Collapsing the conversation used to
  // leave a 12 px sliver that the column's own overflow clipped away, so there was no
  // way back and the two panels took the window while the rest sat empty.
  report.check('the two side panels have a collapse toggle and the chat cannot collapse', () => {
    const missing = ['sidebar', 'context-panel'].filter((name) => !pageState.toggles.includes(name));
    if (missing.length > 0) throw new Error(`no .shell-toggle for ${missing.join(', ')}`);
    if (pageState.toggles.includes('chat')) {
      throw new Error('the chat column still offers a collapse toggle, which cannot be undone');
    }
    return pageState.toggles.join(', ');
  });

  // The state has to live in ui/shell.js, not only in the DOM: import the module
  // the page already loaded, click the toggle, and read both back.
  const toggleRun = await window.webContents.executeJavaScript(`(async () => {
    const shell = await import('./ui/shell.js');
    const column = document.getElementById('sidebar');
    const toggle = document.querySelector('.shell-toggle[aria-controls="sidebar"]');
    const read = () => ({
      state: shell.isColumnCollapsed('sidebar'),
      attribute: column.dataset.collapsed,
      width: Math.round(column.getBoundingClientRect().width),
    });

    const before = read();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = { ...read(), expanded: toggle.getAttribute('aria-expanded'), label: toggle.getAttribute('aria-label') };
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restored = read();

    return { before, after, restored, hasApi: typeof shell.setColumnCollapsed === 'function' };
  })()`);

  report.check('a toggle collapses its column and ui/shell.js keeps the state', () => {
    if (!toggleRun.hasApi) throw new Error('ui/shell.js does not export setColumnCollapsed');
    if (toggleRun.before.state !== false) throw new Error('the sidebar did not start expanded');
    if (toggleRun.after.state !== true || toggleRun.after.attribute !== 'true') {
      throw new Error(`module says ${toggleRun.after.state}, DOM says ${toggleRun.after.attribute}`);
    }
    if (toggleRun.after.width >= toggleRun.before.width) {
      throw new Error(`the column did not shrink: ${toggleRun.before.width}px -> ${toggleRun.after.width}px`);
    }
    if (toggleRun.after.expanded !== 'false' || !/^Expand sidebar$/.test(toggleRun.after.label ?? '')) {
      throw new Error(`the toggle still reads "${toggleRun.after.label}" with aria-expanded ${toggleRun.after.expanded}`);
    }
    if (toggleRun.restored.state !== false || toggleRun.restored.width !== toggleRun.before.width) {
      throw new Error('clicking again did not restore the column');
    }
    return `${toggleRun.before.width}px -> ${toggleRun.after.width}px -> ${toggleRun.restored.width}px`;
  });

  report.check('the context panel starts expanded on a 1200px window', () => {
    const panel = columnNamed('context-panel');
    if (pageState.viewportWidth < 1000) throw new Error(`the window opened at ${pageState.viewportWidth}px`);
    if (panel.collapsed !== 'false') throw new Error(`data-collapsed is ${panel.collapsed}`);
    return `${pageState.viewportWidth}px wide, panel ${panel.width}px`;
  });

  // The sidebar list draws node 0:1075's nav: eight 34 px rows 8 px apart, headed by
  // the New chat action and ending in Settings, with the count badge the node draws
  // on the Chats row (0:1151, 22 x 16 on a pill). The rows are measured in the live
  // page because the design draws the list, not the markup that happens to hold it.
  const navRun = await window.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('#sidebar-nav .nav-sidebar-row'));
    const boxOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const count = document.getElementById('sidebar-chats-count');
    return {
      rows: rows.map(boxOf),
      labels: rows.map((row) => row.querySelector('.nav-sidebar-row-label')?.textContent?.trim() ?? ''),
      gap: rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom) : -1,
      count: count ? { ...boxOf(count), corner: getComputedStyle(count).borderRadius } : null,
    };
  })()`);

  report.check('the Sidebar conversation list draws node 0:1075', () => {
    const expected = ['New chat', 'Chats', 'Agents', 'Tasks', 'Reminders', 'Automations', 'Files', 'Settings'];
    if (navRun.labels.join(',') !== expected.join(',')) {
      throw new Error(`the nav reads ${navRun.labels.join(', ')}; the node draws ${expected.join(', ')}`);
    }
    const wrong = navRun.rows.filter((row) => Math.abs(row.height - 34) > 0.6);
    if (wrong.length > 0) throw new Error(`${wrong.length} nav row(s) are not 34 px tall`);
    if (Math.abs(navRun.gap - 8) > 0.6) throw new Error(`the rows are ${navRun.gap}px apart, the sidebar uses 8`);
    if (!navRun.count) throw new Error('the Chats row has no count badge');
    if (Math.abs(navRun.count.height - 16) > 0.6 || navRun.count.width < 22) {
      throw new Error(`the count badge is ${navRun.count.width}x${navRun.count.height}, the node draws 22x16`);
    }
    return `${navRun.rows.length} rows 34 px tall 8 px apart, badge ${navRun.count.width}x${navRun.count.height}`;
  });

  report.check('renderer module ran without error', () => {
    if (pageState.ready !== 'true') throw new Error('app.js did not mark the document ready');
  });

  report.check('design tokens are applied', () => {
    if (pageState.tokensLoaded === '') throw new Error('--zuri-bg-canvas is empty');
    return `theme=${pageState.theme} canvas=${pageState.tokensLoaded}`;
  });

  // The logo, in both places it shows: the window/taskbar icon Electron paints, and
  // the favicon every page declares. Without them the app carries Electron's default
  // logo, which is what a missing or unreadable file looks like from the outside.
  const faviconRun = await window.webContents.executeJavaScript(`(async () => {
    const link = document.querySelector('link[rel="icon"]');
    const href = link?.getAttribute('href') ?? '';
    if (href === '') return { href: '', resolved: '', image: null };

    const resolved = new URL(href, location.href).href;
    // Ask the browser to paint it: a malformed SVG parses as a file but still fails here.
    const image = await new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve({ ok: true, width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve({ ok: false, width: 0, height: 0 });
      probe.src = resolved;
    });
    return { href, resolved, image };
  })()`);

  report.check('the window icon is an image Electron can load', () => {
    const icon = nativeImage.createFromPath(ICON_ENTRY);
    if (icon.isEmpty()) throw new Error(`no readable window icon at ${ICON_ENTRY}`);
    const { width, height } = icon.getSize();
    // Windows asks for 16 to 256 px out of this file; a small source would blur the taskbar.
    if (width < 256 || height < 256) {
      throw new Error(`the window icon is ${width}x${height}, too small for the taskbar`);
    }
    return `${path.basename(ICON_ENTRY)} at ${width}x${height}`;
  });

  report.check('the shell page draws the Zuri mark as its favicon', () => {
    if (faviconRun.href === '') throw new Error('the page has no <link rel="icon">');
    if (faviconRun.image?.ok !== true) {
      throw new Error(`the browser could not draw ${faviconRun.resolved}`);
    }
    return `${faviconRun.href} at ${faviconRun.image.width}x${faviconRun.image.height}`;
  });

  // Every page, not only the one under test: a view with a broken href would fall back
  // to a blank tab icon, and nothing else in the suite opens all of them.
  report.check('every page points its favicon at the same mark', () => {
    const pages = [path.join(root, 'src', 'renderer', 'index.html')];
    const viewsDir = path.join(root, 'src', 'renderer', 'views');
    for (const name of fs.readdirSync(viewsDir)) {
      if (name.endsWith('.html')) pages.push(path.join(viewsDir, name));
    }

    const wrong = [];
    for (const page of pages) {
      const html = fs.readFileSync(page, 'utf8');
      const match = /<link rel="icon"[^>]*href="([^"]+)"/.exec(html);
      if (!match) {
        wrong.push(`${path.basename(page)} declares none`);
        continue;
      }
      // path.resolve reads the forward slashes an href uses on every platform.
      if (!fs.existsSync(path.resolve(path.dirname(page), match[1]))) {
        wrong.push(`${path.basename(page)} points at ${match[1]}, which is missing`);
      }
    }
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return `${pages.length} page(s) share one mark`;
  });

  report.check('renderer has no Node globals', () => {
    if (pageState.hasRequire || pageState.hasProcess) {
      throw new Error('require or process is visible to the renderer');
    }
  });

  // The composer's model chip is the dropdown every screen with a composer gets, so
  // it is the one measured here: a native select would open the pale Windows menu.
  checkDropdowns('the composer', await measureDropdowns(window));

  // The providers key form is the one dropdown a view builds instead of markup, so it
  // is the easiest to leave native and hand its list to Windows. Open Settings, open
  // that panel, measure it, then put the shell back on Chats for the checks below.
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-sidebar-row[data-route="settings"]').click();
    document.getElementById('settings-ov-row-providers').click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return true;
  })()`);
  checkDropdowns('the Settings providers panel', await measureDropdowns(window, '#view-settings select'));
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav-sidebar-row[data-route="chats"]').click();
    return true;
  })()`);

  // The bridge is the only route to main, so check it from inside the page:
  // a declared channel must round-trip, an undeclared one must never leave.
  const bridge = await window.webContents.executeJavaScript(`(async () => {
    const api = window.zuri;
    if (!api) return { present: false };

    const channels = Array.isArray(api.channels) ? api.channels.slice() : [];
    const mainChannels = await api.app.channels();
    const info = await api.app.info();

    let unlistedError = '';
    try {
      await api.invoke('not:a:channel');
    } catch (error) {
      unlistedError = String(error?.message ?? error);
    }

    return {
      present: true,
      channels,
      mainChannels,
      info,
      unlistedError,
      hasNamespaces: typeof api.app?.info === 'function' && typeof api.app?.channels === 'function',
    };
  })()`);

  report.check('preload bridge exposes window.zuri with its channel list', () => {
    if (!bridge.present) throw new Error('window.zuri is undefined');
    if (!Array.isArray(bridge.channels) || bridge.channels.length === 0) {
      throw new Error('window.zuri.channels is empty');
    }
    if (!bridge.hasNamespaces) throw new Error('window.zuri.app.info/channels are missing');
    return bridge.channels.join(', ');
  });

  report.check('a declared channel round-trips to main', () => {
    if (bridge.info?.name !== 'Zuri') throw new Error(`unexpected app info: ${JSON.stringify(bridge.info)}`);
    return `${bridge.info.name} ${bridge.info.version}`;
  });

  report.check('main registers exactly the channels the bridge exposes', () => {
    const exposed = [...bridge.channels].sort();
    const handled = [...bridge.mainChannels].sort();
    if (exposed.join('|') !== handled.join('|')) {
      throw new Error(`bridge: ${exposed.join(', ')} / main: ${handled.join(', ')}`);
    }
    return `${handled.length} channels`;
  });

  report.check('an unlisted channel is rejected before reaching main', () => {
    if (!bridge.unlistedError.includes('Unknown IPC channel')) {
      throw new Error(`no rejection: ${bridge.unlistedError || 'call resolved'}`);
    }
    return bridge.unlistedError;
  });

  /**
   * Read the collapse state of every column from inside the page, plus the shell's own
   * box against the window it is in.
   * @param {BrowserWindow} target
   */
  const readShell = (target) =>
    target.webContents.executeJavaScript(`(() => {
      const shell = document.getElementById('app');
      const box = shell.getBoundingClientRect();
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        shell: {
          width: Math.round(box.width),
          height: Math.round(box.height),
          right: Math.round(box.right),
          bottom: Math.round(box.bottom),
          maxWidth: getComputedStyle(shell).maxWidth,
        },
        columns: ['sidebar', 'chat', 'context-panel'].map((id) => ({
          id,
          collapsed: document.getElementById(id)?.dataset.collapsed,
          width: Math.round(document.getElementById(id)?.getBoundingClientRect().width ?? 0),
        })),
      };
    })()`);

  /**
   * The shell is the window: it has no max-width and no gap beside or under it, and the
   * document does not scroll sideways. A shell smaller than its window is what a browser
   * view of the app shows when the page was laid out at an older, smaller frame, and it
   * reads as "the screen size is wrong" even though the columns themselves are fine.
   * @param {string} label
   * @param {Awaited<ReturnType<typeof readShell>>} state
   */
  const checkFillsWindow = (label, state) => {
    report.check(`${label}: the shell fills the window, with no dead space beside or under it`, () => {
      const short = `${state.shell.width}x${state.shell.height} in a ${state.width}x${state.height} window`;
      if (state.shell.maxWidth !== 'none') {
        throw new Error(`the shell is capped at max-width ${state.shell.maxWidth}`);
      }
      if (Math.abs(state.shell.width - state.width) > 1 || Math.abs(state.shell.height - state.height) > 1) {
        throw new Error(`the shell is ${short}`);
      }
      if (state.scrollWidth > state.width + 1) {
        throw new Error(`the page scrolls sideways: ${state.scrollWidth}px of content in a ${state.width}px window`);
      }
      return `${state.shell.width}x${state.shell.height}, nothing to scroll sideways`;
    });
  };

  // Every run gets its own store root, and the shell is pointed at it before any
  // reload. A developer's own chats.json under userData would otherwise open as the
  // transcript under test: the send checks below append to the thread on screen, so a
  // thread from the real store makes that append fail and the assertions read the
  // wrong bubble. One root for the whole run, so the window and the checks agree on
  // which threads exist.
  const storeRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zuri-smoke-'));
  setStoreRoot(storeRoot);

  // Below 1000px the context panel starts collapsed. The breakpoint is read once
  // at start, so the window has to be resized and reloaded to test it. The resize
  // must have reached the page before that reload: a fixed sleep here once let the
  // fresh document read the old, wider viewport and start expanded.
  await resizeAndSettle(window, 940, 800);
  await reloadAndWait(window);
  await wait(300); // the collapse animates over motion-base, so measure after it settles
  const narrow = await readShell(window);

  checkFillsWindow('a narrow window', narrow);

  report.check('the context panel starts collapsed below 1000px', () => {
    if (narrow.width >= 1000) throw new Error(`the window is ${narrow.width}px, so 1000px was not crossed`);
    const panel = narrow.columns.find((column) => column.id === 'context-panel');
    if (panel.collapsed !== 'true') throw new Error(`data-collapsed is ${panel.collapsed}`);
    if (panel.width > 100) throw new Error(`the collapsed panel is still ${panel.width}px wide`);
    return `${narrow.width}px wide, panel collapsed to ${panel.width}px`;
  });

  // A collapsed panel is only useful if the control that opens it can be clicked. The
  // check above proved the state; this one proves the way out of it, with a real hit
  // test, because a programmatic .click() succeeds on a control that is clipped to
  // nothing and therefore unreachable for a person. That is exactly how the old 12 px
  // rail shipped: collapsed correctly, impossible to reopen.
  const railHit = await window.webContents.executeJavaScript(`(() => {
    const toggle = document.querySelector('.shell-toggle[aria-controls="context-panel"]');
    const panel = document.getElementById('context-panel');
    const t = toggle.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(t.x + t.width / 2), Math.round(t.y + t.height / 2));
    return {
      width: Math.round(t.width),
      height: Math.round(t.height),
      insideColumn: t.x >= p.x - 0.5 && t.x + t.width <= p.x + p.width + 0.5,
      onToggle: Boolean(hit && hit.closest('.shell-toggle') === toggle),
      hit: hit ? String(hit.id || hit.className || hit.tagName) : 'none',
    };
  })()`);

  report.check('a collapsed panel keeps a toggle a person can actually click', () => {
    if (!railHit.insideColumn) {
      throw new Error('the toggle sits outside the collapsed column, so it is clipped away');
    }
    if (railHit.width < 44 || railHit.height < 44) {
      throw new Error(`the toggle is ${railHit.width}x${railHit.height}px, under the 44 px tap target`);
    }
    if (!railHit.onToggle) throw new Error(`the centre of the toggle belongs to ${railHit.hit}`);
    return `${railHit.width}x${railHit.height}px, hit test returns the toggle`;
  });

  // Expanding it by hand and then widening the window must not undo the choice.
  await window.webContents.executeJavaScript(
    `document.querySelector('.shell-toggle[aria-controls="context-panel"]').click() && true`,
  );
  await resizeAndSettle(window, 1200, 800);
  await wait(300);
  const widened = await readShell(window);
  checkFillsWindow('a wide window', widened);

  report.check('a resize keeps the collapse choice the user made', () => {
    const panel = widened.columns.find((column) => column.id === 'context-panel');
    if (widened.width < 1000) throw new Error(`the window stayed at ${widened.width}px`);
    if (panel.collapsed !== 'false') throw new Error(`the panel collapsed itself when the window grew`);
    return `${widened.width}px wide, still expanded at ${panel.width}px`;
  });

  await reloadAndWait(window);
  await wait(300);
  const reloaded = await readShell(window);

  report.check('a 1200px start leaves the context panel expanded', () => {
    const panel = reloaded.columns.find((column) => column.id === 'context-panel');
    if (panel.collapsed !== 'false') throw new Error(`data-collapsed is ${panel.collapsed} after reloading at ${reloaded.width}px`);
    return `${reloaded.width}px wide`;
  });

  // Provider keys. The real Settings view is opened in a second window and driven
  // against the same throwaway store root, so the key this test types is never
  // written into the developer's real userData folder.

  const settingsWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await settingsWindow.loadFile(SETTINGS_ENTRY);

  // The Input / Text component (design node 0:44) as the app actually draws it: the
  // Settings key field is that component, so this reads the live box back rather than
  // trusting the stylesheet alone, and reads it again after a theme swap to prove the
  // one token layer is what the field follows.
  const fieldRun = await settingsWindow.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('provider-key');
    const tokens = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    const resolve = (name) => {
      probe.style.color = tokens.getPropertyValue(name).trim();
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const readIcon = () => {
      const icon = document.querySelector('.field-icon');
      if (!icon) return null;
      const style = getComputedStyle(icon);
      const box = icon.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      return {
        width: style.width,
        height: style.height,
        color: style.color,
        inset: Math.round(box.left - field.left),
        centre: Math.round(box.top + box.height / 2 - field.top - field.height / 2),
      };
    };
    const readBox = () => {
      const style = getComputedStyle(input);
      return {
        height: style.height,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        shadow: style.boxShadow,
        paddingLeft: style.paddingLeft,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        icon: readIcon(),
      };
    };
    const dark = readBox();
    const surface = resolve('--zuri-surface-secondary');
    const hairline = resolve('--zuri-border-hairline');
    const subtle = resolve('--zuri-text-subtle');
    document.documentElement.dataset.theme = 'light';
    const light = readBox();
    const lightSurface = resolve('--zuri-surface-secondary');
    document.documentElement.dataset.theme = 'dark';
    return { dark, light, surface, hairline, lightSurface, subtle };
  })()`);

  report.check('the Input / Text matches node 0:44', () => {
    const { dark, light, surface, hairline, lightSurface, subtle } = fieldRun;
    if (dark.height !== '40px') throw new Error(`the field renders ${dark.height} tall, the node draws 40`);
    if (dark.radius !== '12px') throw new Error(`the corner renders ${dark.radius}, radius/radius-md is 12`);
    if (dark.background !== surface) throw new Error(`the fill renders ${dark.background}, color/surface-secondary is ${surface}`);
    // The node's strokes/0 is a 1 px color/border-subtle rule aligned INSIDE the box,
    // so it has to show up as an inset shadow on the resolved hairline. A real border
    // would grow the 40 px box, and a field with no edge at all is the regression.
    if (parseFloat(dark.borderWidth) > 0) {
      throw new Error(`the edge renders ${dark.borderWidth} ${dark.borderStyle}, the node's stroke is drawn inside the box, not as a border`);
    }
    const edge = String(dark.shadow).replace(/\s+/g, '');
    const hair = String(hairline).replace(/\s+/g, '');
    if (!edge.includes('inset') || !edge.includes(hair)) {
      throw new Error(`the edge renders ${dark.shadow || 'nothing'}, the node draws a 1 px inset stroke in color/border-subtle (${hairline})`);
    }
    if (dark.paddingLeft !== '36px') {
      throw new Error(`the value starts at ${dark.paddingLeft}, the node starts it at 36 px: 12 px glyph inset + 16 px glyph + 8 px gap`);
    }
    if (!dark.icon) throw new Error('the field draws no leading glyph, the node draws one 12 px in');
    if (dark.icon.width !== '16px' || dark.icon.height !== '16px') {
      throw new Error(`the glyph renders ${dark.icon.width} x ${dark.icon.height}, the node draws 16 x 16`);
    }
    if (dark.icon.inset !== 12) throw new Error(`the glyph starts ${dark.icon.inset} px in, the node puts it at 12`);
    if (dark.icon.centre !== 0) throw new Error(`the glyph sits ${dark.icon.centre} px off the field centre, the node centres it`);
    if (dark.icon.color !== subtle) {
      throw new Error(`the glyph strokes ${dark.icon.color}, color/text-subtle is ${subtle}`);
    }
    if (dark.fontSize !== '14px' || dark.lineHeight !== '22px') {
      throw new Error(`the value renders ${dark.fontSize}/${dark.lineHeight}, the node's Value is 14/22`);
    }
    if (light.background !== lightSurface) throw new Error(`the light field fills ${light.background}, not ${lightSurface}`);
    if (light.background === dark.background) throw new Error('the field keeps its dark fill after the theme swap');
    if (light.height !== '40px' || light.radius !== '12px') throw new Error('the theme swap moved the field box');
    // Both themes have to draw it, so a swap cannot leave the field edgeless.
    if (!String(light.shadow).replace(/\s+/g, '').includes('inset')) {
      throw new Error(`the light theme drops the field edge (${light.shadow || 'nothing'}), the hairline token is drawn in both`);
    }
    return `40 px field, 12 px corner, surface-secondary fill (${surface} dark, ${lightSurface} light), 1 px inset hairline edge, 16 px glyph at 12 px in, 36 px value inset, 14/22 value`;
  });

  // loadFile() resolves on did-finish-load, so no waitForLoad() here: right after it
  // resolves isLoadingMainFrame() still reports true and the wait would never end.

  const FAKE_KEY = 'sk-smoke-0123456789abcdef';
  const keyRun = await settingsWindow.webContents.executeJavaScript(`(async () => {
    const view = await import('./settings.js');
    const form = document.getElementById('provider-key-form');
    const input = document.getElementById('provider-key');

    input.value = ${JSON.stringify(FAKE_KEY)};
    form.requestSubmit();
    for (let tick = 0; tick < 80 && form.dataset.busy !== 'false'; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      state: view.getKeyState(),
      fieldValue: input.value,
      statusText: document.getElementById('provider-key-status').textContent.trim(),
      hasKeyAttribute: document.getElementById('provider-key-status').dataset.hasKey,
      errorText: document.getElementById('provider-key-error').textContent.trim(),
      html: document.documentElement.outerHTML,
      ipcStatus: await window.zuri.settings.keyStatus({ provider: 'openai' }),
      ipcSave: await window.zuri.settings.setKey({ provider: 'openai', key: '' }),
    };
  })()`);

  report.check('the Settings view saves a key through zuri:settings:setKey', () => {
    if (keyRun.errorText !== '') throw new Error(keyRun.errorText);
    if (keyRun.statusText !== 'Key saved' || keyRun.hasKeyAttribute !== 'true') {
      throw new Error(`the status reads "${keyRun.statusText}" (data-has-key ${keyRun.hasKeyAttribute})`);
    }
    const file = path.join(storeRoot, 'secrets.json');
    if (!fs.existsSync(file)) throw new Error(`no secrets.json at ${file}`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored?.keys?.openai !== FAKE_KEY) throw new Error('secrets.json does not hold the key that was typed');
    return `saved to ${file}`;
  });

  report.check('the renderer keeps only the boolean hasKey', () => {
    const state = keyRun.state ?? {};
    if (JSON.stringify(state).includes(FAKE_KEY)) throw new Error('the view state contains the key');
    if (Object.keys(state).sort().join(',') !== 'hasKey,provider') {
      throw new Error(`the view state holds ${Object.keys(state).join(', ')}`);
    }
    if (typeof state.hasKey !== 'boolean') throw new Error('hasKey is not a boolean');
    if (keyRun.fieldValue !== '') throw new Error('the key is still in the input field');
    if (keyRun.html.includes(FAKE_KEY)) throw new Error('the key is in the rendered markup');
    if (JSON.stringify(keyRun.ipcStatus).includes(FAKE_KEY)) throw new Error('keyStatus returned the key');
    if (keyRun.ipcStatus?.data?.hasKey !== true) throw new Error('keyStatus does not report the saved key');
    return 'state { provider, hasKey }, field cleared, no key over IPC';
  });

  report.check('a key sent to main is never echoed back', () => {
    if (keyRun.ipcSave?.ok !== false) throw new Error('an empty key was accepted');
    if (JSON.stringify(keyRun.ipcSave).includes(FAKE_KEY)) throw new Error('the rejection carried the stored key');
    return keyRun.ipcSave?.error?.message ?? 'rejected';
  });

  // A chat log is the other file that could leak a key: write one, then scan every
  // file in the throwaway root for the key string.
  const chatRun = await window.webContents.executeJavaScript(`(async () => {
    const created = await window.zuri.chats.create();
    if (created?.ok !== true) return { ok: false, error: created?.error?.message ?? 'no result' };
    const appended = await window.zuri.chats.appendMessage({
      threadId: created.data.id,
      message: { role: 'user', content: 'Check my key status' },
    });
    return { ok: appended?.ok === true, error: appended?.error?.message ?? '' };
  })()`);

  report.check('no chat log or store file contains the key', () => {
    if (chatRun.ok !== true) throw new Error(`could not write a chat: ${chatRun.error}`);

    const chatFile = path.join(storeRoot, 'chats.json');
    if (!fs.existsSync(chatFile)) throw new Error('no chats.json was written, so the scan proves nothing');
    if (!fs.readFileSync(chatFile, 'utf8').includes('Check my key status')) {
      throw new Error('the chat message was not stored');
    }

    const files = fs.readdirSync(storeRoot).filter((name) => name.endsWith('.json'));
    const leaks = files.filter(
      (name) => name !== 'secrets.json' && fs.readFileSync(path.join(storeRoot, name), 'utf8').includes(FAKE_KEY),
    );
    if (leaks.length > 0) throw new Error(`the key appears in ${leaks.join(', ')}`);
    return `${files.length} files scanned, only secrets.json holds the key`;
  });

  const removalRun = await settingsWindow.webContents.executeJavaScript(`(async () => {
    const view = await import('./settings.js');
    const form = document.getElementById('provider-key-form');
    const removeButton = document.getElementById('provider-key-remove');
    const enabledBefore = removeButton.disabled === false;

    // Measured before the click, while a key is stored, so the control is in its
    // enabled state rather than greyed out.
    const computed = getComputedStyle(removeButton);
    const rootStyle = getComputedStyle(document.documentElement);
    const style = {
      height: Math.round(removeButton.getBoundingClientRect().height),
      paddingLeft: computed.paddingLeft,
      paddingRight: computed.paddingRight,
      radius: computed.borderTopLeftRadius,
      borderWidth: computed.borderTopWidth,
      background: computed.backgroundColor,
      color: computed.color,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      dangerFillToken: rootStyle.getPropertyValue('--zuri-danger-button-fill').trim(),
      foregroundToken: rootStyle.getPropertyValue('--zuri-text-on-accent').trim(),
    };

    removeButton.click();
    for (let tick = 0; tick < 80 && form.dataset.busy !== 'false'; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      enabledBefore,
      disabledAfter: removeButton.disabled,
      statusText: document.getElementById('provider-key-status').textContent.trim(),
      hasKeyAttribute: document.getElementById('provider-key-status').dataset.hasKey,
      state: view.getKeyState(),
      style,
      ipcStatus: await window.zuri.settings.keyStatus({ provider: 'openai' }),
    };
  })()`);

  report.check('Remove key clears the stored key through main', () => {
    if (!removalRun.enabledBefore) throw new Error('Remove key was disabled while a key was stored');
    if (removalRun.statusText !== 'No key saved' || removalRun.hasKeyAttribute !== 'false') {
      throw new Error(`the status reads "${removalRun.statusText}" (data-has-key ${removalRun.hasKeyAttribute})`);
    }
    if (removalRun.state?.hasKey !== false) throw new Error('the view still reports a key');
    if (removalRun.ipcStatus?.data?.hasKey !== false) throw new Error('main still reports a key');
    if (fs.existsSync(path.join(storeRoot, 'secrets.json'))) {
      throw new Error('secrets.json survived the removal');
    }
    if (!removalRun.disabledAfter) throw new Error('Remove key is still enabled with no key stored');
    return 'key file deleted, status back to "No key saved"';
  });

  // Button / Danger (design node 0:24) is drawn once in components.css and used by
  // the Settings view's destructive action, so this measures the control the person
  // actually clicks rather than reading the stylesheet. The node is a 101 x 36 solid
  // red box: 12 px corner, 16 px of side padding, no outline and a 14/20 regular label
  // in the fill's primary-foreground. The fill is the node's bound variable "danger",
  // which tokens.json gives as #F31260 in both modes, so the token is checked against
  // that value as well: a node change moves the token and this check together.
  report.check('Button / Danger matches the design node 0:24', () => {
    const style = removalRun.style ?? {};
    const toRgb = (value) => {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? '').trim());
      if (!match) return String(value ?? '').trim();
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
      return `rgb(${r}, ${g}, ${b})`;
    };

    if (style.dangerFillToken !== '#f31260') {
      throw new Error(`the danger fill token reads "${style.dangerFillToken}" (expected #f31260, the node's variable danger)`);
    }

    const wanted = [
      ['the 36 px node height', style.height, 36],
      ['the left side padding', style.paddingLeft, '16px'],
      ['the right side padding', style.paddingRight, '16px'],
      ['the 12 px node corner', style.radius, '12px'],
      ['no outline, as the node has none', style.borderWidth, '0px'],
      ['the node fill (variable danger)', style.background, toRgb(style.dangerFillToken)],
      ['the primary-foreground label', style.color, toRgb(style.foregroundToken)],
      ['the 14 px label size', style.fontSize, '14px'],
      ['the regular label weight', style.fontWeight, '400'],
      ['the label-md 20 px line box', style.lineHeight, '20px'],
    ];
    const wrong = wanted.filter(([, actual, expected]) => actual !== expected);
    if (wrong.length > 0) {
      throw new Error(wrong.map(([label, actual, expected]) => `${label}: ${actual} (expected ${expected})`).join('; '));
    }
    return '36 px tall, 16 px padding, radius 12, danger #F31260 fill, white label at 14/20';
  });

  // Ask mode's failure path, end to end. This runs after Remove key, so no network
  // call is attempted: with no key saved, Send must land an inline error bubble in the
  // transcript and must not invent a reply in chats.json.
  const replyErrorRun = await window.webContents.executeJavaScript(`(async () => {
    const input = document.getElementById('composer-input');
    const sendButton = document.getElementById('composer-send');
    input.value = 'Does Ask mode work?';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const enabledBefore = sendButton.disabled === false;
    sendButton.click();

    const failedBubble = () => document.querySelector('.message[data-state="failed"]');
    for (let tick = 0; tick < 120 && !failedBubble(); tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const bubble = failedBubble();
    const threads = await window.zuri.chats.list();
    const thread = (threads?.data ?? []).find((entry) =>
      (entry.messages ?? []).some((message) => message.content === 'Does Ask mode work?'),
    );

    return {
      enabledBefore,
      text: bubble?.querySelector('.message-text')?.textContent?.trim() ?? '',
      role: bubble?.dataset.role ?? '',
      state: bubble?.dataset.state ?? '',
      streamBubbles: document.querySelectorAll('.message[data-state="streaming"]').length,
      replies: (thread?.messages ?? []).filter((message) => message.role === 'assistant').length,
      userMessages: (thread?.messages ?? []).filter((message) => message.role === 'user').length,
      composerState: document.getElementById('composer-shell').dataset.state ?? '',
    };
  })()`);

  report.check('a send with no key shows an inline error bubble, not a silent failure', () => {
    if (!replyErrorRun.enabledBefore) throw new Error('Send was disabled with text in the composer');
    if (replyErrorRun.state !== 'failed') throw new Error('the transcript has no failed bubble');
    if (replyErrorRun.role !== 'assistant') throw new Error(`the error bubble is a ${replyErrorRun.role} turn`);
    if (!replyErrorRun.text.includes('key') || !replyErrorRun.text.includes('Settings')) {
      throw new Error(`the bubble reads "${replyErrorRun.text}"`);
    }
    if (replyErrorRun.streamBubbles !== 0) throw new Error('the empty reply bubble was left behind');
    if (replyErrorRun.replies !== 0) throw new Error('a reply was saved without a key');
    if (replyErrorRun.userMessages !== 1) throw new Error('the sent message was not saved');
    if (replyErrorRun.composerState !== 'ready') throw new Error('the composer stayed locked after the error');
    return replyErrorRun.text;
  });

  // The chat column's error block is open-pencil's "State / Error" component
  // (node 0:287): a 320 x 240 card on color/danger-soft with radius-xl, a 48 px
  // color/surface disc around the node's 22 px mark in color/danger, a 16/24
  // semibold title, a 14/22 body in color/text-subtle, then the node's 36 px
  // color/surface action. Retry has to be a real control, so clicking it asks
  // again for the reply that never arrived, which is the state this run is in.
  //
  // Chromium hands :hover to whatever sits under the real OS pointer, and the
  // pointer is wherever the person left it while this run drives the UI through
  // script. Retry is a control whose default fill is a token, so with the pointer
  // resting on it this block would read the hover colour (or a value partway
  // through the 150 ms fade) and report a mismatch the design does not have. The
  // top bar has no hover paint, so the pointer is parked there before sampling.
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const errorBlockRun = await window.webContents.executeJavaScript(`(async () => {
    const block = document.querySelector('.error-block');
    const action = document.getElementById('chat-error-retry');
    const disc = block?.querySelector('.error-block-icon') ?? null;
    const icon = disc?.querySelector('svg') ?? null;
    const composer = document.getElementById('composer-shell');
    const failedCount = () => document.querySelectorAll('.message[data-state="failed"]').length;
    // Every colour is read twice: once as the token the theme declares, and once as
    // the value an element actually paints. The first catches a token that drifted
    // from the node, the second a component that stopped using its own token.
    const declared = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
    const probe = (name) => {
      const span = document.createElement('span');
      span.style.color = 'var(' + name + ')';
      document.body.append(span);
      const value = getComputedStyle(span).color;
      span.remove();
      return value;
    };
    const box = block.getBoundingClientRect();
    const discBox = disc.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    const style = getComputedStyle(block);
    const discStyle = getComputedStyle(disc);
    const titleStyle = getComputedStyle(block.querySelector('.error-block-title'));
    const textStyle = getComputedStyle(block.querySelector('.error-block-text'));
    const actionStyle = getComputedStyle(action);
    const composerBox = composer.getBoundingClientRect();
    const before = failedCount();
    action.click();
    for (let tick = 0; tick < 120 && failedCount() <= before; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
      title: block.querySelector('.error-block-title').textContent.trim(),
      text: block.querySelector('.error-block-text').textContent.trim(),
      label: action.textContent.trim(),
      shapes: icon ? icon.querySelectorAll('circle, path').length : 0,
      width: Math.round(box.width),
      blockHeight: Math.round(box.height),
      blockCenter: Math.round(box.left + box.width / 2),
      composerCenter: Math.round(composerBox.left + composerBox.width / 2),
      radius: Math.round(Number.parseFloat(style.borderTopLeftRadius)),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
      discWidth: Math.round(discBox.width),
      discHeight: Math.round(discBox.height),
      discRadius: Math.round(Number.parseFloat(discStyle.borderTopLeftRadius)),
      iconWidth: Math.round(iconBox.width),
      iconHeight: Math.round(iconBox.height),
      titleFont: [titleStyle.fontSize, titleStyle.lineHeight, titleStyle.fontWeight].join(' '),
      textFont: [textStyle.fontSize, textStyle.lineHeight].join(' '),
      actionHeight: Math.round(actionBox.height),
      actionFont: [actionStyle.fontSize, actionStyle.lineHeight].join(' '),
      actionPadding: [actionStyle.paddingLeft, actionStyle.paddingRight].join(' '),
      actionRadius: Math.round(Number.parseFloat(actionStyle.borderTopLeftRadius)),
      tokens: {
        fill: declared('--zuri-error-block-fill'),
        surface: declared('--zuri-error-block-surface'),
        icon: declared('--zuri-error-block-icon'),
        title: declared('--zuri-error-block-title'),
        text: declared('--zuri-error-block-text'),
        radius: declared('--zuri-error-block-radius'),
      },
      paints: {
        fill: style.backgroundColor,
        surface: discStyle.backgroundColor,
        action: actionStyle.backgroundColor,
        icon: icon ? getComputedStyle(icon).color : '',
        title: titleStyle.color,
        text: textStyle.color,
      },
      probes: {
        fill: probe('--zuri-error-block-fill'),
        surface: probe('--zuri-error-block-surface'),
        icon: probe('--zuri-error-block-icon'),
        title: probe('--zuri-error-block-title'),
        text: probe('--zuri-error-block-text'),
      },
      failedBefore: before,
      failedAfter: failedCount(),
      composerState: composer.dataset.state ?? '',
    };
  })()`);

  report.check('the chat column shows the Block / Error component and its Retry asks again', () => {
    const run = errorBlockRun;
    // The node paints with semantic variables, so each token is held to that
    // variable's value in whichever theme this run drew the screen in.
    const expected =
      run.theme === 'light'
        ? { fill: '#fdd8e5', surface: '#ffffff', icon: '#f31260', title: '#11181c', text: '#6b6b75' }
        : { fill: '#310413', surface: '#18181b', icon: '#f31260', title: '#ecedee', text: '#a1a1aa' };
    const tokenIs = (name) => {
      const value = run.tokens[name];
      if (value !== expected[name]) {
        throw new Error(`--zuri-error-block-${name} is ${value}, the node's ${run.theme} value is ${expected[name]}`);
      }
    };
    const paints = (painted, token, label) => {
      if (painted !== run.probes[token]) {
        throw new Error(`${label} paints ${painted}, not var(--zuri-error-block-${token}) which resolves to ${run.probes[token]}`);
      }
    };

    if (run.title !== "Couldn't reach the provider") throw new Error(`the title reads "${run.title}"`);
    if (run.text !== 'Check your API key in Settings, then try again.') {
      throw new Error(`the body reads "${run.text}"`);
    }
    if (run.label !== 'Retry') throw new Error(`the action reads "${run.label}"`);
    if (run.shapes !== 2) throw new Error(`the mark draws ${run.shapes} shapes, not the node's circle and stroke`);
    if (run.width !== 320) throw new Error(`the card is ${run.width}px wide, not the node's 320`);
    if (run.blockHeight !== 240) throw new Error(`the card is ${run.blockHeight}px tall, not the node's 240`);
    // The card sits on the same centre line as the composer below it. Without the
    // component's own auto margins a flex column pins a width-capped item to its
    // start, so the card reads as left-aligned under a full-width field.
    if (Math.abs(run.blockCenter - run.composerCenter) > 1) {
      throw new Error(`the card is ${run.blockCenter - run.composerCenter}px off the composer's centre line`);
    }
    if (run.tokens.radius !== '20px') throw new Error(`--zuri-error-block-radius is ${run.tokens.radius}, not the node's radius-xl`);
    if (run.radius !== 20) throw new Error(`the card radius is ${run.radius}px, not the node's radius-xl`);
    if (run.padding !== '24px 24px 24px 24px') throw new Error(`the card padding is ${run.padding}`);
    for (const name of ['fill', 'surface', 'icon', 'title', 'text']) tokenIs(name);
    paints(run.paints.fill, 'fill', 'the card fill');
    paints(run.paints.surface, 'surface', 'the icon disc');
    paints(run.paints.action, 'surface', 'the action fill');
    paints(run.paints.icon, 'icon', 'the mark');
    paints(run.paints.title, 'title', 'the title');
    paints(run.paints.text, 'text', 'the body');
    if (run.discWidth !== 48 || run.discHeight !== 48) {
      throw new Error(`the icon disc is ${run.discWidth}x${run.discHeight}, not the node's 48`);
    }
    // The disc is bound to radius/full, so any radius past half its width draws the
    // circle the node draws.
    if (run.discRadius < 24) throw new Error(`the icon disc radius is ${run.discRadius}px, not a full circle`);
    if (run.iconWidth !== 22 || run.iconHeight !== 22) {
      throw new Error(`the mark is ${run.iconWidth}x${run.iconHeight}, not the node's 22`);
    }
    if (run.titleFont !== '16px 24px 600') throw new Error(`the title type is ${run.titleFont}`);
    if (run.textFont !== '14px 22px') throw new Error(`the body type is ${run.textFont}`);
    if (run.actionHeight !== 36) throw new Error(`the action is ${run.actionHeight}px tall, not the node's 36`);
    if (run.actionFont !== '14px 20px') throw new Error(`the action label type is ${run.actionFont}`);
    if (run.actionPadding !== '16px 16px') throw new Error(`the action padding is ${run.actionPadding}`);
    if (run.actionRadius !== 12) throw new Error(`the action radius is ${run.actionRadius}px, not radius-md`);
    if (run.failedAfter <= run.failedBefore) throw new Error('Retry did not ask for the reply again');
    if (run.composerState !== 'ready') throw new Error('Retry left the composer locked');
    return `${run.width}x${run.blockHeight} card on the composer's centre line, ${run.discWidth}px disc, 22px mark and 36px action in the ${run.theme} theme's own values, Retry re-asked for the reply`;
  });

  // The context panel's empty block is the design's "Empty State Card"
  // (node 0:10866): a 48 px icon badge, title, body and one action. The action has
  // to be a real control, so clicking it opens a chat with the request begun.
  const emptyBlockRun = await window.webContents.executeJavaScript(`(async () => {
    const block = document.querySelector('.empty-block');
    const action = document.getElementById('reminders-empty-action');
    const input = document.getElementById('composer-input');
    const before = (await window.zuri.chats.list())?.data ?? [];
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    action.click();
    for (let tick = 0; tick < 80 && input.value === ''; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const threads = (await window.zuri.chats.list())?.data ?? [];
    const rect = block?.getBoundingClientRect();
    return {
      title: block?.querySelector('.empty-block-title')?.textContent?.trim() ?? '',
      text: block?.querySelector('.empty-block-text')?.textContent?.trim() ?? '',
      actionLabel: action?.textContent?.trim() ?? '',
      markPaths: block?.querySelectorAll('.empty-block-mark svg path').length ?? 0,
      markStroke: block?.querySelector('.empty-block-mark') ? getComputedStyle(block.querySelector('.empty-block-mark')).color : '',
      width: Math.round(rect?.width ?? 0),
      composerValue: input.value,
      focused: document.activeElement === input,
      beforeCount: before.length,
      afterCount: threads.length,
    };
  })()`);

  report.check('the context panel shows the Empty State Card and its action starts a chat', () => {
    if (emptyBlockRun.title !== 'No reminders yet') throw new Error(`the title reads "${emptyBlockRun.title}"`);
    if (!emptyBlockRun.text.startsWith('Scheduled tasks and their reminders')) {
      throw new Error(`the caption reads "${emptyBlockRun.text}"`);
    }
    if (emptyBlockRun.actionLabel !== 'Create a task') {
      throw new Error(`the action reads "${emptyBlockRun.actionLabel}"`);
    }
    // The badge draws the node's own two vectors (0:10869 and 0:10870) as strokes
    // in text-subtle. Counting them keeps a redrawn or filled glyph from passing:
    // the node's mark is line art, and it is quiet, not accented.
    if (emptyBlockRun.markPaths !== 2) throw new Error(`the mark has ${emptyBlockRun.markPaths} paths, not the node's 2`);
    if (emptyBlockRun.markStroke !== 'rgb(161, 161, 170)') {
      throw new Error(`the mark is drawn in ${emptyBlockRun.markStroke}, not text-subtle`);
    }
    if (emptyBlockRun.width < 200) throw new Error(`the block is only ${emptyBlockRun.width}px wide`);
    if (emptyBlockRun.composerValue !== 'Create a task: ') {
      throw new Error(`the action left "${emptyBlockRun.composerValue}" in the composer`);
    }
    if (!emptyBlockRun.focused) throw new Error('the action did not put the caret in the composer');
    if (emptyBlockRun.afterCount !== emptyBlockRun.beforeCount + 1) {
      throw new Error(`threads went from ${emptyBlockRun.beforeCount} to ${emptyBlockRun.afterCount}`);
    }
    return `${emptyBlockRun.width}px block, chat opened with the request begun`;
  });

  checkDropdowns('the Settings provider field', await measureDropdowns(settingsWindow));

  settingsWindow.destroy();
  fs.rmSync(storeRoot, { recursive: true, force: true });

  // Files view. A throwaway workspace gives the page a real row, so the list and
  // both actions are exercised through the real bridge instead of a stub.
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zuri-files-'));
  setWorkspaceRoot(workspaceRoot);
  await fs.promises.writeFile(path.join(workspaceRoot, 'report.md'), '# Report\n', 'utf8');

  const filesWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await filesWindow.loadFile(FILES_ENTRY);

  const filesRun = await filesWindow.webContents.executeJavaScript(`(async () => {
    await import('./files.js');
    const rows = () => Array.from(document.querySelectorAll('.file-row'));
    for (let tick = 0; tick < 80 && rows().length === 0; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const row = rows()[0];
    const buttons = Array.from(row?.querySelectorAll('button') ?? []);
    const bridgeList = await window.zuri.files.list({});
    // The guard must stop an outside path before Explorer is asked to show it.
    const outsideReveal = await window.zuri.files.reveal({ path: '../outside.txt' });

    return {
      rows: rows().length,
      name: row?.querySelector('.file-row-name')?.textContent?.trim() ?? '',
      meta: row?.querySelector('.file-row-meta')?.textContent?.trim() ?? '',
      labels: buttons.map((button) => button.textContent.trim()),
      ariaLabels: buttons.map((button) => button.getAttribute('aria-label')),
      status: document.getElementById('files-status').textContent.trim(),
      emptyHidden: document.getElementById('files-empty').hidden,
      error: document.getElementById('files-error').textContent.trim(),
      bridgePaths: (bridgeList?.data?.files ?? []).map((file) => file.path),
      outsideCode: outsideReveal?.error?.code ?? '',
    };
  })()`);

  report.check('the Files view lists workspace files through the bridge', () => {
    if (filesRun.error !== '') throw new Error(filesRun.error);
    if (filesRun.rows !== 1) throw new Error(`${filesRun.rows} rows rendered`);
    if (filesRun.name !== 'report.md') throw new Error(`the row reads "${filesRun.name}"`);
    if (!filesRun.meta.includes('B')) throw new Error(`the meta line reads "${filesRun.meta}"`);
    if (filesRun.emptyHidden !== true) throw new Error('the empty state is showing beside a file');
    if (!filesRun.bridgePaths.includes('report.md')) {
      throw new Error(`the bridge listed ${filesRun.bridgePaths.join(', ') || 'nothing'}`);
    }
    return filesRun.status;
  });

  report.check('each file row offers Open and Reveal in Explorer', () => {
    if (filesRun.labels.join('|') !== 'Open|Reveal in Explorer') {
      throw new Error(`the actions read ${filesRun.labels.join(', ') || 'nothing'}`);
    }
    if (!filesRun.ariaLabels.every((label) => label && label.includes('report.md'))) {
      throw new Error(`the labels are ${filesRun.ariaLabels.join(', ')}`);
    }
  });

  report.check('Files refuses a path outside the workspace', () => {
    if (filesRun.outsideCode !== 'TOOL_PATH_OUTSIDE_WORKSPACE') {
      throw new Error(`reveal answered ${filesRun.outsideCode || 'success'}`);
    }
    return filesRun.outsideCode;
  });

  filesWindow.destroy();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  // Button / Ghost (design node 0:10). Built as markup on the live page rather
  // than through a view, because no screen places the "See all" affordance yet;
  // the numbers still come from the stylesheet in force, not a copy of it here.
  const ghostRun = await window.webContents.executeJavaScript(`(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-ghost';
    button.textContent = 'See all';
    // The rule transitions fill and label, so a reading taken straight after the
    // theme swap would catch the control mid-fade. Pin it to the resting state.
    button.style.transition = 'none';
    document.body.append(button);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    const readBox = () => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        padding: style.paddingLeft + ' ' + style.paddingRight,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        border: style.borderTopWidth,
      };
    };
    const readTokens = () => ({
      surface: colourToken('--zuri-surface'),
      muted: colourToken('--zuri-text-muted'),
      rowRadius: radiusToken('--zuri-radius-row'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    button.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Ghost matches node 0:10', () => {
    const problems = [];

    for (const [theme, run] of [['dark', ghostRun.dark], ['light', ghostRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 32) problems.push(`${theme}: the box is ${box.height} px tall, the node is 32`);
      if (box.padding !== '16px 16px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 16 px each side`);
      }
      if (box.radius !== tokens.rowRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/row (${tokens.rowRadius})`);
      }
      if (box.background !== tokens.surface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/background (${tokens.surface})`);
      }
      if (box.color !== tokens.muted) {
        problems.push(`${theme}: the label is ${box.color}, the node binds color/muted (${tokens.muted})`);
      }
      if (box.fontSize !== '14px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the label is ${box.fontSize} at weight ${box.fontWeight}, the node sets 14 px regular`);
      }
      if (box.border !== '0px') {
        problems.push(`${theme}: the button draws a ${box.border} border the node does not have`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = ghostRun.dark;
    return `32 px tall, ${box.padding} side padding, radius ${box.radius}, surface fill and muted 13 px label in both themes`;
  });

  // Button / Secondary (design node 0:20), the member the Buttons Row labels
  // "Bordered". No screen places an outlined action yet, so it is built as markup
  // on the live page the way the ghost and icon members are; the numbers come from
  // the stylesheet in force, not from a copy of them here.
  const borderedRun = await window.webContents.executeJavaScript(`(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = 'Cancel';
    // The rule transitions fill and outline, so a reading taken straight after the
    // theme swap would catch the control mid-fade. Pin it to the resting state.
    button.style.transition = 'none';
    document.body.append(button);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    // A 1 px outline does not read back as "1px" on a scaled display, so the
    // expected weight is measured from a 1 px reference under the same conditions.
    const onePixelBorder = () => {
      probe.style.borderWidth = '1px';
      probe.style.borderStyle = 'solid';
      return getComputedStyle(probe).borderTopWidth;
    };

    const readBox = () => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        padding: style.paddingLeft + ' ' + style.paddingRight,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
      };
    };
    const readTokens = () => ({
      surface: colourToken('--zuri-bordered-button-surface'),
      border: colourToken('--zuri-bordered-button-border'),
      label: colourToken('--zuri-bordered-button-label'),
      onePx: onePixelBorder(),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    button.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Secondary matches node 0:20, the "Bordered" component', () => {
    const problems = [];

    for (const [theme, run] of [['dark', borderedRun.dark], ['light', borderedRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 36) problems.push(`${theme}: the box is ${box.height} px tall, the node is 36`);
      if (box.padding !== '16px 16px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 16 px each side`);
      }
      if (box.radius !== '12px') {
        problems.push(`${theme}: the corner is ${box.radius}, the node is drawn on radius 12`);
      }
      if (box.background !== tokens.surface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds surface-raised (${tokens.surface})`);
      }
      // The node's stroke is exactly one CSS pixel. Measured against the reference
      // border rather than the literal "1px", because a scaled display snaps the
      // used width to whole device pixels and reports it as a fraction of a CSS px.
      if (box.borderWidth !== tokens.onePx || box.borderColor !== tokens.border) {
        problems.push(
          `${theme}: the outline is ${box.borderWidth} ${box.borderColor}, the node draws 1 px of border-subtle (${tokens.onePx} ${tokens.border} on this display)`,
        );
      }
      if (box.color !== tokens.label) {
        problems.push(`${theme}: the label is ${box.color}, the node binds text (${tokens.label})`);
      }
      if (box.fontSize !== '14px' || box.lineHeight !== '20px' || box.fontWeight !== '400') {
        problems.push(
          `${theme}: the label is ${box.fontSize}/${box.lineHeight} at weight ${box.fontWeight}, the node sets 14/20 regular`,
        );
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = borderedRun.dark;
    return `36 px tall, ${box.padding} side padding, radius ${box.radius}, surface-raised fill and a 1 px border-subtle outline round the 14/20 text label, in both themes`;
  });

  // Button / Icon (design node 0:18). Built as markup on the live page rather
  // than through a view, because no screen places an icon-only control yet (the
  // design's top bar, node 0:132, is its own card). The glyph is the node's two
  // stroked vectors on the 24 unit grid the design's icons are drawn on, rendered
  // into the node's 20 px icon box; the numbers still come from the stylesheet in
  // force, not from a copy of them here.
  const iconRun = await window.webContents.executeJavaScript(`(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-icon';
    button.setAttribute('aria-label', 'Search');
    button.innerHTML =
      '<svg class="btn-icon-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M11 19a8 8 0 100-16 8 8 0 000 16z" fill="none" stroke="currentColor" stroke-width="2"></path>' +
      '<path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>' +
      '</svg>';
    // The rule transitions fill and icon colour, so a reading taken straight
    // after the theme swap would catch the control mid-fade. Pin it to rest.
    button.style.transition = 'none';
    document.body.append(button);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    const readBox = () => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      const glyph = button.querySelector('.btn-icon-glyph').getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        iconColour: style.color,
        border: style.borderTopWidth,
        iconWidth: Math.round(glyph.width),
        iconHeight: Math.round(glyph.height),
        insetLeft: Math.round(glyph.left - box.left),
        insetTop: Math.round(glyph.top - box.top),
        vectors: button.querySelectorAll('.btn-icon-glyph path').length,
      };
    };
    const readTokens = () => ({
      surface: colourToken('--zuri-surface'),
      muted: colourToken('--zuri-text-muted'),
      rowRadius: radiusToken('--zuri-radius-row'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    button.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Icon matches node 0:18', () => {
    const problems = [];

    for (const [theme, run] of [['dark', iconRun.dark], ['light', iconRun.light]]) {
      const { box, tokens } = run;
      if (box.width !== 28 || box.height !== 28) {
        problems.push(`${theme}: the box is ${box.width}x${box.height}, the node is 28x28`);
      }
      if (box.radius !== tokens.rowRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/row (${tokens.rowRadius})`);
      }
      if (box.background !== tokens.surface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/background (${tokens.surface})`);
      }
      if (box.iconColour !== tokens.muted) {
        problems.push(`${theme}: the icon is ${box.iconColour}, the node binds color/muted (${tokens.muted})`);
      }
      // The node's icon frame is 4 px in from the button on every side.
      if (box.insetLeft !== 4 || box.insetTop !== 4) {
        problems.push(`${theme}: the icon sits ${box.insetLeft}/${box.insetTop} px in, the node insets it 4 px`);
      }
      if (box.iconWidth !== 20 || box.iconHeight !== 20) {
        problems.push(`${theme}: the icon box is ${box.iconWidth}x${box.iconHeight}, the node draws 20x20`);
      }
      if (box.vectors !== 2) {
        problems.push(`${theme}: the icon has ${box.vectors} stroked paths, the node draws 2`);
      }
      if (box.border !== '0px') {
        problems.push(`${theme}: the button draws a ${box.border} border the node does not have`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = iconRun.dark;
    return `${box.width}x${box.height}, ${box.iconWidth} px icon inset ${box.insetLeft} px, radius ${box.radius}, surface fill and muted icon in both themes`;
  });

  // Button / Pill (design node 0:3599, the segmented control's active chip).
  // Built as markup on the live page rather
  // than through a view, because the composer's mode selector (where the node's
  // "Ask" chip belongs) is its own card. The numbers still come from the
  // stylesheet in force, not from a copy of them here.
  const pillRun = await window.webContents.executeJavaScript(`(async () => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'btn-pill';
    pill.textContent = 'Ask';
    // The rule transitions fill and label, so a reading taken straight after the
    // theme swap would catch the control mid-fade. Pin it to the resting state.
    pill.style.transition = 'none';
    document.body.append(pill);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    // The node is 47 px wide because its "Ask" label is 23 px between 16 px of
    // padding, so the check reads the label and confirms the pill hugs it.
    const label = document.createRange();
    label.selectNodeContents(pill);
    const labelWidth = label.getBoundingClientRect().width;

    const readBox = () => {
      const style = getComputedStyle(pill);
      const box = pill.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        labelWidth: Math.round(labelWidth),
        padding: style.paddingLeft + ' ' + style.paddingRight,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        border: style.borderTopWidth,
      };
    };
    const readTokens = () => ({
      soft: colourToken('--zuri-primary-soft'),
      softForeground: colourToken('--zuri-primary-soft-foreground'),
      pillRadius: radiusToken('--zuri-radius-pill'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    pill.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Pill matches node 0:3599: the active mode chip', () => {
    const problems = [];

    for (const [theme, run] of [['dark', pillRun.dark], ['light', pillRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 22) problems.push(`${theme}: the box is ${box.height} px tall, the node is 22`);
      if (box.padding !== '16px 16px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 16 px each side`);
      }
      if (box.width !== box.labelWidth + 32) {
        problems.push(`${theme}: the pill is ${box.width} px wide for a ${box.labelWidth} px label, the node adds 16 px of padding each side`);
      }
      if (box.radius !== tokens.pillRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/pill (${tokens.pillRadius})`);
      }
      if (box.background !== tokens.soft) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/primary-soft (${tokens.soft})`);
      }
      if (box.color !== tokens.softForeground) {
        problems.push(`${theme}: the label is ${box.color}, the node binds color/primary-soft-foreground (${tokens.softForeground})`);
      }
      if (box.fontSize !== '14px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the label is ${box.fontSize} at weight ${box.fontWeight}, the node sets 14 px regular`);
      }
      if (box.border !== '0px') {
        problems.push(`${theme}: the pill draws a ${box.border} border the node does not have`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = pillRun.dark;
    return `${box.width}x${box.height} pill around a ${box.labelWidth} px label, ${box.padding} padding, radius ${box.radius}, primary-soft fill and its 14 px foreground label in both themes`;
  });

  // Nav / Avatar Chip (design node 0:76). Built as markup on the live page rather
  // than through a view, because no screen places the component yet: the design's
  // top bar (node 0:78) draws its own copy at 0:91. The initials are the person's,
  // so the sample "AK" is the node's. The numbers still come from the stylesheet
  // in force, not from a copy of them here.
  const avatarRun = await window.webContents.executeJavaScript(`(async () => {
    const chip = document.createElement('span');
    chip.className = 'nav-avatar-chip';
    const initials = document.createElement('span');
    initials.className = 'nav-avatar-chip-initials';
    initials.textContent = 'AK';
    chip.append(initials);
    document.body.append(chip);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    const readBox = () => {
      const style = getComputedStyle(chip);
      const textStyle = getComputedStyle(initials);
      const box = chip.getBoundingClientRect();
      const text = initials.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        shadow: style.boxShadow,
        colour: textStyle.color,
        fontSize: textStyle.fontSize,
        lineHeight: textStyle.lineHeight,
        fontWeight: textStyle.fontWeight,
        textWidth: Math.round(text.width),
        textHeight: Math.round(text.height),
        insetLeft: Math.round(text.left - box.left),
        insetRight: Math.round(box.right - text.right),
        insetTop: Math.round(text.top - box.top),
        insetBottom: Math.round(box.bottom - text.bottom),
      };
    };
    const readTokens = () => ({
      accent: colourToken('--zuri-accent'),
      inverse: colourToken('--zuri-text-on-accent'),
      pillRadius: radiusToken('--zuri-radius-pill'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    chip.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Nav / Avatar Chip matches node 0:76', () => {
    const problems = [];

    for (const [theme, run] of [['dark', avatarRun.dark], ['light', avatarRun.light]]) {
      const { box, tokens } = run;
      if (box.width !== 28 || box.height !== 28) {
        problems.push(`${theme}: the chip is ${box.width}x${box.height}, the node is 28x28`);
      }
      if (box.radius !== tokens.pillRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/pill (${tokens.pillRadius})`);
      }
      if (box.background !== tokens.accent) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/accent (${tokens.accent})`);
      }
      if (box.colour !== tokens.inverse) {
        problems.push(`${theme}: the initials are ${box.colour}, the node binds color/inverse (${tokens.inverse})`);
      }
      if (box.fontSize !== '12px' || box.lineHeight !== '16px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the initials are ${box.fontSize}/${box.lineHeight} at weight ${box.fontWeight}, the node sets 12/16 regular`);
      }
      // The node insets the text 6 px on every side, which is where centring the
      // sample's 17 x 16 box lands: the text box has to stay the line's 16 px tall
      // and sit 6 px from the top and bottom, and 5.5 px a side before rounding.
      if (box.textHeight !== 16) {
        problems.push(`${theme}: the text box is ${box.textHeight} px tall, the node's line is 16`);
      }
      if (box.insetTop !== 6 || box.insetBottom !== 6) {
        problems.push(`${theme}: the initials sit ${box.insetTop}/${box.insetBottom} px from the top and bottom, the node centres them at 6`);
      }
      if (Math.abs(box.insetLeft - box.insetRight) > 1) {
        problems.push(`${theme}: the initials sit ${box.insetLeft}/${box.insetRight} px from the sides, the node centres them`);
      }
      if (box.border !== '0px') {
        problems.push(`${theme}: the chip draws a ${box.border} border the node does not have`);
      }
      if (box.shadow !== 'none') {
        problems.push(`${theme}: the chip draws a ${box.shadow} shadow the node does not have`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = avatarRun.dark;
    return `${box.width}x${box.height}, radius ${box.radius}, accent fill, inverse ${box.fontSize}/${box.lineHeight} initials centred ${box.insetTop} px from the top in both themes`;
  });

  // Button / Primary (design node 0:6). Built as markup on the live page rather
  // than through a view, because the composer's send button (where the node's
  // "Send" label belongs) is its own card. The numbers still come from the
  // stylesheet in force, not from a copy of them here.
  const primaryRun = await window.webContents.executeJavaScript(`(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-primary';
    button.textContent = 'Send';
    // The rule transitions the fill, so a reading taken straight after the theme
    // swap would catch the control mid-fade. Pin it to the resting state.
    button.style.transition = 'none';
    document.body.append(button);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    // The node is 64 px wide because its "Send" label is 32 px between 16 px of
    // padding, so the check reads the label and confirms the button hugs it.
    const label = document.createRange();
    label.selectNodeContents(button);
    const labelWidth = label.getBoundingClientRect().width;

    const readBox = () => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        labelWidth: Math.round(labelWidth),
        padding: style.paddingLeft + ' ' + style.paddingRight,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        border: style.borderTopWidth,
      };
    };
    const readTokens = () => ({
      accent: colourToken('--zuri-accent'),
      onAccent: colourToken('--zuri-text-on-accent'),
      rowRadius: radiusToken('--zuri-radius-row'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    button.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Primary matches node 0:6', () => {
    const problems = [];

    for (const [theme, run] of [['dark', primaryRun.dark], ['light', primaryRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 32) {
        problems.push(`${theme}: the box is ${box.height} px tall, the node is 32`);
      }
      if (box.padding !== '16px 16px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 16 px each side`);
      }
      if (box.width !== box.labelWidth + 32) {
        problems.push(`${theme}: the button is ${box.width} px wide for a ${box.labelWidth} px label, the node adds 16 px of padding each side`);
      }
      if (box.radius !== tokens.rowRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/row (${tokens.rowRadius})`);
      }
      if (box.background !== tokens.accent) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/primary (${tokens.accent})`);
      }
      if (box.color !== tokens.onAccent) {
        problems.push(`${theme}: the label is ${box.color}, the node binds color/inverse (${tokens.onAccent})`);
      }
      if (box.fontSize !== '13px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the label is ${box.fontSize} at weight ${box.fontWeight}, the node sets 13 px regular`);
      }
      if (box.border !== '0px') {
        problems.push(`${theme}: the button draws a ${box.border} border the node does not have`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = primaryRun.dark;
    return `${box.width}x${box.height} filled button around a ${box.labelWidth} px label, ${box.padding} padding, radius ${box.radius}, accent fill and on-accent 13 px label in both themes`;
  });

  // Button / Small (design node 0:16). Built as markup on the live page rather
  // than through a view, because the quiet action it belongs to (a section's
  // "Skip for now") is its own card. The numbers still come from the stylesheet in
  // force, not from a copy of them here. Node 0:16 is a 36 px text-only control:
  // it draws no fill and no outline, so there is no hairline or 1 px reference to
  // compare against.
  const smallRun = await window.webContents.executeJavaScript(`(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-small';
    button.textContent = 'Add task';
    // The rule transitions the fill and the outline, so a reading taken straight
    // after the theme swap would catch the control mid-fade. Pin it to the
    // resting state.
    button.style.transition = 'none';
    document.body.append(button);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };

    // The node is 110 px wide because its "Skip for now" label is 78 px between
    // 16 px of padding, so the check reads the label and confirms the button hugs
    // it. The probe's own label is shorter, which is why the width is checked
    // against the measured label rather than a copied 110.
    const label = document.createRange();
    label.selectNodeContents(button);
    const labelWidth = label.getBoundingClientRect().width;

    const readBox = () => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        labelWidth: Math.round(labelWidth),
        padding: style.paddingLeft + ' ' + style.paddingRight,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        borderWidth: style.borderTopWidth,
        borderColour: style.borderTopColor,
      };
    };
    const readTokens = () => ({
      subtle: colourToken('--zuri-text-subtle'),
      lgRadius: radiusToken('--zuri-radius-lg'),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    button.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Button / Small matches node 0:16', () => {
    const problems = [];

    for (const [theme, run] of [['dark', smallRun.dark], ['light', smallRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 36) {
        problems.push(`${theme}: the box is ${box.height} px tall, the node is 36`);
      }
      if (box.padding !== '16px 16px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 16 px each side`);
      }
      // The node draws no outline, so the button is the label plus 16 px of
      // padding on each side and nothing else.
      if (box.width !== box.labelWidth + 32) {
        problems.push(`${theme}: the button is ${box.width} px wide for a ${box.labelWidth} px label, the node adds 16 px of padding each side and no outline`);
      }
      if (box.radius !== tokens.lgRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius-lg (${tokens.lgRadius})`);
      }
      if (box.background !== 'rgba(0, 0, 0, 0)') {
        problems.push(`${theme}: the fill is ${box.background}, the node draws none`);
      }
      if (box.color !== tokens.subtle) {
        problems.push(`${theme}: the label is ${box.color}, the node binds color/text-subtle (${tokens.subtle})`);
      }
      if (box.fontSize !== '14px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the label is ${box.fontSize} at weight ${box.fontWeight}, the node sets 14 px regular`);
      }
      if (box.borderWidth !== '0px') {
        problems.push(`${theme}: the outline is ${box.borderWidth}, the node draws none`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = smallRun.dark;
    return `${box.width}x${box.height} button around a ${box.labelWidth} px label, ${box.padding} padding, radius ${box.radius}, no fill or outline and a subtle 14 px label in both themes`;
  });

  // Card / Default (design node 0:84, "Card / Base"). Built as markup on the live page rather
  // than through a view, because the views that will hold cards (the context
  // panel's active work, a chat summary) are their own cards. The numbers still
  // come from the stylesheet in force, not from a copy of them here.
  const cardRun = await window.webContents.executeJavaScript(`(async () => {
    const card = document.createElement('article');
    card.className = 'card';
    const title = document.createElement('h2');
    title.className = 'card-heading';
    title.textContent = 'Q4 summary';
    const text = document.createElement('p');
    text.className = 'card-body';
    text.textContent = 'Drafted from the open Excel workbook and saved to Documents.';
    const meta = document.createElement('p');
    meta.className = 'card-subtitle';
    meta.textContent = 'Autopilot - Today 09:30';
    card.append(title, text, meta);
    // A theme swap can animate a surface; pin the card to its resting state so the
    // reading is not caught mid-fade.
    card.style.transition = 'none';
    document.body.append(card);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const borderToken = (name) => {
      probe.style.borderTopColor = 'var(' + name + ')';
      probe.style.borderTopStyle = 'solid';
      return getComputedStyle(probe).borderTopColor;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };
    // A 1 px outline does not read back as "1px" on a scaled display, so the
    // expected weight is measured from a 1 px reference under the same conditions.
    const onePixelBorder = () => {
      probe.style.borderWidth = '1px';
      probe.style.borderStyle = 'solid';
      return getComputedStyle(probe).borderTopWidth;
    };

    // The node's 160 px height is its sample copy (a 44 px header row, a two-line
    // body, a 24 px footer row, two 12 px gaps and 40 px of padding), so the check
    // reads the rhythm and the 280 px measure instead of a height that any other
    // body copy would change.
    const readBox = () => {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      const metaBox = meta.getBoundingClientRect();
      const titleStyle = getComputedStyle(title);
      const textStyle = getComputedStyle(text);
      const metaStyle = getComputedStyle(meta);
      return {
        width: Math.round(box.width),
        padding: style.paddingTop + ' ' + style.paddingRight + ' ' + style.paddingBottom + ' ' + style.paddingLeft,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderColour: style.borderTopColor,
        shadow: style.boxShadow,
        titleInset: Math.round(titleBox.top - box.top),
        titleGap: Math.round(textBox.top - titleBox.bottom),
        metaGap: Math.round(metaBox.top - textBox.bottom),
        bottomInset: Math.round(box.bottom - metaBox.bottom),
        measure: Math.round(textBox.width),
        title: {
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight,
          fontWeight: titleStyle.fontWeight,
          color: titleStyle.color,
        },
        text: {
          fontSize: textStyle.fontSize,
          lineHeight: textStyle.lineHeight,
          fontWeight: textStyle.fontWeight,
          color: textStyle.color,
        },
        meta: {
          fontSize: metaStyle.fontSize,
          lineHeight: metaStyle.lineHeight,
          fontWeight: metaStyle.fontWeight,
          color: metaStyle.color,
        },
      };
    };
    const readTokens = () => ({
      raised: colourToken('--zuri-surface-raised'),
      text: colourToken('--zuri-text-primary'),
      subtle: colourToken('--zuri-text-subtle'),
      hairline: borderToken('--zuri-border-hairline'),
      cardRadius: radiusToken('--zuri-base-card-radius'),
      onePx: onePixelBorder(),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    card.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Card / Default matches node 0:84', () => {
    const problems = [];

    for (const [theme, run] of [['dark', cardRun.dark], ['light', cardRun.light]]) {
      const { box, tokens } = run;
      // A CSS outline is a border, so it adds its own width to the 20 px padding
      // inset. The node's stroke sits inside its frame instead, which leaves the
      // same 1 px difference the other card probes accept; measuring the reference
      // border keeps that difference sub-pixel at a scaled display.
      const outline = parseFloat(tokens.onePx);
      const inset = Math.round(20 + outline);
      const measure = Math.round(320 - 40 - 2 * outline);
      if (box.width !== 320) {
        problems.push(`${theme}: the card is ${box.width} px wide, the node is 320`);
      }
      if (box.padding !== '20px 20px 20px 20px') {
        problems.push(`${theme}: the padding is ${box.padding}, the node keeps 20 px on every side`);
      }
      if (box.titleInset !== inset || box.bottomInset !== inset) {
        problems.push(`${theme}: the text sits ${box.titleInset} px from the top and ${box.bottomInset} px from the bottom, the node pads 20 px inside a ${outline} px outline`);
      }
      if (box.titleGap !== 12 || box.metaGap !== 12) {
        problems.push(`${theme}: the gaps between title, body and meta are ${box.titleGap} px and ${box.metaGap} px, the node uses 12 px`);
      }
      if (box.measure !== measure) {
        problems.push(`${theme}: the body wraps in ${box.measure} px, the node's 20 px padding inside its outline leaves ${measure}`);
      }
      if (box.radius !== tokens.cardRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/xl (${tokens.cardRadius})`);
      }
      if (box.background !== tokens.raised) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/surface-raised (${tokens.raised})`);
      }
      if (box.borderWidth !== tokens.onePx || box.borderColour !== tokens.hairline) {
        problems.push(`${theme}: the outline is ${box.borderWidth} ${box.borderColour}, the node draws 1 px color/border (${tokens.hairline})`);
      }
      if (box.shadow !== 'none') {
        problems.push(`${theme}: the card draws ${box.shadow}, the node has no shadow`);
      }
      if (box.title.fontSize !== '16px' || box.title.lineHeight !== '24px' || box.title.fontWeight !== '600') {
        problems.push(`${theme}: the title is ${box.title.fontSize} on ${box.title.lineHeight} at weight ${box.title.fontWeight}, the node sets 16/24 semibold`);
      }
      if (box.title.color !== tokens.text) {
        problems.push(`${theme}: the title is ${box.title.color}, the node binds color/text (${tokens.text})`);
      }
      if (box.text.fontSize !== '14px' || box.text.lineHeight !== '22px' || box.text.fontWeight !== '400') {
        problems.push(`${theme}: the body is ${box.text.fontSize} on ${box.text.lineHeight} at weight ${box.text.fontWeight}, the node sets 14/22 regular`);
      }
      if (box.text.color !== tokens.subtle) {
        problems.push(`${theme}: the body is ${box.text.color}, the node binds color/text-subtle (${tokens.subtle})`);
      }
      if (box.meta.fontSize !== '13px' || box.meta.lineHeight !== '20px' || box.meta.fontWeight !== '400') {
        problems.push(`${theme}: the meta line is ${box.meta.fontSize} on ${box.meta.lineHeight} at weight ${box.meta.fontWeight}, the node sets 13/20 regular`);
      }
      if (box.meta.color !== tokens.subtle) {
        problems.push(`${theme}: the meta line is ${box.meta.color}, the node binds color/text-subtle (${tokens.subtle})`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = cardRun.dark;
    return `${box.width} px card, ${box.padding} padding on a 12 px rhythm over a ${box.measure} px measure, radius ${box.radius}, surface-raised fill, 1 px hairline outline, 16/24 semibold title, 14/22 body and 13/20 subtle meta in both themes`;
  });


  // Card / Raised (design node 0:58). Same probe as the default card: the numbers
  // come from the stylesheet in force, and the two things the node changes are the
  // fill (color/raised) and the drop shadow. The shadow is compared against the
  // token itself rather than a copy of its value, because the browser rewrites a
  // box-shadow into its own order and rounding.
  const raisedRun = await window.webContents.executeJavaScript(`(async () => {
    const card = document.createElement('article');
    card.className = 'card-raised';
    const title = document.createElement('h2');
    title.className = 'card-raised-title';
    title.textContent = 'Provider connected';
    const text = document.createElement('p');
    text.className = 'card-raised-text';
    text.textContent = 'Anthropic - claude-sonnet-4 - keys stored in Windows Credential Manager.';
    const meta = document.createElement('p');
    meta.className = 'card-raised-meta';
    meta.textContent = 'Checked 2 minutes ago';
    card.append(title, text, meta);
    card.style.transition = 'none';
    document.body.append(card);

    const probe = document.createElement('span');
    // Read a resting value: a theme swap can animate a shadow, and a probe caught
    // mid-fade would report an interpolated shadow that matches nothing.
    probe.style.transition = 'none';
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const borderToken = (name) => {
      probe.style.borderTopColor = 'var(' + name + ')';
      probe.style.borderTopStyle = 'solid';
      return getComputedStyle(probe).borderTopColor;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };
    const shadowToken = (name) => {
      probe.style.boxShadow = 'var(' + name + ')';
      return getComputedStyle(probe).boxShadow;
    };
    const onePixelBorder = () => {
      probe.style.borderWidth = '1px';
      probe.style.borderStyle = 'solid';
      return getComputedStyle(probe).borderTopWidth;
    };

    const readBox = () => {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        padding: style.paddingTop + ' ' + style.paddingRight + ' ' + style.paddingBottom + ' ' + style.paddingLeft,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderColour: style.borderTopColor,
        shadow: style.boxShadow,
        titleGap: Math.round(textBox.top - titleBox.bottom),
        measure: Math.round(textBox.width),
      };
    };
    const readTokens = () => ({
      raised: colourToken('--zuri-surface-raised'),
      hairline: borderToken('--zuri-border-hairline'),
      cardRadius: radiusToken('--zuri-radius-card'),
      raisedShadow: shadowToken('--zuri-shadow-raised'),
      onePx: onePixelBorder(),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    card.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Card / Raised matches node 0:58', () => {
    const problems = [];

    for (const [theme, run] of [['dark', raisedRun.dark], ['light', raisedRun.light]]) {
      const { box, tokens } = run;
      const outline = parseFloat(tokens.onePx);
      const measure = Math.round(320 - 32 - 2 * outline);
      if (box.width !== 320) {
        problems.push(`${theme}: the raised card is ${box.width} px wide, the node is 320`);
      }
      if (box.padding !== '16px 16px 16px 16px') {
        problems.push(`${theme}: the padding is ${box.padding}, the node keeps 16 px on every side`);
      }
      if (box.titleGap !== 8) {
        problems.push(`${theme}: the gap under the title is ${box.titleGap} px, the node uses 8 px`);
      }
      if (box.measure !== measure) {
        problems.push(`${theme}: the body wraps in ${box.measure} px, the node's 16 px padding inside its outline leaves ${measure}`);
      }
      if (box.radius !== tokens.cardRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/card (${tokens.cardRadius})`);
      }
      if (box.background !== tokens.raised) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/raised (${tokens.raised})`);
      }
      if (box.borderWidth !== tokens.onePx || box.borderColour !== tokens.hairline) {
        problems.push(`${theme}: the outline is ${box.borderWidth} ${box.borderColour}, the node draws 1 px color/border (${tokens.hairline})`);
      }
      // The node's only separation from Card / Default is the shadow, so a card
      // that reads back as none has lost the reason it exists.
      if (tokens.raisedShadow === 'none' || box.shadow === 'none') {
        problems.push(`${theme}: the raised card draws no shadow, the node draws 0 8px 24px`);
      }
      if (box.shadow !== tokens.raisedShadow) {
        problems.push(`${theme}: the shadow is ${box.shadow}, the node binds the raised shadow token (${tokens.raisedShadow})`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = raisedRun.dark;
    return `${box.width} px card, ${box.padding} padding on an 8 px rhythm over a ${box.measure} px measure, radius ${box.radius}, raised fill, 1 px hairline outline and the node's drop shadow in both themes`;
  });

  // Card / Glass (design node 0:105). The same probe shape as the two cards above,
  // reading the five values this node binds: a 20 px inset, the radius its radius-xl
  // binding resolves to, the translucent glass-surface fill, the 1 px glass-border
  // and a body on color/text-subtle. The two glass colours carry alpha, so they are
  // compared against the tokens rather than against a copy of 0.702 and 0.4 here.
  const glassRun = await window.webContents.executeJavaScript(`(async () => {
    const card = document.createElement('article');
    card.className = 'card-glass';
    const title = document.createElement('h2');
    title.className = 'card-glass-title';
    title.textContent = 'Pinned to Autopilot';
    const text = document.createElement('p');
    text.className = 'card-glass-text';
    text.textContent = 'Floating panels and the compact overlay use the glass-surface token over app content.';
    card.append(title, text);
    // A theme swap can animate a surface; pin the card to its resting state so the
    // reading is not caught mid-fade.
    card.style.transition = 'none';
    document.body.append(card);

    const probe = document.createElement('span');
    probe.style.transition = 'none';
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const borderToken = (name) => {
      probe.style.borderTopColor = 'var(' + name + ')';
      probe.style.borderTopStyle = 'solid';
      return getComputedStyle(probe).borderTopColor;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };
    const onePixelBorder = () => {
      probe.style.borderWidth = '1px';
      probe.style.borderStyle = 'solid';
      return getComputedStyle(probe).borderTopWidth;
    };

    // The node is 140 px tall because its sample copy is: a 24 px title, an 8 px gap
    // and a two-line 44 px body between 20 px insets. The card states that height as
    // a minimum, so the check reads the width, the height the sample copy produces
    // and the rhythm, then the copy's own steps, rather than trusting a fixed frame.
    const readBox = () => {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      const titleStyle = getComputedStyle(title);
      const textStyle = getComputedStyle(text);
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        padding: style.paddingTop + ' ' + style.paddingRight + ' ' + style.paddingBottom + ' ' + style.paddingLeft,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderColour: style.borderTopColor,
        shadow: style.boxShadow,
        titleInset: Math.round(titleBox.top - box.top),
        titleGap: Math.round(textBox.top - titleBox.bottom),
        measure: Math.round(textBox.width),
        title: {
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight,
          fontWeight: titleStyle.fontWeight,
          color: titleStyle.color,
        },
        text: {
          fontSize: textStyle.fontSize,
          lineHeight: textStyle.lineHeight,
          fontWeight: textStyle.fontWeight,
          color: textStyle.color,
        },
      };
    };
    const readTokens = () => ({
      text: colourToken('--zuri-text-primary'),
      subtle: colourToken('--zuri-text-subtle'),
      glassSurface: colourToken('--zuri-glass-card-surface'),
      glassBorder: borderToken('--zuri-glass-card-border'),
      glassRadius: radiusToken('--zuri-glass-card-radius'),
      onePx: onePixelBorder(),
    });

    const previousTheme = document.documentElement.dataset.theme;
    const dark = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = 'light';
    const light = { box: readBox(), tokens: readTokens() };
    document.documentElement.dataset.theme = previousTheme;

    card.remove();
    probe.remove();
    return { dark, light };
  })()`);

  report.check('the Card / Glass matches node 0:105', () => {
    const problems = [];

    for (const [theme, run] of [['dark', glassRun.dark], ['light', glassRun.light]]) {
      const { box, tokens } = run;
      const outline = parseFloat(tokens.onePx);
      const inset = Math.round(20 + outline);
      const measure = Math.round(320 - 40 - 2 * outline);
      if (box.width !== 320) {
        problems.push(`${theme}: the glass card is ${box.width} px wide, the node is 320`);
      }
      if (box.height !== 140) {
        problems.push(`${theme}: the glass card is ${box.height} px tall, the node is 140 on its sample copy`);
      }
      if (box.padding !== '20px 20px 20px 20px') {
        problems.push(`${theme}: the padding is ${box.padding}, the node keeps 20 px on every side`);
      }
      if (box.titleInset !== inset) {
        problems.push(`${theme}: the title sits ${box.titleInset} px from the top, the node pads 20 px inside a ${outline} px outline`);
      }
      if (box.titleGap !== 8) {
        problems.push(`${theme}: the gap under the title is ${box.titleGap} px, the node uses 8 px`);
      }
      if (box.measure !== measure) {
        problems.push(`${theme}: the body wraps in ${box.measure} px, the node's 20 px padding inside its outline leaves ${measure}`);
      }
      if (box.radius !== tokens.glassRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius-xl (${tokens.glassRadius})`);
      }
      // The card's whole reason to exist is the translucent fill, so a card that
      // read back opaque would have lost it.
      if (box.background !== tokens.glassSurface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds glass-surface (${tokens.glassSurface})`);
      }
      if (box.borderWidth !== tokens.onePx || box.borderColour !== tokens.glassBorder) {
        problems.push(`${theme}: the outline is ${box.borderWidth} ${box.borderColour}, the node draws 1 px glass-border (${tokens.glassBorder})`);
      }
      if (box.shadow !== 'none') {
        problems.push(`${theme}: the card draws ${box.shadow}, the node has no shadow`);
      }
      if (box.title.fontSize !== '16px' || box.title.lineHeight !== '24px' || box.title.fontWeight !== '600') {
        problems.push(`${theme}: the title is ${box.title.fontSize} on ${box.title.lineHeight} at weight ${box.title.fontWeight}, the node sets 16/24 semibold`);
      }
      if (box.title.color !== tokens.text) {
        problems.push(`${theme}: the title is ${box.title.color}, the node binds color/text (${tokens.text})`);
      }
      if (box.text.fontSize !== '14px' || box.text.lineHeight !== '22px' || box.text.fontWeight !== '400') {
        problems.push(`${theme}: the body is ${box.text.fontSize} on ${box.text.lineHeight} at weight ${box.text.fontWeight}, the node sets 14/22 regular`);
      }
      if (box.text.color !== tokens.subtle) {
        problems.push(`${theme}: the body is ${box.text.color}, the node binds color/text-subtle (${tokens.subtle})`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = glassRun.dark;
    return `${box.width}x${box.height} glass card, ${box.padding} padding on an 8 px rhythm over a ${box.measure} px measure, radius ${box.radius}, translucent glass-surface fill, 1 px glass-border, 16/24 semibold title and 14/22 subtle body in both themes`;
  });

  // Select / Menu (design nodes 0:61 and 0:43). One component with two halves - the
  // closed Input / Select and the menu it opens - so both are measured on the thing
  // the pages ship: a .select-field around a real <select>, enhanced by
  // ui/select.js, opening its three real rows, with one group label mounted into the
  // list because the node draws one (no screen has more than one group of choices
  // yet, so no page passes a label today). Everything is compared in both themes.
  const selectRun = await window.webContents.executeJavaScript(`(async () => {
    const { enhanceSelect } = await import('./ui/select.js');

    const field = document.createElement('div');
    field.className = 'select select-field';
    // The node is 320 px wide. .select only caps the width, so the probe states it.
    field.style.width = '320px';

    const select = document.createElement('select');
    select.className = 'select-control';
    select.id = 'probe-select-menu';
    for (const pair of [['Rename', 'rename'], ['Duplicate', 'duplicate'], ['Delete', 'delete']]) {
      const option = document.createElement('option');
      option.value = pair[1];
      option.textContent = pair[0];
      select.append(option);
    }
    // The current choice is what carries the node's selected fill and check mark.
    select.value = 'duplicate';

    const chevron = document.createElement('span');
    chevron.className = 'select-icon';
    chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>';

    field.append(select, chevron);
    document.body.append(field);

    const control = enhanceSelect(select);
    control.open();

    const menu = document.querySelector('.select-menu');
    const label = document.createElement('p');
    label.className = 'select-menu-label';
    label.textContent = 'Models';
    menu.prepend(label);

    const probe = document.createElement('span');
    document.body.append(probe);
    const colourToken = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const borderToken = (name) => {
      probe.style.borderTopColor = 'var(' + name + ')';
      probe.style.borderTopStyle = 'solid';
      return getComputedStyle(probe).borderTopColor;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };
    const shadowToken = (name) => {
      probe.style.boxShadow = 'var(' + name + ')';
      return getComputedStyle(probe).boxShadow;
    };
    const onePixelBorder = () => {
      probe.style.borderWidth = '1px';
      probe.style.borderStyle = 'solid';
      return getComputedStyle(probe).borderTopWidth;
    };

    const read = () => {
      const fieldStyle = getComputedStyle(field);
      const fieldBox = field.getBoundingClientRect();
      const triggerStyle = getComputedStyle(control.trigger);
      const iconBox = chevron.getBoundingClientRect();
      const menuStyle = getComputedStyle(menu);
      const menuBox = menu.getBoundingClientRect();
      const labelStyle = getComputedStyle(label);
      const labelBox = label.getBoundingClientRect();
      const rows = Array.from(menu.querySelectorAll('.select-menu-option'));
      return {
        field: {
          width: Math.round(fieldBox.width),
          height: Math.round(fieldBox.height),
          radius: fieldStyle.borderTopLeftRadius,
          background: fieldStyle.backgroundColor,
          borderWidth: fieldStyle.borderTopWidth,
          borderColour: fieldStyle.borderTopColor,
        },
        trigger: {
          paddingLeft: triggerStyle.paddingLeft,
          paddingRight: triggerStyle.paddingRight,
          fontSize: triggerStyle.fontSize,
          lineHeight: triggerStyle.lineHeight,
          color: triggerStyle.color,
        },
        chevron: {
          width: Math.round(iconBox.width),
          rightInset: Math.round(fieldBox.right - iconBox.right),
          color: getComputedStyle(chevron).color,
        },
        menu: {
          maxWidth: menuStyle.maxWidth,
          height: Math.round(menuBox.height),
          padding: menuStyle.padding,
          gap: menuStyle.rowGap,
          radius: menuStyle.borderTopLeftRadius,
          background: menuStyle.backgroundColor,
          borderWidth: menuStyle.borderTopWidth,
          borderColour: menuStyle.borderTopColor,
          shadow: menuStyle.boxShadow,
        },
        label: {
          height: Math.round(labelBox.height),
          fontSize: labelStyle.fontSize,
          lineHeight: labelStyle.lineHeight,
          fontWeight: labelStyle.fontWeight,
          color: labelStyle.color,
        },
        rows: rows.map((row) => {
          const style = getComputedStyle(row);
          return {
            height: Math.round(row.getBoundingClientRect().height),
            radius: style.borderTopLeftRadius,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontWeight: style.fontWeight,
            padding: style.padding,
            justify: style.justifyContent,
            background: style.backgroundColor,
            color: style.color,
          };
        }),
        selected: (() => {
          const chosen = rows.find((row) => row.getAttribute('aria-selected') === 'true');
          const style = getComputedStyle(chosen);
          const mark = getComputedStyle(chosen, '::after');
          return {
            background: style.backgroundColor,
            color: style.color,
            markContent: mark.content,
            markSide: mark.borderRightWidth,
            markSideColour: mark.borderRightColor,
            markFoot: mark.borderBottomWidth,
            markTurn: mark.transform,
          };
        })(),
        tokens: {
          fieldRadius: radiusToken('--zuri-radius-field'),
          menuRadius: radiusToken('--zuri-radius-card'),
          rowRadius: radiusToken('--zuri-radius-row'),
          surface: colourToken('--zuri-surface'),
          surfaceSecondary: colourToken('--zuri-surface-secondary'),
          hairline: borderToken('--zuri-border-hairline'),
          text: colourToken('--zuri-text-primary'),
          muted: colourToken('--zuri-text-muted'),
          accent: colourToken('--zuri-accent'),
          accentSubtle: colourToken('--zuri-accent-subtle'),
          subtle: colourToken('--zuri-text-subtle'),
          shadow: shadowToken('--zuri-shadow-raised'),
          onePx: onePixelBorder(),
        },
      };
    };

    const previousTheme = document.documentElement.dataset.theme;
    const dark = read();
    document.documentElement.dataset.theme = 'light';
    const light = read();
    document.documentElement.dataset.theme = previousTheme;

    control.close();
    control.destroy();
    field.remove();
    probe.remove();

    return { dark, light };
  })()`);

  report.check('the Select / Menu matches nodes 0:61 and 0:43', () => {
    const problems = [];
    // A 1 px stroke does not read back as exactly 1 on a scaled display, so the
    // insets the stroke shifts are allowed the same 1 px.
    const near = (actual, expected) => Math.abs(actual - expected) <= 1;

    for (const theme of ['dark', 'light']) {
      const run = selectRun[theme];
      const { field, trigger, chevron, menu, label, rows, selected, tokens } = run;
      const stroke = Math.round(parseFloat(tokens.onePx));

      // The closed control, Input / Select (node 0:61).
      if (field.width !== 320 || field.height !== 40) {
        problems.push(theme + ': the closed control is ' + field.width + 'x' + field.height + ', the node is 320x40');
      }
      if (field.radius !== tokens.fieldRadius) {
        problems.push(theme + ': the field corner is ' + field.radius + ', the node binds radius/md (' + tokens.fieldRadius + ')');
      }
      if (field.background !== tokens.surfaceSecondary) {
        problems.push(theme + ': the field fill is ' + field.background + ', the node binds color/surface-secondary (' + tokens.surfaceSecondary + ')');
      }
      if (parseFloat(field.borderWidth) > 0) {
        problems.push(theme + ': the field edge is ' + field.borderWidth + ' ' + field.borderColour + ', the control is a flat fill with no outline');
      }
      if (trigger.paddingLeft !== '12px' || trigger.paddingRight !== '40px') {
        problems.push(theme + ': the value is padded ' + trigger.paddingLeft + ' left and ' + trigger.paddingRight + ' right, the node puts it 12 px in and keeps 24 + 16 px for the chevron');
      }
      if (trigger.fontSize !== '14px' || trigger.lineHeight !== '22px') {
        problems.push(theme + ': the value is ' + trigger.fontSize + ' on ' + trigger.lineHeight + ', the node sets 14/22');
      }
      if (trigger.color !== tokens.text) {
        problems.push(theme + ': the value is ' + trigger.color + ', the node binds color/text (' + tokens.text + ')');
      }
      if (chevron.width !== 16 || !near(chevron.rightInset, 24 + stroke)) {
        problems.push(theme + ': the chevron is ' + chevron.width + ' px wide and sits ' + chevron.rightInset + ' px in from the edge, the node draws 16 px at 24 inside its stroke');
      }
      if (chevron.color !== tokens.subtle) {
        problems.push(theme + ': the chevron is ' + chevron.color + ', the node binds color/text-subtle (' + tokens.subtle + ')');
      }

      // The open menu (node 0:43): 260 wide on color/background inside a 1 px edge on
      // the radius/card corner, with the card's raised shadow.
      if (menu.maxWidth !== '260px') {
        problems.push(theme + ': the menu caps at ' + menu.maxWidth + ', the node is 260 px wide');
      }
      if (!near(parseFloat(menu.padding), 8 - stroke)) {
        problems.push(theme + ': the menu pads ' + menu.padding + ', the node insets its content 8 px less the 1 px edge');
      }
      if (menu.gap !== '4px') {
        problems.push(theme + ': the menu stacks its parts ' + menu.gap + ' apart, the node uses the 4 px spacing step');
      }
      if (menu.radius !== tokens.menuRadius) {
        problems.push(theme + ': the menu corner is ' + menu.radius + ', the node binds the card radius (' + tokens.menuRadius + ')');
      }
      if (menu.background !== tokens.surface) {
        problems.push(theme + ': the menu fill is ' + menu.background + ', the node binds color/background (' + tokens.surface + ')');
      }
      if (menu.borderWidth !== tokens.onePx || menu.borderColour !== tokens.hairline) {
        problems.push(theme + ': the menu edge is ' + menu.borderWidth + ' ' + menu.borderColour + ', the node draws 1 px color/border (' + tokens.hairline + ')');
      }
      if (menu.shadow !== tokens.shadow) {
        problems.push(theme + ': the menu casts ' + menu.shadow + ', the node carries the raised shadow (' + tokens.shadow + ')');
      }

      // The height is the node's arithmetic, not a written number: the two 7 px
      // insets, the two 1 px edges, the 16 px label, the 4 px gaps around the three
      // 28 px rows add up to the node's 128. Measured parts carry the display's
      // fraction, so the sum is allowed the same 1 px as every other inset.
      const parts = parseFloat(menu.padding) * 2 + parseFloat(menu.borderWidth) * 2 + label.height +
        parseFloat(menu.gap) * 3 + 28 * 3;
      if (!near(menu.height, parts)) {
        problems.push(theme + ': the menu is ' + menu.height + ' px tall, its own parts add up to ' + parts);
      }

      // The group label (node 0:46): 12 px on a 16 px line, regular, in color/muted.
      if (label.fontSize !== '12px' || label.lineHeight !== '16px' || label.fontWeight !== '400') {
        problems.push(theme + ': the group label is ' + label.fontSize + '/' + label.lineHeight + ' at weight ' + label.fontWeight + ', the node sets 12/16 regular');
      }
      if (label.color !== tokens.muted) {
        problems.push(theme + ': the group label is ' + label.color + ', the node binds color/muted (' + tokens.muted + ')');
      }

      // The option rows: 28 px on the radius/row corner, color/background fill,
      // color/text label at 13/18, the 8 px inset, and the mark on the far edge.
      if (rows.length !== 3) problems.push(theme + ': the list drew ' + rows.length + ' rows, the node draws 3');
      rows.forEach((row, index) => {
        const where = theme + ': row ' + (index + 1);
        if (row.height !== 28) problems.push(where + ' is ' + row.height + ' px tall, the node draws 28');
        if (row.radius !== tokens.rowRadius) problems.push(where + ' has a ' + row.radius + ' corner, the node binds the row radius (' + tokens.rowRadius + ')');
        if (row.fontSize !== '13px' || row.lineHeight !== '18px' || row.fontWeight !== '400') {
          problems.push(where + ' is ' + row.fontSize + '/' + row.lineHeight + ' at weight ' + row.fontWeight + ', the node sets 13/18 regular');
        }
        if (row.padding !== '0px 8px') problems.push(where + ' pads ' + row.padding + ', the node insets the label by the 8 px spacing step');
        if (row.justify !== 'space-between') problems.push(where + ' lays out as ' + row.justify + ', so the mark is not held on the far edge');
      });
      const resting = rows.find((row, index) => index !== 1);
      if (resting.background !== tokens.surface) {
        problems.push(theme + ': a resting row is filled ' + resting.background + ', the node fills every row with color/background (' + tokens.surface + ')');
      }
      if (resting.color !== tokens.text) {
        problems.push(theme + ': a resting row is labelled ' + resting.color + ', the node binds color/text (' + tokens.text + ')');
      }

      // The current choice paints color/primary-soft and nothing else: the label
      // keeps color/text, which is why a recoloured label is a problem here.
      if (selected.background !== tokens.accentSubtle) {
        problems.push(theme + ': the chosen row is filled ' + selected.background + ', the node fills it with color/primary-soft (' + tokens.accentSubtle + ')');
      }
      if (selected.color !== tokens.text) {
        problems.push(theme + ': the chosen row is labelled ' + selected.color + ', the node keeps color/text (' + tokens.text + ')');
      }
      if (selected.markContent === 'none' || selected.markContent === 'normal') {
        problems.push(theme + ': the chosen row draws no check mark');
      }
      if (!near(parseFloat(selected.markSide), 1.33) || !near(parseFloat(selected.markFoot), 1.33)) {
        problems.push(theme + ': the check mark is stroked ' + selected.markSide + ' and ' + selected.markFoot + ', the node strokes 1.33');
      }
      if (selected.markSideColour !== tokens.accent) {
        problems.push(theme + ': the check mark is ' + selected.markSideColour + ', the node strokes color/primary (' + tokens.accent + ')');
      }
      if (!/matrix/.test(selected.markTurn)) {
        problems.push(theme + ': the check mark is not the turned box the node draws (' + selected.markTurn + ')');
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { field, menu, label, rows } = selectRun.light;
    return field.width + 'x' + field.height + ' closed control at radius ' + field.radius + ', a 260 px menu at radius ' +
      menu.radius + ' holding a ' + label.fontSize + '/' + label.lineHeight + ' label and ' + rows.length + ' rows of ' +
      rows[0].height + ' px, the chosen row on color/primary-soft with an accent tick, in both themes';
  });

  // Loading Dots block (design node 0:117). Built through the renderer's own
  // factory on the live page, so the numbers come from the stylesheet in force
  // rather than from a copy of them in this file.
  const dotsRun = await window.webContents.executeJavaScript(`(async () => {
    const { createLoadingDots, createMessageElement } = await import('./ui/composer.js');

    const bubble = createMessageElement({ role: 'assistant', content: '' });
    bubble.dataset.state = 'streaming';
    const dots = createLoadingDots();
    bubble.querySelector('.message-text').append(dots);
    document.body.append(bubble);

    const box = dots.getBoundingClientRect();
    const dotBoxes = Array.from(dots.querySelectorAll('.loading-dots-dot')).map((dot) => {
      const rect = dot.getBoundingClientRect();
      const style = getComputedStyle(dot);
      return {
        x: Math.round(rect.left - box.left),
        y: Math.round(rect.top - box.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        radius: style.borderTopLeftRadius,
        color: style.backgroundColor,
        opacity: style.opacity,
      };
    });

    // The theme's own values, resolved the way the block resolves them.
    const probe = document.createElement('span');
    document.body.append(probe);
    const tokenColor = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const muted = tokenColor('--zuri-text-muted');
    const surface = tokenColor('--zuri-surface');
    probe.remove();

    const textStyle = getComputedStyle(bubble.querySelector('.message-text'));
    const shapeStyle = getComputedStyle(bubble.querySelector('.message-bubble'));
    const result = {
      width: Math.round(box.width),
      height: Math.round(box.height),
      background: getComputedStyle(dots).backgroundColor,
      role: dots.getAttribute('role'),
      label: dots.getAttribute('aria-label'),
      dots: dotBoxes,
      muted,
      surface,
      textPadding: textStyle.paddingTop + ' ' + textStyle.paddingRight + ' ' + textStyle.paddingBottom + ' ' + textStyle.paddingLeft,
      textBackground: textStyle.backgroundColor,
      textOpacity: textStyle.opacity,
      // The shape moved from the words to the bubble, so the check reads the bubble
      // too: a card around the dots would be a box the node does not draw.
      shapePadding: shapeStyle.paddingTop + ' ' + shapeStyle.paddingRight + ' ' + shapeStyle.paddingBottom + ' ' + shapeStyle.paddingLeft,
      shapeBackground: shapeStyle.backgroundColor,
    };

    bubble.remove();
    return result;
  })()`);

  report.check('the Loading Dots block matches node 0:117', () => {
    if (dotsRun.width !== 20 || dotsRun.height !== 22) {
      throw new Error(`the block is ${dotsRun.width}x${dotsRun.height}, the node is 20x22`);
    }

    const placed = dotsRun.dots.map((dot) => `${dot.x},${dot.y} ${dot.width}x${dot.height}`);
    const wanted = ['0,9 4x4', '8,9 4x4', '16,9 4x4'];
    if (placed.join(' | ') !== wanted.join(' | ')) {
      throw new Error(`the dots sit at ${placed.join(' | ')}, the node has ${wanted.join(' | ')}`);
    }

    if (dotsRun.background !== dotsRun.surface) {
      throw new Error(`the block is filled ${dotsRun.background}, the node binds color/surface (${dotsRun.surface})`);
    }

    const wrongColour = dotsRun.dots.find((dot) => dot.color !== dotsRun.muted);
    if (wrongColour) throw new Error(`a dot is ${wrongColour.color}, the theme's color/muted is ${dotsRun.muted}`);

    const dimmed = dotsRun.dots.find((dot) => dot.opacity !== '1');
    if (dimmed) throw new Error(`a dot is at ${dimmed.opacity} opacity; the node draws all three solid`);

    const square = dotsRun.dots.find((dot) => Number.parseFloat(dot.radius) < dot.width / 2);
    if (square) throw new Error(`a dot has ${square.radius} of radius on a ${square.width}px box, so it is not round`);

    if (dotsRun.role !== 'img' || !dotsRun.label) {
      throw new Error(`the block carries no spoken label (role ${dotsRun.role}, label "${dotsRun.label}")`);
    }

    return `${dotsRun.width}x${dotsRun.height}, dots at ${placed.join(', ')}, ${dotsRun.muted}`;
  });

  report.check('a waiting reply shows the dots without a bubble around them', () => {
    if (dotsRun.textPadding !== '0px 0px 0px 0px' || dotsRun.shapePadding !== '0px 0px 0px 0px') {
      throw new Error(`the bubble keeps ${dotsRun.shapePadding} of padding around the dots (words: ${dotsRun.textPadding})`);
    }
    if (dotsRun.textBackground !== 'rgba(0, 0, 0, 0)' || dotsRun.shapeBackground !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`the bubble keeps its ${dotsRun.shapeBackground} background behind the dots (words: ${dotsRun.textBackground})`);
    }
    if (dotsRun.textOpacity !== '1') throw new Error(`the dots are dimmed to ${dotsRun.textOpacity}`);
    return 'the block is the only thing in the turn';
  });

  // The wiring, driven through the real composer with a stand-in bridge: the block
  // has to be on screen while the reply is awaited and gone once a token lands.
  const dotsLive = await window.webContents.executeJavaScript(`(async () => {
    const { createComposer } = await import('./ui/composer.js');

    const transcript = document.createElement('div');
    transcript.className = 'chat-transcript';
    const input = document.createElement('textarea');
    const sendButton = document.createElement('button');
    const composerRoot = document.createElement('div');
    const hero = document.createElement('div');
    // The shell's streaming row (node 0:944), as index.html ships it.
    const stream = document.createElement('div');
    stream.className = 'stream-status';
    stream.hidden = true;
    const streamLabel = document.createElement('p');
    const streamStop = document.createElement('button');
    streamStop.type = 'button';
    stream.append(streamLabel, streamStop);
    document.body.append(transcript, input, sendButton, composerRoot, hero, stream);
    input.value = 'Check the dots';

    let onToken = null;
    let releaseReply = () => {};
    const stopCalls = [];
    const standInChat = {
      send: () => new Promise((resolve) => { releaseReply = resolve; }),
      stop: async ({ threadId }) => {
        stopCalls.push(threadId);
        return { ok: true, data: { stopped: true } };
      },
      onStream: (handler) => {
        onToken = handler;
        return () => { onToken = null; };
      },
    };
    const standInChats = {
      appendMessage: async ({ message }) => ({
        ok: true,
        data: { message: { id: 'm1', ...message }, thread: { id: 't1', messages: [message] } },
      }),
    };

    const composer = createComposer({
      elements: { transcript, input, send: sendButton, composer: composerRoot, hero, stream, streamLabel, streamStop },
      chats: standInChats,
      chat: standInChat,
      ensureThread: async () => ({ id: 't1', messages: [] }),
      currentThread: () => ({ id: 't1', messages: [{ role: 'user', content: 'Check the dots' }] }),
      applyThread: () => {},
      report: () => {},
      clearReport: () => {},
    });

    const turn = () => transcript.querySelector('[data-role="assistant"]');
    const settle = (ticks) => new Promise((resolve) => setTimeout(resolve, ticks * 10));
    const pendingReply = composer.send();
    for (let tick = 0; tick < 40 && !turn(); tick += 1) await settle(1);

    const waiting = {
      dots: turn()?.querySelectorAll('.loading-dots').length ?? -1,
      dotsInsideBubble: turn()?.querySelectorAll('.message-text .loading-dots').length ?? -1,
      text: turn()?.querySelector('.message-text')?.textContent ?? '',
      streamHidden: stream.hidden,
      streamLabel: streamLabel.textContent,
      streamLast: transcript.lastElementChild === stream,
      composerState: composerRoot.dataset.state ?? '',
      inputDisabled: input.disabled,
      sendDisabled: sendButton.disabled,
    };

    // Stop is the row's one control: pressing it has to reach the bridge with the
    // thread that is streaming, not with whatever is on screen by then.
    composer.stop();
    for (let tick = 0; tick < 10 && stopCalls.length === 0; tick += 1) await settle(1);
    const stopped = { calls: stopCalls.slice(), stopDisabled: streamStop.disabled };

    if (typeof onToken === 'function') onToken({ threadId: 't1', delta: 'First token.' });
    await settle(1);
    const afterToken = {
      dots: turn()?.querySelectorAll('.loading-dots').length ?? -1,
      text: turn()?.querySelector('.message-text')?.textContent ?? '',
    };

    releaseReply({ ok: true, data: { message: { id: 'm2', content: 'First token.' } } });
    await pendingReply;
    const settled = {
      dots: turn()?.querySelectorAll('.loading-dots').length ?? -1,
      state: turn()?.dataset.state ?? '',
      streamHidden: stream.hidden,
      composerState: composerRoot.dataset.state ?? '',
      inputDisabled: input.disabled,
    };

    transcript.remove();
    input.remove();
    sendButton.remove();
    composerRoot.remove();
    hero.remove();
    stream.remove();

    return { waiting, stopped, afterToken, settled };
  })()`);

  report.check('a waiting reply shows the Loading Dots block', () => {
    if (dotsLive.waiting.dots !== 1) {
      throw new Error(`the reply turn holds ${dotsLive.waiting.dots} dots blocks while the reply is awaited`);
    }
    if (dotsLive.waiting.dotsInsideBubble !== 1) {
      throw new Error('the block is not inside the reply bubble');
    }
    return 'the block stands in for the reply text';
  });

  report.check('the first token replaces the Loading Dots block', () => {
    if (dotsLive.afterToken.dots !== 0) throw new Error('the block stayed after a token arrived');
    if (!dotsLive.afterToken.text.includes('First token.')) {
      throw new Error(`the bubble reads "${dotsLive.afterToken.text}" after the token`);
    }
    return 'block removed, token written in its place';
  });

  report.check('no Loading Dots block survives a settled reply', () => {
    if (dotsLive.settled.dots !== 0) throw new Error('the block outlived the reply');
    if (dotsLive.settled.state !== 'sent') throw new Error(`the turn settled as "${dotsLive.settled.state}"`);
    return 'state sent, no block';
  });

  // The disabled state of the shell (design node 0:823): while a reply is arriving
  // the composer is inert and the streaming row says what is happening.
  report.check('the streaming row holds the disabled state while a reply is in flight', () => {
    if (dotsLive.waiting.streamHidden) throw new Error('the streaming row stayed hidden during the reply');
    if (dotsLive.waiting.streamLabel !== 'Zuri is writing') {
      throw new Error(`the row reads "${dotsLive.waiting.streamLabel}"`);
    }
    if (!dotsLive.waiting.streamLast) throw new Error('the row is not the last thing in the transcript');
    if (dotsLive.waiting.composerState !== 'disabled') {
      throw new Error(`the composer is in state "${dotsLive.waiting.composerState}"`);
    }
    if (!dotsLive.waiting.inputDisabled) throw new Error('the input still takes text during the reply');
    if (!dotsLive.waiting.sendDisabled) throw new Error('send is still live during the reply');
    return 'row shown, composer inert';
  });

  report.check('the streaming row leaves and the composer returns when the reply settles', () => {
    if (!dotsLive.settled.streamHidden) throw new Error('the streaming row outlived the reply');
    if (dotsLive.settled.composerState !== 'ready') {
      throw new Error(`the composer stayed in state "${dotsLive.settled.composerState}"`);
    }
    if (dotsLive.settled.inputDisabled) throw new Error('the input is still disabled after the reply');
    return 'row hidden, composer ready';
  });

  report.check('Stop reaches the bridge with the thread that is streaming', () => {
    if (dotsLive.stopped.calls.length !== 1) {
      throw new Error(`Stop made ${dotsLive.stopped.calls.length} calls to main`);
    }
    if (dotsLive.stopped.calls[0] !== 't1') {
      throw new Error(`Stop asked about thread "${dotsLive.stopped.calls[0]}"`);
    }
    if (!dotsLive.stopped.stopDisabled) throw new Error('Stop stays pressable while the reply winds down');
    return 'chat.stop called once for t1';
  });

  // Loading Skeleton block (design node 0:296, "State / Skeleton Row"). Built
  // through the renderer's own factory on the live page, so the geometry and the
  // colours are read back from the stylesheet in force rather than copied into
  // this file.
  const skeletonRun = await window.webContents.executeJavaScript(`(async () => {
    const { createLoadingSkeleton } = await import('./ui/skeleton.js');

    const block = createLoadingSkeleton('Loading conversations');
    document.body.append(block);

    const box = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    // Computed colours arrive as rgb() or rgba(); the numbers in them are all
    // this needs, so they are read positionally rather than by syntax.
    const toRgba = (value) => {
      const text = String(value);
      const open = text.indexOf('(');
      if (open === -1) return null;
      const parts = text.slice(open + 1, text.lastIndexOf(')')).split(',').map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const offsets = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left - box.left),
        y: Math.round(rect.top - box.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const caption = block.querySelector('.loading-skeleton-caption');
    const captionStyle = getComputedStyle(caption);
    const captionBox = offsets(caption);

    const rows = Array.from(block.querySelectorAll('.loading-skeleton-row')).map((row) => {
      const disc = row.querySelector('.loading-skeleton-disc');
      const wide = row.querySelector('.loading-skeleton-bar--wide');
      const narrow = row.querySelector('.loading-skeleton-bar--narrow');
      return {
        ...offsets(row),
        disc: {
          ...offsets(disc),
          radius: Number.parseFloat(getComputedStyle(disc).borderTopLeftRadius),
          fill: toRgba(getComputedStyle(disc).backgroundColor),
        },
        wide: offsets(wide),
        narrow: {
          ...offsets(narrow),
          radius: Number.parseFloat(getComputedStyle(narrow).borderTopLeftRadius),
          fill: toRgba(getComputedStyle(narrow).backgroundColor),
        },
        // The node puts the short pill 12 px below the long one.
        pitch: Math.round(narrow.getBoundingClientRect().top - wide.getBoundingClientRect().top),
      };
    });

    // The theme's own values, resolved the way the block resolves them.
    const probe = document.createElement('span');
    document.body.append(probe);
    const tokenColor = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const surfaceToken = tokenColor('--zuri-surface-secondary');
    const tokens = {
      surface: toRgba(surfaceToken),
      sunken: toRgba(tokenColor('--zuri-surface-tertiary')),
      subtle: toRgba(tokenColor('--zuri-text-subtle')),
    };
    probe.remove();

    const result = {
      width: box.width,
      height: box.height,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
      fill: toRgba(style.backgroundColor),
      caption: {
        text: caption.textContent.trim(),
        size: captionStyle.fontSize,
        colour: toRgba(captionStyle.color),
        top: captionBox.y,
        height: captionBox.height,
      },
      rows,
      tokens,
      role: block.getAttribute('role'),
      label: block.getAttribute('aria-label'),
    };

    block.remove();
    return result;
  })()`);

  report.check('the Loading Skeleton block matches node 0:296', () => {
    const run = skeletonRun;
    const near = (value, expected) => Math.abs(value - expected) <= 0.01;
    const sameColour = (left, right) =>
      left && right && near(left.r, right.r) && near(left.g, right.g) && near(left.b, right.b) && near(left.a, right.a);

    if (Math.abs(run.width - 320) > 0.6) throw new Error(`the card is ${run.width}px wide, not the node's 320`);
    if (Math.abs(run.height - 159) > 0.6) throw new Error(`the card is ${run.height}px tall, not the node's 159`);
    if (run.radius !== 20) throw new Error(`the card radius is ${run.radius}px, not the node's radius-xl 20`);
    if (run.padding !== '20px 20px 20px 20px') throw new Error(`the card padding is ${run.padding}, not the node's 20`);
    if (!sameColour(run.fill, run.tokens.surface)) {
      throw new Error('the card is not filled with the theme colour/surface-secondary');
    }

    if (run.caption.text !== 'Loading list') {
      throw new Error(`the caption reads "${run.caption.text}", not the node's "Loading list"`);
    }
    if (run.caption.size !== '13px') throw new Error(`the caption is ${run.caption.size}, not the node's 13`);
    if (run.caption.top !== 20) throw new Error(`the caption starts at ${run.caption.top}px, not the node's 20`);
    if (run.caption.height !== 15) throw new Error(`the caption is ${run.caption.height}px tall, not the node's 15`);
    if (!sameColour(run.caption.colour, run.tokens.subtle)) {
      throw new Error('the caption is not the theme colour/text-subtle');
    }

    if (run.rows.length !== 2) throw new Error(`the block holds ${run.rows.length} rows, the node has 2`);
    const [first, second] = run.rows;
    // Padding 20 plus the caption's 15 and the 12 px rhythm: the node's 47, then
    // that plus the 40 px row and the same 12 px rhythm.
    if (first.y !== 47) throw new Error(`the first row starts at ${first.y}px, not the node's 47`);
    if (second.y !== 99) throw new Error(`the second row starts at ${second.y}px, not the node's 99`);

    const pills = run.rows.map((row) => `${row.wide.width}x${row.wide.height} / ${row.narrow.width}x${row.narrow.height}`);
    const wanted = ['228x12 / 140x12', '228x12 / 120x12'];
    if (pills.join(' | ') !== wanted.join(' | ')) {
      throw new Error(`the pills measure ${pills.join(' | ')}, the node has ${wanted.join(' | ')}`);
    }

    const oddRow = run.rows.filter((row) => row.height !== 40 || row.disc.width !== 40 || row.disc.height !== 40);
    if (oddRow.length) {
      throw new Error(`a row is not the node's 40 px with a 40 px disc (${oddRow.map((row) => `${row.height} / ${row.disc.width}x${row.disc.height}`).join(', ')})`);
    }
    const offPitch = run.rows.filter((row) => row.pitch !== 20);
    if (offPitch.length) {
      throw new Error(`a short pill sits ${offPitch[0].pitch}px below the long one, not the node's 20`);
    }
    const squared = run.rows.filter((row) => row.disc.radius < 999 || row.narrow.radius < 999);
    if (squared.length) throw new Error("a disc or pill is not on the node's radius-full");
    const miscoloured = run.rows.filter(
      (row) => !sameColour(row.disc.fill, run.tokens.sunken) || !sameColour(row.narrow.fill, run.tokens.sunken),
    );
    if (miscoloured.length) throw new Error('a shape is not filled with the theme colour/surface-tertiary');

    if (!run.role || !run.label) {
      throw new Error(`the block carries no spoken label (role ${run.role}, label "${run.label}")`);
    }

    return `320x159 card, caption and two 40 px rows, pills ${pills.join(', ')}`;
  });

  // The shell's acceptance is "it matches the design node it was drawn from", so
  // measure it at the node's own frame: 0:131 is 1440x900, a 52 px top bar over an
  // 848 px body split 260 / 860 / 320 across. Everything below is a number the
  // node draws, or a gap between two of them, not a number read back from CSS.
  const originalContent = window.getContentSize();
  await resizeAndSettle(window, 1440, 900);

  const shellMatch = await window.webContents.executeJavaScript(`(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
      };
    };
    const style = (element) => getComputedStyle(element);
    const topBar = document.querySelector('.top-bar');
    const trailing = Array.from(document.querySelector('.top-bar-trailing').children);
    const title = document.querySelector('.top-bar-title');
    const model = document.querySelector('.top-bar-model');

    // A detached probe resolves a token to the colour the compositor would paint,
    // so the columns can be compared against the token rather than a hex literal.
    const toneOf = (property) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(' + property + ')';
      document.body.appendChild(probe);
      const colour = style(probe).backgroundColor;
      probe.remove();
      return colour;
    };

    // tokens.json's radius/pill is 999 and HeroUI's full radius is 9999px; both
    // clamp to half the 28 px control height, so either reads as the node's pill.
    const pill = document.createElement('div');
    pill.style.borderRadius = 'var(--zuri-radius-pill)';
    document.body.appendChild(pill);
    const pillRadius = style(pill).borderRadius;
    pill.remove();

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      topBar: { ...box(topBar), borderBottom: parseFloat(style(topBar).borderBottomWidth) },
      body: box(document.querySelector('.shell')),
      columns: ['sidebar', 'chat', 'context-panel'].map((id) => {
        const column = document.getElementById(id);
        return { id, ...box(column), fill: style(column).backgroundColor };
      }),
      toggle: box(document.querySelector('.top-bar .shell-toggle') ?? document.querySelector('.sidebar-brand-toggle')),
      title: { ...box(title), fontSize: parseFloat(style(title).fontSize) },
      model: { ...box(model), radius: style(model).borderRadius },
      trailing: trailing.map(box),
      tones: {
        canvas: toneOf('--zuri-bg-canvas'),
        panel: toneOf('--zuri-surface-secondary'),
        surface: toneOf('--zuri-surface'),
        // The sidebar is the glass card from the "Sidebar conversation list" page
        // (node 0:1077), so its tone is the translucent one, not the panel grey.
        glass: toneOf('--zuri-sidebar-surface'),
      },
      pillRadius,
    };
  })()`);

  report.check('the App shell is drawn from node 0:466', () => {
    const near = (left, right, label) => {
      if (Math.abs(left - right) > 0.6) throw new Error(`${label} is ${left}, the node draws ${right}`);
    };
    const column = (id) => shellMatch.columns.find((entry) => entry.id === id);

    // 0:466 is 1200x800: a window-wide 56 px bar (0:132) over a 744 px body, then a
    // 260 px sidebar, a 12 px gutter and a 928 px workspace. At 1440 the workspace is
    // 1168 wide and the centre 1168 - 12 - 300 = 856.
    near(shellMatch.viewport.width, 1440, 'the measured viewport');
    near(shellMatch.viewport.height, 900, 'the measured viewport height');
    near(shellMatch.topBar.height, 56, 'the top bar height');
    near(shellMatch.topBar.width, 1440, 'the top bar width');
    near(shellMatch.topBar.x, 0, 'the top bar left edge');
    near(shellMatch.topBar.borderBottom, 1, 'the top bar hairline');
    near(shellMatch.body.height, 844, 'the content row height');

    // The sidebar is the floating glass panel from the "Sidebar conversation list"
    // page (node 0:1075): 260 wide, inset 12 from the window edge and 12 from the
    // body's top and bottom, so its footprint is 284 and the centre runs 284..1128.
    // Sidebar 260 at 12, Centre 844 at 284, Context 300 at 1140.
    const expected = { sidebar: { x: 12, width: 260 }, chat: { x: 284, width: 844 }, 'context-panel': { x: 1140, width: 300 } };
    for (const [id, want] of Object.entries(expected)) {
      const measured = column(id);
      near(measured.x, want.x, `#${id} left edge`);
      near(measured.width, want.width, `#${id} width`);
    }
    // The bar spans the window, so the content row starts under it. The sidebar is a
    // card inside that row rather than a full-height column, so it gives up 12 px at
    // each end (the node insets its panel 24 from the frame's top edge).
    near(column('sidebar').height, 820, 'the sidebar height');
    near(column('chat').height, 844, 'the centre height');
    near(column('context-panel').height, 844, 'the context panel height');

    // The frame's tone separation: the sidebar is the glass panel, the context panel
    // sits on the panel tone and the centre on the reading surface. Getting these the
    // wrong way round inverts the whole shell.
    if (column('sidebar').fill !== shellMatch.tones.glass) throw new Error('the sidebar is not on the navy panel tone');
    if (column('context-panel').fill !== shellMatch.tones.panel) throw new Error('the context panel is not on the panel tone');
    if (column('chat').fill !== shellMatch.tones.surface) throw new Error('the centre is not on the surface tone');

    // Top bar: the section title inset 16 from the window edge, then search (220x32),
    // the bell (32), the model chip (28 high, pill) and the theme button (32), 8 px
    // apart, ending 16 from the bar's right edge. The account is the sidebar's user
    // row now.
    near(shellMatch.title.x, 16, 'the section title left edge');
    near(shellMatch.title.fontSize, 15, 'the section title size');
    near(shellMatch.title.height, 18, 'the section title line height');

    if (shellMatch.trailing.length !== 4) throw new Error(`the top bar trailing side has ${shellMatch.trailing.length} controls, the node has 4`);
    const [search, bell, chip, theme] = shellMatch.trailing;
    near(search.width, 220, 'the search field width');
    near(search.height, 32, 'the search field height');
    near(bell.width, 32, 'the bell width');
    near(bell.height, 32, 'the bell height');
    near(chip.height, 28, 'the model chip height');
    near(theme.width, 32, 'the theme button width');
    near(theme.height, 32, 'the theme button height');
    near(1440 - theme.right, 16, 'the right edge inset');
    const gaps = shellMatch.trailing.slice(1).map((control, index) => control.x - shellMatch.trailing[index].right);
    if (gaps.join(',') !== '8,8,8') throw new Error(`the trailing controls sit ${gaps.join(',')} apart, the node has 8,8,8`);

    // tokens.json's radius/pill is 999 and HeroUI's full radius is 9999px; both
    // clamp to half the 28 px height, so the pill is the token, whichever it reads.
    if (shellMatch.model.radius !== shellMatch.pillRadius) {
      throw new Error(`the model chip radius is ${shellMatch.model.radius}, not radius/pill (${shellMatch.pillRadius})`);
    }

    return `1440x900: 56 px bar over ${shellMatch.columns.map((entry) => `${entry.id} ${entry.width}`).join(' / ')}, trailing 220/32/28/32 at 8 px gaps`;
  });

  // The field draws the focus ring for the input inside it, so the input must not
  // paint one of its own. Chromium's default ring is a white rectangle that ignores
  // the pill radius, which read as a second border floating inside the search field.
  const searchRing = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.top-bar-search-input');
    const field = document.querySelector('.top-bar-search');
    input.focus();
    const inner = getComputedStyle(input);
    const outer = getComputedStyle(field);
    const measured = {
      innerOutline: inner.outlineStyle,
      innerBorder: inner.borderTopStyle,
      outerOutline: outer.outlineStyle,
      outerWidth: parseFloat(outer.outlineWidth),
      outerRadius: parseFloat(outer.borderRadius),
    };
    input.blur();
    return measured;
  })()`);

  report.check('the search field draws one focus ring, not two', () => {
    if (searchRing.innerOutline !== 'none') {
      throw new Error(`the input draws its own ${searchRing.innerOutline} outline inside the field`);
    }
    if (searchRing.innerBorder !== 'none') {
      throw new Error(`the input draws its own ${searchRing.innerBorder} border inside the field`);
    }
    if (searchRing.outerOutline === 'none' || searchRing.outerWidth <= 0) {
      throw new Error('the field draws no ring, so nothing marks where the caret is');
    }
    if (searchRing.outerRadius <= 0) {
      throw new Error('the field ring has no radius, so it will not follow the pill');
    }
    return `one ${searchRing.outerWidth}px ring on the ${searchRing.outerRadius}px field, none on the input`;
  });

  // The conversation transcript page's acceptance is the same sentence as the
  // shell's: it matches the node it was drawn from. Node 0:1221 is a 1440x900
  // window whose 860 px chat column is drawn in four states: 0:1222 a reply
  // streaming in, 0:1427 an empty conversation, 0:1595 a reply that failed and
  // 0:1776 one still loading. The turns below are built by the renderer's own
  // factory, so this measures the page as it paints rather than restating the
  // stylesheet's numbers back to itself.
  const transcriptMatch = await window.webContents.executeJavaScript(`(async () => {
    const { createMessageElement } = await import('./ui/composer.js');
    const { createTranscriptSkeleton } = await import('./ui/chats.js');

    const transcript = document.getElementById('chat-transcript');
    const hero = document.getElementById('chat-empty-hero');
    const kept = Array.from(transcript.childNodes);
    const errorBlock = document.getElementById('chat-error-block');
    const previous = { state: transcript.dataset.state, hero: hero.hidden, errorBlock: errorBlock.hidden };

    const round = (value) => Math.round(value * 10) / 10;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        right: round(rect.right),
        bottom: round(rect.bottom),
      };
    };
    const styleOf = (element) => window.getComputedStyle(element);
    const px = (element, property) => round(Number.parseFloat(styleOf(element)[property]));
    const paint = (element) => styleOf(element).backgroundColor;
    const corner = (element) => px(element, 'borderTopLeftRadius');
    const font = (element) => px(element, 'fontSize') + '/' + px(element, 'lineHeight');
    // Resolved by the browser so the comparison is paint against paint and holds in
    // either theme rather than only in the light one.
    const token = (name) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(' + name + ')';
      document.body.append(probe);
      const value = styleOf(probe).color;
      probe.remove();
      return value;
    };
    const rel = (element, origin) => {
      const own = element.getBoundingClientRect();
      const base = origin.getBoundingClientRect();
      return {
        x: round(own.x - base.x),
        y: round(own.y - base.y),
        width: round(own.width),
        height: round(own.height),
        right: round(own.right - base.x),
        bottom: round(own.bottom - base.y),
      };
    };
    const show = (state) => {
      for (const node of Array.from(transcript.querySelectorAll('.message, .transcript-skeleton'))) node.remove();
      transcript.dataset.state = state;
      hero.hidden = state !== 'empty';
      // The error block belongs to the error state, where it is 240 px of card under
      // the transcript. Left on screen it would push these injected turns into a
      // scrollbar, which takes its width off every turn measured here. The
      // transcript node is measured on the page it draws, without that card.
      errorBlock.hidden = true;
    };

    const header = document.querySelector('.transcript-header');
    const result = {
      column: box(document.getElementById('chat')),
      header: box(header),
      title: rel(document.getElementById('chat-title'), header),
      transcript: box(transcript),
      inset: { top: px(transcript, 'paddingTop'), side: px(transcript, 'paddingLeft') },
      composer: box(document.querySelector('.composer')),
      hint: box(document.getElementById('composer-hint')),
      fills: {
        readerBubble: token('--zuri-transcript-fill'),
        bubble: token('--zuri-transcript-bubble'),
        bubbleUser: token('--zuri-transcript-bubble-user'),
        card: token('--zuri-transcript-card'),
        bar: token('--zuri-transcript-skeleton'),
        failed: token('--zuri-transcript-failed-soft'),
        subtle: token('--zuri-text-subtle'),
      },
    };

    // State 2 (0:1427): the empty transcript, a 520 px hero centred in the column.
    show('empty');
    const mark = hero.querySelector('.transcript-empty-mark');
    const lead = hero.querySelector('.shell-empty-lead');
    const grid = hero.querySelector('.transcript-suggestions');
    result.empty = {
      hero: box(hero),
      mark: box(mark),
      markCorner: corner(mark),
      markCentre: round(box(mark).x + box(mark).width / 2),
      title: { ...box(hero.querySelector('.shell-empty-title')), font: font(hero.querySelector('.shell-empty-title')) },
      lead: { ...box(lead), font: font(lead) },
      grid: box(grid),
      gridGap: px(grid, 'columnGap'),
      chips: Array.from(grid.children).map((chip) => ({
        ...box(chip),
        corner: corner(chip),
        inset: px(chip, 'paddingLeft'),
        font: font(chip),
      })),
    };

    // State 1 (0:1222): the node's four turns, the last one still arriving.
    show('filled');
    const turns = [
      createMessageElement({
        id: 'n1',
        role: 'user',
        mode: 'ask',
        content: 'I exported the Q4 budget to Excel. Can you check whether we are over on anything?',
        createdAt: '2025-10-15T09:58:00.000Z',
      }),
      createMessageElement({
        id: 'n2',
        role: 'assistant',
        mode: 'ask',
        content: 'Three lines are over in Budget.xlsx: Travel, Software and Contractors.\\n\\nWant me to add a variance column so you can see the gap per line?',
        createdAt: '2025-10-15T09:58:00.000Z',
      }),
      createMessageElement({
        id: 'n3',
        role: 'user',
        mode: 'act',
        content: 'Yes please. Insert the column and fill it in.',
        createdAt: '2025-10-15T10:01:00.000Z',
        attachments: [{ name: 'Budget.xlsx', state: 'open' }],
      }),
      createMessageElement({
        id: 'n4',
        role: 'assistant',
        mode: 'act',
        state: 'streaming',
        content: 'Adding the column to the Summary sheet now.',
        createdAt: '2025-10-15T10:01:00.000Z',
        tool: { name: 'Budget.xlsx - Summary', state: 'running', detail: 'Insert column F' },
      }),
    ];
    transcript.append(...turns);

    // Read once the turns are in: a thread taller than the column shows a scrollbar,
    // and its width comes off the content the turns are laid out in.
    result.scrollbar = transcript.offsetWidth - transcript.clientWidth;

    result.turns = turns.map((turn) => {
      const stack = turn.querySelector('.message-stack');
      const bubble = turn.querySelector('.message-bubble');
      const meta = turn.querySelector('.message-meta');
      const footnote = turn.querySelector('.message-footnote');
      const avatar = turn.querySelector('.message-avatar');
      const entry = {
        role: turn.dataset.role,
        mode: turn.dataset.mode,
        box: rel(turn, transcript),
        stack: { ...rel(stack, turn), cap: px(stack, 'maxWidth') },
        meta: meta ? { ...rel(meta, turn), gap: px(meta, 'columnGap') } : null,
        footnote: footnote
          ? {
              ...rel(footnote, turn),
              font: font(footnote),
              ink: styleOf(footnote).color,
              text: footnote.textContent,
            }
          : null,
        avatar: avatar ? { ...rel(avatar, turn), corner: corner(avatar), paint: paint(avatar) } : null,
        // The node's rounded shape is the bubble (0:1649, 0:1652); the words inside it
        // are the turn's message-text, measured on their own so a measure can be checked.
        bubble: { ...rel(bubble, turn), corner: corner(bubble), inset: px(bubble, 'paddingLeft'), paint: paint(bubble) },
        texts: Array.from(turn.querySelectorAll('.message-text')).map((text) => ({
          ...rel(text, turn),
          font: font(text),
          cap: px(text, 'maxWidth'),
          inset: px(text, 'paddingLeft'),
          corner: corner(text),
          paint: paint(text),
        })),
      };
      const tool = turn.querySelector('.message-tool');
      if (tool) entry.tool = { ...rel(tool, turn), corner: corner(tool), paint: paint(tool) };
      const streaming = turn.querySelector('.message-streaming');
      if (streaming) {
        const caret = streaming.querySelector('.message-streaming-caret');
        entry.streaming = {
          ...rel(streaming, turn),
          gap: px(streaming, 'columnGap'),
          caret: box(caret),
          label: font(streaming.querySelector('.message-streaming-label')),
          dots: Array.from(streaming.querySelectorAll('.message-streaming-dot')).map(box),
        };
      }
      const chip = turn.querySelector('.message-attachment');
      if (chip) {
        entry.chip = {
          ...rel(chip, turn),
          corner: corner(chip),
          stroke: px(chip, 'borderTopWidth'),
          inset: px(chip, 'paddingLeft'),
        };
      }
      return entry;
    });

    // State 3 (0:1595): the reply that failed, as a turn of its own.
    show('filled');
    const failed = createMessageElement({
      id: 'n5',
      role: 'assistant',
      mode: 'ask',
      state: 'failed',
      content: '401 invalid_api_key',
      createdAt: '2025-10-15T10:02:00.000Z',
    });
    transcript.append(failed);
    const failureCard = failed.querySelector('.message-error-card');
    const failureAvatar = failed.querySelector('.message-avatar');
    result.error = {
      box: rel(failed, transcript),
      stack: rel(failed.querySelector('.message-stack'), failed),
      avatar: { ...rel(failureAvatar, failed), corner: corner(failureAvatar), paint: paint(failureAvatar) },
      card: { ...rel(failureCard, failed), corner: corner(failureCard), paint: paint(failureCard) },
      retry: rel(failed.querySelector('.message-retry-row'), failed),
    };

    // State 4 (0:1776): a conversation still loading, drawn as the turns' shape.
    show('filled');
    const skeleton = createTranscriptSkeleton();
    transcript.append(skeleton);
    const userGroup = skeleton.querySelector('.transcript-skeleton-turn[data-role="user"]');
    const replyGroup = skeleton.querySelector('.transcript-skeleton-turn[data-role="assistant"]');
    result.loading = {
      box: rel(skeleton, transcript),
      gap: px(skeleton, 'rowGap'),
      userGroup: { ...rel(userGroup, skeleton), gap: px(userGroup, 'columnGap') },
      replyGroup: rel(replyGroup, skeleton),
      userBars: Array.from(userGroup.children).map(box),
      replyBars: Array.from(skeleton.querySelector('.transcript-skeleton-lines').children).map(box),
      replyAvatar: box(skeleton.querySelector('.transcript-skeleton-avatar')),
      barCorner: corner(skeleton.querySelector('.transcript-skeleton-bar')),
      barPaint: paint(skeleton.querySelector('.transcript-skeleton-bar')),
      note: rel(skeleton.querySelector('.transcript-skeleton-note'), skeleton),
      spinner: box(skeleton.querySelector('.transcript-skeleton-spinner')),
      noteGap: px(skeleton.querySelector('.transcript-skeleton-note'), 'columnGap'),
    };

    for (const node of Array.from(transcript.querySelectorAll('.message, .transcript-skeleton'))) node.remove();
    transcript.replaceChildren(...kept);
    transcript.dataset.state = previous.state;
    hero.hidden = previous.hero;
    errorBlock.hidden = previous.errorBlock;
    return result;
  })()`);

  report.check('the Conversation transcript page is drawn from node 0:1625', () => {
    const near = (value, expected, label) => {
      if (Math.abs(value - expected) > 0.6) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    // A pill is drawn as radius/pill but paints as half its box, so compare the two
    // the way the browser does rather than against the token's 999.
    const halfPill = (corner, height) => Math.min(corner, height / 2);
    const same = (value, expected, label) => {
      if (value !== expected) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const paintIs = (value, expected, label) => {
      if (value !== expected) throw new Error(`${label} is ${value}, the node's fill resolves to ${expected}`);
    };
    const reads = (value, expected, label) => {
      if (!String(value).startsWith(expected)) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };

    // The column is the shell's centre, so it takes whatever the current App Shell
    // frame leaves. The sidebar is the floating 260 px panel from the "Sidebar
    // conversation list" page (12 px inset + 260 panel = 272), so the centre runs
    // 1440 - 272 - 12 - 300 - 12 = 844. The transcript node (0:1642) draws its frame
    // 1120 wide, so the bubbles are pinned to their own node sizes (460 and 672) and
    // only the column-dependent numbers below are measured against this width.
    const centre = 1440 - 272 - 12 - 300 - 12;
    near(transcriptMatch.column.width, centre, 'the chat column width');
    near(transcriptMatch.transcript.width, centre, 'the transcript width');
    near(transcriptMatch.header.height, 96, 'the transcript header height');
    near(transcriptMatch.title.x, 32, 'the thread title inset');
    near(transcriptMatch.inset.side, 64, 'the transcript side inset');
    near(transcriptMatch.inset.top, 22, 'the transcript top inset');
    // The turns span the column inside its 64 px insets, less the scrollbar it shows
    // when the thread is taller than the column.
    const turnWidth = centre - 2 * 64 - transcriptMatch.scrollbar;

    // The composer under it: the node's 60 px pill on the turns' 64 px inset, and the hint
    // on the same inset.
    near(transcriptMatch.composer.width, centre - 2 * 64, 'the composer width');
    near(transcriptMatch.composer.height, 60, 'the composer height');
    near(transcriptMatch.hint.x - transcriptMatch.column.x, 64, 'the composer hint inset');

    // 0:1642: four turns on the column, 24 apart, the first 22 down under the rule.
    same(transcriptMatch.turns.length, 4, 'the number of turns');
    const [ask, reply, act, streaming] = transcriptMatch.turns;
    for (const turn of transcriptMatch.turns) {
      near(turn.box.width, turnWidth, 'a turn width');
      near(turn.box.x, 64, 'a turn inset');
    }
    near(ask.box.y, 22, 'the first turn top');
    for (let index = 1; index < transcriptMatch.turns.length; index += 1) {
      near(
        transcriptMatch.turns[index].box.y - transcriptMatch.turns[index - 1].box.bottom,
        24,
        `the gap above turn ${index + 1}`,
      );
    }

    // A reader's turn: the node's 460 px primary-soft bubble (0:1649) against the
    // right edge, its words on the 424 px measure its 18 px inset leaves, and the
    // 13/20 clock under it at the bubble's own left edge (0:1651). The node puts no
    // name or badge above a sent prompt: the clock is its only label.
    same(ask.role, 'user', 'turn 1 role');
    same(ask.mode, 'ask', 'turn 1 mode');
    near(ask.stack.cap, 460, 'the reader stack cap');
    if (ask.stack.width > 460) throw new Error(`the reader stack is ${ask.stack.width} wide, the node draws it within 460`);
    near(ask.stack.right, turnWidth, 'the reader stack right edge');
    same(ask.meta, null, 'a reader meta row above the bubble');
    near(ask.bubble.width, 460, 'the reader bubble width');
    near(ask.bubble.right, turnWidth, 'the reader bubble right edge');
    near(ask.bubble.corner, 20, 'the reader bubble radius');
    near(ask.bubble.inset, 18, 'the reader bubble inset');
    paintIs(ask.bubble.paint, transcriptMatch.fills.bubbleUser, 'the reader bubble fill');
    near(ask.footnote.height, 20, 'the reader clock height');
    near(ask.footnote.x, turnWidth - 460, 'the reader clock left edge');
    reads(ask.footnote.font, '13/20', 'the reader clock type');
    paintIs(ask.footnote.ink, transcriptMatch.fills.subtle, 'the reader clock colour');
    near(ask.footnote.y - ask.bubble.bottom, 6, 'the gap under the reader bubble');
    if (!ask.footnote.text.endsWith('· sent')) {
      throw new Error(`the reader clock reads "${ask.footnote.text}", the node draws "14:02 · sent"`);
    }
    same(ask.texts.length, 1, 'the reader bubble count');
    near(ask.texts[0].cap, 424, 'the reader text measure');
    if (ask.texts[0].width > 424) throw new Error(`the reader text is ${ask.texts[0].width} wide, the node caps it at 424`);
    reads(ask.texts[0].font, '14/22', 'the reader text type');

    // Zuri's turn: a 24 px mark, its 672 px surface-raised card 32 in, the 20 px meta
    // row, and the two paragraphs the node draws as separate blocks 8 apart on the
    // 632 px measure the card's 20 px inset leaves.
    same(reply.role, 'assistant', 'turn 2 role');
    near(reply.avatar.width, 24, 'the Zuri mark width');
    near(reply.avatar.height, 24, 'the Zuri mark height');
    near(reply.avatar.corner, 9999, 'the Zuri mark radius token');
    near(halfPill(reply.avatar.corner, reply.avatar.height), 12, 'the Zuri mark radius');
    paintIs(reply.avatar.paint, transcriptMatch.fills.readerBubble, 'the Zuri mark fill');
    near(reply.stack.x, 0, 'the Zuri stack inset');
    near(reply.stack.width, 672, 'the Zuri stack width');
    near(reply.bubble.width, 672, 'the Zuri card width');
    near(reply.bubble.corner, 20, 'the Zuri card radius');
    near(reply.bubble.inset, 20, 'the Zuri card inset');
    paintIs(reply.bubble.paint, transcriptMatch.fills.bubble, 'the Zuri card fill');
    near(reply.meta.height, 24, 'the Zuri meta row height');
    same(reply.texts.length, 2, 'the paragraph count');
    for (const paragraph of reply.texts) {
      near(paragraph.width, 632, 'a paragraph width');
      reads(paragraph.font, '15/24', 'a paragraph type');
    }
    near(reply.texts[1].y - reply.texts[0].bottom, 8, 'the gap between paragraphs');

    // An Act turn: the reader's bubble again, with the 28 px file chip inside its
    // 18 px inset rather than on the column's edge.
    same(act.role, 'user', 'turn 3 role');
    same(act.mode, 'act', 'turn 3 mode');
    near(act.stack.cap, 460, 'the Act stack cap');
    near(act.stack.right, turnWidth, 'the Act stack right edge');
    near(act.bubble.right, turnWidth, 'the Act bubble right edge');
    near(act.texts[0].right, turnWidth - 18, 'the Act text right edge');
    near(act.chip.height, 28, 'the attachment chip height');
    near(halfPill(act.chip.corner, act.chip.height), 14, 'the attachment chip radius');
    near(act.chip.stroke, 1, 'the attachment chip stroke');
    near(act.chip.right, turnWidth - 18, 'the attachment chip right edge');

    // The streaming reply: the tool card, then the node's 2 x 22 caret row under it.
    same(streaming.role, 'assistant', 'turn 4 role');
    near(streaming.tool.width, 620, 'the tool card width');
    near(streaming.tool.corner, 10, 'the tool card radius');
    paintIs(streaming.tool.paint, transcriptMatch.fills.card, 'the tool card fill');
    near(streaming.streaming.height, 22, 'the streaming row height');
    near(streaming.streaming.gap, 8, 'the streaming row gap');
    near(streaming.streaming.caret.width, 2, 'the streaming caret width');
    near(streaming.streaming.caret.height, 22, 'the streaming caret height');
    // The node's streaming row is the caret plus its label (0:1673); the three dots
    // belong to the waiting bubble, which the first token replaces.
    same(streaming.streaming.dots.length, 0, 'the streaming dot count');
    reads(streaming.streaming.label, '12/16', 'the streaming label type');

    // 0:1427: the empty transcript, a 520 px hero on the column's centre line.
    near(transcriptMatch.empty.hero.width, 520, 'the empty hero width');
    near(transcriptMatch.empty.mark.width, 56, 'the empty mark width');
    near(transcriptMatch.empty.mark.height, 56, 'the empty mark height');
    near(transcriptMatch.empty.markCorner, 16, 'the empty mark radius');
    near(transcriptMatch.empty.markCentre, transcriptMatch.column.x + centre / 2, 'the empty mark centre');
    near(transcriptMatch.empty.title.y - transcriptMatch.empty.mark.bottom, 16, 'the gap under the mark');
    reads(transcriptMatch.empty.title.font, '22/30', 'the empty title type');
    if (transcriptMatch.empty.lead.width > 420) throw new Error(`the empty lead is ${transcriptMatch.empty.lead.width} wide, the node caps it at 420`);
    reads(transcriptMatch.empty.lead.font, '14/22', 'the empty lead type');
    near(transcriptMatch.empty.lead.y - transcriptMatch.empty.title.bottom, 16, 'the gap under the title');
    near(transcriptMatch.empty.grid.width, 520, 'the suggestion grid width');
    near(transcriptMatch.empty.gridGap, 8, 'the suggestion grid gap');
    near(transcriptMatch.empty.grid.y - transcriptMatch.empty.lead.bottom, 16, 'the gap above the suggestions');
    same(transcriptMatch.empty.chips.length, 4, 'the suggestion count');
    for (const chip of transcriptMatch.empty.chips) {
      near(chip.width, 256, 'a suggestion width');
      near(chip.corner, 10, 'a suggestion radius');
      near(chip.inset, 12, 'a suggestion inset');
      reads(chip.font, '12/16', 'a suggestion type');
      if (chip.height < 40) throw new Error(`a suggestion is ${chip.height} tall, the node floors it at 40`);
    }

    // 0:1595: the failed reply keeps the mark and puts the reason in a 620 px card,
    // with the way out under it.
    near(transcriptMatch.error.stack.x, 32, 'the failed stack inset');
    near(transcriptMatch.error.avatar.width, 24, 'the failed mark width');
    near(halfPill(transcriptMatch.error.avatar.corner, transcriptMatch.error.avatar.height), 12, 'the failed mark radius');
    paintIs(transcriptMatch.error.avatar.paint, transcriptMatch.fills.failed, 'the failed mark fill');
    near(transcriptMatch.error.card.width, 620, 'the error card width');
    near(transcriptMatch.error.card.corner, 10, 'the error card radius');
    paintIs(transcriptMatch.error.card.paint, transcriptMatch.fills.card, 'the error card fill');
    near(transcriptMatch.error.retry.height, 38, 'the retry row height');
    near(transcriptMatch.error.retry.y - transcriptMatch.error.card.bottom, 8, 'the gap above the retry row');

    // 0:1776: the loading state is the shape of the same two turns, 24 apart, its
    // bars on the node's 12/14 heights and 4 px radius.
    near(transcriptMatch.loading.box.width, turnWidth, 'the loading column width');
    near(transcriptMatch.loading.gap, 24, 'the loading group gap');
    near(transcriptMatch.loading.userGroup.width, 420, 'the loading reader group width');
    near(transcriptMatch.loading.userGroup.gap, 8, 'the loading reader group gap');
    near(transcriptMatch.loading.replyGroup.x, 0, 'the loading reply alignment');
    near(transcriptMatch.loading.userGroup.x, turnWidth - 420, 'the loading reader alignment');
    near(transcriptMatch.loading.userBars[0].width, 72, 'the reader meta bar width');
    near(transcriptMatch.loading.userBars[1].width, 420, 'the reader bar width');
    near(transcriptMatch.loading.userBars[2].width, 280, 'the reader short bar width');
    near(transcriptMatch.loading.replyBars[0].width, 64, 'the first reply bar width');
    for (const bar of transcriptMatch.loading.replyBars.slice(1, 3)) {
      near(bar.width, turnWidth - 32, 'a reply bar width');
    }
    near(transcriptMatch.loading.replyBars[3].width, 380, 'the last reply bar width');
    for (const bar of transcriptMatch.loading.userBars) {
      near(bar.corner, 4, 'a loading bar radius');
    }
    paintIs(transcriptMatch.loading.barPaint, transcriptMatch.fills.bar, 'the loading bar fill');
    near(transcriptMatch.loading.replyAvatar.width, 24, 'the loading mark width');
    near(transcriptMatch.loading.note.height, 16, 'the loading note height');
    near(transcriptMatch.loading.spinner.width, 14, 'the loading spinner width');
    near(transcriptMatch.loading.noteGap, 8, 'the loading note gap');
    near(transcriptMatch.loading.note.y - transcriptMatch.loading.replyGroup.bottom, 24, 'the gap above the note');

    return `${transcriptMatch.column.width} px column: header 96, ${turnWidth} px turns 24 apart, ` +
      `${ask.bubble.width} px reader bubble on a ${ask.bubble.corner} px corner, ${reply.bubble.width} px reply card ` +
      `holding a ${reply.texts[0].width} px measure, empty hero 520, error card 620, loading bars 12/14`;
  });

  window.setContentSize(originalContent[0], originalContent[1]);

  // The first-run page's acceptance is the same sentence as the shell's: it matches the
  // node it was drawn from. Node 0:2328 "First-run welcome / provider setup" draws one
  // 520 wide card nine times on a 1200 x 800 canvas - the three steps, three field
  // refusals, the save in flight and the confirmation - so each drawing is opened
  // through data-state on the card and measured as drawn, not read back from the
  // stylesheet. The canvas mixes collections by design (step 1 is drawn light, step 2
  // dark), which is why the page follows the app theme through the token block in
  // tokens.css rather than pinning one drawing's hex.
  const onboardingWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    useContentSize: true,
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await onboardingWindow.loadFile(ONBOARDING_ENTRY);
  await wait(300);

  const onboardingMatch = await onboardingWindow.webContents.executeJavaScript(`(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const style = (element) => (element ? getComputedStyle(element) : null);
    const card = document.getElementById('onboarding-card');

    // A hidden probe resolves each custom property to the colour a rule would paint, so
    // the assertions below compare toned values instead of token names.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const tone = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const tones = {
      accent: tone('--zuri-onboarding-primary'),
      onAccent: tone('--zuri-onboarding-primary-foreground'),
      surface: tone('--zuri-onboarding-surface'),
      tertiary: tone('--zuri-onboarding-surface-tertiary'),
      danger: tone('--zuri-onboarding-danger'),
      dangerSoft: tone('--zuri-onboarding-danger-soft'),
    };
    probe.remove();

    const measure = () => {
      const primary = document.getElementById('onboarding-primary');
      const nameLabel = document.getElementById('onboarding-label');
      const steps = Array.from(card.querySelectorAll('.onboarding-step'));
      const themeCards = Array.from(card.querySelectorAll('.onboarding-theme'));
      const caption = card.querySelector('.onboarding-step-caption');
      return {
        card: box(card),
        radius: style(card).borderRadius,
        padding: style(card).paddingTop,
        fill: style(card).backgroundColor,
        badge: box(card.querySelector('.onboarding-badge')),
        title: {
          size: style(card.querySelector('.onboarding-title')).fontSize,
          weight: style(card.querySelector('.onboarding-title')).fontWeight,
        },
        subtitle: { size: style(card.querySelector('.onboarding-subtitle')).fontSize },
        steps: steps.map((step) => ({
          bar: box(step.querySelector('.onboarding-step-bar')),
          fill: style(step.querySelector('.onboarding-step-bar')).backgroundColor,
        })),
        captionSize: style(caption).fontSize,
        label: { box: box(nameLabel), size: style(nameLabel).fontSize },
        input: box(document.getElementById('onboarding-input-wrap')),
        outline: style(document.getElementById('onboarding-input-wrap')).borderColor,
        themes: themeCards.map(box),
        alert: box(document.getElementById('onboarding-alert')),
        primary: {
          box: box(primary),
          fill: style(primary).backgroundColor,
          label: style(document.getElementById('onboarding-primary-label')).color,
        },
        spinner: style(card.querySelector('.onboarding-spinner')).display,
        skip: box(card.querySelector('.onboarding-skip')),
        privacy: box(card.querySelector('.onboarding-privacy')),
        summary: box(document.getElementById('onboarding-summary')),
      };
    };

    const states = {};
    for (const state of ['name', 'name-error', 'theme', 'key', 'key-too-short', 'key-rejected', 'saving', 'success']) {
      card.dataset.state = state;
      states[state] = measure();
    }
    card.dataset.state = 'name';
    return { viewport: { width: innerWidth, height: innerHeight }, tones, states };
  })()`);

  // The attach dialog and the chip it hands back (the page drawn as node 0:3779).
  const attachRun = await window.webContents.executeJavaScript(`(async () => {
      const { createAttachDialog, createAttachmentChip } = await import('./ui/attachDialog.js');

      const colourToken = (name) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(' + name + ')';
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const box = (el) => {
        const rect = el.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
      };

      // \`control.element\` is the scrim, so the dialog is measured where it really
      // sits: a fixed overlay centred in the window.
      const control = createAttachDialog({});
      document.body.append(control.element);

      const strip = document.getElementById('composer-attachments');
      const previousTheme = document.documentElement.dataset.theme;

      // Every reading is relative to the dialog (or to the pill for the chip),
      // because the node's numbers are each component's own coordinate space.
      const read = () => {
        const dialog = control.element.querySelector('.attach-dialog');
        const origin = dialog.getBoundingClientRect();
        const style = (el) => getComputedStyle(el);
        const q = (selector) => dialog.querySelector(selector);
        const rel = (el) => {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x - origin.x), y: Math.round(rect.y - origin.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        };

        const chip = strip.firstElementChild;
        const chipRect = chip ? chip.getBoundingClientRect() : null;
        const composerRect = document.querySelector('.composer').getBoundingClientRect();
        const relChip = (el) => {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x - chipRect.x), y: Math.round(rect.y - chipRect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        };

        return {
          dialog: { ...box(dialog), radius: style(dialog).borderTopLeftRadius, background: style(dialog).backgroundColor, shadow: style(dialog).boxShadow },
          header: rel(q('.attach-header')),
          title: { ...rel(q('.attach-title')), fontSize: style(q('.attach-title')).fontSize, lineHeight: style(q('.attach-title')).lineHeight, fontWeight: style(q('.attach-title')).fontWeight, color: style(q('.attach-title')).color },
          subtitle: { ...rel(q('.attach-subtitle')), fontSize: style(q('.attach-subtitle')).fontSize, lineHeight: style(q('.attach-subtitle')).lineHeight, color: style(q('.attach-subtitle')).color },
          close: { ...rel(q('.attach-close')), radius: style(q('.attach-close')).borderTopLeftRadius, background: style(q('.attach-close')).backgroundColor },
          divider: { ...rel(q('.attach-divider')), background: style(q('.attach-divider')).backgroundColor },
          dropzone: { ...rel(q('.attach-dropzone')), radius: style(q('.attach-dropzone')).borderTopLeftRadius, background: style(q('.attach-dropzone')).backgroundColor, compact: q('.attach-dropzone').dataset.compact },
          badge: { ...rel(q('.attach-badge')), radius: style(q('.attach-badge')).borderTopLeftRadius, background: style(q('.attach-badge')).backgroundColor },
          dropTitle: { ...rel(q('.attach-drop-title')), fontSize: style(q('.attach-drop-title')).fontSize, lineHeight: style(q('.attach-drop-title')).lineHeight },
          dropHint: { ...rel(q('.attach-drop-hint')), fontSize: style(q('.attach-drop-hint')).fontSize, lineHeight: style(q('.attach-drop-hint')).lineHeight, color: style(q('.attach-drop-hint')).color },
          browse: { ...rel(q('.attach-browse')), radius: style(q('.attach-browse')).borderTopLeftRadius, background: style(q('.attach-browse')).backgroundColor, color: style(q('.attach-browse')).color, disabled: q('.attach-browse').disabled, hidden: q('.attach-browse').hidden },
          alert: { ...rel(q('.attach-alert')), hidden: q('.attach-alert').hidden, radius: style(q('.attach-alert')).borderTopLeftRadius, background: style(q('.attach-alert')).backgroundColor, color: style(q('.attach-alert')).color },
          alertTitle: { ...rel(q('.attach-alert-title')), fontSize: style(q('.attach-alert-title')).fontSize, lineHeight: style(q('.attach-alert-title')).lineHeight },
          alertBody: { ...rel(q('.attach-alert-body')), fontSize: style(q('.attach-alert-body')).fontSize, lineHeight: style(q('.attach-alert-body')).lineHeight },
          caption: { ...rel(q('.attach-caption')), fontSize: style(q('.attach-caption')).fontSize, lineHeight: style(q('.attach-caption')).lineHeight, letterSpacing: style(q('.attach-caption')).letterSpacing, color: style(q('.attach-caption')).color },
          empty: { ...rel(q('.attach-empty')), hidden: q('.attach-empty').hidden, fontSize: style(q('.attach-empty')).fontSize, lineHeight: style(q('.attach-empty')).lineHeight },
          row: (() => {
            const row = q('.attach-row');
            if (!row) return null;
            const rowStyle = style(row.querySelector('.attach-row-note'));
            return {
              ...rel(row),
              radius: style(row).borderTopLeftRadius,
              background: style(row).backgroundColor,
              badge: rel(row.querySelector('.attach-row-badge')),
              badgeBackground: style(row.querySelector('.attach-row-badge')).backgroundColor,
              name: rel(row.querySelector('.attach-row-name')),
              nameSize: style(row.querySelector('.attach-row-name')).fontSize,
              note: rel(row.querySelector('.attach-row-note')),
              noteSize: rowStyle.fontSize,
              noteColour: rowStyle.color,
              remove: rel(row.querySelector('.attach-row-remove')),
              removeBackground: style(row.querySelector('.attach-row-remove')).backgroundColor,
            };
          })(),
          cancel: { ...rel(q('.attach-cancel')), radius: style(q('.attach-cancel')).borderTopLeftRadius, background: style(q('.attach-cancel')).backgroundColor, color: style(q('.attach-cancel')).color },
          submit: { ...rel(q('.attach-submit')), hidden: q('.attach-submit').hidden, disabled: q('.attach-submit').disabled, background: style(q('.attach-submit')).backgroundColor },
          choose: (() => {
            const el = q('.attach-submit-choose');
            if (!el) return null;
            return { ...rel(el), hidden: el.hidden, background: style(el).backgroundColor, color: style(el).color };
          })(),
          chip: chipRect
            ? {
                ...box(chip),
                x: Math.round(chipRect.x - composerRect.x),
                y: Math.round(chipRect.y - composerRect.y),
                radius: style(chip).borderTopLeftRadius,
                background: style(chip).backgroundColor,
                mark: relChip(chip.querySelector('.composer-chip-mark')),
                name: { ...relChip(chip.querySelector('.composer-chip-name')), fontSize: style(chip.querySelector('.composer-chip-name')).fontSize, lineHeight: style(chip.querySelector('.composer-chip-name')).lineHeight },
                size: { ...relChip(chip.querySelector('.composer-chip-size')), fontSize: style(chip.querySelector('.composer-chip-size')).fontSize, lineHeight: style(chip.querySelector('.composer-chip-size')).lineHeight, color: style(chip.querySelector('.composer-chip-size')).color },
                remove: relChip(chip.querySelector('.composer-chip-remove')),
              }
            : null,
          tokens: {
            surface: colourToken('--zuri-attach-surface'),
            surfaceSecondary: colourToken('--zuri-attach-surface-secondary'),
            surfaceTertiary: colourToken('--zuri-attach-surface-tertiary'),
            text: colourToken('--zuri-attach-text'),
            subtle: colourToken('--zuri-attach-text-subtle'),
            primary: colourToken('--zuri-attach-primary'),
            primaryForeground: colourToken('--zuri-attach-primary-foreground'),
            divider: colourToken('--zuri-attach-divider'),
            dangerSoft: colourToken('--zuri-attach-danger-soft'),
            dangerSoftText: colourToken('--zuri-attach-danger-soft-foreground'),
            shadow: getComputedStyle(document.documentElement).getPropertyValue('--zuri-attach-shadow').trim(),
            pillRadius: getComputedStyle(document.documentElement).getPropertyValue('--zuri-radius-pill').trim(),
          },
        };
      };

      const readAll = () => {
        control.open('idle');
        const idle = read();
        control.open('picking');
        const picking = read();
        control.open('rejected', { name: 'Q3 forecast.xlsx', size: 2516582 }, 'readFile was blocked for C:\\\\Windows\\\\System32\\\\hosts. Choose a file inside Documents, Downloads or Desktop.');
        const rejected = read();
        control.close();

        // Frames 04-05 are the same pill with the chip in and out, so the chip is
        // appended to the real strip and taken out again.
        const chip = createAttachmentChip({ name: 'Q3 forecast.xlsx', size: 2516582 });
        strip.append(chip);
        strip.hidden = false;
        const withChip = read();
        strip.replaceChildren();
        strip.hidden = true;

        return { idle, picking, rejected, withChip, tokens: idle.tokens };
      };

      const dark = readAll();
      document.documentElement.dataset.theme = 'light';
      const light = readAll();
      document.documentElement.dataset.theme = previousTheme;

      control.element.remove();
      return { dark, light };
    })()`);

    // The dialog is built by ui/attachDialog.js but mounted by the chat page (ui/chats.js),
    // and that mount is what puts the paperclip and ?state= in reach of it. Measured, not
    // assumed: the same drawing un-wired reads as finished in the frame measurements above.
    const attachMount = {};
    for (const [name, search] of [['dialog', 'state=attach'], ['chip', 'state=attach-chip']]) {
      const pageWindow = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        useContentSize: true,
        webPreferences: {
          preload: PRELOAD_ENTRY,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await pageWindow.loadFile(EXPECTED_ENTRY, { search });

      // initChats is async: wait for the page to publish its state list rather than
      // sleeping for a fixed time and hoping.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const ready = await pageWindow.webContents.executeJavaScript(
          `Array.isArray(window.__KAI_STATES__) ? window.__KAI_STATES__.length : 0`,
        );
        if (ready > 0) break;
        await wait(150);
      }

      attachMount[name] = await pageWindow.webContents.executeJavaScript(`(() => {
        const scrim = document.querySelector('.attach-scrim');
        const strip = document.getElementById('composer-attachments');
        const chip = strip ? strip.querySelector('.composer-chip-name') : null;
        return {
          states: Array.isArray(window.__KAI_STATES__) ? window.__KAI_STATES__ : [],
          mounted: scrim !== null,
          showing: scrim !== null && scrim.hidden === false,
          chipCount: strip !== null && strip.hidden === false ? strip.children.length : 0,
          chipName: chip ? chip.textContent : '',
          paperclip: document.getElementById('composer-attach') !== null,
        };
      })()`);
      pageWindow.destroy();
    }

    report.check('the chat page mounts the attach dialog and holds its frames', () => {
      const names = ['attach', 'attach-picking', 'attach-rejected', 'attach-chip'];

      for (const [name, run] of Object.entries(attachMount)) {
        if (!run.paperclip) throw new Error(`${name}: the composer has no paperclip to open it`);
        if (!run.mounted) throw new Error(`${name}: no attach dialog in the page, so nothing is wired`);
        for (const state of names) {
          if (!run.states.includes(state)) throw new Error(`${name}: ?state= does not list ${state}`);
        }
      }

      if (!attachMount.dialog.showing) throw new Error('?state=attach does not put the dialog on screen');
      if (attachMount.chip.showing) throw new Error('?state=attach-chip shows the dialog instead of the chip');
      if (attachMount.chip.chipCount !== 1) throw new Error(`?state=attach-chip puts ${attachMount.chip.chipCount} chips in the strip`);
      if (attachMount.chip.chipName !== 'Q3 forecast.xlsx') throw new Error(`the chip reads "${attachMount.chip.chipName}"`);

      return `${attachMount.dialog.states.length} page states: ?state=attach opens the dialog, ?state=attach-chip fills the strip with ${attachMount.chip.chipName}`;
    });

    report.check('the Attach file dialog matches node 0:3779', () => {
      const near = (value, expected, label, slack = 1) => {
        if (Math.abs(value - expected) > slack) {
          throw new Error(`${label} is ${value}, the node draws ${expected}`);
        }
      };
      const same = (actual, expected, label) => {
        if (actual !== expected) {
          throw new Error(`${label} is ${actual}, the node uses ${expected}`);
        }
      };
      const squash = (text) => String(text).replace(/\s+/g, '');
      const pill = (entry, label) => {
        if (parseFloat(entry.radius) < entry.height / 2) {
          throw new Error(`${theme}: ${label} is ${entry.radius}, the node draws ${tokens.pillRadius}`);
        }
      };

      for (const theme of ['dark', 'light']) {
        const run = attachRun[theme];
        const { idle, picking, rejected, tokens } = run;

        // Frame 01, the resting dialog: 480x448 at radius 24 on color/surface, with
        // the node's 0 8 32 shadow and a 48 px header.
        same(idle.dialog.width, 480, theme + ': the dialog width');
        near(idle.dialog.height, 448, theme + ': the dialog height');
        same(idle.dialog.radius, '24px', theme + ': the dialog corner');
        same(idle.dialog.background, tokens.surface, theme + ': the dialog fill');
        // The shadow reads back in the engine's own order and units, so the drawn
        // colour and the 8 down / 32 blur are checked instead of the whole string.
        const shadow = squash(idle.dialog.shadow);
        const shadowToken = squash(tokens.shadow);
        if (!shadow.includes(shadowToken.slice(shadowToken.indexOf('rgba('))) || !shadow.includes('8px') || !shadow.includes('32px')) {
          throw new Error(`${theme}: the dialog shadow is ${idle.dialog.shadow}, the node draws ${tokens.shadow}`);
        }
        near(idle.header.height, 48, theme + ': the header height');
        near(idle.title.x, 24, theme + ': the title inset');
        same(idle.title.fontSize, '20px', theme + ': the title size');
        same(idle.title.lineHeight, '28px', theme + ': the title leading');
        same(idle.title.fontWeight, '600', theme + ': the title weight');
        same(idle.title.color, tokens.text, theme + ': the title colour');
        same(idle.subtitle.fontSize, '13px', theme + ': the subtitle size');
        same(idle.subtitle.lineHeight, '20px', theme + ': the subtitle leading');
        same(idle.subtitle.color, tokens.subtle, theme + ': the subtitle colour');
        same(idle.close.width, 44, theme + ': the close control width');
        same(idle.close.height, 44, theme + ': the close control height');
        same(idle.close.x, 388, theme + ': the close control inset');
        same(idle.close.radius, '12px', theme + ': the close control corner');
        same(idle.close.background, tokens.surfaceSecondary, theme + ': the close control fill');
        near(idle.divider.y, 96, theme + ': the rule position');
        same(idle.divider.height, 1, theme + ': the rule thickness');
        same(idle.divider.background, tokens.divider, theme + ': the rule colour');

        // The drop zone: 432x156 at radius 20, a 40 px badge disc 16 px in, 14/20
        // over 12/18, and a 112x36 Browse pill on the primary fill.
        near(idle.dropzone.y, 121, theme + ': the drop zone position');
        same(idle.dropzone.width, 432, theme + ': the drop zone width');
        same(idle.dropzone.height, 156, theme + ': the drop zone height');
        same(idle.dropzone.radius, '20px', theme + ': the drop zone corner');
        same(idle.dropzone.background, tokens.surfaceSecondary, theme + ': the drop zone fill');
        same(idle.badge.width, 40, theme + ': the badge width');
        same(idle.badge.height, 40, theme + ': the badge height');
        near(idle.badge.y - idle.dropzone.y, 16, theme + ': the badge inside the drop zone');
        same(idle.badge.background, tokens.surface, theme + ': the badge fill');
        same(idle.dropTitle.fontSize, '14px', theme + ': the drop title size');
        same(idle.dropTitle.lineHeight, '20px', theme + ': the drop title leading');
        same(idle.dropHint.fontSize, '12px', theme + ': the drop hint size');
        same(idle.dropHint.lineHeight, '18px', theme + ': the drop hint leading');
        same(idle.dropHint.color, tokens.subtle, theme + ': the drop hint colour');
        same(idle.browse.width, 112, theme + ': the Browse width');
        same(idle.browse.height, 36, theme + ': the Browse height');
        near(idle.browse.y - idle.dropzone.y, 108, theme + ': the Browse inside the drop zone');
        pill(idle.browse, 'the Browse corner');
        same(idle.browse.background, tokens.primary, theme + ': the Browse fill');
        same(idle.browse.color, tokens.primaryForeground, theme + ': the Browse label');
        same(idle.browse.disabled, false, theme + ': Browse is enabled with no picker open');

        // The list area: an 11/16 tracked caption over the empty note, then the
        // footer pinned to the dialog's bottom edge with Attach dead until a file
        // arrives.
        near(idle.caption.y, 297, theme + ': the caption position');
        same(idle.caption.fontSize, '11px', theme + ': the caption size');
        same(idle.caption.lineHeight, '16px', theme + ': the caption leading');
        same(idle.caption.letterSpacing, '0.66px', theme + ': the caption tracking');
        same(idle.caption.color, tokens.subtle, theme + ': the caption colour');
        near(idle.empty.y, 321, theme + ': the empty note position');
        same(idle.empty.fontSize, '13px', theme + ': the empty note size');
        same(idle.empty.lineHeight, '20px', theme + ': the empty note leading');
        same(idle.empty.hidden, false, theme + ': the empty note shows with no file');
        same(idle.alert.hidden, true, theme + ': the refusal alert stays out of the resting dialog');
        same(idle.cancel.width, 88, theme + ': the Cancel width');
        same(idle.cancel.height, 36, theme + ': the Cancel height');
        pill(idle.cancel, 'the Cancel corner');
        same(idle.cancel.background, tokens.surfaceTertiary, theme + ': the Cancel fill');
        same(idle.submit.width, 84, theme + ': the Attach width');
        same(idle.submit.height, 36, theme + ': the Attach height');
        same(idle.submit.disabled, true, theme + ': Attach is dead with no file');
        near(idle.submit.x + idle.submit.width, 456, theme + ': the footer sits on the dialog edge');

        // Frame 02: the second picker cannot open, so Browse keeps its box and
        // loses its colour, and the zone keeps its 156 px.
        same(picking.browse.disabled, true, theme + ': Browse is disabled while the picker is up');
        same(picking.browse.background, tokens.surfaceTertiary, theme + ': the disabled Browse fill');
        same(picking.dropzone.height, 156, theme + ': the picking drop zone height');

        // Frame 03, the refusal: the zone drops to 120 px with no Browse, an 80 px
        // alert appears, and Choose another file takes Attach's place.
        same(rejected.dropzone.height, 120, theme + ': the refused drop zone height');
        same(rejected.browse.hidden, true, theme + ': Browse is out of the refused zone');
        same(rejected.alert.hidden, false, theme + ': the refusal alert shows');
        near(rejected.alert.y, 257, theme + ': the refusal alert position');
        same(rejected.alert.width, 432, theme + ': the refusal alert width');
        same(rejected.alert.height, 80, theme + ': the refusal alert height');
        same(rejected.alert.radius, '12px', theme + ': the refusal alert corner');
        same(rejected.alert.background, tokens.dangerSoft, theme + ': the refusal alert fill');
        same(rejected.alert.color, tokens.dangerSoftText, theme + ': the refusal alert ink');
        same(rejected.alertTitle.fontSize, '13px', theme + ': the refusal title size');
        same(rejected.alertTitle.lineHeight, '20px', theme + ': the refusal title leading');
        same(rejected.alertBody.fontSize, '12px', theme + ': the refusal body size');
        same(rejected.alertBody.lineHeight, '18px', theme + ': the refusal body leading');
        near(rejected.alertTitle.y - rejected.alert.y, 12, theme + ': the refusal title inset');
        near(rejected.alertBody.y - rejected.alert.y, 32, theme + ': the refusal body inset');
        near(rejected.caption.y, 357, theme + ': the caption under the refusal');
        same(rejected.empty.hidden, true, theme + ': the empty note steps aside for the refused row');
        near(rejected.row.y, 381, theme + ': the file row position');
        same(rejected.row.width, 432, theme + ': the file row width');
        same(rejected.row.height, 56, theme + ': the file row height');
        same(rejected.row.radius, '12px', theme + ': the file row corner');
        same(rejected.row.background, tokens.surfaceSecondary, theme + ': the file row fill');
        same(rejected.row.badge.width, 32, theme + ': the row badge width');
        same(rejected.row.badge.height, 32, theme + ': the row badge height');
        near(rejected.row.badge.x - rejected.row.x, 12, theme + ': the row badge inset');
        same(rejected.row.badgeBackground, tokens.dangerSoft, theme + ': the refused row badge fill');
        near(rejected.row.name.x - rejected.row.x, 52, theme + ': the row name inset');
        same(rejected.row.nameSize, '13px', theme + ': the row name size');
        same(rejected.row.noteSize, '11px', theme + ': the row note size');
        same(rejected.row.noteColour, tokens.dangerSoftText, theme + ': the refused row note colour');
        near(rejected.row.remove.x - rejected.row.x, 396, theme + ': the row remove inset');
        same(rejected.row.removeBackground, tokens.surface, theme + ': the row remove fill');
        same(rejected.submit.hidden, true, theme + ': Attach gives way to Choose another file');
        same(rejected.choose.width, 164, theme + ': the Choose another file width');
        same(rejected.choose.height, 36, theme + ': the Choose another file height');
        same(rejected.choose.background, tokens.primary, theme + ': the Choose another file fill');
        near(rejected.choose.x + rejected.choose.width, 456, theme + ': the refusal footer sits on the dialog edge');

        // Frames 04-05: the chip in the pill, 196x24 at radius 6, 14 px down and
        // 12 px in, with a 12 px glyph, 13/20 name, 11/16 size and a 10 px remove.
        if (!run.withChip.chip) {
          throw new Error(`${theme}: the chip did not appear in the composer`);
        }
        const chip = run.withChip.chip;
        same(chip.height, 24, theme + ': the chip height');
        same(chip.radius, '6px', theme + ': the chip corner');
        same(chip.background, tokens.surfaceSecondary, theme + ': the chip fill');
        near(chip.y, 14, theme + ': the chip drop from the pill top');
        near(chip.x, 12, theme + ': the chip inset from the pill edge');
        same(chip.mark.width, 12, theme + ': the chip glyph width');
        same(chip.mark.height, 12, theme + ': the chip glyph height');
        near(chip.mark.x, 8, theme + ': the chip glyph inset');
        same(chip.name.fontSize, '13px', theme + ': the chip name size');
        same(chip.name.lineHeight, '20px', theme + ': the chip name leading');
        near(chip.name.x, 26, theme + ': the chip name inset');
        same(chip.size.fontSize, '11px', theme + ': the chip size label');
        same(chip.size.lineHeight, '16px', theme + ': the chip size leading');
        same(chip.size.color, tokens.subtle, theme + ': the chip size colour');
        same(chip.remove.width, 16, theme + ': the chip remove hit box');
        near(chip.width - chip.remove.x - chip.remove.width, 10, theme + ': the chip right inset');
      }
    });

  report.check('the First-run welcome page is drawn from node 0:2328', () => {
    const near = (value, expected, label, slack = 0.6) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const same = (value, expected, label) => {
      if (value !== expected) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const run = onboardingMatch;
    const { name, theme, key, saving, success } = run.states;
    const nameError = run.states['name-error'];
    const tooShort = run.states['key-too-short'];
    const rejected = run.states['key-rejected'];

    near(run.viewport.width, 1200, 'the measured viewport width');
    near(run.viewport.height, 800, 'the measured viewport height');

    // One card, 520 wide on a 32 px padding, so its measure is the node's 456; it is
    // centred on the canvas at 340 across, and 187 down in step 1 (426 + 1 px of
    // rounding on a content-sized card). Every state keeps that frame.
    for (const [label, state] of [
      ['step one', name],
      ['step two', theme],
      ['step three', key],
      ['the confirmation', success],
    ]) {
      near(state.card.width, 520, `the card width in ${label}`);
      near(state.card.x, 340, `the card left edge in ${label}`);
      near(state.card.width - 2 * 32, 456, `the card measure in ${label}`);
      same(state.radius, '24px', `the card corner radius in ${label}`);
      same(state.padding, '32px', `the card padding in ${label}`);
      if (state.fill !== run.tones.surface) throw new Error(`the card in ${label} is not on the surface tone`);
    }
    near(name.card.y, 187, 'the card top in step one', 1);

    // Header (badge 0:2394, title 0:2398, subtitle 0:2399): a 44 px soft disc beside a
    // 28/36 semibold title over a 14/22 subtitle.
    near(name.badge.width, 44, 'the header badge width');
    near(name.badge.height, 44, 'the header badge height');
    same(name.title.size, '28px', 'the title size');
    same(name.title.weight, '600', 'the title weight');
    same(name.subtitle.size, '14px', 'the subtitle size');

    // Progress: three 144 x 4 bars filling the 456 measure 12 apart, the step under way
    // on the accent tone and the two ahead on the tertiary tone, captioned at 13.
    for (const [index, step] of name.steps.entries()) {
      near(step.bar.width, 144, `progress bar ${index + 1} width`);
      near(step.bar.height, 4, `progress bar ${index + 1} height`);
    }
    const across = name.steps[name.steps.length - 1].bar.x + name.steps[name.steps.length - 1].bar.width - name.steps[0].bar.x;
    near(across, 456, 'the three bars across the measure');
    near(name.steps[1].bar.x - (name.steps[0].bar.x + name.steps[0].bar.width), 12, 'the gap between two progress bars');
    same(name.steps[0].fill, run.tones.accent, 'the bar under way');
    for (const step of name.steps.slice(1)) same(step.fill, run.tones.tertiary, 'a bar still ahead');
    same(name.captionSize, '13px', 'the step caption size');

    // Step one: a 14 px label over a 456 x 40 field (0:2406 / 0:2407).
    same(name.label.size, '14px', 'the field label size');
    near(name.label.box.width, 456, 'the field label measure');
    near(name.input.width, 456, 'the name field width');
    near(name.input.height, 40, 'the name field height');

    // Step two: two equal theme cards, 24 apart, together the measure.
    same(theme.themes.length, 2, 'the number of theme cards');
    near(theme.themes[0].width, 216, 'a theme card width');
    near(theme.themes[0].height, 152, 'a theme card height');
    near(theme.themes[1].width, theme.themes[0].width, 'the second theme card width');
    near(theme.themes[1].x - (theme.themes[0].x + theme.themes[0].width), 24, 'the gap between the theme cards');

    // Step three: the key field, then the 456 x 20 privacy row under the actions.
    near(key.input.width, 456, 'the key field width');
    near(key.privacy.width, 456, 'the privacy row measure');
    near(key.privacy.height, 20, 'the privacy row height');

    // The three refusals turn the field's outline to the danger tone. Only a key main
    // refused raises the 456 x 52 alert; the other two report under the field.
    for (const [label, state] of [
      ['the empty name', nameError],
      ['the short key', tooShort],
      ['the rejected key', rejected],
    ]) {
      near(state.input.width, 456, `the ${label} field width`);
      same(state.outline, run.tones.danger, `the ${label} field outline`);
    }
    if (name.outline === run.tones.danger) throw new Error('step one outlines its field in the danger tone before anything was refused');
    near(rejected.alert.width, 456, 'the rejected-key alert measure');
    near(rejected.alert.height, 52, 'the rejected-key alert height');
    same(nameError.alert.width, 0, 'the alert raised by an empty name');
    same(tooShort.alert.width, 0, 'the alert raised by a short key');

    // The primary action carries the accent fill in every step it is drawn on, with the
    // contrast label, and the save in flight shows the spinner instead.
    for (const [label, state] of [['step one', name], ['step two', theme], ['step three', key]]) {
      same(state.primary.fill, run.tones.accent, `the primary fill in ${label}`);
      same(state.primary.label, run.tones.onAccent, `the primary label in ${label}`);
      same(state.primary.box.height, 36, `the primary button height in ${label}`);
    }
    same(name.spinner, 'inline', 'the spinner at rest');
    same(saving.spinner, 'block', 'the spinner while saving');

    // The confirmation: the step captions go, the skip goes, the badge grows to 64 and
    // the title drops to the smaller step beside a summary line.
    same(success.skip.width, 0, 'the skip control on the confirmation');
    near(success.summary.width, 456, 'the confirmation summary measure');
    near(success.badge.width, 64, 'the confirmation badge width');
    same(success.title.size, '24px', 'the confirmation title size');

    return `1200x800: one 520 wide card, 32 padding, 24 radius, 44 px badge, 28/36 title, three 144x4 bars 12 apart, 456x40 field, 216x152 theme cards 24 apart, three refusals, saving and the confirmation`;
  });

  onboardingWindow.destroy();

  // The sign-in page's acceptance is the same sentence as the shell's: it matches the
  // node it was drawn from. Node 0:11371 is 1440x900 with a 640 px brand panel on the
  // left and a 560 px card at (760, 150) on the right. Its five frames are that one page
  // in four desktop states plus a 390 wide phone frame, so each frame is opened through
  // ?state= and measured as drawn rather than reading the stylesheet back to itself.
  const SIGNIN_FRAMES = {
    empty: '',
    loading: 'state=loading',
    error: 'state=error',
    'signed-in': 'state=signed-in',
  };

  const measureSignIn = async (width, height, search = '') => {
    const signInWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await signInWindow.loadFile(SIGNIN_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await signInWindow.webContents.executeJavaScript(`(() => {
      const style = (element) => getComputedStyle(element);
      const measure = (selector) => {
        const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const computed = style(element);
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          radius: parseFloat(computed.borderRadius),
          background: computed.backgroundColor,
          color: computed.color,
          shadow: computed.boxShadow,
          display: computed.display,
          offsetLeft: element.offsetLeft,
          offsetTop: element.offsetTop,
          size: parseFloat(computed.fontSize),
          leading: parseFloat(computed.lineHeight),
          weight: computed.fontWeight,
          text: element.textContent.replace(/\\s+/g, ' ').trim(),
        };
      };

      // Every frame-scoped selector is written against the visible panel, so a box of 0
      // never passes for a drawn one: the two panels share the title/sub class names.
      const form = '.signin-panel:not(.signin-panel-done) ';
      const email = document.querySelector('#signin-email');
      const placeholder = getComputedStyle(email, '::placeholder');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        state: document.querySelector('.signin-page').dataset.state,
        brand: measure('.signin-brand'),
        mark: measure('.signin-brand-mark'),
        brandName: measure('.signin-brand-name'),
        headline: measure('.signin-brand-headline'),
        body: measure('.signin-brand-body'),
        features: Array.from(document.querySelectorAll('.signin-features li')).map(measure),
        featureIcons: Array.from(document.querySelectorAll('.signin-features li svg')).map(measure),
        card: measure('.signin-card'),
        formPanel: measure('.signin-panel:not(.signin-panel-done)'),
        title: measure(form + '.signin-title'),
        sub: measure(form + '.signin-sub'),
        emailField: measure('.signin-field-email'),
        emailLabel: measure('.signin-field-email .signin-label'),
        emailInput: measure('.signin-field-email .signin-input'),
        emailPlaceholder: {
          text: email.placeholder,
          size: parseFloat(placeholder.fontSize),
          color: placeholder.color,
        },
        passwordField: measure('.signin-field-password'),
        passwordInput: measure('.signin-field-password .signin-input'),
        reveal: measure('.signin-reveal'),
        rememberRow: measure(form + '.signin-remember-row'),
        checkBox: measure(form + '.signin-check'),
        checkGlyph: measure(form + '.signin-checkbox svg'),
        rememberLabel: measure(form + '.signin-remember'),
        forgot: measure(form + '.signin-forgot'),
        submit: measure(form + '.signin-submit'),
        submitIcon: measure(form + '.signin-submit-icon'),
        banner: measure(form + '.signin-error'),
        bannerMessage: measure(form + '.signin-error span'),
        divider: measure(form + '.signin-divider'),
        or: measure(form + '.signin-divider span'),
        secondary: measure(form + '.signin-secondary'),
        printApp: measure('.signin-print-app'),
        printPhone: measure('.signin-print-phone'),
        status: measure('.signin-status'),
        statusTime: measure('.signin-status-time'),
        phoneMark: measure('.signin-phone-brand .signin-brand-mark'),
        phoneName: measure('.signin-phone-brand-name'),
        doneIcon: measure('.signin-done-icon'),
        doneTitle: measure('.signin-panel-done .signin-title'),
        doneSub: measure('.signin-panel-done .signin-sub'),
        track: measure('.signin-progress'),
        fill: measure('.signin-progress-fill'),
        note: measure('.signin-redirect'),
        continueButton: measure('.signin-panel-done .signin-submit'),
      };
    })()`);
    signInWindow.destroy();
    return measured;
  };

  const signIn = {};
  for (const [name, search] of Object.entries(SIGNIN_FRAMES)) {
    signIn[name] = await measureSignIn(1440, 900, search);
  }
  signIn.phone = await measureSignIn(390, 844);

  report.check('the Sign-in page is drawn from node 0:11371', () => {
    const near = (value, expected, label, slack = 0.6) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the page draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, hex, label) => {
      if (value !== rgb(hex)) throw new Error(`${label} is ${value}, the node paints ${hex}`);
    };

    const empty = signIn.empty;
    const loading = signIn.loading;
    const error = signIn.error;
    const done = signIn['signed-in'];
    const phone = signIn.phone;

    near(empty.viewport.width, 1440, 'the measured viewport width');
    near(empty.viewport.height, 900, 'the measured viewport height');
    writes(empty.state, 'empty', 'the opening state');

    // The brand panel: 640 x 900 of colour/surface-dark, a 32 px mark at (48, 48) on
    // radius 8, the 15/20 wordmark 92 from the left, and the 28/36 headline 48 px in.
    const brand = [
      ['empty', empty],
      ['loading', loading],
      ['error', error],
      ['signed-in', done],
    ];
    for (const [name, frame] of brand) {
      near(frame.brand.width, 640, `the ${name} brand panel width`);
      near(frame.brand.height, 900, `the ${name} brand panel height`);
      paints(frame.brand.background, '#101214', `the ${name} brand panel`);
      near(frame.mark.x, 48, `the ${name} mark left`);
      near(frame.mark.y, 48, `the ${name} mark top`);
      near(frame.mark.width, 32, `the ${name} mark width`);
      near(frame.mark.height, 32, `the ${name} mark height`);
      near(frame.mark.radius, 8, `the ${name} mark radius`);
      paints(frame.mark.background, '#2F6BFF', `the ${name} mark`);
      near(frame.brandName.x, 92, `the ${name} wordmark left`);
      near(frame.brandName.y, 54, `the ${name} wordmark top`);
      near(frame.brandName.size, 15, `the ${name} wordmark size`);
      near(frame.brandName.leading, 20, `the ${name} wordmark line`);
      writes(frame.brandName.weight, '500', `the ${name} wordmark weight`);
      paints(frame.brandName.color, '#EDEFF2', `the ${name} wordmark`);
    }

    near(empty.headline.x, 48, 'the headline left');
    near(empty.headline.y, 300, 'the headline top');
    near(empty.headline.width, 480, 'the headline width');
    near(empty.headline.height, 36, 'the headline line');
    near(empty.headline.size, 28, 'the headline size');
    paints(empty.headline.color, '#EDEFF2', 'the headline');
    near(empty.body.x, 48, 'the body copy left');
    near(empty.body.y, 392, 'the body copy top');
    near(empty.body.width, 460, 'the body copy width');
    near(empty.body.leading, 22, 'the body copy leading');
    paints(empty.body.color, '#ADB4BB', 'the body copy');

    // Three 32 px feature rows on a 40 px pitch, each glyph 16 px at the row's 8.
    if (empty.features.length !== 3) throw new Error(`the page draws ${empty.features.length} feature rows, the node has 3`);
    const featureTops = [488, 528, 568];
    for (const [index, row] of empty.features.entries()) {
      near(row.x, 48, `feature row ${index + 1} left`);
      near(row.y, featureTops[index], `feature row ${index + 1} top`);
      near(row.width, 480, `feature row ${index + 1} width`);
      near(row.height, 32, `feature row ${index + 1} height`);
      near(empty.featureIcons[index].x, 48, `feature glyph ${index + 1} left`);
      near(empty.featureIcons[index].y, featureTops[index] + 8, `feature glyph ${index + 1} top`);
      near(empty.featureIcons[index].width, 16, `feature glyph ${index + 1} width`);
    }

    // The card is 560 wide at (760, 150) on radius 12, with its 1 px hairline drawn as an
    // inset ring and the node's 0 4 16 soft shadow under it.
    near(empty.card.x, 760, 'the card left edge');
    near(empty.card.y, 150, 'the card top');
    near(empty.card.width, 560, 'the card width');
    near(empty.card.radius, 12, 'the card radius');
    paints(empty.card.background, '#FFFFFF', 'the card fill');
    if (!empty.card.shadow.includes(rgb('#E8EAED'))) throw new Error('the card draws no hairline ring');
    if (!empty.card.shadow.includes('0px 4px 16px')) throw new Error('the card draws no 0 4 16 shadow');

    // Empty frame: the card's 600 height and its stack, every part 40 px in from the card.
    near(empty.card.height, 600, 'the empty card height');
    near(empty.title.y, 190, 'the title top');
    near(empty.title.height, 36, 'the title line');
    near(empty.title.size, 28, 'the title size');
    near(empty.sub.y, 234, 'the subtitle top');
    near(empty.sub.size, 14, 'the subtitle size');
    near(empty.sub.leading, 22, 'the subtitle leading');
    paints(empty.sub.color, '#6B7280', 'the subtitle');
    near(empty.emailField.y, 290, 'the email field top');
    near(empty.emailField.width, 480, 'the email field width');
    near(empty.emailField.height, 70, 'the email field height');
    near(empty.emailLabel.size, 13, 'the field label size');
    near(empty.emailLabel.leading, 18, 'the field label line');
    writes(empty.emailLabel.weight, '500', 'the field label weight');
    near(empty.emailInput.y, 316, 'the email input top');
    near(empty.emailInput.width, 480, 'the email input width');
    near(empty.emailInput.height, 44, 'the email input height');
    near(empty.emailInput.radius, 8, 'the email input radius');
    paints(empty.emailInput.background, '#FFFFFF', 'the email input fill');
    near(empty.emailPlaceholder.size, 14, 'the placeholder size');
    near(empty.emailPlaceholder.leading, 22, 'the placeholder leading');
    paints(empty.emailPlaceholder.color, '#8E9196', 'the placeholder');
    near(empty.passwordField.y, 386, 'the password field top');
    near(empty.reveal.y, 426, 'the reveal glyph top');
    near(empty.reveal.width, 16, 'the reveal glyph width');
    near(empty.rememberRow.y, 458, 'the remember row top');
    near(empty.rememberRow.height, 20, 'the remember row height');
    near(empty.checkBox.width, 20, 'the checkbox width');
    near(empty.checkBox.height, 20, 'the checkbox height');
    near(empty.checkBox.radius, 5, 'the checkbox radius');
    paints(empty.checkBox.background, '#2F6BFF', 'the checked box');
    near(empty.checkGlyph.width, 12, 'the check glyph width');
    near(empty.forgot.size, 13, 'the reset link size');
    paints(empty.forgot.color, '#2F6BFF', 'the reset link');
    near(empty.submit.y, 506, 'the submit top');
    near(empty.submit.width, 480, 'the submit width');
    near(empty.submit.height, 44, 'the submit height');
    near(empty.submit.radius, 8, 'the submit radius');
    paints(empty.submit.background, '#2F6BFF', 'the submit fill');
    near(empty.submit.size, 14, 'the submit label size');
    near(empty.submit.leading, 20, 'the submit label line');
    writes(empty.submit.weight, '500', 'the submit label weight');
    paints(empty.submit.color, '#FFFFFF', 'the submit label');
    near(empty.divider.y, 574, 'the divider row top');
    near(empty.divider.height, 20, 'the divider row height');
    near(empty.or.size, 11, 'the "or" size');
    paints(empty.or.color, '#8E9196', 'the "or"');
    near(empty.secondary.y, 606, 'the create-account top');
    near(empty.secondary.height, 44, 'the create-account height');
    near(empty.secondary.radius, 8, 'the create-account radius');
    near(empty.printApp.y, 674, 'the app fine print top');
    near(empty.printApp.size, 11, 'the app fine print size');
    near(empty.printApp.leading, 16, 'the app fine print line');
    paints(empty.printApp.color, '#8E9196', 'the app fine print');

    // Rejected frame: the banner 40 px tall at 124, then the stack shifted 56 down.
    near(error.card.height, 660, 'the rejected card height');
    near(error.banner.x, 800, 'the banner left');
    near(error.banner.y, 274, 'the banner top');
    near(error.banner.width, 480, 'the banner width');
    near(error.banner.height, 40, 'the banner height');
    near(error.banner.radius, 8, 'the banner radius');
    paints(error.banner.background, '#F0F1F3', 'the banner fill');
    near(error.bannerMessage.size, 12, 'the banner message size');
    near(error.bannerMessage.leading, 18, 'the banner message line');
    if (!error.passwordInput.shadow.includes(rgb('#D14343'))) {
      throw new Error('the rejected password outline does not draw #D14343');
    }
    near(error.emailField.y, 346, 'the rejected email field top');
    near(error.passwordField.y, 442, 'the rejected password field top');
    near(error.rememberRow.y, 514, 'the rejected remember row top');
    near(error.submit.y, 562, 'the rejected submit top');
    near(error.divider.y, 630, 'the rejected divider top');
    near(error.secondary.y, 662, 'the rejected create-account top');
    near(error.printApp.y, 730, 'the rejected fine print top');
    paints(error.secondary.background, '#FFFFFF', 'the rejected create-account fill');

    // Submitting frame: sunken fields and a soft accent button with the glyph at its left.
    near(loading.card.height, 600, 'the submitting card height');
    paints(loading.emailInput.background, '#F0F1F3', 'the submitting email field');
    paints(loading.passwordInput.background, '#F0F1F3', 'the submitting password field');
    paints(loading.submit.background, '#EAF0FF', 'the submitting button');
    paints(loading.submit.color, '#2F6BFF', 'the submitting label');
    writes(loading.submitIcon.display, 'block', 'the spinner');
    // The glyph is mid-spin, so its box moves every frame; the node's 150/14 is a layout
    // position inside the button, so the offsets are asserted rather than the rect.
    near(loading.submitIcon.offsetLeft, 150, 'the spinner left');
    near(loading.submitIcon.offsetTop, 14, 'the spinner top');
    writes(loading.submit.text, 'Signing in\u2026', 'the submitting label text');
    paints(loading.secondary.background, '#FFFFFF', 'the submitting create-account fill');

    // Signed-in frame: the hand-off card is 340 tall, the bar 6 px on a pill radius.
    near(done.card.height, 340, 'the signed-in card height');
    writes(done.formPanel.display, 'none', 'the form panel in the signed-in frame');
    near(done.doneIcon.x, 800, 'the done glyph left');
    near(done.doneIcon.y, 190, 'the done glyph top');
    near(done.doneIcon.width, 44, 'the done glyph box');
    near(done.doneIcon.radius, 10, 'the done glyph radius');
    paints(done.doneIcon.background, '#E9F6F0', 'the done glyph fill');
    near(done.doneTitle.y, 254, 'the signed-in title top');
    near(done.doneTitle.size, 28, 'the signed-in title size');
    near(done.doneSub.y, 298, 'the signed-in subtitle top');
    near(done.track.y, 354, 'the progress track top');
    near(done.track.width, 480, 'the progress track width');
    near(done.track.height, 6, 'the progress track height');
    paints(done.fill.background, '#1F9D6B', 'the progress fill');
    near(done.fill.width, 348, 'the progress fill width');
    near(done.note.y, 378, 'the redirect note top');
    near(done.note.size, 11, 'the redirect note size');
    near(done.continueButton.y, 414, 'the continue button top');
    near(done.continueButton.height, 44, 'the continue button height');
    near(done.continueButton.size, 14, 'the continue button label size');
    writes(done.continueButton.weight, '500', 'the continue button label weight');
    paints(done.continueButton.background, '#2F6BFF', 'the continue button fill');

    // Phone frame: one 390 column, the brand panel and the app fine print dropped, the
    // card flattened onto the page, controls 48 px, and the drawn bottom line at 780.
    near(phone.viewport.width, 390, 'the phone viewport width');
    near(phone.viewport.height, 844, 'the phone viewport height');
    writes(phone.brand.display, 'none', 'the brand panel at 390');
    writes(phone.card.background, 'rgba(0, 0, 0, 0)', 'the card fill at 390');
    writes(phone.card.shadow, 'none', 'the card shadow at 390');
    writes(phone.rememberLabel.display, 'none', 'the remember box at 390');
    writes(phone.printApp.display, 'none', 'the app fine print at 390');
    near(phone.status.width, 390, 'the status bar width');
    near(phone.status.height, 28, 'the status bar height');
    near(phone.statusTime.x, 16, 'the status time left');
    near(phone.statusTime.y, 7, 'the status time top');
    near(phone.phoneMark.x, 20, 'the phone mark left');
    near(phone.phoneMark.y, 52, 'the phone mark top');
    near(phone.phoneMark.width, 32, 'the phone mark width');
    near(phone.phoneName.x, 64, 'the phone wordmark left');
    near(phone.phoneName.size, 15, 'the phone wordmark size');
    near(phone.title.x, 20, 'the phone title left');
    near(phone.title.y, 112, 'the phone title top');
    near(phone.title.width, 350, 'the phone title width');
    near(phone.title.size, 28, 'the phone title size');
    near(phone.sub.y, 156, 'the phone subtitle top');
    near(phone.emailField.y, 220, 'the phone email field top');
    near(phone.emailField.width, 350, 'the phone email field width');
    near(phone.emailField.height, 74, 'the phone email field height');
    near(phone.emailInput.y, 246, 'the phone email input top');
    near(phone.emailInput.height, 48, 'the phone email input height');
    near(phone.emailInput.radius, 8, 'the phone email input radius');
    paints(phone.emailInput.background, '#F7F8F9', 'the phone email input fill');
    near(phone.emailPlaceholder.size, 15, 'the phone placeholder size');
    near(phone.passwordField.y, 312, 'the phone password field top');
    near(phone.passwordInput.y, 338, 'the phone password input top');
    near(phone.reveal.x, 340, 'the phone reveal glyph left');
    near(phone.forgot.y, 404, 'the phone reset link top', 1.2);
    near(phone.forgot.height, 18, 'the phone reset link height');
    near(phone.forgot.x + phone.forgot.width, 370, 'the phone reset link right edge');
    near(phone.submit.y, 444, 'the phone submit top');
    near(phone.submit.width, 350, 'the phone submit width');
    near(phone.submit.height, 48, 'the phone submit height');
    near(phone.submit.size, 15, 'the phone submit label size');
    writes(phone.submit.weight, '500', 'the phone submit label weight');
    near(phone.divider.y, 516, 'the phone divider row top');
    near(phone.or.size, 11, 'the phone "or" size');
    near(phone.secondary.y, 548, 'the phone create-account top');
    near(phone.secondary.height, 48, 'the phone create-account height');
    near(phone.secondary.size, 15, 'the phone create-account label size');
    paints(phone.secondary.background, '#F7F8F9', 'the phone create-account fill');
    near(phone.printPhone.y, 780, 'the phone fine print top');
    near(phone.printPhone.width, 350, 'the phone fine print width');
    near(phone.printPhone.size, 11, 'the phone fine print size');
    writes(phone.printPhone.text, 'One account for web and desktop.', 'the phone fine print');

    // The node's sentences, as the page actually renders them.
    writes(empty.headline.text, 'One account for web and desktop.', 'the headline');
    writes(
      empty.body.text,
      "Sign in once and your chats, tasks and automations follow you \u2014 whether you're in the browser or on Windows.",
      'the body copy',
    );
    writes(empty.features[0].text, 'Ask, Act and Autopilot in one workspace', 'the first feature');
    writes(empty.features[1].text, 'Cloud handoff between devices', 'the second feature');
    writes(empty.features[2].text, 'Keys stay in your account, not in the URL', 'the third feature');
    writes(empty.title.text, 'Sign in', 'the title');
    writes(empty.sub.text, 'Use the same account you use in the browser.', 'the subtitle');
    writes(empty.emailPlaceholder.text, 'you@studio.com', 'the email placeholder');
    writes(empty.rememberRow.text, 'Keep me signed in Forgot password?', 'the remember row');
    writes(empty.submit.text, 'Sign in', 'the submit label');
    writes(empty.secondary.text, 'Create an account', 'the create-account label');
    writes(
      empty.printApp.text,
      'Inside the desktop app this returns you to the view you were on.',
      'the app fine print',
    );
    writes(
      error.bannerMessage.text,
      'Email or password is incorrect. Try again or reset your password.',
      'the banner message',
    );
    writes(done.doneTitle.text, "You're signed in", 'the signed-in title');
    writes(
      done.doneSub.text,
      'Signed in as ana@studio.com. Returning you to the view you were on\u2026',
      'the signed-in subtitle',
    );
    writes(
      done.note.text,
      'This account is now the one used on web and desktop.',
      'the redirect note',
    );
    writes(done.continueButton.text, 'Continue to Zuri Desk', 'the continue button');

    return '1440x900: 640 brand panel, 560x600 card at 760,150, empty, submitting, rejected (660 tall) and signed-in (340 tall) frames as drawn, plus the 390 phone column';
  });

  // The forgot-password page is closed on the same sentence as the shell: it matches the
  // node it was drawn from. Node 0:11991 is 1440x900 with the sign-in page's 640 px brand
  // panel and a 560 px card at (760, 190). Its six frames are that page in five desktop
  // states plus a 390 wide phone frame, so each frame is opened through ?state= and
  // measured as drawn rather than reading the stylesheet back to itself.
  const FORGOT_FRAMES = {
    empty: '',
    loading: 'state=loading',
    sent: 'state=sent',
    error: 'state=error',
    disabled: 'state=disabled',
  };

  const measureForgot = async (width, height, search = '') => {
    const forgotWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await forgotWindow.loadFile(FORGOT_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await forgotWindow.webContents.executeJavaScript(`(() => {
      const style = (element) => getComputedStyle(element);
      const measure = (selector) => {
        const element = typeof selector === "string" ? document.querySelector(selector) : selector;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const computed = style(element);
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          radius: parseFloat(computed.borderRadius),
          background: computed.backgroundColor,
          color: computed.color,
          shadow: computed.boxShadow,
          display: computed.display,
          size: parseFloat(computed.fontSize),
          leading: parseFloat(computed.lineHeight),
          weight: computed.fontWeight,
          text: element.textContent.replace(/\\s+/g, ' ').trim(),
        };
      };

      // The two panels share the title and sub class names, so each frame-scoped selector
      // names its panel: a hidden panel would otherwise measure 0 and pass for drawn.
      const form = '.forgot-panel-form ';
      const sent = '.forgot-panel-sent ';
      const email = document.querySelector('#forgot-email');
      const placeholder = getComputedStyle(email, '::placeholder');
      const submit = document.querySelector('.forgot-submit');
      const done = document.querySelector('.forgot-panel-sent .forgot-submit');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        state: document.querySelector('.forgot-page').dataset.state,
        brand: measure('.forgot-brand'),
        mark: measure('.forgot-brand .forgot-brand-mark'),
        brandName: measure('.forgot-brand .forgot-brand-name'),
        headline: measure('.forgot-brand-headline'),
        body: measure('.forgot-brand-body'),
        features: Array.from(document.querySelectorAll('.forgot-features li')).map(measure),
        featureIcons: Array.from(document.querySelectorAll('.forgot-features li svg')).map(measure),
        card: measure('.forgot-card'),
        disc: measure(form + '.forgot-disc'),
        title: measure(form + '.forgot-title'),
        sub: measure(form + '.forgot-sub'),
        fields: measure(form + '.forgot-fields'),
        label: measure(form + '.forgot-label'),
        input: measure(form + '.forgot-input'),
        placeholder: {
          text: email.placeholder,
          size: parseFloat(placeholder.fontSize),
          color: placeholder.color,
        },
        errorRow: measure(form + '.forgot-error'),
        errorMessage: measure(form + '.forgot-error-message'),
        button: measure(form + '.forgot-submit'),
        buttonLabel: measure(form + '.forgot-submit-label'),
        back: measure(form + '.forgot-back'),
        backLink: measure(form + '.forgot-back .forgot-back-link'),
        sentDisc: measure(sent + '.forgot-disc'),
        sentTitle: measure(sent + '.forgot-title'),
        sentSub: measure(sent + '.forgot-sub'),
        note: measure(sent + '.forgot-note'),
        noteText: measure(sent + '.forgot-note-text'),
        resend: measure(sent + '.forgot-resend'),
        sentBack: measure(sent + '.forgot-back-link-end'),
        status: measure('.forgot-status'),
        statusTime: measure('.forgot-status-time'),
        phoneBrand: measure('.forgot-phone-brand'),
        phoneDisc: measure('.forgot-phone-brand .forgot-brand-mark'),
        phoneName: measure('.forgot-phone-brand-name'),
        fieldLook: measure(form + '.forgot-input'),
        submitDisabled: submit ? submit.disabled : null,
        sentButtonDisabled: done ? done.disabled : null,
      };
    })()`);
    forgotWindow.destroy();
    return measured;
  };

  const forgot = {};
  for (const [name, search] of Object.entries(FORGOT_FRAMES)) {
    forgot[name] = await measureForgot(1440, 900, search);
  }
  forgot.phone = await measureForgot(390, 844);

  report.check('the Forgot-password page is drawn from node 0:11991', () => {
    const near = (value, expected, label, slack = 0.6) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the page draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, hex, label) => {
      if (value !== rgb(hex)) throw new Error(`${label} is ${value}, the node paints ${hex}`);
    };

    const empty = forgot.empty;
    const loading = forgot.loading;
    const sent = forgot.sent;
    const error = forgot.error;
    const off = forgot.disabled;
    const phone = forgot.phone;

    near(empty.viewport.width, 1440, 'the measured viewport width');
    near(empty.viewport.height, 900, 'the measured viewport height');
    writes(empty.state, 'empty', 'the opening state');

    // The brand panel is the sign-in page's: 640 x 900 of color/surface-dark, a 32 px mark
    // at (48, 48) on radius 8, the 15/20 wordmark 92 in, the 28/36 headline at 300.
    for (const [name, frame] of [['empty', empty], ['loading', loading], ['sent', sent], ['error', error], ['disabled', off]]) {
      near(frame.brand.width, 640, `the ${name} brand panel width`);
      near(frame.brand.height, 900, `the ${name} brand panel height`);
      paints(frame.brand.background, '#101214', `the ${name} brand panel`);
      near(frame.mark.x, 48, `the ${name} mark left`);
      near(frame.mark.y, 48, `the ${name} mark top`);
      near(frame.mark.width, 32, `the ${name} mark width`);
      near(frame.mark.radius, 8, `the ${name} mark radius`);
      paints(frame.mark.background, '#2F6BFF', `the ${name} mark`);
      near(frame.brandName.x, 92, `the ${name} wordmark left`);
      near(frame.brandName.size, 15, `the ${name} wordmark size`);
      near(frame.brandName.leading, 20, `the ${name} wordmark line`);
      paints(frame.brandName.color, '#EDEFF2', `the ${name} wordmark`);
    }

    near(empty.headline.x, 48, 'the headline left');
    near(empty.headline.y, 300, 'the headline top');
    near(empty.headline.width, 480, 'the headline width');
    near(empty.headline.size, 28, 'the headline size');
    near(empty.headline.leading, 36, 'the headline line');
    paints(empty.headline.color, '#EDEFF2', 'the headline');
    near(empty.body.y, 392, 'the body copy top');
    near(empty.body.width, 460, 'the body copy width');
    near(empty.body.leading, 22, 'the body copy leading');
    paints(empty.body.color, '#ADB4BB', 'the body copy');

    // Three 32 px feature rows on a 40 px pitch, each glyph 16 px at the row's 8.
    if (empty.features.length !== 3) throw new Error(`the page draws ${empty.features.length} feature rows, the node has 3`);
    const featureTops = [488, 528, 568];
    for (const [index, row] of empty.features.entries()) {
      near(row.x, 48, `feature row ${index + 1} left`);
      near(row.y, featureTops[index], `feature row ${index + 1} top`);
      near(row.height, 32, `feature row ${index + 1} height`);
      near(empty.featureIcons[index].y, featureTops[index] + 8, `feature glyph ${index + 1} top`);
      near(empty.featureIcons[index].width, 16, `feature glyph ${index + 1} width`);
    }

    // The card is 560 wide at (760, 190) on radius 12, with its 1 px hairline drawn as an
    // inset ring and the node's 0 4 16 soft shadow under it.
    const cards = [
      ['empty', empty, 190, 420],
      ['loading', loading, 190, 420],
      ['error', error, 190, 438],
      ['disabled', off, 190, 420],
      ['sent', sent, 230, 340],
    ];
    for (const [name, frame, top, height] of cards) {
      near(frame.card.x, 760, `the ${name} card left edge`);
      near(frame.card.y, top, `the ${name} card top`);
      near(frame.card.width, 560, `the ${name} card width`);
      near(frame.card.height, height, `the ${name} card height`);
      near(frame.card.radius, 12, `the ${name} card radius`);
      paints(frame.card.background, '#FFFFFF', `the ${name} card fill`);
      if (!frame.card.shadow.includes(rgb('#E8EAED'))) throw new Error(`the ${name} card draws no hairline ring`);
      if (!frame.card.shadow.includes('0px 4px 16px')) throw new Error(`the ${name} card draws no 0 4 16 shadow`);
    }

    // The key disc is 44 px at the card's 40 px inset on radius 10 in primary-soft.
    near(empty.disc.x, 800, 'the key disc left');
    near(empty.disc.y, 230, 'the key disc top');
    near(empty.disc.width, 44, 'the key disc width');
    near(empty.disc.radius, 10, 'the key disc radius');
    paints(empty.disc.background, '#EAF0FF', 'the key disc');
    near(sent.sentDisc.x, 800, 'the sent disc left');
    near(sent.sentDisc.y, 270, 'the sent disc top');
    paints(sent.sentDisc.background, '#E9F6F0', 'the sent disc');

    // The card's own rhythm: disc 84, title 104, sub 148, field 212, button 288, back 352.
    near(empty.title.x, 800, 'the card title left');
    near(empty.title.y, 294, 'the card title top');
    near(empty.title.size, 28, 'the card title size');
    near(empty.title.leading, 36, 'the card title line');
    paints(empty.title.color, '#1F2328', 'the card title');
    near(empty.sub.y, 338, 'the card sub top');
    near(empty.sub.width, 480, 'the card sub width');
    near(empty.sub.size, 14, 'the card sub size');
    near(empty.sub.leading, 22, 'the card sub leading');
    paints(empty.sub.color, '#6B7280', 'the card sub');
    near(empty.fields.y, 402, 'the field top');
    near(empty.fields.width, 480, 'the field width');
    near(empty.label.size, 13, 'the field label size');
    near(empty.label.leading, 18, 'the field label line');
    writes(empty.label.weight, '500', 'the field label weight');
    near(empty.input.y, 428, 'the input top');
    near(empty.input.width, 480, 'the input width');
    near(empty.input.height, 44, 'the input height');
    near(empty.input.radius, 8, 'the input radius');
    paints(empty.input.background, '#FFFFFF', 'the resting input fill');
    if (!empty.input.shadow.includes(rgb('#E8EAED'))) throw new Error('the resting input draws no hairline outline');
    near(empty.placeholder.size, 14, 'the placeholder size');
    paints(empty.placeholder.color, '#8E9196', 'the placeholder');
    near(empty.button.y, 478, 'the send button top');
    near(empty.button.height, 44, 'the send button height');
    near(empty.button.radius, 8, 'the send button radius');
    paints(empty.button.background, '#2F6BFF', 'the send button fill');
    paints(empty.button.color, '#FFFFFF', 'the send button label');
    near(empty.buttonLabel.size, 14, 'the send label size');
    near(empty.buttonLabel.leading, 20, 'the send label line');
    writes(empty.buttonLabel.weight, '500', 'the send label weight');
    // The link row sits 20 px under the button, centred inside the card's measure.
    near(empty.back.y, 542, 'the back row top');
    near(empty.back.height, 20, 'the back row height');
    near(empty.backLink.size, 13, 'the back link size');
    paints(empty.backLink.color, '#2F6BFF', 'the back link');

    // The sending frame: a filled field the user cannot change and a soft button.
    paints(loading.input.background, '#F0F1F3', 'the sending field fill');
    paints(loading.button.background, '#EAF0FF', 'the sending button fill');
    paints(loading.button.color, '#2F6BFF', 'the sending label');
    if (loading.submitDisabled !== true) throw new Error('the sending frame leaves the send button live');

    // The unknown-address frame: the field it complains about outlined in danger, an 18 px
    // message row directly under it, and the button pushed down by exactly that row.
    if (!error.input.shadow.includes(rgb('#D14343'))) throw new Error('the rejected field is not outlined in danger');
    paints(error.errorRow.color, '#D14343', 'the message row');
    near(error.errorRow.y, 472, 'the message row top');
    near(error.errorRow.height, 18, 'the message row height');
    near(error.button.y, 496, 'the rejected send button top');
    near(error.back.y, 560, 'the rejected back row top');

    // The blank-email frame: the same card with the button in its inert look.
    paints(off.button.background, '#F0F1F3', 'the inert button fill');
    paints(off.button.color, '#8E9196', 'the inert label');
    if (off.submitDisabled !== true) throw new Error('the blank-email frame leaves the send button live');

    // The sent frame: a 340 px card at 230 with a quiet note, a 236 px resend button and
    // the back link in the other 236 px half.
    near(sent.sentTitle.y, 334, 'the sent title top');
    writes(sent.sentTitle.text, 'Check your email', 'the sent title');
    near(sent.sentSub.y, 378, 'the sent sub top');
    near(sent.note.y, 442, 'the sent note top');
    near(sent.note.height, 44, 'the sent note height');
    paints(sent.note.background, '#F7F8F9', 'the sent note fill');
    near(sent.noteText.size, 12, 'the sent note size');
    near(sent.noteText.leading, 18, 'the sent note leading');
    paints(sent.noteText.color, '#6B7280', 'the sent note');
    near(sent.resend.y, 502, 'the resend button top');
    near(sent.resend.width, 236, 'the resend button width');
    near(sent.resend.height, 44, 'the resend button height');
    paints(sent.resend.background, '#F7F8F9', 'the resend button fill');
    near(sent.sentBack.y, 514, 'the sent back link top', 1.5);
    near(
      sent.sentBack.y + sent.sentBack.height / 2,
      sent.resend.y + sent.resend.height / 2,
      'the sent back link centre',
      1,
    );
    near(sent.sentBack.width, 236, 'the sent back link width');
    paints(sent.sentBack.color, '#2F6BFF', 'the sent back link');

    // The phone frame: one column on the card colour, its own status bar and wordmark row,
    // and 48 px controls 28 px under the sub.
    near(phone.viewport.width, 390, 'the phone viewport width');
    near(phone.status.height, 28, 'the phone status bar height');
    near(phone.statusTime.size, 11, 'the phone clock size');
    near(phone.phoneBrand.y, 44, 'the phone wordmark row top');
    near(phone.phoneBrand.height, 32, 'the phone wordmark row height');
    near(phone.phoneDisc.width, 32, 'the phone mark width');
    near(phone.phoneName.size, 15, 'the phone wordmark size');
    near(phone.disc.x, 20, 'the phone key disc left');
    near(phone.disc.y, 104, 'the phone key disc top');
    near(phone.title.y, 168, 'the phone card title top');
    near(phone.sub.y, 212, 'the phone card sub top');
    near(phone.fields.y, 284, 'the phone field top');
    near(phone.input.y, 310, 'the phone input top');
    near(phone.input.height, 48, 'the phone input height');
    paints(phone.input.background, '#F7F8F9', 'the phone input fill');
    near(phone.placeholder.size, 15, 'the phone placeholder size');
    near(phone.button.y, 376, 'the phone send button top');
    near(phone.button.height, 48, 'the phone send button height');
    near(phone.buttonLabel.size, 15, 'the phone send label size');
    near(phone.back.y, 444, 'the phone back row top');

    // The node's sentences, as the page actually renders them.
    writes(empty.headline.text, 'Your account, everywhere you work.', 'the headline');
    writes(
      empty.body.text,
      'One account for the browser and Windows. Create it once and your chats, tasks and automations are waiting on both.',
      'the body copy',
    );
    writes(empty.features[0].text, 'Ask, Act and Autopilot in one workspace', 'the first feature');
    writes(empty.features[1].text, 'Cloud handoff between devices', 'the second feature');
    writes(empty.features[2].text, 'Provider keys stay in your account', 'the third feature');
    writes(empty.title.text, 'Reset your password', 'the card title');
    writes(
      empty.sub.text,
      "Enter the email on your account and we'll send a link to set a new password.",
      'the card sub',
    );
    writes(empty.placeholder.text, 'you@studio.com', 'the email placeholder');
    writes(empty.buttonLabel.text, 'Send reset link', 'the send label');
    writes(loading.buttonLabel.text, 'Sending...', 'the sending label');
    writes(empty.backLink.text, 'Back to sign in', 'the back link');
    writes(
      error.errorMessage.text,
      'No account matches that email. Check it and try again.',
      'the message row',
    );
    writes(
      sent.sentSub.text,
      'If that address has an account, a reset link is on its way. It expires in 30 minutes.',
      'the sent sub',
    );
    writes(sent.noteText.text, 'Nothing arrived? Check spam, or send another link.', 'the sent note');
    writes(sent.resend.text, 'Send another link', 'the resend label');

    return '1440x900: 640 brand panel, 560x420 card at 760,190, message row 18 tall pushing the button to 306, sent card 340 at 230, blank-email card inert, plus the 390 phone column';
  });

  // The sign-up page is closed on the same sentence as the shell: it matches the node
  // it was drawn from. Node 0:11637 is 1440x900 with the same 640 px brand panel and a
  // 560 px card at (760, 70). Its five frames are that one page in five desktop states
  // plus a 390 wide phone frame, so each frame is opened through ?state= and measured
  // as drawn rather than reading the stylesheet back to itself.
  const SIGNUP_FRAMES = {
    empty: '',
    loading: 'state=loading',
    error: 'state=error',
    disabled: 'state=disabled',
    success: 'state=success',
  };

  const measureSignUp = async (width, height, search = '') => {
    const signUpWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await signUpWindow.loadFile(SIGNUP_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await signUpWindow.webContents.executeJavaScript(`(() => {
      const style = (element) => getComputedStyle(element);
      const measure = (selector) => {
        const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const computed = style(element);
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          radius: parseFloat(computed.borderRadius),
          background: computed.backgroundColor,
          color: computed.color,
          display: computed.display,
          left: computed.left,
          size: parseFloat(computed.fontSize),
          leading: parseFloat(computed.lineHeight),
          weight: computed.fontWeight,
          text: element.textContent.replace(/\\s+/g, ' ').trim(),
        };
      };

      // Frame-scoped selectors are written against the visible panel, so a box of 0
      // never passes for a drawn one: the two panels share the title/sub class names.
      const form = '.signup-panel:not(.signup-panel-done) ';
      const email = document.querySelector('#signup-email');
      const placeholder = getComputedStyle(email, '::placeholder');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        state: document.querySelector('.signup-page').dataset.state,
        brand: measure('.signup-brand'),
        mark: measure('.signup-brand .signup-brand-mark'),
        brandName: measure('.signup-brand .signup-brand-name'),
        headline: measure('.signup-brand-headline'),
        body: measure('.signup-brand-body'),
        features: Array.from(document.querySelectorAll('.signup-features li')).map(measure),
        featureIcons: Array.from(document.querySelectorAll('.signup-features li svg')).map(measure),
        card: measure('.signup-card'),
        title: measure(form + '.signup-title'),
        sub: measure(form + '.signup-sub'),
        nameField: measure('.signup-field-name'),
        nameInput: measure('.signup-field-name .signup-input'),
        emailField: measure('.signup-field-email'),
        emailLabel: measure('.signup-field-email .signup-label'),
        emailInput: measure('.signup-field-email .signup-input'),
        emailError: measure('.signup-field-email .signup-error'),
        emailErrorIcon: measure('.signup-field-email .signup-error svg'),
        emailErrorMessage: measure('.signup-field-email .signup-error .signup-error-message'),
        passwordField: measure('.signup-field-password'),
        passwordInput: measure('.signup-field-password .signup-input'),
        reveal: measure('.signup-reveal'),
        strength: measure('.signup-strength'),
        bars: Array.from(document.querySelectorAll('.signup-strength .signup-bar')).map(measure),
        hint: measure(form + '.signup-strength-hint'),
        submit: measure(form + '.signup-submit'),
        submitIcon: measure(form + '.signup-submit-icon'),
        submitLabel: measure(form + ' [data-signup-submit-label]'),
        terms: measure(form + '.signup-terms'),
        divider: measure(form + '.signup-divider'),
        signinRow: measure(form + '.signup-signin-row'),
        question: measure(form + '.signup-signin-question'),
        signinLink: measure(form + '.signup-signin-link'),
        print: measure('.signup-print'),
        status: measure('.signup-status'),
        statusTime: measure('.signup-status-time'),
        phoneMark: measure('.signup-phone-brand .signup-brand-mark'),
        phoneName: measure('.signup-phone-brand-name'),
        emailPlaceholder: {
          text: email.placeholder,
          size: parseFloat(placeholder.fontSize),
          color: placeholder.color,
        },
        // What each drawn frame already has in its fields, so the check can say the
        // page carries the node's values and not only its boxes.
        values: {
          name: document.querySelector('#signup-name').value,
          email: email.value,
          password: document.querySelector('#signup-password').value,
        },
        doneIcon: measure('.signup-done-icon'),
        doneTitle: measure('.signup-panel-done .signup-title'),
        doneSub: measure('.signup-panel-done .signup-sub'),
        track: measure('.signup-progress'),
        fill: measure('.signup-progress-fill'),
        summary: measure('.signup-summary'),
        summaryIcon: measure('.signup-summary svg'),
        summaryText: measure('.signup-summary span'),
        continueButton: measure('.signup-panel-done .signup-submit'),
      };
    })()`);
    signUpWindow.destroy();
    return measured;
  };

  const signUp = {};
  for (const [name, search] of Object.entries(SIGNUP_FRAMES)) {
    signUp[name] = await measureSignUp(1440, 900, search);
  }
  signUp.phone = await measureSignUp(390, 844);

  report.check('the Sign-up page is drawn from node 0:11637', () => {
    const near = (value, expected, label, slack = 0.6) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the page draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, hex, label) => {
      if (value !== rgb(hex)) throw new Error(`${label} is ${value}, the node paints ${rgb(hex)}`);
    };

    const { empty, loading, error, disabled, success, phone } = signUp;

    // The page is the node's 1440 x 900 canvas, and ?state= opens the frame asked for.
    for (const name of Object.keys(SIGNUP_FRAMES)) {
      near(signUp[name].viewport.width, 1440, `the ${name} frame width`, 0);
      near(signUp[name].viewport.height, 900, `the ${name} frame height`, 0);
      writes(signUp[name].state, name, `the ${name} frame state`);
    }

    // The node fills three of its frames and draws the out-of-reach one with an
    // empty email box; the page carries the same values in the same boxes.
    writes(loading.values.password, 'correct-horse-9', 'the submitting frame password');
    writes(loading.values.email, 'ana@studio.com', 'the submitting frame email');
    writes(error.values.password, 'zuri2026', 'the rejected frame password');
    writes(error.values.email, 'ana@studio.com', 'the rejected frame email');
    writes(disabled.values.password, 'zuri', 'the out-of-reach frame password');
    writes(disabled.values.email, '', 'the out-of-reach frame email');

    // The brand column: 640 wide, a 32 px mark at 48, the wordmark beside it, and the
    // headline, supporting line and three feature rows on the node's own Y positions.
    near(empty.brand.width, 640, 'the brand column width');
    near(empty.brand.height, 900, 'the brand column height');
    paints(empty.brand.background, '#101214', 'the brand column fill');
    near(empty.mark.x, 48, 'the mark left');
    near(empty.mark.y, 48, 'the mark top');
    near(empty.mark.width, 32, 'the mark width');
    near(empty.mark.radius, 8, 'the mark radius');
    paints(empty.mark.background, '#2F6BFF', 'the mark fill');
    near(empty.brandName.x, 92, 'the wordmark left');
    near(empty.brandName.y, 54, 'the wordmark top');
    near(empty.brandName.size, 15, 'the wordmark size');
    near(empty.headline.x, 48, 'the headline left');
    near(empty.headline.y, 300, 'the headline top');
    near(empty.headline.width, 480, 'the headline width');
    near(empty.headline.size, 28, 'the headline size');
    near(empty.headline.leading, 36, 'the headline line height');
    paints(empty.headline.color, '#EDEFF2', 'the headline');
    near(empty.body.x, 48, 'the supporting line left');
    near(empty.body.y, 392, 'the supporting line top');
    near(empty.body.width, 460, 'the supporting line width');
    paints(empty.body.color, '#ADB4BB', 'the supporting line');
    [488, 528, 568].forEach((top, index) => {
      near(empty.features[index].y, top, `feature ${index + 1} top`);
      near(empty.features[index].height, 32, `feature ${index + 1} height`);
      near(empty.featureIcons[index].width, 16, `feature ${index + 1} glyph size`);
      paints(empty.featureIcons[index].color, '#5B8CFF', `feature ${index + 1} glyph`);
    });

    // The card: 560 x 760 at (760, 70), 12 across the corners, its title 40 in.
    near(empty.card.x, 760, 'the card left');
    near(empty.card.y, 70, 'the card top');
    near(empty.card.width, 560, 'the card width');
    near(empty.card.height, 760, 'the card height');
    near(empty.card.radius, 12, 'the card radius');
    paints(empty.card.background, '#FFFFFF', 'the card fill');
    near(empty.title.x, 800, 'the card title left');
    near(empty.title.y, 110, 'the card title top');
    near(empty.title.size, 28, 'the card title size');
    near(empty.title.leading, 36, 'the card title line height');
    paints(empty.title.color, '#1F2328', 'the card title');
    near(empty.sub.y, 154, 'the subtitle top');
    paints(empty.sub.color, '#6B7280', 'the subtitle');

    // Three fields of 70 on a 96 px pitch, each a 44 px box 26 below its label.
    [[empty.nameField, 210, 'the name field'], [empty.emailField, 306, 'the email field'], [empty.passwordField, 402, 'the password field']].forEach(([field, top, label]) => {
      near(field.y, top, `${label} top`);
      near(field.height, 70, `${label} height`);
      near(field.width, 480, `${label} width`);
    });
    near(empty.nameInput.y, 236, 'the name box top');
    near(empty.nameInput.height, 44, 'the name box height');
    near(empty.emailLabel.size, 13, 'the field label size');
    near(empty.emailLabel.leading, 18, 'the field label line height');
    paints(empty.emailLabel.color, '#1F2328', 'the field label');
    near(empty.emailInput.radius, 8, 'the field radius');
    paints(empty.emailInput.background, '#FFFFFF', 'the resting field fill');
    paints(empty.emailInput.color, '#1F2328', 'the field text');
    near(empty.reveal.x, 1244, 'the eye glyph left');
    near(empty.reveal.y, 442, 'the eye glyph top');
    writes(empty.emailPlaceholder.text, 'you@studio.com', 'the email placeholder');
    if (empty.emailPlaceholder.color !== 'rgb(142, 145, 150)') {
      throw new Error(`the placeholder is ${empty.emailPlaceholder.color}, the node paints rgb(142, 145, 150)`);
    }

    // The strength row: three 150 x 4 bars 2 px down, and its line 12 px down.
    near(empty.strength.y, 474, 'the strength row top');
    near(empty.strength.height, 28, 'the strength row height');
    [0, 158, 316].forEach((left, index) => {
      near(empty.bars[index].x, 800 + left, `strength bar ${index + 1} left`);
      near(empty.bars[index].y, 476, `strength bar ${index + 1} top`);
      near(empty.bars[index].width, 150, `strength bar ${index + 1} width`);
      near(empty.bars[index].height, 4, `strength bar ${index + 1} height`);
      near(empty.bars[index].radius, 2, `strength bar ${index + 1} radius`);
      paints(empty.bars[index].background, '#E8EAED', `strength bar ${index + 1}`);
    });
    near(empty.hint.y, 486, 'the strength line top');
    near(empty.hint.width, 480, 'the strength line width');
    near(empty.hint.size, 11, 'the strength line size');
    paints(empty.hint.color, '#8E9196', 'the strength line');
    writes(empty.hint.text, 'Use 10+ characters with a number or symbol', 'the strength line');

    // The submit, the terms line, the rule, the sign-in row and the desktop note.
    near(empty.submit.y, 522, 'the submit top');
    near(empty.submit.width, 480, 'the submit width');
    near(empty.submit.height, 44, 'the submit height');
    near(empty.submit.radius, 8, 'the submit radius');
    paints(empty.submit.background, '#2F6BFF', 'the resting submit fill');
    paints(empty.submit.color, '#FFFFFF', 'the resting submit label');
    near(empty.submit.size, 14, 'the submit label size');
    writes(empty.submitIcon.display, 'none', 'the resting spinner');
    near(empty.terms.y, 586, 'the terms line top');
    near(empty.terms.width, 480, 'the terms line width');
    near(empty.terms.size, 11, 'the terms line size');
    paints(empty.terms.color, '#8E9196', 'the terms line');
    near(empty.divider.y, 626, 'the rule top');
    near(empty.divider.height, 1, 'the rule height');
    paints(empty.divider.background, '#E8EAED', 'the rule');
    near(empty.signinRow.y, 650, 'the sign-in row top');
    near(empty.signinRow.height, 20, 'the sign-in row height');
    near(empty.question.size, 13, 'the sign-in question size');
    paints(empty.question.color, '#6B7280', 'the sign-in question');
    near(empty.signinLink.y, 651, 'the sign-in link top');
    paints(empty.signinLink.color, '#2F6BFF', 'the sign-in link');
    near(empty.print.y, 698, 'the desktop note top');
    near(empty.print.size, 11, 'the desktop note size');
    paints(empty.print.color, '#8E9196', 'the desktop note');

    // The submitting frame: sunken fields, a filled strength row and a busy button.
    paints(loading.emailInput.background, '#F0F1F3', 'the submitting field fill');
    loading.bars.forEach((bar, index) => paints(bar.background, '#1F9D6B', `submitting strength bar ${index + 1}`));
    writes(loading.hint.text, 'Strong password', 'the submitting strength line');
    paints(loading.submit.background, '#EAF0FF', 'the submitting submit fill');
    paints(loading.submit.color, '#2F6BFF', 'the submitting submit label');
    writes(loading.submitLabel.text, 'Creating account\u2026', 'the submitting submit label');
    writes(loading.submitIcon.display, 'block', 'the submitting spinner');
    // The spinner turns, so its bounding box moves with the phase of the animation.
    // The inset it is drawn at is the stable number the node gives.
    near(parseFloat(loading.submitIcon.left), 148, 'the submitting spinner inset');

    // The rejected frame: one message 4 px under its field, the fields below it pushed
    // down 18, the first bar amber and the line in the danger tone.
    near(error.card.height, 778, 'the rejected card height');
    near(error.emailError.y, 380, 'the field message top');
    near(error.emailError.height, 18, 'the field message height');
    near(error.emailErrorIcon.width, 14, 'the field message glyph');
    paints(error.emailErrorIcon.color, '#D14343', 'the field message glyph');
    near(error.emailErrorMessage.x, 818, 'the field message text left');
    near(error.emailErrorMessage.size, 12, 'the field message size');
    near(error.emailErrorMessage.leading, 16, 'the field message line height');
    paints(error.emailErrorMessage.color, '#D14343', 'the field message');
    writes(
      error.emailErrorMessage.text,
      'That email already has an account \u2014 sign in instead.',
      'the field message',
    );
    near(error.passwordField.y, 420, 'the rejected password field top');
    near(error.strength.y, 492, 'the rejected strength row top');
    near(error.submit.y, 540, 'the rejected submit top');
    paints(error.bars[0].background, '#C7861F', 'the rejected first strength bar');
    paints(error.bars[1].background, '#E8EAED', 'the rejected second strength bar');
    paints(error.hint.color, '#D14343', 'the rejected strength line');
    writes(error.hint.text, 'Weak \u2014 add a number or symbol', 'the rejected strength line');

    // The out-of-reach frame: the button goes grey, its label with it, and the row
    // prints the instruction that gets the form back.
    paints(disabled.submit.background, '#F0F1F3', 'the out-of-reach submit fill');
    paints(disabled.submit.color, '#8E9196', 'the out-of-reach submit label');
    paints(disabled.bars[0].background, '#E8EAED', 'the out-of-reach first strength bar');
    paints(disabled.hint.color, '#8E9196', 'the out-of-reach strength line');
    writes(
      disabled.hint.text,
      'Enter an email and a password of 10+ characters',
      'the out-of-reach strength line',
    );
    near(disabled.submit.y, 522, 'the out-of-reach submit top');

    // The created card: 560 x 400 at (760, 150), its disc 40 in, its button at the foot.
    near(success.card.y, 150, 'the created card top');
    near(success.card.height, 400, 'the created card height');
    near(success.doneIcon.x, 800, 'the created disc left');
    near(success.doneIcon.y, 190, 'the created disc top');
    near(success.doneIcon.width, 44, 'the created disc size');
    near(success.doneIcon.radius, 10, 'the created disc radius');
    paints(success.doneIcon.background, '#E9F6F0', 'the created disc fill');
    paints(success.doneIcon.color, '#1F9D6B', 'the created disc glyph');
    near(success.doneTitle.y, 254, 'the created title top');
    near(success.doneSub.y, 298, 'the created subtitle top');
    near(success.track.y, 366, 'the progress track top');
    near(success.track.height, 6, 'the progress track height');
    paints(success.track.background, '#F0F1F3', 'the progress track');
    near(success.fill.width, 384, 'the progress fill width');
    paints(success.fill.background, '#1F9D6B', 'the progress fill');
    near(success.summary.y, 402, 'the summary row top');
    near(success.summary.height, 40, 'the summary row height');
    near(success.summary.radius, 8, 'the summary row radius');
    paints(success.summary.background, '#F7F8F9', 'the summary row fill');
    near(success.summaryIcon.x, 812, 'the summary glyph left');
    near(success.summaryText.x, 836, 'the summary text left');
    near(success.summaryText.size, 12, 'the summary text size');
    paints(success.summaryText.color, '#6B7280', 'the summary text');
    near(success.continueButton.y, 466, 'the continue button top');
    near(success.continueButton.height, 44, 'the continue button height');
    paints(success.continueButton.background, '#2F6BFF', 'the continue button fill');
    writes(success.continueButton.text, 'Continue to setup', 'the continue button');

    // The phone frame: one 390 wide column, its own status bar and wordmark row,
    // 48 px controls and the sign-in row at the foot.
    near(phone.viewport.width, 390, 'the phone frame width', 0);
    near(phone.viewport.height, 844, 'the phone frame height', 0);
    near(phone.status.height, 28, 'the phone status bar height');
    near(phone.statusTime.x, 16, 'the phone clock left');
    near(phone.statusTime.y, 7, 'the phone clock top');
    near(phone.statusTime.size, 11, 'the phone clock size');
    near(phone.phoneMark.x, 20, 'the phone mark left');
    near(phone.phoneMark.y, 44, 'the phone mark top');
    near(phone.phoneMark.width, 32, 'the phone mark size');
    near(phone.phoneName.x, 64, 'the phone wordmark left');
    near(phone.phoneName.y, 51, 'the phone wordmark top');
    near(phone.phoneName.size, 15, 'the phone wordmark size');
    near(phone.title.x, 20, 'the phone title left');
    near(phone.title.y, 100, 'the phone title top');
    near(phone.sub.y, 140, 'the phone subtitle top');
    near(phone.nameField.y, 192, 'the phone name field top');
    near(phone.nameField.width, 350, 'the phone name field width');
    near(phone.nameField.height, 74, 'the phone name field height');
    near(phone.emailField.y, 280, 'the phone email field top');
    near(phone.passwordField.y, 368, 'the phone password field top');
    paints(phone.emailInput.background, '#F7F8F9', 'the phone field fill');
    near(phone.emailInput.y, 306, 'the phone email box top');
    near(phone.emailInput.height, 48, 'the phone email box height');
    near(phone.emailPlaceholder.size, 15, 'the phone field size');
    near(phone.strength.y, 436, 'the phone strength row top');
    [0, 119, 238].forEach((left, index) => {
      near(phone.bars[index].x, 20 + left, `phone strength bar ${index + 1} left`);
      near(phone.bars[index].width, 112, `phone strength bar ${index + 1} width`);
    });
    near(phone.submit.y, 484, 'the phone submit top');
    near(phone.submit.width, 350, 'the phone submit width');
    near(phone.submit.height, 48, 'the phone submit height');
    near(phone.submit.size, 15, 'the phone submit label size');
    near(phone.terms.y, 548, 'the phone terms line top');
    near(phone.signinRow.y, 596, 'the phone sign-in row top');
    writes(phone.divider.display, 'none', 'the phone rule');
    writes(phone.print.display, 'none', 'the phone desktop note');

    // The node's sentences, as the page actually renders them.
    writes(empty.brandName.text, 'Zuri Desk', 'the wordmark');
    writes(empty.headline.text, 'Your account, everywhere you work.', 'the headline');
    writes(
      empty.body.text,
      'One account for the browser and Windows. Create it once and your chats, tasks and automations are waiting on both.',
      'the supporting line',
    );
    writes(empty.features[0].text, 'Ask, Act and Autopilot in one workspace', 'the first feature');
    writes(empty.features[1].text, 'Cloud handoff between devices', 'the second feature');
    writes(empty.features[2].text, 'Provider keys stay in your account', 'the third feature');
    writes(empty.title.text, 'Create your account', 'the card title');
    writes(empty.sub.text, 'One account for the web app and the desktop app.', 'the subtitle');
    writes(empty.submitLabel.text, 'Create account', 'the submit label');
    writes(
      empty.terms.text,
      'By creating an account you agree to the Terms and the Privacy Policy.',
      'the terms line',
    );
    writes(empty.signinRow.text, 'Already have an account? Sign in', 'the sign-in row');
    writes(
      empty.print.text,
      'In the desktop app you continue straight to first-run setup.',
      'the desktop note',
    );
    writes(success.doneTitle.text, 'Account created', 'the created title');
    writes(
      success.doneSub.text,
      'Welcome, Ana. This account now works in the browser and on Windows \u2014 continuing to first-run setup\u2026',
      'the created subtitle',
    );
    writes(
      success.summaryText.text,
      'A verification email is on its way to ana@studio.com',
      'the summary line',
    );

    return '1440x900: 640 brand panel, 560x760 card at 760,70, three 70 px fields on a 96 px pitch, empty, submitting, rejected (778 tall), out-of-reach and created (400 tall) frames as drawn, plus the 390 phone column';
  });


  // The reset-password page closes on the same sentence as the shell: it matches
  // node 0:12246. The node is 1440x900 with the same 640 px brand panel and a
  // 560 px card at (760, 170). Its five desktop frames plus the 390 wide phone
  // frame are opened through ?state= and measured as drawn. The node's expired
  // link is the page's error frame, so that frame opens as ?state=error.
  const RESET_FRAMES = {
    empty: '',
    loading: 'state=loading',
    expired: 'state=error',
    mismatch: 'state=mismatch',
    success: 'state=success',
  };

  const measureReset = async (width, height, search = '') => {
    const resetWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await resetWindow.loadFile(RESET_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await resetWindow.webContents.executeJavaScript(`(() => {
      const style = (element) => getComputedStyle(element);
      const measure = (selector) => {
        const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const computed = style(element);
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          radius: parseFloat(computed.borderRadius),
          background: computed.backgroundColor,
          color: computed.color,
          display: computed.display,
          shadow: computed.boxShadow,
          size: parseFloat(computed.fontSize),
          leading: parseFloat(computed.lineHeight),
          weight: computed.fontWeight,
          text: element.textContent.replace(/\\s+/g, ' ').trim(),
        };
      };

      // The three panels share the title, sub and button class names, so each
      // frame's selectors are scoped to the panel that frame shows.
      const form = '.reset-panel-form ';
      const expired = '.reset-panel-error ';
      const success = '.reset-panel-success ';
      const newInput = document.querySelector('#reset-new');
      const confirmInput = document.querySelector('#reset-confirm');
      const placeholder = getComputedStyle(newInput, '::placeholder');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        state: document.querySelector('.reset-page').dataset.state,
        brand: measure('.reset-brand'),
        mark: measure('.reset-brand .reset-brand-mark'),
        brandName: measure('.reset-brand .reset-brand-name'),
        headline: measure('.reset-brand-headline'),
        body: measure('.reset-brand-body'),
        features: Array.from(document.querySelectorAll('.reset-features li')).map(measure),
        featureIcons: Array.from(document.querySelectorAll('.reset-features li svg')).map(measure),
        card: measure('.reset-card'),
        formDisc: measure(form + '.reset-disc'),
        expiredDisc: measure(expired + '.reset-disc'),
        successDisc: measure(success + '.reset-disc'),
        title: measure(form + '.reset-title'),
        sub: measure(form + '.reset-sub'),
        newField: measure('.reset-field-new'),
        newInput: measure('.reset-field-new .reset-input'),
        confirmField: measure('.reset-field-confirm'),
        confirmInput: measure('.reset-field-confirm .reset-input'),
        label: measure('.reset-field-new .reset-label'),
        reveal: measure('.reset-field-new .reset-reveal'),
        error: measure(form + '.reset-error'),
        errorMessage: measure(form + '.reset-error .reset-error-message'),
        submit: measure(form + '.reset-submit'),
        submitLabel: measure(form + ' [data-reset-submit-label]'),
        submitDisabled: document.querySelector(form + '.reset-submit').disabled,
        newDisabled: newInput.disabled,
        values: { newPassword: newInput.value, confirmPassword: confirmInput.value },
        expiredTitle: measure(expired + '.reset-title'),
        expiredSub: measure(expired + '.reset-sub'),
        expiredSubmit: measure(expired + '.reset-submit'),
        back: measure(expired + '.reset-back'),
        backLabel: measure(expired + '.reset-back-label'),
        successTitle: measure(success + '.reset-title'),
        successSub: measure(success + '.reset-sub'),
        track: measure(success + '.reset-progress'),
        fill: measure(success + '.reset-progress-fill'),
        successSubmit: measure(success + '.reset-submit'),
        status: measure('.reset-status'),
        statusTime: measure('.reset-status-time'),
        phoneMark: measure('.reset-phone-brand .reset-brand-mark'),
        phoneName: measure('.reset-phone-brand-name'),
        placeholder: {
          text: newInput.placeholder,
          size: parseFloat(placeholder.fontSize),
          color: placeholder.color,
        },
      };
    })()`);
    resetWindow.destroy();
    return measured;
  };

  const reset = {};
  for (const [name, search] of Object.entries(RESET_FRAMES)) {
    reset[name] = await measureReset(1440, 900, search);
  }
  reset.phone = await measureReset(390, 844);

  report.check('the Reset-password page is drawn from node 0:12246', () => {
    const near = (value, expected, label, slack = 0.6) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the page draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, hex, label) => {
      if (value !== rgb(hex)) throw new Error(`${label} is ${value}, the node paints ${hex}`);
    };

    const empty = reset.empty;
    const loading = reset.loading;
    const expired = reset.expired;
    const mismatch = reset.mismatch;
    const success = reset.success;
    const phone = reset.phone;

    near(empty.viewport.width, 1440, 'the measured viewport width');
    near(empty.viewport.height, 900, 'the measured viewport height');
    writes(empty.state, 'empty', 'the opening state');

    // The brand column is the auth pages': 640 x 900 of the dark surface, a
    // 32 px mark at (48, 48), the 15/20 wordmark 92 in, the 28/36 headline at
    // 300, the 460 px body at 392 and three 32 px feature rows from 488.
    for (const [name, frame] of [['empty', empty], ['loading', loading], ['expired', expired], ['mismatch', mismatch], ['success', success]]) {
      near(frame.brand.width, 640, `the ${name} brand panel width`);
      near(frame.brand.height, 900, `the ${name} brand panel height`);
      paints(frame.brand.background, '#101214', `the ${name} brand panel`);
      near(frame.mark.x, 48, `the ${name} mark left`);
      near(frame.mark.y, 48, `the ${name} mark top`);
      near(frame.mark.width, 32, `the ${name} mark width`);
      near(frame.mark.radius, 8, `the ${name} mark radius`);
      paints(frame.mark.background, '#2F6BFF', `the ${name} mark`);
      near(frame.brandName.x, 92, `the ${name} wordmark left`);
      near(frame.brandName.size, 15, `the ${name} wordmark size`);
      near(frame.brandName.leading, 20, `the ${name} wordmark line`);
      paints(frame.brandName.color, '#EDEFF2', `the ${name} wordmark`);
    }

    near(empty.headline.x, 48, 'the headline left');
    near(empty.headline.y, 300, 'the headline top');
    near(empty.headline.width, 480, 'the headline width');
    near(empty.headline.size, 28, 'the headline size');
    near(empty.headline.leading, 36, 'the headline line');
    paints(empty.headline.color, '#EDEFF2', 'the headline');
    near(empty.body.y, 392, 'the body copy top');
    near(empty.body.width, 460, 'the body copy width');
    near(empty.body.leading, 22, 'the body copy leading');
    paints(empty.body.color, '#ADB4BB', 'the body copy');

    if (empty.features.length !== 3) throw new Error(`the page draws ${empty.features.length} feature rows, the node has 3`);
    const featureTops = [488, 528, 568];
    for (const [index, row] of empty.features.entries()) {
      near(row.x, 48, `feature row ${index + 1} left`);
      near(row.y, featureTops[index], `feature row ${index + 1} top`);
      near(row.height, 32, `feature row ${index + 1} height`);
      near(empty.featureIcons[index].y, featureTops[index] + 8, `feature glyph ${index + 1} top`);
      near(empty.featureIcons[index].width, 16, `feature glyph ${index + 1} width`);
    }

    // The card: 560 wide at 760, on radius 12, white, with the hairline drawn
    // as an inset ring and the node's 0 4 16 shadow under it. The form frames
    // are 470 tall at 170; the mismatched one is 484; both results are 320 at
    // 270.
    const cards = [
      ['empty', empty, 170, 470],
      ['loading', loading, 170, 470],
      ['mismatch', mismatch, 170, 484],
      ['expired', expired, 270, 320],
      ['success', success, 270, 320],
    ];
    for (const [name, frame, top, height] of cards) {
      near(frame.card.x, 760, `the ${name} card left edge`);
      near(frame.card.y, top, `the ${name} card top`);
      near(frame.card.width, 560, `the ${name} card width`);
      near(frame.card.height, height, `the ${name} card height`);
      near(frame.card.radius, 12, `the ${name} card radius`);
      paints(frame.card.background, '#FFFFFF', `the ${name} card fill`);
      if (!frame.card.shadow.includes(rgb('#E8EAED'))) throw new Error(`the ${name} card draws no hairline ring`);
      if (!frame.card.shadow.includes('0px 4px 16px')) throw new Error(`the ${name} card draws no 0 4 16 shadow`);
    }

    // The 44 px icon disc at the card's 40 px inset: the lock on the accent
    // tint, the red link-off on the sunken surface, the green check on success.
    near(empty.formDisc.x, 800, 'the lock disc left');
    near(empty.formDisc.y, 210, 'the lock disc top');
    near(empty.formDisc.width, 44, 'the lock disc width');
    near(empty.formDisc.radius, 10, 'the lock disc radius');
    paints(empty.formDisc.background, '#EAF0FF', 'the lock disc');
    near(expired.expiredDisc.y, 310, 'the expired disc top');
    paints(expired.expiredDisc.background, '#F0F1F3', 'the expired disc');
    paints(expired.expiredDisc.color, '#D14343', 'the expired disc glyph');
    near(success.successDisc.y, 310, 'the success disc top');
    paints(success.successDisc.background, '#E9F6F0', 'the success disc');
    paints(success.successDisc.color, '#1F9D6B', 'the success disc glyph');

    // The card's own rhythm: disc to 84, title at 104, sub at 148, first field
    // at 204, second at 300, button at 396.
    near(empty.title.x, 800, 'the card title left');
    near(empty.title.y, 274, 'the card title top');
    near(empty.title.size, 28, 'the card title size');
    near(empty.title.leading, 36, 'the card title line');
    paints(empty.title.color, '#1F2328', 'the card title');
    near(empty.sub.y, 318, 'the card sub top');
    near(empty.sub.width, 480, 'the card sub width');
    near(empty.sub.size, 14, 'the card sub size');
    near(empty.sub.leading, 22, 'the card sub leading');
    paints(empty.sub.color, '#6B7280', 'the card sub');
    near(empty.newField.y, 374, 'the new password field top');
    near(empty.newField.width, 480, 'the new password field width');
    near(empty.label.size, 13, 'the field label size');
    near(empty.label.leading, 18, 'the field label line');
    writes(empty.label.weight, '500', 'the field label weight');
    near(empty.newInput.y, 400, 'the new password input top');
    near(empty.newInput.width, 480, 'the new password input width');
    near(empty.newInput.height, 44, 'the new password input height');
    near(empty.newInput.radius, 8, 'the new password input radius');
    paints(empty.newInput.background, '#FFFFFF', 'the resting input fill');
    if (!empty.newInput.shadow.includes(rgb('#E8EAED'))) throw new Error('the resting input draws no hairline outline');
    near(empty.placeholder.size, 14, 'the placeholder size');
    paints(empty.placeholder.color, '#8E9196', 'the placeholder');
    near(empty.confirmField.y, 470, 'the confirm field top');
    near(empty.confirmInput.y, 496, 'the confirm input top');
    near(empty.submit.y, 566, 'the submit top');
    near(empty.submit.height, 44, 'the submit height');
    near(empty.submit.radius, 8, 'the submit radius');
    paints(empty.submit.background, '#2F6BFF', 'the submit fill');
    paints(empty.submit.color, '#FFFFFF', 'the submit label');
    near(empty.submitLabel.size, 14, 'the submit label size');
    near(empty.submitLabel.leading, 20, 'the submit label line');
    writes(empty.submitLabel.weight, '500', 'the submit label weight');

    // The saving frame: filled fields the user cannot change, a soft button and
    // the label the node draws; it draws no spinner.
    paints(loading.newInput.background, '#F0F1F3', 'the saving field fill');
    paints(loading.submit.background, '#EAF0FF', 'the saving button fill');
    paints(loading.submit.color, '#2F6BFF', 'the saving label');
    if (loading.submitDisabled !== true) throw new Error('the saving frame leaves the button live');
    if (loading.newDisabled !== true) throw new Error('the saving frame leaves the password fields live');

    // The mismatched frame: an 18 px message under the confirm field and the
    // button pushed down by exactly that row.
    paints(mismatch.error.color, '#D14343', 'the message row');
    near(mismatch.error.y, 544, 'the message row top');
    near(mismatch.error.height, 18, 'the message row height');
    near(mismatch.submit.y, 580, 'the rejected submit top');

    // The expired frame: title 374, two-line sub 418, button 482, back row 542.
    near(expired.expiredTitle.y, 374, 'the expired title top');
    near(expired.expiredSub.y, 418, 'the expired sub top');
    near(expired.expiredSub.height, 44, 'the expired sub height');
    near(expired.expiredSubmit.y, 482, 'the expired button top');
    near(expired.back.y, 542, 'the back row top');
    near(expired.back.height, 20, 'the back row height');
    near(expired.backLabel.size, 13, 'the back link size');
    paints(expired.backLabel.color, '#2F6BFF', 'the back link');

    // The saved frame: title 374, sub 418, a 6 px 85% track at 474, button 510.
    near(success.successTitle.y, 374, 'the saved title top');
    near(success.successSub.y, 418, 'the saved sub top');
    near(success.track.y, 474, 'the saved track top');
    near(success.track.height, 6, 'the saved track height');
    near(success.fill.width, 408, 'the saved track fill width');
    paints(success.fill.background, '#1F9D6B', 'the saved track fill');
    near(success.successSubmit.y, 510, 'the saved button top');

    // The phone frame: a 28 px status bar, the 44 px wordmark row, the lock disc
    // at 104, title 168, sub 212, fields 276 and 368, button 460.
    near(phone.viewport.width, 390, 'the phone viewport width');
    near(phone.status.height, 28, 'the phone status bar height');
    near(phone.statusTime.size, 11, 'the phone clock size');
    near(phone.phoneMark.y, 44, 'the phone wordmark row top');
    near(phone.phoneMark.width, 32, 'the phone mark width');
    near(phone.phoneName.size, 15, 'the phone wordmark size');
    near(phone.formDisc.x, 20, 'the phone lock disc left');
    near(phone.formDisc.y, 104, 'the phone lock disc top');
    near(phone.title.y, 168, 'the phone card title top');
    near(phone.sub.y, 212, 'the phone card sub top');
    near(phone.sub.height, 22, 'the phone card sub height');
    near(phone.newField.y, 276, 'the phone first field top');
    near(phone.newInput.y, 302, 'the phone first input top');
    near(phone.newInput.height, 48, 'the phone input height');
    paints(phone.newInput.background, '#F7F8F9', 'the phone input fill');
    near(phone.placeholder.size, 15, 'the phone placeholder size');
    near(phone.confirmField.y, 368, 'the phone second field top');
    near(phone.submit.y, 460, 'the phone submit top');
    near(phone.submit.height, 48, 'the phone submit height');
    near(phone.submitLabel.size, 15, 'the phone submit label size');

    // The node's sentences, as the page actually renders them.
    writes(empty.brandName.text, 'Zuri Desk', 'the wordmark');
    writes(empty.headline.text, 'Choose a new password.', 'the headline');
    writes(
      empty.body.text,
      "Your reset link is single use and expires after 30 minutes. Pick something long that you don't use anywhere else.",
      'the supporting line',
    );
    writes(empty.features[0].text, 'Ask, Act and Autopilot in one workspace', 'the first feature');
    writes(empty.features[1].text, 'Cloud handoff between devices', 'the second feature');
    writes(empty.features[2].text, 'Provider keys stay in your account', 'the third feature');
    writes(empty.title.text, 'Set a new password', 'the card title');
    writes(empty.sub.text, "You're resetting the password for ana@studio.com.", 'the card sub');
    writes(empty.placeholder.text, 'At least 10 characters', 'the placeholder');
    writes(empty.submitLabel.text, 'Set password', 'the submit label');
    writes(loading.submitLabel.text, 'Saving\u2026', 'the saving label');
    writes(mismatch.errorMessage.text, "The two passwords don't match.", 'the message row');
    writes(expired.expiredTitle.text, 'This link has expired', 'the expired title');
    writes(
      expired.expiredSub.text,
      "Reset links are single use and last 30 minutes. Request a fresh one and it'll work.",
      'the expired sub',
    );
    writes(success.successTitle.text, 'Password updated', 'the saved title');
    writes(
      success.successSub.text,
      'Your new password is saved. Taking you to sign in \u2014 use the new one on every device.',
      'the saved sub',
    );

    // The frames carry the node's values, not just its boxes.
    writes(loading.values.newPassword, 'correct-horse-9', 'the saving new password');
    writes(loading.values.confirmPassword, 'correct-horse-9', 'the saving confirmation');
    writes(mismatch.values.newPassword, 'correct-horse-9', 'the mismatched new password');
    writes(mismatch.values.confirmPassword, 'correct-horse-8', 'the mismatched confirmation');

    return '1440x900: 640 brand panel, 560x470 card at 760,170, two 70 px fields on a 96 px pitch, empty, saving, expired (320 at 270), mismatched (484), saved (320 at 270), plus the 390 phone column';
  });

  // The Reminder create / edit dialog (open-pencil node 0:10485). Frame 01 draws it at
  // 480 x 592 over the reminders page and frames 02 to 06 redraw the same card in its five
  // states, so each state is opened through ?state= and measured against the numbers the
  // node carries. A change to any of those numbers in open-pencil shows up here as a
  // failing measurement instead of silent drift.
  const measureReminderDialog = async (width, height, search) => {
    const reminderWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await reminderWindow.loadFile(REMINDER_DIALOG_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await reminderWindow.webContents.executeJavaScript(`(() => {
      const style = (element) => getComputedStyle(element);
      const round = (value) => Math.round(value);

      // Positions are read from each card's own top-left corner, which is how the node
      // writes them, so the page offset never leaks into a measurement.
      const readCard = (card) => {
        if (!card) return null;
        const origin = card.getBoundingClientRect();
        const cardStyle = style(card);
        const box = (selector) => {
          const element = typeof selector === 'string' ? card.querySelector(selector) : selector;
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const computed = style(element);
          if (rect.width === 0 && rect.height === 0) {
            return { hidden: true, text: element.textContent.replace(/\\s+/g, ' ').trim() };
          }
          return {
            x: round(rect.x - origin.x),
            y: round(rect.y - origin.y),
            width: round(rect.width),
            height: round(rect.height),
            radius: parseFloat(computed.borderRadius) || 0,
            background: computed.backgroundColor,
            color: computed.color,
            shadow: computed.boxShadow,
            opacity: parseFloat(computed.opacity),
            size: parseFloat(computed.fontSize),
            leading: parseFloat(computed.lineHeight),
            weight: computed.fontWeight,
            tracking: Math.round(parseFloat(computed.letterSpacing) * 100) / 100,
            padding: [computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft].map((value) => round(parseFloat(value))),
            text: element.querySelector('input') ? element.querySelector('input').value : element instanceof HTMLInputElement ? element.value : element.textContent.replace(/\\s+/g, ' ').trim(),
          };
        };
        return {
          state: card.dataset.state,
          card: {
            width: round(origin.width),
            height: round(origin.height),
            radius: parseFloat(cardStyle.borderRadius) || 0,
            background: cardStyle.backgroundColor,
            color: cardStyle.color,
            shadow: cardStyle.boxShadow,
            padding: [cardStyle.paddingTop, cardStyle.paddingRight, cardStyle.paddingBottom, cardStyle.paddingLeft].map((value) => round(parseFloat(value))),
            overflow: card.scrollHeight - card.clientHeight,
          },
          eyebrow: box('.reminder-dialog-eyebrow'),
          title: box('.reminder-dialog-title'),
          subtitle: box('.reminder-dialog-subtitle'),
          close: box('.reminder-dialog-close'),
          headRule: box('.reminder-dialog-rule'),
          labels: Array.from(card.querySelectorAll('.reminder-dialog-label')).map((element) => box(element)),
          required: box('.reminder-dialog-required'),
          textField: box('.reminder-dialog-field'),
          rows: Array.from(card.querySelectorAll('.reminder-dialog-row')).map((row) => ({
            hidden: style(row).display === 'none' || row.getBoundingClientRect().height === 0,
            field: box(row.querySelector('.reminder-dialog-field')),
            unit: box(row.querySelector('.reminder-dialog-unit')),
            next: box(row.querySelector('.reminder-dialog-next')),
          })),
          type: box('.reminder-dialog-type'),
          options: Array.from(card.querySelectorAll('.reminder-dialog-type-option')).map((element) => box(element)),
          helper: box('.reminder-dialog-helper'),
          hint: box('.reminder-dialog-hint'),
          hintLabel: box('.reminder-dialog-hint-label'),
          hintBody: box('.reminder-dialog-hint-body'),
          banner: box('.reminder-dialog-banner'),
          bannerTile: box('.reminder-dialog-banner-tile'),
          bannerTitle: box('.reminder-dialog-banner-title'),
          bannerBody: box('.reminder-dialog-banner-body'),
          footRule: box('.reminder-dialog-rule-foot'),
          footHint: box('.reminder-dialog-foot-hint'),
          secondary: box('.reminder-dialog-secondary'),
          primary: box('.reminder-dialog-primary'),
          spinner: box('.reminder-dialog-spinner'),
        };
      };

      const states = {};
      document.querySelectorAll('.rd-specimen-mount .reminder-dialog').forEach((card) => {
        states[card.dataset.state] = readCard(card);
      });
      const scrim = document.querySelector('.rd-live .rd-scrim');
      const pageBar = document.querySelector('.rd-page-bar');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        theme: document.documentElement.dataset.theme,
        page: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          barWidth: pageBar ? round(pageBar.getBoundingClientRect().width) : 0,
        },
        scrim: scrim ? style(scrim).backgroundColor : null,
        live: readCard(document.querySelector('.rd-live .reminder-dialog')),
        states,
      };
    })()`);
    reminderWindow.destroy();
    return measured;
  };

  const reminder = {
    light: await measureReminderDialog(1440, 1000, 'theme=light'),
    dark: await measureReminderDialog(1440, 1000, 'theme=dark'),
    phone: await measureReminderDialog(390, 844, 'theme=light'),
  };

  report.check('the Reminder create / edit dialog matches node 0:10485', () => {
    const near = (value, expected, label, slack = 1) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the card draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, hex, label) => {
      if (value !== rgb(hex)) throw new Error(`${label} is ${value}, the node paints ${hex}`);
    };

    const light = reminder.light;
    const dark = reminder.dark;
    const phone = reminder.phone;
    writes(light.theme, 'light', 'the light sheet theme');
    writes(dark.theme, 'dark', 'the dark sheet theme');

    const pill = (value, label) => {
      if (!(value >= 999)) throw new Error(`${label} is ${value}, the node draws a full pill`);
    };
    // Frame 01 is the dialog as it opens, so the shared shape is measured there.
    const fresh = light.live;
    if (!fresh) throw new Error('the sheet drew no dialog to measure');
    const edit = light.states.edit;
    const invalid = light.states.invalid;
    const saving = light.states.saving;
    const disabled = light.states.disabled;
    const saved = light.states.saved;
    for (const [name, frame] of Object.entries({ fresh, edit, invalid, saving, disabled, saved })) {
      if (!frame) throw new Error(`the sheet draws no ${name} frame`);
    }

    // Frame 01: the card over the page's scrim.
    const live = light.live;
    near(live.card.width, 480, 'the dialog width (0:10548 is 480)');
    near(live.card.height, 592, 'the dialog height');
    near(live.card.radius, 24, 'the dialog corner radius');
    near(live.card.padding[0], 24, 'the dialog padding');
    paints(live.card.background, '#FFFFFF', 'the dialog fill');
    if (!live.card.shadow.includes('16px') || !live.card.shadow.includes('48px')) {
      throw new Error(`the dialog shadow is ${live.card.shadow}, the node draws 0 16 48`);
    }
    writes(light.scrim, 'rgba(0, 0, 0, 0.4)', 'the scrim over the reminders page');

    // The header: eyebrow, title, subtitle, close button and the rule under them.
    writes(fresh.eyebrow.text, 'AUTOPILOT \u00b7 REMINDERS', 'the eyebrow');
    near(fresh.eyebrow.x, 24, 'the eyebrow left');
    near(fresh.eyebrow.y, 24, 'the eyebrow top');
    near(fresh.eyebrow.size, 11, 'the eyebrow size', 0.1);
    near(fresh.eyebrow.leading, 16, 'the eyebrow leading', 0.1);
    writes(fresh.eyebrow.weight, '600', 'the eyebrow weight');
    near(fresh.eyebrow.tracking, 0.66, 'the eyebrow tracking', 0.01);
    paints(fresh.eyebrow.color, '#6B6B75', 'the eyebrow colour');
    writes(fresh.title.text, 'New reminder', 'the title');
    near(fresh.title.y, 46, 'the title top');
    near(fresh.title.size, 20, 'the title size', 0.1);
    near(fresh.title.leading, 28, 'the title leading', 0.1);
    writes(fresh.title.weight, '600', 'the title weight');
    paints(fresh.title.color, '#11181C', 'the title colour');
    near(fresh.subtitle.y, 78, 'the subtitle top');
    near(fresh.subtitle.size, 13, 'the subtitle size', 0.1);
    near(fresh.subtitle.leading, 22, 'the subtitle leading', 0.1);
    paints(fresh.subtitle.color, '#6B6B75', 'the subtitle colour');
    near(fresh.close.x, 420, 'the close button left');
    near(fresh.close.y, 24, 'the close button top');
    near(fresh.close.width, 36, 'the close button width');
    near(fresh.close.height, 36, 'the close button height');
    near(fresh.close.radius, 12, 'the close button radius');
    paints(fresh.close.background, '#F4F4F5', 'the close button fill');
    near(fresh.headRule.x, 24, 'the header rule left');
    near(fresh.headRule.y, 116, 'the header rule top');
    near(fresh.headRule.width, 432, 'the header rule width', 0);
    near(fresh.headRule.height, 1, 'the header rule height', 0);
    paints(fresh.headRule.background, '#111111', 'the header rule colour');

    // The three fields, the type options and the helper line under the time.
    writes(fresh.labels.length, 3, 'the label count');
    ['Reminder text', 'Type', 'Time'].forEach((text, index) => {
      const label = fresh.labels[index];
      writes(label.text.replace('*', '').trim(), text, `label ${index + 1}`);
      near(label.x, 24, `label ${index + 1} left`);
      near(label.size, 13, `label ${index + 1} size`, 0.1);
      near(label.leading, 20, `label ${index + 1} leading`, 0.1);
      writes(label.weight, '500', `label ${index + 1} weight`);
      paints(label.color, '#11181C', `label ${index + 1} colour`);
    });
    near(fresh.labels[0].y, 140, 'the first label top');
    near(fresh.labels[1].y, 228, 'the type label top');
    near(fresh.labels[2].y, 308, 'the time label top');
    writes(fresh.required.text, '*', 'the required star');
    near(fresh.required.size, 13, 'the required star size', 0.1);
    writes(fresh.required.weight, '600', 'the required star weight');
    paints(fresh.required.color, '#F31260', 'the required star colour');
    const field = fresh.textField;
    near(field.x, 24, 'the text field left');
    near(field.y, 164, 'the text field top');
    near(field.width, 432, 'the text field width', 0);
    near(field.height, 40, 'the text field height', 0);
    near(field.radius, 12, 'the text field radius');
    paints(field.background, '#F4F4F5', 'the text field fill');
    writes(field.text, 'Stand up and stretch', 'the text field value');
    near(field.padding[1], 12, 'the text field inset', 0);
    near(fresh.type.x, 24, 'the type track left');
    near(fresh.type.y, 252, 'the type track top');
    near(fresh.type.width, 332, 'the type track width', 0);
    near(fresh.type.height, 32, 'the type track height', 0);
    near(fresh.type.radius, 12, 'the type track radius');
    paints(fresh.type.background, '#F4F4F5', 'the type track fill');
    writes(fresh.options.length, 3, 'the type option count');
    ['Once', 'Interval', 'Daily'].forEach((text, index) => {
      const option = fresh.options[index];
      writes(option.text, text, `option ${index + 1}`);
      near(option.height, 26, `option ${index + 1} height`, 0);
      near(option.radius, 8, `option ${index + 1} radius`);
      near(option.x, [28, 136, 244][index], `option ${index + 1} left`, 3);
      near(option.size, 12, `option ${index + 1} size`, 0.1);
    });
    paints(fresh.options[2].background, '#FFFFFF', 'the selected option fill');
    writes(fresh.options[0].background, 'rgba(0, 0, 0, 0)', 'an unselected option fill');
    writes(fresh.options[2].weight, '600', 'the selected option weight');
    const timeRow = fresh.rows.find((entry) => !entry.hidden);
    if (!timeRow) throw new Error('the time row is not drawn');
    near(timeRow.field.width, 200, 'the time field width', 0);
    near(timeRow.field.height, 40, 'the time field height', 0);
    near(timeRow.field.radius, 12, 'the time field radius');
    paints(timeRow.field.background, '#F4F4F5', 'the time field fill');
    near(timeRow.field.x, 24, 'the time field left');
    near(timeRow.next.x, 240, 'the next ping line left');
    near(timeRow.next.size, 13, 'the next ping size', 0.1);
    near(timeRow.next.leading, 20, 'the next ping leading', 0.1);
    near(fresh.helper.y, 378, 'the helper top');
    near(fresh.helper.size, 13, 'the helper size', 0.1);
    near(fresh.helper.leading, 20, 'the helper leading', 0.1);
    paints(fresh.helper.color, '#6B6B75', 'the helper colour');

    // The autopilot hint box: 432 x 82, 12 in from the top, 8 under the last line.
    near(fresh.hint.x, 24, 'the hint left');
    near(fresh.hint.y, 410, 'the hint top');
    near(fresh.hint.width, 432, 'the hint width', 0);
    near(fresh.hint.height, 82, 'the hint height', 0);
    near(fresh.hint.radius, 12, 'the hint radius');
    paints(fresh.hint.background, '#F4F4F5', 'the hint fill');
    writes(fresh.hintLabel.text, 'RUNS ON AUTOPILOT', 'the hint caps label');
    near(fresh.hintLabel.x - fresh.hint.x, 12, 'the hint label inset', 0);
    near(fresh.hintLabel.y - fresh.hint.y, 12, 'the hint label top', 0);
    near(fresh.hintLabel.size, 11, 'the hint label size', 0.1);
    near(fresh.hintLabel.leading, 16, 'the hint label leading', 0.1);
    writes(fresh.hintLabel.weight, '600', 'the hint label weight');
    near(fresh.hintLabel.tracking, 0.66, 'the hint label tracking', 0.01);
    near(fresh.hintBody.y - fresh.hint.y, 30, 'the hint body top', 0);
    near(fresh.hintBody.size, 13, 'the hint body size', 0.1);
    near(fresh.hintBody.leading, 22, 'the hint body leading', 0.1);
    paints(fresh.hintBody.color, '#6B6B75', 'the hint body colour');

    // The footer: rule, escape hint and the two pill buttons.
    near(fresh.footRule.y, 516, 'the footer rule top');
    near(fresh.footRule.width, 432, 'the footer rule width', 0);
    paints(fresh.footRule.background, '#111111', 'the footer rule colour');
    near(fresh.footHint.y, 537, 'the footer hint top');
    near(fresh.footHint.size, 13, 'the footer hint size', 0.1);
    near(fresh.footHint.leading, 22, 'the footer hint leading', 0.1);
    near(fresh.secondary.x, 240, 'the secondary button left');
    near(fresh.secondary.width, 96, 'the secondary button width', 1);
    near(fresh.secondary.height, 40, 'the secondary button height', 0);
    pill(fresh.secondary.radius, 'the secondary button pill radius');
    paints(fresh.secondary.background, '#F4F4F5', 'the secondary button fill');
    near(fresh.secondary.size, 13, 'the secondary button size', 0.1);
    writes(fresh.secondary.weight, '600', 'the secondary button weight');
    writes(fresh.secondary.text, 'Cancel', 'the secondary button label');
    near(fresh.primary.x, 348, 'the primary button left');
    near(fresh.primary.width, 108, 'the primary button width', 2);
    near(fresh.primary.height, 40, 'the primary button height', 0);
    pill(fresh.primary.radius, 'the primary button pill radius');
    paints(fresh.primary.background, '#006FEE', 'the primary button fill');
    paints(fresh.primary.color, '#FFFFFF', 'the primary button label');
    writes(fresh.primary.weight, '600', 'the primary button weight');
    writes(fresh.primary.text, 'Save reminder', 'the primary button label');

    // Frame 02: the same card reopened on a saved reminder.
    writes(edit.title.text, 'Edit reminder', 'the edit title');
    writes(edit.subtitle.text, 'Saving updates this entry in place.', 'the edit subtitle');
    writes(edit.labels[2].text, 'Every', 'the edit time label');
    writes(edit.primary.text, 'Save changes', 'the edit primary label');
    const editRow = edit.rows.find((entry) => !entry.hidden);
    near(editRow.field.width, 200, 'the interval field width', 0);
    writes(editRow.unit.text, 'minutes', 'the interval unit');
    near(editRow.unit.size, 12, 'the interval unit size', 0.1);

    // Frame 03: the invalid time. The field keeps its fill under a 1 px danger ring, the
    // helper turns to the danger text colour and the hint becomes the danger box.
    const invalidRow = invalid.rows.find((entry) => !entry.hidden);
    paints(invalidRow.field.background, '#FDD8E5', 'the invalid field fill');
    if (!invalidRow.field.shadow.includes('inset')) throw new Error(`the invalid field has no inner ring: ${invalidRow.field.shadow}`);
    paints(`${invalidRow.field.shadow.split(')')[0]})`, '#F31260', 'the invalid field ring');
    paints(invalid.helper.color, '#B80E4D', 'the invalid helper colour');
    paints(invalid.hint.background, '#FDD8E5', 'the invalid hint fill');
    writes(invalid.hintLabel.text, 'NOTHING IS SAVED YET', 'the invalid hint label');
    paints(invalid.hintBody.color, '#B80E4D', 'the invalid hint text');
    writes(invalid.primary.text, 'Save reminder', 'the invalid primary label');

    // Frames 04 and 05: saving and the disabled save.
    if (!saving.spinner || saving.spinner.hidden) throw new Error('the saving frame draws no spinner');
    pill(saving.spinner.radius, 'the saving spinner radius');
    if (saving.spinner.width < 14 || saving.spinner.width > 20) {
      throw new Error(`the saving spinner is ${saving.spinner.width} px, the node draws a 16 px ring`);
    }
    writes(saving.hintLabel.text, 'WRITING TO REMINDERS.JSON', 'the saving hint label');
    writes(saving.footHint.text, 'Saving - one moment', 'the saving footer hint');
    near(saving.secondary.opacity, 0.5, 'the saving secondary opacity', 0.01);
    paints(disabled.primary.background, '#E4E4E7', 'the disabled save fill');
    paints(disabled.primary.color, '#6B6B75', 'the disabled save label');
    writes(disabled.hintLabel.text, 'WAITING ON MINUTES', 'the disabled hint label');
    writes(disabled.primary.text, 'Save reminder', 'the disabled primary label');

    // Frame 06: the saved banner replaces the hint box.
    if (!saved.hint || !saved.hint.hidden) throw new Error('the saved frame still draws the hint box');
    const banner = saved.banner;
    if (!banner || banner.hidden) throw new Error('the saved frame draws no banner');
    near(banner.x, 24, 'the saved banner left');
    near(banner.width, 432, 'the saved banner width', 0);
    near(banner.radius, 12, 'the saved banner radius');
    paints(banner.background, '#D3F7E3', 'the saved banner fill');
    near(saved.bannerTile.width, 24, 'the saved tick tile width', 0);
    near(saved.bannerTile.height, 24, 'the saved tick tile height', 0);
    pill(saved.bannerTile.radius, 'the saved tick tile radius');
    paints(saved.bannerTile.background, '#17C964', 'the saved tick tile fill');
    writes(saved.bannerTitle.text, 'Reminder saved', 'the saved banner title');
    near(saved.bannerTitle.size, 13, 'the saved banner title size', 0.1);
    near(saved.bannerTitle.leading, 20, 'the saved banner title leading', 0.1);
    writes(saved.bannerTitle.weight, '600', 'the saved banner title weight');
    paints(saved.bannerTitle.color, '#0A7A3D', 'the saved banner title colour');
    near(saved.bannerBody.size, 12, 'the saved banner body size', 0.1);
    near(saved.bannerBody.leading, 16, 'the saved banner body leading', 0.1);
    writes(saved.primary.text, 'Done', 'the saved primary label');
    writes(saved.secondary.text, 'View list', 'the saved secondary label');

    // The dark sheet paints the same card from the dark side of the palette.
    const darkEdit = dark.states.edit;
    paints(darkEdit.card.background, '#18181B', 'the dark dialog fill');
    paints(darkEdit.card.color, '#ECEDEE', 'the dark dialog text');
    paints(darkEdit.textField.background, '#27272A', 'the dark field fill');
    paints(darkEdit.eyebrow.color, '#A1A1AA', 'the dark eyebrow colour');
    paints(darkEdit.headRule.background, '#FFFFFF', 'the dark rule colour');
    paints(darkEdit.primary.background, '#006FEE', 'the dark primary fill');
    paints(dark.states.invalid.helper.color, '#FF8FB0', 'the dark invalid helper colour');
    paints(dark.states.invalid.hint.background, '#310413', 'the dark invalid hint fill');
    paints(dark.states.saved.banner.background, '#052814', 'the dark saved banner fill');
    paints(dark.states.disabled.primary.background, '#3F3F46', 'the dark disabled save fill');
    writes(dark.scrim, 'rgba(0, 0, 0, 0.6)', 'the dark scrim');

    // Both page widths: the bar spans the window, nothing scrolls sideways, and the card
    // keeps its 480 x 592 shape on the desktop while the phone narrows it to the column.
    near(light.page.barWidth, light.page.clientWidth, 'the sheet bar width at 1440', 0);
    near(dark.page.barWidth, dark.page.clientWidth, 'the sheet bar width at 1440', 0);
    if (phone.page.scrollWidth > phone.page.clientWidth) {
      throw new Error(`the phone page scrolls sideways: ${phone.page.scrollWidth} into ${phone.page.clientWidth}`);
    }
    near(phone.page.barWidth, phone.page.clientWidth, 'the sheet bar width at 390', 0);
    if (phone.live.card.width > phone.viewport.width - 32) {
      throw new Error(`the phone card is ${phone.live.card.width} wide in a ${phone.viewport.width} window`);
    }
    // The phone sheet steps the card down one radius from the node's 24; it is an
    // adaptation the node does not draw, so only the step is pinned here.
    if (!(phone.live.card.radius >= 12 && phone.live.card.radius < 24)) {
      throw new Error(`the phone card radius is ${phone.live.card.radius}, the sheet steps it below the node's 24`);
    }
    near(phone.live.card.padding[0], 20, 'the phone card padding');
    writes(phone.live.card.overflow, 0, 'the phone card overflow');

    return '480 x 592 card, 24 padding, 432 x 1 rules at 116 and 516, 332 x 32 type track with a 108-wide save, drawn for new, edit, invalid, saving, disabled and saved, light and dark, plus the 390 phone column';
  });

  // The Automation create / edit dialog (open-pencil node 0:11673). Frame 01 draws the card
  // at 480 x 744 over the automations page and frames 02 to 05 redraw the same card in its
  // four other states. The sheet mounts all five at once, so one load measures every state
  // against the numbers the node carries, and a change in open-pencil turns into a failing
  // measurement here instead of silent drift on the page.
  const measureAutomationDialog = async (width, height, search) => {
    const dialogWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await dialogWindow.loadFile(AUTOMATION_DIALOG_ENTRY, search ? { search } : undefined);
    await wait(250);
    const measured = await dialogWindow.webContents.executeJavaScript(`(() => {
      const round = (value) => Math.round(value);

      // Positions are read from each card's own top-left corner, which is how the node
      // writes them, so the page offset never leaks into a measurement.
      const readCard = (card) => {
        if (!card) return null;
        const origin = card.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const box = (target) => {
          const element = typeof target === 'string' ? card.querySelector(target) : target;
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          const holdsValue =
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement;
          return {
            x: round(rect.x - origin.x),
            y: round(rect.y - origin.y),
            width: round(rect.width),
            height: round(rect.height),
            radius: parseFloat(computed.borderRadius) || 0,
            background: computed.backgroundColor,
            border: computed.borderTopColor,
            borderWidth: parseFloat(computed.borderTopWidth) || 0,
            color: computed.color,
            opacity: parseFloat(computed.opacity),
            size: parseFloat(computed.fontSize),
            leading: parseFloat(computed.lineHeight),
            weight: computed.fontWeight,
            text: holdsValue ? element.value : element.textContent.replace(/\\s+/g, ' ').trim(),
          };
        };
        return {
          state: card.dataset.state,
          card: {
            width: round(origin.width),
            height: round(origin.height),
            radius: parseFloat(cardStyle.borderRadius) || 0,
            padding: [cardStyle.paddingTop, cardStyle.paddingRight, cardStyle.paddingBottom, cardStyle.paddingLeft].map((value) => round(parseFloat(value))),
            background: cardStyle.backgroundColor,
            shadow: cardStyle.boxShadow,
            overflow: card.scrollHeight - card.clientHeight,
            sideways: card.scrollWidth - card.clientWidth,
          },
          title: box('.automation-dialog-title'),
          subtitle: box('.automation-dialog-subtitle'),
          close: box('.automation-dialog-close'),
          headRule: box('.automation-dialog-rule'),
          labels: Array.from(card.querySelectorAll('.automation-dialog-label')).map((element) => box(element)),
          hints: Array.from(card.querySelectorAll('.automation-dialog-hint')).map((element) => box(element)),
          prompt: box('.automation-dialog-prompt'),
          promptInput: box('.automation-dialog-prompt-input'),
          counter: box('.automation-dialog-counter'),
          selects: Array.from(card.querySelectorAll('.automation-dialog-select')).map((element) => box(element)),
          picked: Array.from(card.querySelectorAll('.automation-dialog-select-input')).map((element) => element.value),
          avatar: box('.automation-dialog-avatar'),
          choices: Array.from(card.querySelectorAll('.automation-dialog-choice')).map((line) => ({
            y: round(line.getBoundingClientRect().y - origin.y),
            selected: line.dataset.selected,
            ring: box(line.querySelector('.automation-dialog-ring')),
            word: box(line.querySelector('.automation-dialog-choice-word')),
            short: box(line.querySelector('.automation-dialog-short')),
          })),
          cadenceHint: box('.automation-dialog-choice-hint'),
          tools: Array.from(card.querySelectorAll('.automation-dialog-tool')).map((line) => ({
            y: round(line.getBoundingClientRect().y - origin.y),
            checked: line.querySelector('input').checked,
            word: box(line.querySelector('.automation-dialog-tool-word')),
            mark: box(line.querySelector('.automation-dialog-box')),
          })),
          footRule: box('.automation-dialog-rule-foot'),
          note: box('.automation-dialog-note'),
          cancel: box('.automation-dialog-cancel'),
          save: box('.automation-dialog-save'),
          spinner: Boolean(card.querySelector('.automation-dialog-spinner')),
        };
      };

      const shell = document.querySelector('.automation-dialog-shell');
      const scrim = document.querySelector('.automation-dialog-scrim');
      const bar = document.querySelector('.automation-dialog-page-bar');
      const sheet = document.querySelector('.automation-dialog-sheet');
      const states = {};
      document.querySelectorAll('.automation-dialog-tile .automation-dialog').forEach((card) => {
        states[card.dataset.state] = readCard(card);
      });
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        theme: document.documentElement.dataset.theme,
        page: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          barWidth: bar ? round(bar.getBoundingClientRect().width) : 0,
          sheetWidth: sheet ? round(sheet.getBoundingClientRect().width) : 0,
          shellWidth: shell ? round(shell.getBoundingClientRect().width) : 0,
          shellHeight: shell ? round(shell.getBoundingClientRect().height) : 0,
        },
        scrim: scrim ? getComputedStyle(scrim).backgroundColor : null,
        live: readCard(document.querySelector('.automation-dialog-stage .automation-dialog')),
        states,
      };
    })()`);
    dialogWindow.destroy();
    return measured;
  };

  const automationDialog = {
    light: await measureAutomationDialog(1440, 1000, 'theme=light'),
    dark: await measureAutomationDialog(1440, 1000, 'theme=dark'),
    phone: await measureAutomationDialog(390, 844, 'theme=light'),
    wide: await measureAutomationDialog(1920, 1080, 'theme=light'),
  };

  report.check('the Automation create / edit dialog matches node 0:11673', () => {
    const near = (value, expected, label, slack = 1) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the card draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const rgb = (hex) => {
      const value = parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const paints = (value, wanted, label) => {
      const expected = wanted.startsWith('rgba') ? wanted : rgb(wanted);
      if (value !== expected) throw new Error(`${label} is ${value}, the node paints ${expected}`);
    };
    const over = (value, limit, label) => {
      if (value > limit) throw new Error(`${label} is ${value}, it should stay under ${limit}`);
    };
    // Chromium snaps a 1.5 px border to whole device pixels, so the node's 1.5 arrives
    // as 1 or 2 depending on the screen; anything outside that is real drift.
    const ring = (value, label) => {
      if (!(value >= 1 && value <= 2)) throw new Error(`${label} is ${value} px, the node draws 1.5`);
    };

    const light = automationDialog.light;
    const dark = automationDialog.dark;
    const phone = automationDialog.phone;
    const wide = automationDialog.wide;
    writes(light.theme, 'light', 'the light sheet theme');
    writes(dark.theme, 'dark', 'the dark sheet theme');

    const fresh = light.live;
    if (!fresh) throw new Error('the sheet drew no live dialog to measure');
    const edit = light.states.edit;
    const invalid = light.states.invalid;
    const saving = light.states.saving;
    const disabled = light.states.disabled;
    for (const [name, frame] of Object.entries({ fresh, edit, invalid, saving, disabled })) {
      if (!frame) throw new Error(`the sheet draws no ${name} frame`);
    }

    // Frame 01: the card itself, over the page's scrim.
    near(fresh.card.width, 480, 'the dialog width (0:11751 is 480)');
    near(fresh.card.height, 744, 'the dialog height');
    near(fresh.card.radius, 24, 'the dialog corner radius');
    near(fresh.card.padding[0], 24, 'the dialog padding');
    near(fresh.card.padding[1], 24, 'the dialog right padding');
    paints(fresh.card.background, '#FFFFFF', 'the dialog fill');
    writes(fresh.card.shadow, 'none', 'the dialog shadow (the node draws none)');
    paints(light.scrim, 'rgba(0, 0, 0, 0.16)', 'the scrim over the automations page');

    // Head: title, subtitle, close button and the rule under them.
    writes(fresh.title.text, 'New automation', 'the title');
    near(fresh.title.x, 24, 'the title left');
    near(fresh.title.y, 24, 'the title top');
    near(fresh.title.size, 20, 'the title size', 0.1);
    near(fresh.title.leading, 28, 'the title leading', 0.1);
    writes(fresh.title.weight, '600', 'the title weight');
    paints(fresh.title.color, '#11181C', 'the title colour');
    writes(fresh.subtitle.text, 'Set a prompt, a mode and when Zuri should run it.', 'the subtitle');
    near(fresh.subtitle.y, 52, 'the subtitle top');
    near(fresh.subtitle.size, 13, 'the subtitle size', 0.1);
    near(fresh.subtitle.leading, 20, 'the subtitle leading', 0.1);
    paints(fresh.subtitle.color, '#6B6B75', 'the subtitle colour');
    near(fresh.close.x, 392, 'the close button left');
    near(fresh.close.y, 24, 'the close button top');
    near(fresh.close.width, 44, 'the close button width');
    near(fresh.close.height, 44, 'the close button height');
    near(fresh.close.radius, 12, 'the close button radius');
    paints(fresh.close.background, '#F4F4F5', 'the close button fill');
    near(fresh.headRule.x, 24, 'the header rule left');
    near(fresh.headRule.y, 88, 'the header rule top');
    near(fresh.headRule.width, 432, 'the header rule width', 0);
    near(fresh.headRule.height, 1, 'the header rule height', 0);
    paints(fresh.headRule.background, 'rgba(17, 17, 17, 0.18)', 'the header rule colour');

    // The five labelled blocks and their right-hand hints.
    writes(fresh.labels.length, 5, 'the label count');
    const labelCopy = ['Prompt', 'Mode', 'Cadence', 'Agent', 'Allowed tools'];
    const labelTops = [104, 236, 320, 476, 560];
    fresh.labels.forEach((label, index) => {
      writes(label.text, labelCopy[index], `label ${index + 1}`);
      near(label.x, 24, `label ${index + 1} left`);
      near(label.y, labelTops[index], `label ${index + 1} top`);
      near(label.size, 13, `label ${index + 1} size`, 0.1);
      near(label.leading, 16, `label ${index + 1} leading`, 0.1);
      writes(label.weight, '600', `label ${index + 1} weight`);
      paints(label.color, '#11181C', `label ${index + 1} colour`);
    });
    writes(fresh.hints[0].text, 'Max 280 characters', 'the prompt hint');
    writes(fresh.hints[1].text, 'When should it run?', 'the cadence hint');
    writes(fresh.hints[2].text, 'Only what you check', 'the tools hint');
    near(fresh.hints[0].y, 104, 'the prompt hint top');
    near(fresh.hints[0].x, 300, 'the prompt hint left');
    near(fresh.hints[0].width, 156, 'the prompt hint width');
    paints(fresh.hints[0].color, '#6B6B75', 'the prompt hint colour');

    // The prompt box, its placeholder and the counter in the corner.
    near(fresh.prompt.x, 24, 'the prompt box left');
    near(fresh.prompt.y, 132, 'the prompt box top');
    near(fresh.prompt.width, 432, 'the prompt box width', 0);
    near(fresh.prompt.height, 88, 'the prompt box height', 0);
    near(fresh.prompt.radius, 12, 'the prompt box radius');
    paints(fresh.prompt.background, '#F4F4F5', 'the prompt box fill');
    writes(fresh.promptInput.text, '', 'the empty prompt');
    writes(fresh.counter.text, '0 / 280', 'the character counter');
    near(fresh.counter.y - fresh.prompt.y, 62, 'the counter top in the prompt box');

    // Mode and agent dropdowns.
    near(fresh.selects[0].y, 264, 'the mode select top');
    near(fresh.selects[0].width, 432, 'the mode select width', 0);
    near(fresh.selects[0].height, 40, 'the mode select height', 0);
    near(fresh.selects[0].radius, 12, 'the mode select radius');
    paints(fresh.selects[0].background, '#F4F4F5', 'the mode select fill');
    near(fresh.selects[1].y, 504, 'the agent select top');
    near(fresh.selects[1].height, 40, 'the agent select height', 0);
    writes(fresh.picked[0], 'act', 'the mode value');
    writes(fresh.picked[1], 'researcher', 'the agent value');
    near(fresh.avatar.x, 36, 'the agent dot left in its field');
    near(fresh.avatar.width, 20, 'the agent dot width', 0);
    paints(fresh.avatar.background, '#E6F1FE', 'the agent dot fill');

    // The three cadence lines: once, every interval with its minutes, daily with the clock.
    writes(fresh.choices.length, 3, 'the cadence line count');
    const choiceTops = [348, 388, 428];
    fresh.choices.forEach((line, index) => {
      near(line.y, choiceTops[index], `cadence line ${index + 1} top`);
      near(line.ring.width, 20, `cadence line ${index + 1} ring width`, 0);
      near(line.ring.height, 20, `cadence line ${index + 1} ring height`, 0);
      near(line.word.x, 56, `cadence line ${index + 1} word left`);
    });
    writes(fresh.choices[0].selected, 'false', 'the once line');
    writes(fresh.choices[1].selected, 'false', 'the interval line');
    writes(fresh.choices[2].selected, 'true', 'the daily line');
    paints(fresh.choices[0].ring.border, '#D4D4D8', 'the once ring');
    paints(fresh.choices[1].ring.border, '#111111', 'the interval ring');
    paints(fresh.choices[2].ring.background, '#006FEE', 'the picked ring fill');
    writes(fresh.choices[2].word.weight, '600', 'the picked cadence weight');
    writes(fresh.choices[0].word.weight, '400', 'the resting cadence weight');
    writes(fresh.choices[0].word.text, 'Once', 'the first cadence');
    writes(fresh.choices[1].word.text, 'Every interval', 'the second cadence');
    writes(fresh.choices[2].word.text, 'Daily', 'the third cadence');
    writes(fresh.cadenceHint.text, 'Runs a single time', 'the once hint');
    if (fresh.choices[0].short) throw new Error('the once line draws a value field, the node draws none');
    near(fresh.choices[1].short.x, 360, 'the minutes field left');
    near(fresh.choices[1].short.width, 96, 'the minutes field width', 0);
    near(fresh.choices[1].short.height, 32, 'the minutes field height', 0);
    near(fresh.choices[2].short.x, 360, 'the clock field left');
    near(fresh.choices[2].short.width, 96, 'the clock field width', 0);
    near(fresh.choices[2].short.height, 32, 'the clock field height', 0);
    near(fresh.choices[2].short.radius, 12, 'the clock field radius');
    paints(fresh.choices[2].short.border, '#006FEE', 'the clock field ring');
    ring(fresh.choices[2].short.borderWidth, 'the clock field ring');

    // The allow-list: two columns, three of the four ticked, the tick on the ink.
    writes(fresh.tools.length, 4, 'the tool count');
    const toolCopy = ['Files & folders', 'Apps & windows', 'Office files', 'Search & web'];
    const toolTops = [588, 588, 620, 620];
    fresh.tools.forEach((tool, index) => {
      writes(tool.word.text, toolCopy[index], `tool ${index + 1}`);
      near(tool.y, toolTops[index], `tool ${index + 1} top`);
      near(tool.mark.width, 20, `tool ${index + 1} box width`, 0);
      near(tool.mark.radius, 4, `tool ${index + 1} box radius`);
      near(tool.word.x, index % 2 === 0 ? 56 : 276, `tool ${index + 1} word left`);
    });
    writes(fresh.tools[0].checked, true, 'the files tick');
    writes(fresh.tools[1].checked, true, 'the apps tick');
    writes(fresh.tools[2].checked, true, 'the office tick');
    writes(fresh.tools[3].checked, false, 'the web tick');
    paints(fresh.tools[0].mark.background, '#11181C', 'the ticked box fill');
    paints(fresh.tools[3].mark.background, '#FFFFFF', 'the resting box fill');
    near(fresh.tools[1].word.x, 276, 'the second tool column', 6);

    // Footer: the rule at 664, the note, Cancel and Save at 40 tall.
    near(fresh.footRule.y, 664, 'the footer rule top');
    near(fresh.footRule.width, 432, 'the footer rule width', 0);
    paints(fresh.footRule.background, 'rgba(17, 17, 17, 0.18)', 'the footer rule colour');
    writes(fresh.note.text, 'Desktop notification on every run.', 'the footer note');
    near(fresh.note.y, 691, 'the footer note top');
    paints(fresh.note.color, '#6B6B75', 'the footer note colour');
    near(fresh.cancel.x, 256, 'the cancel left');
    near(fresh.cancel.y, 680, 'the cancel top');
    near(fresh.cancel.width, 80, 'the cancel width');
    near(fresh.cancel.height, 40, 'the cancel height');
    paints(fresh.cancel.border, '#111111', 'the cancel edge');
    near(fresh.save.x, 344, 'the save left');
    near(fresh.save.y, 680, 'the save top');
    near(fresh.save.width, 112, 'the save width');
    near(fresh.save.height, 40, 'the save height');
    paints(fresh.save.background, '#006FEE', 'the save fill');
    paints(fresh.save.color, '#FFFFFF', 'the save label colour');
    writes(fresh.save.text, 'Save', 'the save label');
    if (!(fresh.save.radius >= 999)) throw new Error(`the save radius is ${fresh.save.radius}, the node draws a full pill`);

    // Frame 02: the same card with the saved values in it.
    writes(edit.title.text, 'Edit automation', 'the edit title');
    writes(edit.save.text, 'Save changes', 'the edit save label');
    writes(
      edit.promptInput.text,
      'Triage the shared inbox, label each thread and draft replies for my review.',
      'the edit prompt',
    );
    writes(edit.counter.text, '75 / 280', 'the edit counter');
    writes(edit.picked[1], 'inbox', 'the edit agent');

    // Frame 03: the two required fields flagged.
    writes(invalid.hints[0].text, 'Prompt is required', 'the invalid prompt hint');
    paints(invalid.hints[0].color, '#F31260', 'the invalid prompt hint colour');
    writes(invalid.hints[1].text, 'Enter a time', 'the invalid cadence hint');
    paints(invalid.hints[1].color, '#F31260', 'the invalid cadence hint colour');
    paints(invalid.prompt.border, '#F31260', 'the invalid prompt ring');
    paints(invalid.choices[2].short.border, '#F31260', 'the invalid clock ring');
    writes(invalid.promptInput.text, '', 'the cleared invalid prompt');

    // Frame 04: the save in flight.
    writes(saving.note.text, 'Writing schedules.json...', 'the saving note');
    writes(saving.save.text, 'Saving...', 'the saving label');
    writes(saving.spinner, true, 'the saving spinner');
    writes(saving.cancel.opacity, 0.5, 'the dimmed cancel');

    // Frame 05: no cadence yet, so Save stays locked and the clock ring rests.
    writes(disabled.save.text, 'Save', 'the locked save label');
    paints(disabled.save.background, '#D4D4D8', 'the locked save fill');
    paints(disabled.save.color, '#6B6B75', 'the locked save label');
    writes(disabled.note.text, 'Pick a cadence to enable Save.', 'the locked note');
    writes(disabled.choices[0].selected, 'false', 'the unselected once line');
    writes(disabled.choices[1].selected, 'false', 'the unselected interval line');
    writes(disabled.choices[2].selected, 'false', 'the unselected daily line');
    paints(disabled.choices[2].ring.border, '#111111', 'the resting daily ring');
    writes(disabled.choices[2].word.weight, '400', 'the resting daily weight');
    paints(disabled.choices[2].short.border, '#111111', 'the resting clock ring');

    // The dark set: one token layer, swapped on the document.
    const darkFresh = dark.live;
    paints(darkFresh.card.background, '#18181B', 'the dark dialog fill');
    paints(darkFresh.title.color, '#ECEDEE', 'the dark title colour');
    paints(darkFresh.headRule.background, 'rgba(255, 255, 255, 0.2)', 'the dark rule colour');
    paints(darkFresh.prompt.background, '#27272A', 'the dark prompt fill');
    paints(darkFresh.save.background, '#006FEE', 'the dark save fill');
    paints(dark.scrim, 'rgba(0, 0, 0, 0.55)', 'the dark scrim');

    // Every width: the bar spans the window, nothing scrolls sideways, the card keeps its
    // 480 shape on the desktop and narrows to the column on the phone.
    near(light.page.barWidth, light.page.clientWidth, 'the sheet bar width at 1440', 0);
    near(dark.page.barWidth, dark.page.clientWidth, 'the sheet bar width at 1440', 0);
    near(wide.page.barWidth, wide.page.clientWidth, 'the sheet bar width at 1920', 0);
    for (const [name, frame] of Object.entries({ light, dark, wide })) {
      if (frame.page.scrollWidth > frame.page.clientWidth) {
        throw new Error(`the ${name} page scrolls sideways: ${frame.page.scrollWidth} into ${frame.page.clientWidth}`);
      }
    }
    over(wide.page.shellWidth, 1200, 'the live frame width at 1920');
    over(wide.page.sheetWidth, 1900, 'the sheet width at 1920');
    if (phone.page.scrollWidth > phone.page.clientWidth) {
      throw new Error(`the phone page scrolls sideways: ${phone.page.scrollWidth} into ${phone.page.clientWidth}`);
    }
    near(phone.page.barWidth, phone.page.clientWidth, 'the sheet bar width at 390', 0);
    over(phone.live.card.width, phone.viewport.width - 32, 'the phone card width');
    writes(phone.live.card.overflow, 0, 'the phone card overflow');
    writes(phone.live.card.sideways, 0, 'the phone card sideways scroll');
    writes(phone.live.labels.length, 5, 'the phone label count');

    return '480 x 744 card over the automations page, drawn for new, edit, invalid, saving and no cadence, light and dark, plus the 390 phone column and the 1920 frame';
  });

  // The Task create / edit dialog (open-pencil node 0:9894). Frame 01 draws the 368 x 800
  // slide-over at the right edge of the tasks page and frame 02 repeats it with the saved
  // values in the fields; frames 03 to 06 describe the invalid, saving, discard and priority
  // states. The sheet mounts all six at once, so one load measures every state against the
  // numbers the node carries, and a change in open-pencil turns into a failing measurement
  // here instead of silent drift on the page.
  const measureTaskDialog = async (width, height, search) => {
    const dialogWindow = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        preload: PRELOAD_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await dialogWindow.loadFile(TASK_DIALOG_ENTRY, search ? { search } : undefined);
    await wait(400);
    const measured = await dialogWindow.webContents.executeJavaScript(`(() => {
      const round = (value) => Math.round(value);

      // Positions come off each panel's own top-left corner, which is how the node
      // writes them, so the page offset never leaks into a measurement.
      const readPanel = (card) => {
        if (!card) return null;
        const origin = card.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const box = (target) => {
          const element = typeof target === 'string' ? card.querySelector(target) : target;
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          const holdsValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
          return {
            x: round(rect.x - origin.x),
            y: round(rect.y - origin.y),
            width: round(rect.width),
            height: round(rect.height),
            radius: parseFloat(computed.borderRadius) || 0,
            background: computed.backgroundColor,
            color: computed.color,
            shadow: computed.boxShadow,
            opacity: parseFloat(computed.opacity),
            size: parseFloat(computed.fontSize),
            leading: parseFloat(computed.lineHeight),
            weight: computed.fontWeight,
            text: holdsValue ? element.value : (element.textContent || '').replace(/\\s+/g, ' ').trim(),
          };
        };
        const head = card.querySelector('.task-dialog-head');
        const foot = card.querySelector('.task-dialog-foot');
        const titleInput = card.querySelector('.task-dialog-field-title input');
        const visibleMenu = card.querySelector('.task-dialog-menu:not([hidden])');
        const visibleConfirm = card.querySelector('.task-dialog-confirm:not([hidden])');
        return {
          state: card.dataset.state,
          caret: card.dataset.caret,
          panel: {
            width: round(origin.width),
            height: round(origin.height),
            radius: parseFloat(cardStyle.borderRadius) || 0,
            background: cardStyle.backgroundColor,
            overflow: card.scrollHeight - card.clientHeight,
            sideways: card.scrollWidth - card.clientWidth,
          },
          eyebrow: box('.task-dialog-eyebrow'),
          heading: box('.task-dialog-title'),
          close: box('.task-dialog-close'),
          headBottom: round(head.getBoundingClientRect().bottom - origin.y),
          labels: Array.from(card.querySelectorAll('.task-dialog-label')).map((element) => box(element)),
          star: box('.task-dialog-required'),
          fields: {
            title: box('.task-dialog-field-title'),
            due: box('.task-dialog-field-due'),
            priority: box('.task-dialog-field-priority'),
            note: box('.task-dialog-field-note'),
          },
          titleText: titleInput ? round(titleInput.getBoundingClientRect().x - origin.x) : null,
          values: {
            title: titleInput ? titleInput.value : null,
            note: card.querySelector('.task-dialog-field-note textarea') ? card.querySelector('.task-dialog-field-note textarea').value : null,
            priority: card.querySelector('.task-dialog-priority-value') ? card.querySelector('.task-dialog-priority-value').textContent.trim() : null,
          },
          caretBox: box('.task-dialog-field-title .task-dialog-caret'),
          calendar: box('.task-dialog-calendar'),
          chevron: box('.task-dialog-chevron'),
          helpers: Array.from(card.querySelectorAll('.task-dialog-helper')).map((element) => box(element)),
          hintCard: box('.task-dialog-hint-card'),
          hintLabel: box('.task-dialog-hint-label'),
          hintBody: box('.task-dialog-hint-body'),
          footTop: round(foot.getBoundingClientRect().top - origin.y),
          footHint: box('.task-dialog-foot-hint'),
          dot: card.querySelector('.task-dialog-dirty:not([hidden])') ? box('.task-dialog-dirty') : null,
          cancel: box('.task-dialog-cancel'),
          save: box('.task-dialog-save'),
          spinner: (() => {
            const element = card.querySelector('.task-dialog-spinner:not([hidden])');
            if (!element) return null;
            // The ring is spinning, so its bounding rect is the rotated square: the
            // offset size is the 12 x 12 the node draws.
            return { ...box(element), offset: element.offsetWidth, offsetHeight: element.offsetHeight, ring: getComputedStyle(element).borderTopWidth };
          })(),
          menu: visibleMenu ? box(visibleMenu) : null,
          menuRows: Array.from(card.querySelectorAll('.task-dialog-menu-item')).map((element) => ({
            level: element.dataset.level,
            tone: element.dataset.tone,
            picked: element.getAttribute('aria-selected'),
            y: round(element.getBoundingClientRect().y - origin.y),
            color: getComputedStyle(element).color,
          })),
          confirm: visibleConfirm ? box('.task-dialog-confirm-card') : null,
        };
      };

      const bar = document.querySelector('.task-dialog-page-bar');
      const sheet = document.querySelector('.task-dialog-sheet');
      const scrim = document.querySelector('.task-dialog-scrim');
      const states = {};
      document.querySelectorAll('.task-dialog-tile .task-dialog').forEach((card) => {
        states[card.dataset.state] = readPanel(card);
      });
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        theme: document.documentElement.dataset.theme,
        states: window.__KAI_STATES__,
        page: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          barWidth: bar ? round(bar.getBoundingClientRect().width) : 0,
          sheetWidth: sheet ? round(sheet.getBoundingClientRect().width) : 0,
        },
        scrim: scrim ? getComputedStyle(scrim).backgroundColor : null,
        live: readPanel(document.querySelector('.task-dialog-stage .task-dialog')),
        drawn: states,
      };
    })()`);
    dialogWindow.destroy();
    return measured;
  };

  const taskDialog = {
    light: await measureTaskDialog(1440, 1000, 'theme=light'),
    dark: await measureTaskDialog(1440, 1000, 'theme=dark'),
    phone: await measureTaskDialog(390, 844, 'theme=light'),
    wide: await measureTaskDialog(1920, 1080, 'theme=light'),
  };

  report.check('the Task create / edit dialog matches node 0:9894', () => {
    const near = (value, expected, label, slack = 1) => {
      if (Math.abs(value - expected) > slack) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const writes = (drawn, node, label) => {
      if (drawn !== node) throw new Error(`the panel draws ${label} as "${drawn}", the node reads "${node}"`);
    };
    const under = (value, limit, label) => {
      if (value > limit) throw new Error(`${label} is ${value}, over the ${limit} the node allows`);
    };
    const over = (value, limit, label) => {
      if (value < limit) throw new Error(`${label} is ${value}, under the ${limit} the node allows`);
    };

    const panel = taskDialog.light.live;
    if (!panel) throw new Error('the sheet mounts no panel in its live frame');
    writes(taskDialog.light.theme, 'light', 'its theme');
    writes(taskDialog.light.states.join(','), 'new,edit,invalid,saving,discard,priority', 'the states it publishes');

    // 0:9966 - the panel and its head.
    near(panel.panel.width, 368, 'the panel width');
    near(panel.panel.height, 800, 'the panel height');
    near(panel.panel.radius, 20, 'the panel corner radius');
    writes(panel.panel.background, 'rgb(255, 255, 255)', 'the panel fill');
    writes(panel.panel.sideways, 0, 'the panel sideways scroll');
    near(panel.eyebrow.y, 22, 'the eyebrow top');
    near(panel.eyebrow.size, 11, 'the eyebrow size');
    near(panel.eyebrow.leading, 16, 'the eyebrow leading');
    writes(panel.eyebrow.weight, '600', 'the eyebrow weight');
    near(panel.heading.y, 44, 'the title top');
    near(panel.heading.size, 20, 'the title size');
    near(panel.heading.leading, 28, 'the title leading');
    writes(panel.heading.text, 'New task', 'the new-task title');
    near(panel.close.x, 308, 'the close button left');
    near(panel.close.y, 22, 'the close button top');
    near(panel.close.width, 36, 'the close button width');
    near(panel.close.height, 36, 'the close button height');
    near(panel.close.radius, 12, 'the close button radius');
    // The head ends where its 1 px rule is drawn, so the rule occupies 88 to 89.
    near(panel.headBottom - 1, 88, 'the head rule');

    // The four labels and their fields: 112, 212, 312 and 388 down.
    near(panel.labels[0].y, 112, 'the title label top');
    near(panel.labels[1].y, 212, 'the due label top');
    near(panel.labels[2].y, 312, 'the priority label top');
    near(panel.labels[3].y, 388, 'the note label top');
    writes(panel.labels[0].size, 14, 'the label size');
    writes(panel.labels[0].leading, 20, 'the label leading');
    near(panel.star.x, 66, 'the required star left');
    writes(panel.star.color, 'rgb(243, 18, 96)', 'the required star colour');

    for (const [name, field] of Object.entries(panel.fields)) {
      near(field.x, 24, `the ${name} field left`);
      near(field.width, 320, `the ${name} field width`);
      near(field.radius, 12, `the ${name} field radius`);
    }
    near(panel.fields.title.y, 136, 'the title field top');
    near(panel.fields.title.height, 40, 'the title field height');
    near(panel.fields.due.y, 236, 'the due field top');
    near(panel.fields.due.height, 40, 'the due field height');
    near(panel.fields.priority.y, 336, 'the priority field top');
    near(panel.fields.note.y, 412, 'the note field top');
    near(panel.fields.note.height, 88, 'the note field height');
    writes(panel.fields.title.background, 'rgb(244, 244, 245)', 'the field fill');
    writes(panel.fields.title.size, 14, 'the field text size');
    writes(panel.fields.title.leading, 22, 'the field text leading');

    // The caret sits at 12 and the text one space further in, at 16.
    near(panel.caretBox.x, 24 + 12, 'the caret left');
    near(panel.caretBox.y, 136 + 10, 'the caret top');
    near(panel.caretBox.width, 1, 'the caret width');
    near(panel.caretBox.height, 20, 'the caret height');
    near(panel.titleText, 24 + 16, 'the title text left');
    writes(panel.caret, 'on', 'the empty title caret');
    near(panel.calendar.x, 24 + 292, 'the calendar glyph left');
    near(panel.calendar.y, 236 + 13, 'the calendar glyph top');
    near(panel.calendar.width, 14, 'the calendar glyph width');
    near(panel.chevron.x, 24 + 292, 'the priority chevron left');
    near(panel.chevron.width, 16, 'the priority chevron width');

    // Helpers at 13/20, 4 under their field.
    near(panel.helpers[0].y, 180, 'the title helper top');
    near(panel.helpers[0].size, 13, 'the helper size');
    near(panel.helpers[0].leading, 20, 'the helper leading');
    near(panel.helpers[1].y, 280, 'the due helper top');

    // The hint card: 320 x 76 at 520.
    near(panel.hintCard.y, 520, 'the hint card top');
    near(panel.hintCard.width, 320, 'the hint card width');
    near(panel.hintCard.height, 76, 'the hint card height');
    near(panel.hintCard.radius, 12, 'the hint card radius');
    near(panel.hintLabel.y, 520 + 10, 'the hint label top');
    writes(panel.hintLabel.size, 11, 'the hint label size');
    near(panel.hintBody.y, 520 + 28, 'the hint body top');
    writes(panel.hintBody.size, 13, 'the hint body size');

    // The foot: the rule at 712, the buttons at 736, 28 under them.
    near(panel.footTop, 712, 'the footer rule');
    near(panel.footHint.y, 744, 'the footer hint top');
    writes(panel.footHint.size, 13, 'the footer hint size');
    writes(panel.footHint.text, 'Esc to cancel', 'the clean footer hint');
    near(panel.cancel.x, 192, 'the cancel button left');
    near(panel.cancel.y, 736, 'the cancel button top');
    near(panel.cancel.width, 73, 'the cancel button width');
    near(panel.cancel.height, 36, 'the cancel button height');
    near(panel.cancel.radius, 12, 'the cancel button radius');
    near(panel.save.x, 273, 'the save button left');
    near(panel.save.width, 71, 'the save button width');
    writes(panel.save.text, 'Save', 'the save label');
    writes(panel.save.color, 'rgb(255, 255, 255)', 'the save label colour');
    // 0:9966 draws the save at 40% while the title is empty.
    writes(panel.save.opacity, 0.4, 'the empty-title save opacity');
    if (panel.dot) throw new Error('the new task draws no dirty dot, the panel shows one');

    // 0:10070 - the edit state: values in the fields, the dot, a live save.
    const edit = taskDialog.light.drawn.edit;
    writes(edit.state, 'edit', 'the edit tile state');
    writes(edit.heading.text, 'Edit task', 'the edit title');
    writes(edit.values.title, 'Send Q3 forecast to Nadia', 'the edit title value');
    writes(edit.values.priority, 'High', 'the edit priority value');
    writes(edit.helpers[0].text, 'Last edited by you · today 08:12', 'the edit helper');
    writes(edit.save.opacity, 1, 'the edit save opacity');
    if (!edit.dot) throw new Error('the edit state draws the dirty dot, the tile shows none');
    near(edit.dot.x, 20, 'the dirty dot left');
    near(edit.dot.width, 6, 'the dirty dot width');
    // The node centres the dot on the hint's own line, which puts its 6 px box at 748.
    near(edit.dot.y, 748, 'the dirty dot top', 3);
    near(edit.footHint.x, 36, 'the dirty footer hint left');
    writes(edit.footHint.text, 'Unsaved changes', 'the dirty footer hint');
    writes(edit.caret, 'off', 'the filled title caret');

    // 0:10105 - a blank title rings the field and says why.
    const invalid = taskDialog.light.drawn.invalid;
    writes(invalid.state, 'invalid', 'the invalid tile state');
    writes(invalid.helpers[0].text, 'Enter a title so Zuri knows what to do.', 'the error message');
    writes(invalid.helpers[0].color, 'rgb(184, 14, 77)', 'the error message colour');
    if (!invalid.fields.title.shadow.includes('243, 18, 96')) {
      throw new Error(`the invalid field rings in the danger colour, it draws ${invalid.fields.title.shadow}`);
    }
    writes(invalid.save.text, 'Save task', 'the invalid save label');
    writes(invalid.save.opacity, 0.4, 'the invalid save opacity');

    // 0:10120 - saving locks the fields and rings the save.
    const saving = taskDialog.light.drawn.saving;
    writes(saving.state, 'saving', 'the saving tile state');
    writes(saving.save.text, 'Saving…', 'the saving save label');
    writes(saving.save.opacity, 1, 'the saving save opacity');
    writes(saving.cancel.text, 'Close', 'the saving cancel label');
    if (!saving.spinner) throw new Error('the saving state draws a spinner in the save button');
    writes(saving.spinner.offset, 12, 'the spinner width');
    writes(saving.spinner.offsetHeight, 12, 'the spinner height');
    writes(saving.spinner.ring, '2px', 'the spinner ring weight');
    writes(saving.helpers[0].text, 'Locked until the write finishes.', 'the saving helper');
    writes(saving.footHint.text, 'Saving - one moment', 'the saving footer hint');
    if (saving.dot) throw new Error('the saving state draws no dirty dot, the tile shows one');

    // 0:10135 - the discard prompt over the panel.
    const discard = taskDialog.light.drawn.discard;
    writes(discard.state, 'discard', 'the discard tile state');
    if (!discard.confirm) throw new Error('the discard state draws a confirm card, the tile shows none');
    near(discard.confirm.radius, 16, 'the confirm card radius');
    writes(discard.confirm.background, 'rgb(255, 255, 255)', 'the confirm card fill');
    over(discard.confirm.width, 240, 'the confirm card width');
    under(discard.confirm.width, 320, 'the confirm card width');

    // 0:10149 - the priority menu, 4 under the field, four levels with a check.
    const priority = taskDialog.light.drawn.priority;
    writes(priority.state, 'priority', 'the priority tile state');
    if (!priority.menu) throw new Error('the priority state draws its menu, the tile shows none');
    near(priority.menu.y, 336 + 40 + 4, 'the priority menu top');
    near(priority.menu.width, 320, 'the priority menu width');
    near(priority.menu.height, 120, 'the priority menu height');
    near(priority.menu.radius, 12, 'the priority menu radius');
    writes(priority.menuRows.length, 4, 'the priority level count');
    writes(priority.menuRows.map((row) => row.level).join(','), 'low,medium,high,urgent', 'the priority levels');
    writes(priority.menuRows.map((row) => row.picked).join(','), 'false,true,false,false', 'the picked priority');
    near(priority.menuRows[0].y, 336 + 44 + 5, 'the first menu row');
    near(priority.menuRows[1].y, 336 + 44 + 35, 'the second menu row');
    near(priority.menuRows[2].y, 336 + 44 + 65, 'the third menu row');
    near(priority.menuRows[3].y, 336 + 44 + 95, 'the fourth menu row');
    writes(priority.menuRows[2].color, 'rgb(0, 91, 196)', 'the High level colour');
    writes(priority.menuRows[3].color, 'rgb(184, 14, 77)', 'the Urgent level colour');

    // The frame the panel is drawn over is the node's, and it is scrimmed the same way.
    writes(taskDialog.light.scrim, 'rgba(17, 24, 28, 0.35)', 'the light scrim');
    writes(taskDialog.dark.scrim, 'rgba(0, 0, 0, 0.55)', 'the dark scrim');
    writes(taskDialog.dark.theme, 'dark', 'the dark theme');
    writes(taskDialog.dark.live.panel.background, 'rgb(24, 24, 27)', 'the dark panel fill');
    writes(taskDialog.dark.live.fields.title.background, 'rgb(39, 39, 42)', 'the dark field fill');
    writes(taskDialog.dark.live.heading.color, 'rgb(236, 237, 238)', 'the dark title colour');

    // 390 wide: one column, the panel inside the window, nothing scrolling sideways.
    if (taskDialog.phone.page.scrollWidth > taskDialog.phone.page.clientWidth) {
      throw new Error(`the phone page scrolls sideways: ${taskDialog.phone.page.scrollWidth} into ${taskDialog.phone.page.clientWidth}`);
    }
    near(taskDialog.phone.page.barWidth, taskDialog.phone.page.clientWidth, 'the page bar width at 390', 0);
    under(taskDialog.phone.live.panel.width, 368, 'the phone panel width');
    over(taskDialog.phone.live.panel.width, 300, 'the phone panel width');
    writes(taskDialog.phone.live.panel.sideways, 0, 'the phone panel sideways scroll');
    over(taskDialog.phone.live.footTop, 400, 'the phone footer position');

    // 1920 wide: the bar still spans the window and the sheet is capped and centred.
    if (taskDialog.wide.page.scrollWidth > taskDialog.wide.page.clientWidth) {
      throw new Error(`the 1920 page scrolls sideways: ${taskDialog.wide.page.scrollWidth} into ${taskDialog.wide.page.clientWidth}`);
    }
    near(taskDialog.wide.page.barWidth, taskDialog.wide.page.clientWidth, 'the page bar width at 1920', 0);
    under(taskDialog.wide.page.sheetWidth, 1900, 'the sheet width at 1920');
    over(taskDialog.wide.page.sheetWidth, 1500, 'the sheet width at 1920');
    over(taskDialog.wide.live.panel.width, 300, 'the live panel width at 1920');

    return '368 x 800 slide-over at the right edge of the tasks page, drawn for new, edit, invalid, saving, discard and priority, light and dark, plus the 390 phone column and the 1920 sheet';
  });

  report.check('no console errors during load', () => {
    if (consoleCapture.errors.length > 0) throw new Error(consoleCapture.errors.join(' | '));
  });

  clearTimeout(hardStop);
  console.log(report.exitCode() === 0 ? 'PASS smoke' : `FAIL smoke: ${report.failures()} assertion(s) failed`);
  app.exit(report.exitCode());
}).catch((error) => {
  clearTimeout(hardStop);
  console.log(`FAIL smoke: ${error.message}`);
  app.exit(1);
});
/**
 * Smoke: boots the real main process, waits for the main window, and checks the
 * shell and renderer are healthy with no console errors. Run via `npm run smoke`
 * (electron scripts/smoke.js), because it needs Electron's APIs.
 */
