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

  report.check('every column has a collapse toggle', () => {
    const missing = ['sidebar', 'chat', 'context-panel'].filter((name) => !pageState.toggles.includes(name));
    if (missing.length > 0) throw new Error(`no .shell-toggle for ${missing.join(', ')}`);
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
   * Read the collapse state of every column from inside the page.
   * @param {BrowserWindow} target
   */
  const readShell = (target) =>
    target.webContents.executeJavaScript(`(() => ({
      width: window.innerWidth,
      columns: ['sidebar', 'chat', 'context-panel'].map((id) => ({
        id,
        collapsed: document.getElementById(id)?.dataset.collapsed,
        width: Math.round(document.getElementById(id)?.getBoundingClientRect().width ?? 0),
      })),
    }))()`);

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

  report.check('the context panel starts collapsed below 1000px', () => {
    if (narrow.width >= 1000) throw new Error(`the window is ${narrow.width}px, so 1000px was not crossed`);
    const panel = narrow.columns.find((column) => column.id === 'context-panel');
    if (panel.collapsed !== 'true') throw new Error(`data-collapsed is ${panel.collapsed}`);
    if (panel.width > 100) throw new Error(`the collapsed panel is still ${panel.width}px wide`);
    return `${narrow.width}px wide, panel collapsed to ${panel.width}px`;
  });

  // Expanding it by hand and then widening the window must not undo the choice.
  await window.webContents.executeJavaScript(
    `document.querySelector('.shell-toggle[aria-controls="context-panel"]').click() && true`,
  );
  await resizeAndSettle(window, 1200, 800);
  await wait(300);
  const widened = await readShell(window);

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
      surfaceToken: rootStyle.getPropertyValue('--zuri-surface').trim(),
      dangerToken: rootStyle.getPropertyValue('--zuri-danger').trim(),
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

  // Button / Danger (design node 0:12) is drawn once in components.css and used by
  // the Settings view's destructive action, so this measures the control the person
  // actually clicks rather than reading the stylesheet.
  report.check('Button / Danger matches the design node 0:12', () => {
    const style = removalRun.style ?? {};
    const toRgb = (value) => {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? '').trim());
      if (!match) return String(value ?? '').trim();
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
      return `rgb(${r}, ${g}, ${b})`;
    };

    const wanted = [
      ['the 32 px node height', style.height, 32],
      ['the left side padding', style.paddingLeft, '16px'],
      ['the right side padding', style.paddingRight, '16px'],
      ['the radius/row corner', style.radius, '8px'],
      ['no outline, as the node has none', style.borderWidth, '0px'],
      ['the color/background fill', style.background, toRgb(style.surfaceToken)],
      ['the color/danger label', style.color, toRgb(style.dangerToken)],
      ['the 13 px label size', style.fontSize, '13px'],
      ['the regular label weight', style.fontWeight, '400'],
      ['the body-sm label line box', style.lineHeight, '20px'],
    ];
    const wrong = wanted.filter(([, actual, expected]) => actual !== expected);
    if (wrong.length > 0) {
      throw new Error(wrong.map(([label, actual, expected]) => `${label}: ${actual} (expected ${expected})`).join('; '));
    }
    return '32 px tall, 16 px padding, radius 8, surface fill, danger label at 13 px';
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

  // The chat column's error block is the design's "Block / Error" component
  // (node 0:121): 360 px wide on 16 px padding, a danger tint and a 32% danger
  // border, a mark beside a 14/22 title and 12/16 caption, then a 28 px Retry.
  // Retry has to be a real control, so clicking it asks again for the reply that
  // never arrived, which is the state this run is already in.
  const errorBlockRun = await window.webContents.executeJavaScript(`(async () => {
    const block = document.querySelector('.error-block');
    const action = document.getElementById('chat-error-retry');
    const icon = block?.querySelector('.error-block-icon svg') ?? null;
    const composer = document.getElementById('composer-shell');
    const failedCount = () => document.querySelectorAll('.message[data-state="failed"]').length;
    const parse = (value) => {
      const match = String(value).match(/rgba?\\(([^)]+)\\)/);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return { r: parts[0] ?? -1, g: parts[1] ?? -1, b: parts[2] ?? -1, a: parts[3] ?? 1 };
    };
    const hex = (value) => {
      const digits = String(value).trim().replace('#', '');
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
      };
    };
    const box = block.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    const style = getComputedStyle(block);
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
      danger: hex(getComputedStyle(document.documentElement).getPropertyValue('--zuri-danger')),
      title: block.querySelector('.error-block-title').textContent.trim(),
      text: block.querySelector('.error-block-text').textContent.trim(),
      label: action.textContent.trim(),
      paths: icon ? icon.querySelectorAll('path').length : 0,
      mark: icon ? parse(getComputedStyle(icon).color) : null,
      width: Math.round(box.width),
      blockCenter: Math.round(box.left + box.width / 2),
      composerCenter: Math.round(composerBox.left + composerBox.width / 2),
      radius: Math.round(Number.parseFloat(style.borderTopLeftRadius)),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
      fill: parse(style.backgroundColor),
      line: parse(style.borderTopColor),
      titleFont: [titleStyle.fontSize, titleStyle.lineHeight, titleStyle.fontWeight].join(' '),
      textFont: [textStyle.fontSize, textStyle.lineHeight].join(' '),
      actionHeight: Math.round(actionBox.height),
      rowHeight: Math.round(block.querySelector('.error-block-row').getBoundingClientRect().height),
      borderWidth: style.borderTopWidth,
      blockHeight: box.height,
      actionPadding: [actionStyle.paddingLeft, actionStyle.paddingRight].join(' '),
      actionRadius: Math.round(Number.parseFloat(actionStyle.borderTopLeftRadius)),
      failedBefore: before,
      failedAfter: failedCount(),
      composerState: composer.dataset.state ?? '',
    };
  })()`);

  report.check('the chat column shows the Block / Error component and its Retry asks again', () => {
    const run = errorBlockRun;
    const { danger } = run;
    const onDangerRamp = (colour) =>
      colour && colour.r === danger.r && colour.g === danger.g && colour.b === danger.b;
    const near = (value, expected) => Math.abs(value - expected) <= 0.01;

    if (run.title !== "Couldn't reach the provider") throw new Error(`the title reads "${run.title}"`);
    if (run.text !== 'Check your API key in Settings, then try again.') {
      throw new Error(`the caption reads "${run.text}"`);
    }
    if (run.label !== 'Retry') throw new Error(`the action reads "${run.label}"`);
    if (run.paths !== 2) throw new Error(`the mark draws ${run.paths} paths, not the node's 2`);
    if (!onDangerRamp(run.mark)) throw new Error('the mark is not in the danger colour');
    if (run.width !== 360) throw new Error(`the block is ${run.width}px wide, not the node's 360`);
    // The card sits on the same centre line as the composer below it. Without the
    // component's own auto margins a flex column pins a width-capped item to its
    // start, so the card reads as left-aligned under a full-width field.
    if (Math.abs(run.blockCenter - run.composerCenter) > 1) {
      throw new Error(`the card is ${run.blockCenter - run.composerCenter}px off the composer's centre line`);
    }
    // The node draws its 1px stroke inside its 110 px box; a CSS border sits outside
    // the padding, so the card measures the node's 110 plus one hairline top and
    // bottom. Chromium snaps a hairline to the display's device pixels, so the width
    // is read back rather than assumed. Everything between the lines is the node's
    // own geometry: 16 padding, 42 row, 8 gap, 28 action, 16 padding.
    const border = Number.parseFloat(run.borderWidth) || 0;
    if (border <= 0 || border > 1) throw new Error(`the card border is ${run.borderWidth}, not a hairline`);
    if (Math.abs(run.blockHeight - (110 + border * 2)) > 0.6) {
      throw new Error(`the block is ${run.blockHeight}px tall, not the node's 110 plus its border`);
    }
    if (Math.abs(run.rowHeight - 42) > 0.6) {
      throw new Error(`the mark and message row is ${run.rowHeight}px, not the node's 42`);
    }
    if (run.radius !== 10) throw new Error(`the block radius is ${run.radius}px, not radius/card`);
    if (run.padding !== '16px 16px 16px 16px') throw new Error(`the padding is ${run.padding}`);
    if (!onDangerRamp(run.fill) || !near(run.fill.a, 0.0588)) {
      throw new Error('the card fill is not the node\'s 5.88% danger tint');
    }
    if (!onDangerRamp(run.line) || !near(run.line.a, 0.32)) {
      throw new Error('the card border is not the node\'s 32% danger line');
    }
    if (run.titleFont !== '14px 22px 400') throw new Error(`the title type is ${run.titleFont}`);
    if (run.textFont !== '12px 16px') throw new Error(`the caption type is ${run.textFont}`);
    if (run.actionHeight !== 28) throw new Error(`the action is ${run.actionHeight}px tall`);
    if (run.actionPadding !== '12px 12px') throw new Error(`the action padding is ${run.actionPadding}`);
    if (run.actionRadius !== 8) throw new Error(`the action radius is ${run.actionRadius}px, not radius/row`);
    if (run.failedAfter <= run.failedBefore) throw new Error('Retry did not ask for the reply again');
    if (run.composerState !== 'ready') throw new Error('Retry left the composer locked');
    return `${run.width}px wide on the composer's centre line, node geometry intact at ${run.radius}px radius, Retry re-asked for the reply`;
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
  // than through a view, because the compact action it belongs to (a section's
  // "Add task") is its own card. The numbers still come from the stylesheet in
  // force, not from a copy of them here.
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
    const borderToken = (name) => {
      probe.style.borderTopColor = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopColor;
    };
    const radiusToken = (name) => {
      probe.style.borderTopLeftRadius = 'var(' + name + ')';
      return getComputedStyle(probe).borderTopLeftRadius;
    };
    // A 1 px outline does not read back as "1px" on a scaled display, so the
    // expected weight is measured from a 1 px reference under the same conditions
    // rather than written down here.
    const onePixelBorder = () => {
      probe.style.border = '1px solid transparent';
      return getComputedStyle(probe).borderTopWidth;
    };

    // The node is 79 px wide because its "Add task" label is 55 px between 12 px
    // of padding, so the check reads the label and confirms the button hugs it.
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
      surface: colourToken('--zuri-surface'),
      text: colourToken('--zuri-text-primary'),
      hairline: borderToken('--zuri-border-hairline'),
      rowRadius: radiusToken('--zuri-radius-row'),
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

  report.check('the Button / Small matches node 0:16', () => {
    const problems = [];

    for (const [theme, run] of [['dark', smallRun.dark], ['light', smallRun.light]]) {
      const { box, tokens } = run;
      if (box.height !== 28) {
        problems.push(`${theme}: the box is ${box.height} px tall, the node is 28`);
      }
      if (box.padding !== '12px 12px') {
        problems.push(`${theme}: side padding is ${box.padding}, the node keeps 12 px each side`);
      }
      // The 1 px outline sits inside the box with border-box sizing, so the
      // button is the label plus 12 px of padding and that outline on each side.
      if (box.width !== box.labelWidth + 26) {
        problems.push(`${theme}: the button is ${box.width} px wide for a ${box.labelWidth} px label, the node adds 12 px of padding and a 1 px outline each side`);
      }
      if (box.radius !== tokens.rowRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/row (${tokens.rowRadius})`);
      }
      if (box.background !== tokens.surface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/background (${tokens.surface})`);
      }
      if (box.color !== tokens.text) {
        problems.push(`${theme}: the label is ${box.color}, the node binds color/text (${tokens.text})`);
      }
      if (box.fontSize !== '13px' || box.fontWeight !== '400') {
        problems.push(`${theme}: the label is ${box.fontSize} at weight ${box.fontWeight}, the node sets 13 px regular`);
      }
      if (box.borderWidth !== tokens.onePx || box.borderColour !== tokens.hairline) {
        problems.push(`${theme}: the outline is ${box.borderWidth} ${box.borderColour}, the node draws 1 px color/border (${tokens.hairline})`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = smallRun.dark;
    return `${box.width}x${box.height} button around a ${box.labelWidth} px label, ${box.padding} padding, radius ${box.radius}, surface fill, 1 px hairline outline and primary 13 px label in both themes`;
  });

  // Card / Default (design node 0:54). Built as markup on the live page rather
  // than through a view, because the views that will hold cards (the context
  // panel's active work, a chat summary) are their own cards. The numbers still
  // come from the stylesheet in force, not from a copy of them here.
  const cardRun = await window.webContents.executeJavaScript(`(async () => {
    const card = document.createElement('article');
    card.className = 'card';
    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = 'Q4 summary';
    const text = document.createElement('p');
    text.className = 'card-text';
    text.textContent = 'Drafted from the open Excel workbook and saved to Documents.';
    const meta = document.createElement('p');
    meta.className = 'card-meta';
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

    // The node's 132 px height is its sample copy (a 24 px title, a 44 px two-line
    // body, a 16 px meta line, three 8 px gaps and 32 px of padding), so the check
    // reads the rhythm and the 288 px measure instead of a height that any other
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
      surface: colourToken('--zuri-surface'),
      text: colourToken('--zuri-text-primary'),
      muted: colourToken('--zuri-text-muted'),
      hairline: borderToken('--zuri-border-hairline'),
      cardRadius: radiusToken('--zuri-radius-card'),
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

  report.check('the Card / Default matches node 0:54', () => {
    const problems = [];

    for (const [theme, run] of [['dark', cardRun.dark], ['light', cardRun.light]]) {
      const { box, tokens } = run;
      // A CSS outline is a border, so it adds its own width to the 16 px padding
      // inset. The node's stroke sits inside its frame instead, which leaves the
      // same 1 px difference the Button / Small card already accepts; measuring the
      // reference border keeps that difference sub-pixel at a scaled display.
      const outline = parseFloat(tokens.onePx);
      const inset = Math.round(16 + outline);
      const measure = Math.round(320 - 32 - 2 * outline);
      if (box.width !== 320) {
        problems.push(`${theme}: the card is ${box.width} px wide, the node is 320`);
      }
      if (box.padding !== '16px 16px 16px 16px') {
        problems.push(`${theme}: the padding is ${box.padding}, the node keeps 16 px on every side`);
      }
      if (box.titleInset !== inset || box.bottomInset !== inset) {
        problems.push(`${theme}: the text sits ${box.titleInset} px from the top and ${box.bottomInset} px from the bottom, the node pads 16 px inside a ${outline} px outline`);
      }
      if (box.titleGap !== 8 || box.metaGap !== 8) {
        problems.push(`${theme}: the gaps between title, body and meta are ${box.titleGap} px and ${box.metaGap} px, the node uses 8 px`);
      }
      if (box.measure !== measure) {
        problems.push(`${theme}: the body wraps in ${box.measure} px, the node's 16 px padding inside its outline leaves ${measure}`);
      }
      if (box.radius !== tokens.cardRadius) {
        problems.push(`${theme}: the corner is ${box.radius}, the node binds radius/card (${tokens.cardRadius})`);
      }
      if (box.background !== tokens.surface) {
        problems.push(`${theme}: the fill is ${box.background}, the node binds color/surface (${tokens.surface})`);
      }
      if (box.borderWidth !== tokens.onePx || box.borderColour !== tokens.hairline) {
        problems.push(`${theme}: the outline is ${box.borderWidth} ${box.borderColour}, the node draws 1 px color/border (${tokens.hairline})`);
      }
      if (box.shadow !== 'none') {
        problems.push(`${theme}: the card draws ${box.shadow}, the node has no shadow`);
      }
      if (box.title.fontSize !== '16px' || box.title.lineHeight !== '24px' || box.title.fontWeight !== '500') {
        problems.push(`${theme}: the title is ${box.title.fontSize} on ${box.title.lineHeight} at weight ${box.title.fontWeight}, the node sets 16/24 medium`);
      }
      if (box.title.color !== tokens.text) {
        problems.push(`${theme}: the title is ${box.title.color}, the node binds color/text (${tokens.text})`);
      }
      if (box.text.fontSize !== '14px' || box.text.lineHeight !== '22px' || box.text.fontWeight !== '400') {
        problems.push(`${theme}: the body is ${box.text.fontSize} on ${box.text.lineHeight} at weight ${box.text.fontWeight}, the node sets 14/22 regular`);
      }
      if (box.text.color !== tokens.text) {
        problems.push(`${theme}: the body is ${box.text.color}, the node binds color/text (${tokens.text})`);
      }
      if (box.meta.fontSize !== '12px' || box.meta.lineHeight !== '16px' || box.meta.fontWeight !== '400') {
        problems.push(`${theme}: the meta line is ${box.meta.fontSize} on ${box.meta.lineHeight} at weight ${box.meta.fontWeight}, the node sets 12/16 regular`);
      }
      if (box.meta.color !== tokens.muted) {
        problems.push(`${theme}: the meta line is ${box.meta.color}, the node binds color/text-muted (${tokens.muted})`);
      }
    }

    if (problems.length > 0) throw new Error(problems.join('; '));

    const { box } = cardRun.dark;
    return `${box.width} px card, ${box.padding} padding on an 8 px rhythm over a ${box.measure} px measure, radius ${box.radius}, surface fill, 1 px hairline outline, 16/24 title, 14/22 body and 12/16 muted meta in both themes`;
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
    title.className = 'card-title';
    title.textContent = 'Provider connected';
    const text = document.createElement('p');
    text.className = 'card-text';
    text.textContent = 'Anthropic - claude-sonnet-4 - keys stored in Windows Credential Manager.';
    const meta = document.createElement('p');
    meta.className = 'card-meta';
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
    if (dotsRun.textPadding !== '0px 0px 0px 0px') {
      throw new Error(`the bubble keeps ${dotsRun.textPadding} of padding around the dots`);
    }
    if (dotsRun.textBackground !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`the bubble keeps its ${dotsRun.textBackground} background behind the dots`);
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
      tones: { canvas: toneOf('--zuri-bg-canvas'), panel: toneOf('--zuri-surface-secondary'), surface: toneOf('--zuri-surface') },
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

    // Sidebar 260 at 0 (full height), Centre 856 at 272, Context 300 at 1140.
    const expected = { sidebar: { x: 0, width: 260 }, chat: { x: 272, width: 856 }, 'context-panel': { x: 1140, width: 300 } };
    for (const [id, want] of Object.entries(expected)) {
      const measured = column(id);
      near(measured.x, want.x, `#${id} left edge`);
      near(measured.width, want.width, `#${id} width`);
    }
    // The bar spans the window, so the sidebar and the content row start under it.
    near(column('sidebar').height, 844, 'the sidebar height');
    near(column('chat').height, 844, 'the centre height');
    near(column('context-panel').height, 844, 'the context panel height');

    // The frame's tone separation: the sidebar and the context panel sit on the panel
    // tone, the centre on the reading surface. Getting these the wrong way round
    // inverts the whole shell.
    if (column('sidebar').fill !== shellMatch.tones.panel) throw new Error('the sidebar is not on the panel tone');
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
    const previous = { state: transcript.dataset.state, hero: hero.hidden };

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
        card: token('--zuri-transcript-card'),
        bar: token('--zuri-transcript-skeleton'),
        failed: token('--zuri-transcript-failed-soft'),
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

    result.turns = turns.map((turn) => {
      const stack = turn.querySelector('.message-stack');
      const meta = turn.querySelector('.message-meta');
      const avatar = turn.querySelector('.message-avatar');
      const entry = {
        role: turn.dataset.role,
        mode: turn.dataset.mode,
        box: rel(turn, transcript),
        stack: { ...rel(stack, turn), cap: px(stack, 'maxWidth') },
        meta: { ...rel(meta, turn), gap: px(meta, 'columnGap') },
        avatar: avatar ? { ...rel(avatar, turn), corner: corner(avatar), paint: paint(avatar) } : null,
        texts: Array.from(stack.querySelectorAll(':scope > .message-text')).map((text) => ({
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
    return result;
  })()`);

  report.check('the Conversation transcript page is drawn from node 0:1221', () => {
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
    // frame leaves: 1440 - 260 sidebar - 12 rail - 300 context - 12 rail = 856. The
    // transcript node (0:1221) was drawn in the older 860 column, so its inner
    // numbers below are expressed against the measured width rather than pinned to
    // that frame's arithmetic.
    const centre = 1440 - 260 - 12 - 300 - 12;
    near(transcriptMatch.column.width, centre, 'the chat column width');
    near(transcriptMatch.transcript.width, centre, 'the transcript width');
    near(transcriptMatch.header.height, 48, 'the transcript header height');
    near(transcriptMatch.title.x, 24, 'the thread title inset');
    near(transcriptMatch.inset.side, 64, 'the transcript side inset');
    near(transcriptMatch.inset.top, 20, 'the transcript top inset');
    // The turns span the column inside its 64 px insets.
    const turnWidth = centre - 2 * 64;

    // The composer under it: the node's 60 px pill inset 40 each side, and the hint
    // on the same inset.
    near(transcriptMatch.composer.width, centre - 2 * 40, 'the composer width');
    near(transcriptMatch.composer.height, 60, 'the composer height');
    near(transcriptMatch.hint.x - transcriptMatch.column.x, 40, 'the composer hint inset');

    // 0:1222: four turns on the column, 24 apart, the first 20 down.
    same(transcriptMatch.turns.length, 4, 'the number of turns');
    const [ask, reply, act, streaming] = transcriptMatch.turns;
    for (const turn of transcriptMatch.turns) {
      near(turn.box.width, turnWidth, 'a turn width');
      near(turn.box.x, 64, 'a turn inset');
    }
    near(ask.box.y, 20, 'the first turn top');
    for (let index = 1; index < transcriptMatch.turns.length; index += 1) {
      near(
        transcriptMatch.turns[index].box.y - transcriptMatch.turns[index - 1].box.bottom,
        24,
        `the gap above turn ${index + 1}`,
      );
    }

    // A reader's turn: a 420 px stack against the right edge, its 24 px meta row
    // above a radius/card bubble on the node's 12 px inset.
    same(ask.role, 'user', 'turn 1 role');
    same(ask.mode, 'ask', 'turn 1 mode');
    near(ask.stack.cap, 460, 'the reader stack cap');
    if (ask.stack.width > 460) throw new Error(`the reader stack is ${ask.stack.width} wide, the node draws it within 460`);
    near(ask.stack.right, turnWidth, 'the reader stack right edge');
    near(ask.meta.height, 24, 'the reader meta row height');
    near(ask.meta.right, turnWidth, 'the reader meta row right edge');
    near(ask.meta.gap, 8, 'the reader meta row gap');
    same(ask.texts.length, 1, 'the reader bubble count');
    near(ask.texts[0].cap, 460, 'the reader bubble cap');
    if (ask.texts[0].width > 460) throw new Error(`the reader bubble is ${ask.texts[0].width} wide, the node draws it within 460`);
    near(ask.texts[0].right, turnWidth, 'the reader bubble right edge');
    near(ask.texts[0].corner, 10, 'the reader bubble radius');
    near(ask.texts[0].inset, 12, 'the reader bubble inset');
    reads(ask.texts[0].font, '14/22', 'the reader bubble type');

    // Zuri's turn: a 24 px mark, its stack 32 in, the 20 px meta row, and the two
    // paragraphs the node draws as separate blocks 8 apart.
    same(reply.role, 'assistant', 'turn 2 role');
    near(reply.avatar.width, 24, 'the Zuri mark width');
    near(reply.avatar.height, 24, 'the Zuri mark height');
    near(reply.avatar.corner, 9999, 'the Zuri mark radius token');
    near(halfPill(reply.avatar.corner, reply.avatar.height), 12, 'the Zuri mark radius');
    paintIs(reply.avatar.paint, transcriptMatch.fills.readerBubble, 'the Zuri mark fill');
    near(reply.stack.x, 32, 'the Zuri stack inset');
    near(reply.stack.width, turnWidth - 32, 'the Zuri stack width');
    near(reply.meta.height, 20, 'the Zuri meta row height');
    same(reply.texts.length, 2, 'the paragraph count');
    for (const paragraph of reply.texts) {
      near(paragraph.width, 620, 'a paragraph width');
      reads(paragraph.font, '14/22', 'a paragraph type');
    }
    near(reply.texts[1].y - reply.texts[0].bottom, 8, 'the gap between paragraphs');

    // An Act turn: the wider 460 px stack, its bubble, and the 28 px file chip.
    same(act.role, 'user', 'turn 3 role');
    same(act.mode, 'act', 'turn 3 mode');
    near(act.stack.cap, 460, 'the Act stack cap');
    near(act.stack.right, turnWidth, 'the Act stack right edge');
    near(act.texts[0].right, turnWidth, 'the Act bubble right edge');
    near(act.chip.height, 28, 'the attachment chip height');
    near(halfPill(act.chip.corner, act.chip.height), 14, 'the attachment chip radius');
    near(act.chip.stroke, 1, 'the attachment chip stroke');
    near(act.chip.right, turnWidth, 'the attachment chip right edge');

    // The streaming reply: the tool card, then the 16 px row under it.
    same(streaming.role, 'assistant', 'turn 4 role');
    near(streaming.tool.width, 620, 'the tool card width');
    near(streaming.tool.corner, 10, 'the tool card radius');
    paintIs(streaming.tool.paint, transcriptMatch.fills.card, 'the tool card fill');
    near(streaming.streaming.height, 16, 'the streaming row height');
    near(streaming.streaming.gap, 8, 'the streaming row gap');
    near(streaming.streaming.caret.width, 2, 'the streaming caret width');
    near(streaming.streaming.caret.height, 16, 'the streaming caret height');
    same(streaming.streaming.dots.length, 3, 'the streaming dot count');
    for (const dot of streaming.streaming.dots) {
      near(dot.width, 4, 'a streaming dot width');
      near(dot.height, 4, 'a streaming dot height');
    }
    near(streaming.streaming.dots[1].x - streaming.streaming.dots[0].x, 8, 'the streaming dot pitch');
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

    return '860 px column: header 48, 732 px turns 24 apart, empty hero 520, error card 620, loading bars 12/14';
  });

  window.setContentSize(originalContent[0], originalContent[1]);

  // The onboarding page's acceptance is the same sentence as the shell's: it matches
  // the node it was drawn from. Node 0:1008 is a 1440x900 window with a 620 x 756 card
  // at (410, 84); its three frames are that one card in three states (0:1009 empty,
  // 0:1079 saving, 0:1151 rejected key), so measure each through data-state rather than
  // reading the stylesheet back to itself.
  const onboardingWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
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
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const style = (element) => getComputedStyle(element);
    const radius = (element) => parseFloat(style(element).borderRadius);
    const text = (selector) => document.querySelector(selector).textContent.replace(/\\s+/g, ' ').trim();
    const paint = (property) => {
      const probe = document.createElement('div');
      probe.style.color = 'var(' + property + ')';
      document.body.appendChild(probe);
      const colour = style(probe).color;
      probe.remove();
      return colour;
    };

    const card = document.getElementById('onboarding-card');
    const button = document.getElementById('onboarding-save');
    const saveLabel = document.getElementById('onboarding-save-label');
    const title = document.querySelector('.onboarding-title');
    const subtitle = document.querySelector('.onboarding-subtitle');
    const control = document.querySelector('.field-control');
    const help = document.getElementById('onboarding-key-help');
    const privacy = document.querySelector('.privacy-note');
    const select = document.querySelector('.field-select-control');

    const run = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      state: card.dataset.state,
      titlebar: box(document.querySelector('.onboarding-titlebar')),
      card: { ...box(card), radius: radius(card) },
      title: {
        ...box(title),
        fontSize: parseFloat(style(title).fontSize),
        color: style(title).color,
      },
      subtitle: { ...box(subtitle), color: style(subtitle).color },
      providerLabel: box(document.querySelector('.onboarding-providers-label')),
      rows: Array.from(document.querySelectorAll('.provider-row')).map((row) => ({ ...box(row), radius: radius(row) })),
      selected: box(document.querySelector('.provider-row:has(.provider-input:checked)')),
      keyField: box(document.querySelector('.onboarding-field-key')),
      keyControl: { ...box(control), radius: radius(control) },
      keyHelp: box(help),
      modelField: box(document.querySelector('.onboarding-field-model')),
      modelSelect: { ...box(select), radius: radius(select) },
      privacy: { ...box(privacy), radius: radius(privacy) },
      save: { ...box(button), radius: radius(button) },
      skip: box(document.querySelector('.skip-note')),
      copy: {
        title: title.textContent.trim(),
        subtitle: text('.onboarding-subtitle'),
        providerLabel: text('.onboarding-providers-label'),
        keyLabel: text('#onboarding-key-label'),
        docs: text('#onboarding-docs'),
        help: text('#onboarding-key-help'),
        modelLabel: text('label[for="onboarding-model"]'),
        privacy: text('.privacy-text'),
        save: text('#onboarding-save-label'),
        skip: text('.skip-note'),
        rows: Array.from(document.querySelectorAll('.provider-row')).map((row) =>
          row.textContent.replace(/\\s+/g, ' ').trim(),
        ),
      },
      tones: {
        text: paint('--zuri-onboarding-text'),
        secondary: paint('--zuri-onboarding-text-secondary'),
        muted: paint('--zuri-onboarding-text-muted'),
        accent: paint('--zuri-onboarding-accent'),
        surface: paint('--zuri-onboarding-surface'),
        fill: paint('--zuri-onboarding-fill'),
        danger: paint('--zuri-onboarding-danger'),
      },
    };

    // 0:1009: Save is disabled and grey until something is typed.
    run.empty = { fill: style(button).backgroundColor, label: style(saveLabel).color };

    // 0:1079: the button keeps the accent, the list and the model fade to half.
    card.dataset.state = 'loading';
    button.disabled = true;
    run.saving = {
      fill: style(button).backgroundColor,
      label: style(saveLabel).color,
      providers: style(document.getElementById('onboarding-providers')).opacity,
      model: style(document.querySelector('.onboarding-field-model')).opacity,
      spinner: style(document.querySelector('.save-spinner')).display,
    };

    // 0:1151: the field outline and the help line turn red with main's reason.
    card.dataset.state = 'error';
    run.error = { border: style(control).borderColor, help: style(help).color };

    card.dataset.state = 'empty';
    return run;
  })()`);

  report.check('the First-run welcome page is drawn from node 0:1008', () => {
    const near = (value, expected, label) => {
      if (Math.abs(value - expected) > 0.6) throw new Error(`${label} is ${value}, the node draws ${expected}`);
    };
    const run = onboardingMatch;

    near(run.viewport.width, 1440, 'the measured viewport width');
    near(run.viewport.height, 900, 'the measured viewport height');
    if (run.state !== 'empty') throw new Error(`the card opens in "${run.state}", node 0:1009 is the empty one`);

    // 0:1009: a 48 px title bar over the 620 x 756 card at (410, 84), radius/card 12.
    near(run.titlebar.height, 48, 'the title bar height');
    near(run.card.x, 410, 'the card left edge');
    near(run.card.y, 84, 'the card top');
    near(run.card.width, 620, 'the card width');
    near(run.card.height, 756, 'the card height');
    near(run.card.radius, 12, 'the card radius');

    // Welcome copy: the 28 px title on its 36 px line, the 14/22 subtitle 8 below it.
    near(run.title.y, 112, 'the title top');
    near(run.title.height, 36, 'the title line');
    near(run.title.fontSize, 28, 'the title size');
    near(run.subtitle.y, 156, 'the subtitle top');
    near(run.subtitle.height, 44, 'the two-line subtitle');
    if (run.title.color !== run.tones.text) throw new Error('the title is not on colour/text');
    if (run.subtitle.color !== run.tones.secondary) throw new Error('the subtitle is not on colour/text-secondary');

    // Provider list: 18 px label at 212, four 52 px rows from 238 on a 60 px pitch,
    // each with radius/card 10 and the chosen one 556 wide from the card's 32 inset.
    near(run.providerLabel.y, 212, 'the provider label top');
    if (run.rows.length !== 4) throw new Error(`the page draws ${run.rows.length} provider rows, the node has 4`);
    const tops = run.rows.map((row) => row.y).join(',');
    if (tops !== '238,298,358,418') throw new Error(`the rows start at ${tops}, the node draws 238,298,358,418`);
    for (const row of run.rows) {
      near(row.height, 52, 'a provider row height');
      near(row.radius, 10, 'a provider row radius');
    }
    near(run.selected.x, 442, 'the chosen row left edge');
    near(run.selected.width, 556, 'the chosen row width');
    near(run.selected.y, 238, 'the chosen row top');

    // Credential form: the 98 px key block at 482 with its 48 px field at 508 and the
    // 12/16 help line at 564; the 68 px model block at 592 with its 42 px select at
    // 618; the 56 px privacy note at 672; the 44 px save at 740; the skip note at 796.
    near(run.keyField.y, 482, 'the key block top');
    near(run.keyField.height, 98, 'the key block height');
    near(run.keyControl.y, 508, 'the API-key field top');
    near(run.keyControl.height, 48, 'the API-key field height');
    near(run.keyControl.radius, 8, 'the API-key field radius');
    near(run.keyHelp.y, 564, 'the help line top');
    near(run.keyHelp.height, 16, 'the help line height');
    near(run.modelField.y, 592, 'the model block top');
    near(run.modelField.height, 68, 'the model block height');
    near(run.modelSelect.y, 618, 'the model select top');
    near(run.modelSelect.height, 42, 'the model select height');
    near(run.modelSelect.radius, 8, 'the model select radius');
    near(run.privacy.y, 672, 'the privacy note top');
    near(run.privacy.height, 56, 'the privacy note height');
    near(run.privacy.radius, 8, 'the privacy note radius');
    near(run.save.y, 740, 'the save button top');
    near(run.save.height, 44, 'the save button height');
    near(run.save.radius, 8, 'the save button radius');
    near(run.skip.y, 796, 'the skip note top');
    near(run.skip.height, 16, 'the skip note height');

    // The node's sentences, as the page actually renders them.
    const written = [
      ['the title', run.copy.title, 'Welcome to Zuri'],
      ['the subtitle', run.copy.subtitle, 'Connect a provider to begin. Your key stays with the main process \u2014 never in this window, never sent to a Zuri server.'],
      ['the provider label', run.copy.providerLabel, 'Provider'],
      ['the key label', run.copy.keyLabel, 'Anthropic API key'],
      ['the docs link', run.copy.docs, 'Where do I find it?'],
      ['the entry help line', run.copy.help, 'Paste a key to continue. Zuri checks it with one test call before saving.'],
      ['the model label', run.copy.modelLabel, 'Default model'],
      ['the privacy note', run.copy.privacy, 'Stored encrypted in Windows Credential Manager by the main process. Nothing is sent to a Zuri server.'],
      ['the save label', run.copy.save, 'Save key'],
      ['the skip note', run.copy.skip, 'You can change providers later in Settings.'],
      ['the Anthropic row', run.copy.rows[0], 'Anthropic claude-sonnet-4 \u00b7 recommended'],
      ['the OpenAI row', run.copy.rows[1], 'OpenAI gpt-4o mini \u00b7 fastest'],
      ['the Google row', run.copy.rows[2], 'Google gemini-2.5-flash \u00b7 long context'],
      ['the Local row', run.copy.rows[3], 'Local (Ollama) no key needed \u00b7 runs on this PC'],
    ];
    for (const [part, drawn, node] of written) {
      if (drawn !== node) throw new Error(`the page draws the ${part} as "${drawn}", the node reads "${node}"`);
    }

    // The three frames are the same card in three states, each drawn in its own colours.
    if (run.empty.fill !== run.tones.fill) throw new Error('the resting Save button is not on the fill tone');
    if (run.empty.label !== run.tones.muted) throw new Error('the resting Save label is not on the muted tone');
    if (run.saving.fill !== run.tones.accent) throw new Error('the saving Save button is not on the accent tone');
    if (run.saving.label !== run.tones.surface) throw new Error('the saving Save label is not on the surface tone');
    if (run.saving.spinner !== 'block') throw new Error('the saving state draws no spinner');
    if (run.saving.providers !== '0.5') throw new Error('the saving state does not fade the provider list');
    if (run.saving.model !== '0.5') throw new Error('the saving state does not fade the model field');
    if (run.error.border !== run.tones.danger) throw new Error('the rejected field outline is not on the danger tone');
    if (run.error.help !== run.tones.danger) throw new Error('the rejected help line is not on the danger tone');

    return `1440x900: 620x756 card at 410,84, four 52 px rows on a 60 px pitch, 48/42 px fields, empty, saving and rejected states as drawn`;
  });

  checkDropdowns('the setup theme and model fields', await measureDropdowns(onboardingWindow));

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
