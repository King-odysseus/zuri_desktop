/**
 * Selftest: node-only checks for the scaffolding and the JSON store.
 * Areas whose modules do not exist yet report SKIP, so the script is honest about
 * coverage instead of passing silently. Run via `npm run selftest`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../src/main/store.js';
import * as secrets from '../src/main/secrets.js';
import * as chat from '../src/main/providers/chat.js';
import * as tools from '../src/main/tools/index.js';
import * as scheduler from '../src/main/scheduler.js';
import * as secondLaunch from '../src/main/second-launch.js';
import * as trayMenu from '../src/main/tray-menu.js';
import { registerInternalOnlyCanvasCheck } from './internal-only-canvas.check.js';
import { registerSearchResultsPanelCheck } from './search-results-panel.check.js';
import { registerAskModeReplyCheck } from './ask-mode-reply.check.js';
import { registerPageInventoryCheck } from './page-inventory.check.js';
import { registerErrorStateCheck } from './error-state.check.js';
import { registerNotFoundCheck } from './not-found.check.js';
import { registerZzProbeCheck } from './zz-probe.check.js';
import { registerChatWorkspaceCheck } from './chat-workspace.check.js';
import { registerFloatingOverlayCheck } from './floating-overlay.check.js';
import { registerExcludedScreensCheck } from './excluded-screens.check.js';
import { registerCaughtUpToastCheck } from './caught-up-toast.check.js';
import { registerActModeProposalCheck } from './act-mode-proposal.check.js';
import { registerButtonSolidPrimarySmCheck } from './button-solid-primary-sm.check.js';
import { registerCardFileCheck } from './card-file.check.js';
import { registerProvidersCheck } from './providers.check.js';
import { registerSettingsAppearanceCheck } from './settings-appearance.check.js';
import { registerComposerPromptCheck } from './composer-prompt.check.js';
import { registerInputSearchCheck } from './input-search.check.js';
import { registerInputSelectCheck } from './input-select.check.js';
import { registerInputTextFieldCheck } from './input-text-field.check.js';
import { registerActionIconGroupCheck } from './action-icon-group.check.js';
import { registerToastSuccessCheck } from './toast-success.check.js';
import { registerControlRadioOnCheck } from './control-radio-on.check.js';
import { registerControlCheckboxOnCheck } from './control-checkbox-on.check.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

/** @param {string} name @param {() => string|void} run */
function check(name, run) {
  try {
    const detail = run();
    console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

/**
 * Async twin of check(): awaited in file order, so async areas report where they
 * appear in the script rather than after the summary.
 * @param {string} name @param {() => Promise<string|void>} run
 */
async function checkAsync(name, run) {
  try {
    const detail = await run();
    console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

/** @param {string} name @param {string} reason */
function skip(name, reason) {
  console.log(`SKIP ${name}: ${reason}`);
}

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const pkg = JSON.parse(read('package.json'));

check('package.json main points at src/main/main.js', () => {
  if (pkg.main !== 'src/main/main.js') throw new Error(`main is ${JSON.stringify(pkg.main)}`);
  return pkg.main;
});

check('package.json scripts start, smoke, selftest and firstrun exist', () => {
  const missing = ['start', 'smoke', 'selftest', 'firstrun'].filter((name) => !pkg.scripts?.[name]);
  if (missing.length > 0) throw new Error(`missing scripts: ${missing.join(', ')}`);
  return Object.keys(pkg.scripts).join(', ');
});

check('main process entry exists', () => {
  if (!exists(pkg.main)) throw new Error(`${pkg.main} not found`);
});

check('main window is created at 1200x800 with isolation on', () => {
  const source = read('src/main/main.js');
  const width = /width:\s*1200/.test(source);
  const height = /height:\s*800/.test(source);
  const isolation = /contextIsolation:\s*true/.test(source);
  const noNode = /nodeIntegration:\s*false/.test(source);
  const loadsEntry = /loadFile\(RENDERER_ENTRY\)/.test(source);
  const broken = [width || 'width', height || 'height', isolation || 'contextIsolation', noNode || 'nodeIntegration', loadsEntry || 'loadFile'].filter((value) => value !== true);
  if (broken.length > 0) throw new Error(`missing: ${broken.join(', ')}`);
});

check('renderer entry, token layer and app module exist', () => {
  const required = ['src/renderer/index.html', 'src/renderer/styles/tokens.css', 'src/renderer/app.js'];
  const missing = required.filter((file) => !exists(file));
  if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);
  return required.join(', ');
});

check('index.html renders the three-column shell', () => {
  const html = read('src/renderer/index.html');
  const required = [
    ['aside#sidebar', /<aside[^>]*\bid="sidebar"/i],
    ['main#chat', /<main[^>]*\bid="chat"/i],
    ['aside#context-panel', /<aside[^>]*\bid="context-panel"/i],
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(html)).map(([label]) => label);
  if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);

  // One toggle per collapsible column, pointed at the column it controls. #chat is
  // not one of them: as a rail it was clipped out of its own column and could not be
  // reopened, which is the dead end this card fixed.
  const withoutToggle = ['sidebar', 'context-panel'].filter(
    (name) => !html.includes(`aria-controls="${name}"`),
  );
  if (withoutToggle.length > 0) throw new Error(`no collapse toggle for ${withoutToggle.join(', ')}`);
  if (html.includes('aria-controls="chat"')) {
    throw new Error('#chat still offers a collapse toggle, and a collapsed chat cannot be reopened');
  }
  if (/<main[^>]*id="chat"[^>]*data-collapsed/i.test(html)) {
    throw new Error('#chat carries a collapsed state it has no control to leave');
  }

  return required.map(([label]) => label).join(', ');
});

check('every page that draws a dropdown links the sheet and enhances the control', () => {
  // A native <select> opens the Windows popup, which no stylesheet reaches. Any page
  // holding one therefore has to link styles/dropdown.css and hand the select to
  // ui/select.js; this walks every page so a new screen cannot quietly miss it.
  const pages = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.html')) pages.push(relative);
    }
  };
  walk('src/renderer');

  const withSelect = pages.filter((page) => /<select\b/i.test(read(page)));
  if (withSelect.length === 0) throw new Error('no page holds a <select>, so this check measures nothing');

  const problems = [];
  for (const page of withSelect) {
    const html = read(page);
    if (!html.includes('styles/dropdown.css')) problems.push(`${page} does not link styles/dropdown.css`);

    const script = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/i);
    if (!script) {
      problems.push(`${page} has no module script, so nothing enhances its select`);
      continue;
    }
    const module_ = path.posix.join(path.posix.dirname(page), script[1]);
    if (!exists(module_)) {
      problems.push(`${page} loads ${script[1]}, which does not exist`);
      continue;
    }
    const source = read(module_);
    if (!/from '\.\.\/ui\/select\.js'/.test(source)) problems.push(`${module_} does not import ui/select.js`);
    if (!/enhanceSelects?\(/.test(source)) problems.push(`${module_} never calls enhanceSelect`);
  }

  if (problems.length > 0) throw new Error(problems.join('; '));
  return `${withSelect.length} pages: ${withSelect.join(', ')}`;
});

check('a collapsed panel keeps a control wide enough to click', () => {
  const tokens = read('src/renderer/styles/tokens.css');
  const css = read('src/renderer/styles/components.css');

  // A collapsed panel is reachable only through its rail, so the rail is a tap
  // target, not decoration. At 12 px it was unusable even before the overflow
  // clipped it, and the panel starts collapsed under 1000 px, so the dead end was
  // the common case rather than an edge one.
  const railPrefix = '--zuri-rail-width:';
  const rails = [];
  for (let at = tokens.indexOf(railPrefix); at !== -1; at = tokens.indexOf(railPrefix, at + 1)) {
    rails.push(Number.parseInt(tokens.slice(at + railPrefix.length), 10));
  }
  if (rails.length !== 2) {
    throw new Error(`tokens.css declares --zuri-rail-width ${rails.length} times, not once per theme`);
  }
  if (rails.some((width) => !Number.isFinite(width) || width < 44)) {
    throw new Error(`the collapsed rail is ${Math.min(...rails)}px, under the 44 px tap target`);
  }

  const ruleBody = (selector) => {
    const at = css.indexOf(selector + ' {');
    if (at === -1) return null;
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The toggle fills the rail and STATES that height: width/height 100% resolved
  // against an auto-height header and left the control at its icon size, which is
  // what made it unclickable once the column clipped it.
  const toggle = ruleBody(".shell-column-context[data-collapsed='true'] .shell-toggle");
  if (toggle === null) throw new Error('components.css has no collapsed-rail toggle rule');
  if (!toggle.includes('width: 100%')) throw new Error('the rail toggle does not fill the rail');
  if (!toggle.includes('height: var(--zuri-rail-width)')) {
    throw new Error('the rail toggle does not state the rail height, so it falls back to its icon size');
  }

  // The header's 12 px side margin would eat a 44 px column and leave the toggle
  // no width to sit in, which is the other half of why it was clipped away.
  const header = ruleBody(".shell-column-context[data-collapsed='true'] .context-header");
  if (header === null) throw new Error('components.css has no collapsed-rail header rule');
  if (!header.includes('margin: 0')) {
    throw new Error('the collapsed header keeps its side margin, which leaves the toggle no width');
  }

  return `rail ${rails[0]}px, toggle fills it at the rail height`;
});

check('ui/shell.js owns the collapse state and the 1000px breakpoint', () => {
  const source = read('src/renderer/ui/shell.js');
  if (!/export function setColumnCollapsed/.test(source)) {
    throw new Error('shell.js does not export setColumnCollapsed');
  }
  if (!/CONTEXT_PANEL_BREAKPOINT\s*=\s*1000/.test(source)) {
    throw new Error('shell.js does not keep the context panel breakpoint at 1000px');
  }
  // A resize listener is allowed only when it re-applies the defaults once, on
  // crossing a breakpoint: inside one band the user's collapse choice has to stand.
  if (/addEventListener\('resize'/.test(source)) {
    const guarded =
      /const next = bandFor\(viewport\.innerWidth\)/.test(source) &&
      /if \(next === band\) return;/.test(source);
    if (!guarded) {
      throw new Error('shell.js listens for resize without waiting for a band change, so a resize would overwrite the user\'s choice');
    }
  }
});

check('the Loading Dots block is drawn as the design draws a waiting reply', () => {
  const css = read('src/renderer/styles/components.css');
  const source = read('src/renderer/ui/composer.js');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:117 draws a 20 x 22 box on the surface fill holding three 4 px dots on
  // the node's 8 px pitch: a 4 px dot plus the 4 px step between them, centred in
  // the box so the row lands on the node's 9 px top offset.
  const block = ruleBody('.loading-dots');
  const blockChecks = [
    ['the 22 px box height', /height:\s*22px/],
    ['the 20 px box width', /width:\s*20px/],
    ["the 4 px step that makes the node's 8 px pitch", /gap:\s*var\(--zuri-space-1\)/],
    ['the centring of the dots in that box', /align-items:\s*center/],
    ['the color/surface fill the node draws behind them', /background:\s*var\(--zuri-surface\)/],
  ];
  const blockMissing = blockChecks.filter(([, pattern]) => !pattern.test(block)).map(([label]) => label);
  if (blockMissing.length > 0) throw new Error(`the block is missing ${blockMissing.join(', ')}`);

  const dot = ruleBody('.loading-dots-dot');
  const dotChecks = [
    ['a 4 px dot', /width:\s*4px/],
    ['a 4 px dot height', /height:\s*4px/],
    ['the pill radius', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/muted fill', /background:\s*var\(--zuri-text-muted\)/],
  ];
  const dotMissing = dotChecks.filter(([, pattern]) => !pattern.test(dot)).map(([label]) => label);
  if (dotMissing.length > 0) throw new Error(`the dot is missing ${dotMissing.join(', ')}`);

  // A waiting reply is the block alone: no bubble frame or padding around it.
  if (!/\.message\[data-state='streaming'\] \.message-text:has\(\.loading-dots\)/.test(css)) {
    throw new Error('nothing drops the bubble frame while the block is standing in for the reply');
  }

  if (!/export function createLoadingDots/.test(source)) {
    throw new Error('composer.js does not export createLoadingDots');
  }
  if (!/const dots = createLoadingDots\(\);/.test(source)) {
    throw new Error('the reply turn never builds the block');
  }
  if (!/dots\.remove\(\);/.test(source)) {
    throw new Error('nothing removes the block, so it would outlive the reply');
  }

  return '20x22 block, 4 px dots on an 8 px pitch in text-muted, shown until the first token';
});

check('the Loading Skeleton block is drawn from node 0:296 and holds the thread list', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const source = read('src/renderer/ui/skeleton.js');
  const chats = read('src/renderer/ui/chats.js');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 320 x 159 card on 20 px padding and a 12 px rhythm, filled
  // color/surface-secondary on its 20 px radius-xl.
  const block = ruleBody('.loading-skeleton');
  const blockChecks = [
    ['the 320 px node width', /max-width:\s*320px/],
    ['the 20 px node padding', /padding:\s*var\(--zuri-space-5\)/],
    ['the 12 px rhythm as the spacing token', /gap:\s*var\(--zuri-space-3\)/],
    ['the color/surface-secondary fill', /background:\s*var\(--zuri-surface-secondary\)/],
    ['the node radius-xl corner', /border-radius:\s*20px/],
  ];
  const blockMissing = blockChecks.filter(([, pattern]) => !pattern.test(block)).map(([label]) => label);
  if (blockMissing.length > 0) throw new Error(`the block is missing ${blockMissing.join(', ')}`);

  // The caption is the node's 13 px type in color/text-subtle.
  const caption = ruleBody('.loading-skeleton-caption');
  const captionChecks = [
    ['the 13 px caption type', /font-size:\s*13px/],
    ['the color/text-subtle ink', /color:\s*var\(--zuri-text-subtle\)/],
    ['the caption line box the node measures', /line-height:\s*15px/],
  ];
  const captionMissing = captionChecks.filter(([, pattern]) => !pattern.test(caption)).map(([label]) => label);
  if (captionMissing.length > 0) throw new Error(`the caption is missing ${captionMissing.join(', ')}`);

  // A row is the node's 40 px disc and two pills, 12 px apart.
  const row = ruleBody('.loading-skeleton-row');
  if (!/gap:\s*var\(--zuri-space-3\)/.test(row)) throw new Error('a row is not on the node\'s 12 px gap');
  const disc = ruleBody('.loading-skeleton-disc');
  const discChecks = [
    ['the 40 px disc', /width:\s*40px[\s\S]*height:\s*40px/],
    ['the radius-full disc', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/surface-tertiary fill', /background:\s*var\(--zuri-surface-tertiary\)/],
  ];
  const discMissing = discChecks.filter(([, pattern]) => !pattern.test(disc)).map(([label]) => label);
  if (discMissing.length > 0) throw new Error(`the disc is missing ${discMissing.join(', ')}`);

  // Each pill is 12 px tall on radius-full in color/surface-tertiary, the wide one
  // filling the lines frame and the narrow ones the node's 140 and 120.
  const bar = ruleBody('.loading-skeleton-bar');
  const barChecks = [
    ['the 12 px pill height', /height:\s*12px/],
    ['the radius-full corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/surface-tertiary fill', /background:\s*var\(--zuri-surface-tertiary\)/],
  ];
  const barMissing = barChecks.filter(([, pattern]) => !pattern.test(bar)).map(([label]) => label);
  if (barMissing.length > 0) throw new Error(`a pill is missing ${barMissing.join(', ')}`);

  const lines = ruleBody('.loading-skeleton-lines');
  if (!/gap:\s*var\(--zuri-space-2\)/.test(lines)) throw new Error('the two pills are not on the node\'s 8 px gap');
  if (!/width:\s*100%/.test(ruleBody('.loading-skeleton-bar--wide'))) {
    throw new Error('the wide pill does not fill the lines frame');
  }
  [140, 120].forEach((width) => {
    const rule = ruleBody(`.loading-skeleton-row[data-narrow='${width}'] .loading-skeleton-bar--narrow`);
    if (!new RegExp('width: *' + width + 'px').test(rule)) {
      throw new Error(`the ${width} px row is not drawn at the node's ${width} px`);
    }
  });

  // Both surface tones the node binds have to exist in each theme, or a theme
  // swap would leave the block half-styled.
  for (const token of ['--zuri-surface-secondary', '--zuri-surface-tertiary']) {
    const declared = tokens.match(new RegExp(`${token}\s*:`, 'g')) ?? [];
    if (declared.length !== 2) {
      throw new Error(`tokens.css declares ${token} ${declared.length} times, not once per theme`);
    }
  }

  if (!/export function createLoadingSkeleton/.test(source)) {
    throw new Error('skeleton.js does not export createLoadingSkeleton');
  }
  if (!/const ROW_NARROW_WIDTHS = \[140, 120\]/.test(source)) {
    throw new Error('the block does not draw the node\'s two rows, 140 and 120 wide');
  }
  if (!/textContent = 'Loading list'/.test(source)) {
    throw new Error('the block does not draw the node\'s caption');
  }
  // The thread list follows frame 05 of the sidebar page (node 0:1423): six rows
  // shaped like a thread row, not the 320 px card, which is wider than the panel
  // list and would overflow the sidebar it is meant to fill.
  const listSkeleton = read('src/renderer/ui/sidebarConversations.js');
  const listCss = read('src/renderer/styles/sidebar-conversations.css');
  if (!listSkeleton.includes('export function createThreadListSkeleton')) {
    throw new Error('sidebarConversations.js does not export createThreadListSkeleton');
  }
  if (!listSkeleton.includes('const SKELETON_ROWS = 6')) {
    throw new Error('the sidebar skeleton does not draw all six rows of frame 05');
  }
  if (!chats.includes('replaceChildren(createThreadListSkeleton(')) {
    throw new Error('the thread list never shows its own skeleton');
  }
  // The skeleton has to go up before the read is awaited, or the panel stays blank
  // until the data lands and the skeleton is never seen.
  const shownAt = chats.indexOf('showSidebarSkeleton();');
  const readAt = chats.indexOf('await call(() => api.list())');
  if (shownAt === -1 || readAt === -1 || shownAt > readAt) {
    throw new Error('the thread list does not show the skeleton while the read is in flight');
  }
  const listShape = [
    ['the 46 px row height', 'height: 46px'],
    ['the 22 px tile', 'width: 22px'],
    ['the 150 px title bar', 'width: 150px'],
    ['the 10 px title bar height', 'height: 10px'],
    ['the 64 px time bar', 'width: 64px'],
    ['the 8 px time bar height', 'height: 8px'],
    ['the color/surface-tertiary fill', 'var(--zuri-surface-tertiary)'],
  ];
  for (const [label, needle] of listShape) {
    if (!listCss.includes(needle)) throw new Error('the sidebar skeleton is missing ' + label);
  }
  return '320x159 card for the design block; the sidebar list shows its own six 46 px rows (frame 05, 0:1423) while chats load';
});

check('the Card / Default is drawn from its design node (Card / Base, 0:84)', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const missingFrom = (selector, checks) => {
    const body = ruleBody(selector);
    const missing = checks.filter(([, pattern]) => !pattern.test(body)).map(([label]) => label);
    if (missing.length > 0) throw new Error(`${selector} is missing ${missing.join(', ')}`);
    return body;
  };

  // The board's card names node 0:54, but that id now resolves to the search field's
  // placeholder text, so this follows the document's actual default card instead:
  // 320 px on a 20 px inset with a 12 px rhythm, filled color/surface-raised and
  // outlined 1 px color/border-subtle on radius/xl corners (20 px). Each value is the
  // token the node binds, so a change in the design moves the card with it.
  const card = missingFrom('.card', [
    ['the 320 px node width', /max-width:\s*320px/],
    ['the 20 px node inset', /padding:\s*var\(--zuri-space-5\)/],
    ['the 12 px rhythm as the spacing token', /gap:\s*var\(--zuri-space-3\)/],
    ['the color/surface-raised fill', /background:\s*var\(--zuri-surface-raised\)/],
    ['the color/border-subtle outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
    ['the radius/xl corner', /border-radius:\s*var\(--zuri-base-card-radius\)/],
  ]);

  // The node draws no shadow, so the 1 px outline is the whole edge.
  if (/box-shadow/.test(card)) throw new Error('the card draws a shadow the node does not have');

  // The node's 160 px frame is 4 px shorter than its own content, so it is a floor
  // rather than a height: a fixed height would clip the longer bodies the card holds.
  if (/(?:^|[\s;])height:/.test(card)) throw new Error('the card fixes the node\'s frame height');

  // Every design value has to come from the token layer, or a node change would
  // leave the card on the old colour or corner.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(card)) {
    throw new Error('the card rule holds a literal colour instead of a token');
  }

  // Header row: a 44 px badge a 12 px gap away from the two text lines.
  missingFrom('.card-header', [['the 12 px badge gap', /gap:\s*var\(--zuri-space-3\)/]]);
  missingFrom('.card-icon', [
    ['the 44 px badge width', /width:\s*44px/],
    ['the 44 px badge height', /height:\s*44px/],
    ['the radius/md badge corner', /border-radius:\s*var\(--zuri-base-card-icon-radius\)/],
    ['the color/surface-secondary badge fill', /background:\s*var\(--zuri-surface-secondary\)/],
    ['the color/text glyph colour', /color:\s*var\(--zuri-text-primary\)/],
  ]);

  // Title (0:90): 16/24 semibold on color/text. Meta (0:91): 13/20 on text-subtle.
  missingFrom('.card-heading', [
    ['the 16 px title size', /font-size:\s*var\(--zuri-font-size-heading-sm\)/],
    ['the 24 px title line height', /line-height:\s*var\(--zuri-line-height-heading-sm\)/],
    ['the semibold title weight', /font-weight:\s*var\(--zuri-font-weight-semibold\)/],
    ['the color/text title colour', /color:\s*var\(--zuri-text-primary\)/],
  ]);
  missingFrom('.card-subtitle', [
    ['the 13 px meta size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the 20 px meta line height', /line-height:\s*var\(--zuri-line-height-body-sm\)/],
    ['the regular meta weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/text-subtle meta colour', /color:\s*var\(--zuri-text-subtle\)/],
  ]);

  // Body (0:92): 14/22 on color/text-subtle, one step back from the title.
  missingFrom('.card-body', [
    ['the 14 px body size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the 22 px body line height', /line-height:\s*var\(--zuri-line-height-body-md\)/],
    ['the regular body weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/text-subtle body colour', /color:\s*var\(--zuri-text-subtle\)/],
  ]);

  // Footer row (0:93): the 24 px status pill (0:94) at the start, the 13/20 file
  // count (0:96) at the end.
  missingFrom('.card-footer', [['the 12 px footer gap', /gap:\s*var\(--zuri-space-3\)/]]);
  missingFrom('.card-status', [
    ['the 24 px pill height', /height:\s*24px/],
    ['the radius/full pill corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/success-soft pill fill', /background:\s*var\(--zuri-success-soft\)/],
    ['the color/success-soft-foreground label colour', /color:\s*var\(--zuri-success-soft-foreground\)/],
    ['the 11 px label-caps size', /font-size:\s*var\(--zuri-font-size-label-caps\)/],
    ['the 16 px label-caps line height', /line-height:\s*var\(--zuri-line-height-label-caps\)/],
    ['the label-caps tracking', /letter-spacing:\s*var\(--zuri-tracking-label-caps\)/],
    ['the semibold label weight', /font-weight:\s*var\(--zuri-font-weight-semibold\)/],
  ]);
  missingFrom('.card-count', [
    ['the 13 px count size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the 20 px count line height', /line-height:\s*var\(--zuri-line-height-body-sm\)/],
    ['the color/text-subtle count colour', /color:\s*var\(--zuri-text-subtle\)/],
  ]);

  // The two semantic colours the node binds have to exist in both themes, or a
  // theme swap would leave the pill on one theme's wash.
  const softWashes = [...tokens.matchAll(/--zuri-success-soft:\s*([^;]+);/g)].map((match) => match[1].trim());
  if (softWashes.length < 2) throw new Error('tokens.css does not declare the success wash in both themes');
  // Each theme carries its own wash, so a shared value would mean one block is
  // missing the token and falling back to the other theme's colour.
  if (new Set(softWashes).size !== softWashes.length) {
    throw new Error('the two theme blocks give the success wash the same value');
  }
  const softLabels = [...tokens.matchAll(/--zuri-success-soft-foreground:\s*([^;]+);/g)].map((match) => match[1].trim());
  if (softLabels.length < 2) throw new Error('tokens.css does not declare the success label colour in both themes');

  return '320 px card on a 20 px inset and a 12 px rhythm, radius 20, surface-raised fill, 1 px hairline outline, 44 px icon badge, 16/24 semibold title over a 13/20 meta, 14/22 subtle body, 24 px success pill and its 13/20 count';
});

check('the Card / Raised is drawn from node 0:58', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:58 repeats Card / Default's geometry - 320 px, 16 px padding, an 8 px
  // rhythm, a 1 px color/border outline on radius/card - and changes exactly two
  // things: the fill is color/raised instead of color/surface, and the card carries
  // a drop shadow. Each value is the token the node binds, so a change in the design
  // moves the card with it.
  const card = ruleBody('.card-raised');
  const cardChecks = [
    ['the 320 px node width', /max-width:\s*320px/],
    ['the 16 px node padding', /padding:\s*var\(--zuri-space-4\)/],
    ['the 8 px rhythm as the spacing token', /gap:\s*var\(--zuri-space-2\)/],
    ['the color/raised fill', /background:\s*var\(--zuri-surface-raised\)/],
    ['the color/border outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
    ['the radius/card corner', /border-radius:\s*var\(--zuri-radius-card\)/],
    ['the node drop shadow', /box-shadow:\s*var\(--zuri-shadow-raised\)/],
  ];
  const cardMissing = cardChecks.filter(([, pattern]) => !pattern.test(card)).map(([label]) => label);
  if (cardMissing.length > 0) throw new Error(`the raised card is missing ${cardMissing.join(', ')}`);

  // 132 px is the node's sample copy ("Provider connected" plus a two-line body),
  // not a frame: a fixed height would clip the longer bodies the card must hold.
  if (/(?:^|[\s;])height:/.test(card)) throw new Error('the raised card fixes the node\'s sample height');

  // Every design value has to come from the token layer, or a node change would
  // leave the card on the old colour or shadow.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(card)) {
    throw new Error('the raised card rule holds a literal colour instead of a token');
  }

  // The shadow is the node's own effect, so it lives in the token layer in both
  // themes; a value copied into the rule would stop tracking the node.
  const shadow = /--zuri-shadow-raised:\s*([^;]+);/g;
  const shadowValues = [...tokens.matchAll(shadow)].map((match) => match[1].trim());
  if (shadowValues.length < 2) {
    throw new Error('tokens.css does not declare the raised shadow in both themes');
  }
  if (new Set(shadowValues).size !== 1) {
    throw new Error('the two theme blocks give the raised shadow different values');
  }
  // The node's effect is a 0/8 offset, 24 px blur, 0 spread shadow.
  if (!/0\s+8px\s+24px\s+rgba?\(/.test(shadowValues[0])) {
    throw new Error(`the raised shadow is ${shadowValues[0]}, the node draws 0 8px 24px`);
  }

  // This node's meta is 12/16 where the base card's is 13/20, and its title is
  // medium where the base card's is semibold, so the raised card owns its text
  // rules instead of borrowing the base card's and drifting from its node.
  const raisedClasses = ['card-raised-title', 'card-raised-text', 'card-raised-meta'].filter(
    (name) => !css.includes(`.${name} {`),
  );
  if (raisedClasses.length > 0) {
    throw new Error(`the raised card has no ${raisedClasses.join(', ')} rules`);
  }

  return '320 px card, 16 px padding on an 8 px rhythm, radius 10, color/raised fill, 1 px hairline outline, node drop shadow';
});

check('the Button / Danger is drawn from node 0:24', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 101 x 36, filled with its bound variable "danger" on the 12 px
  // corner, with a 14 px regular label on color/primary-foreground and 16 px of
  // side padding. Its 101 px width is its label plus that padding, so the rule
  // states the padding and lets the label size the control.
  const button = ruleBody('.btn-danger');
  const buttonChecks = [
    ['the 36 px node height', /height:\s*36px/],
    ['16 px of side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the 12 px node corner', /border-radius:\s*var\(--zuri-radius-lg\)/],
    ['the color/danger fill token', /background:\s*var\(--zuri-danger-button-fill\)/],
    ['the color/primary-foreground label', /color:\s*var\(--zuri-text-on-accent\)/],
    ['the 14 px label size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the button is missing ${buttonMissing.join(', ')}`);

  // The node has no outline; a border would add a shape the design does not draw.
  if (!/border:\s*0/.test(button)) throw new Error('the button draws a border the node does not have');

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the button rule holds a literal colour instead of a token');
  }

  // The fill token is the node's variable "danger": #F31260 in both token modes, so
  // the control keeps the design's red rather than borrowing the HeroUI ramp's step.
  const fillTokens = tokens.match(/--zuri-danger-button-fill:\s*([^;]+);/g) ?? [];
  if (fillTokens.length !== 2) {
    throw new Error(`tokens.css declares --zuri-danger-button-fill ${fillTokens.length} times, not once per theme`);
  }
  if (!fillTokens.every((line) => /#f31260/.test(line))) {
    throw new Error("the danger fill token is not the node value #F31260");
  }

  const disabled = ruleBody('.btn-danger:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  // Drawn once, consumed by the app: the Settings view's destructive action is it.
  if (!/class="btn-danger"/.test(html)) throw new Error('the Settings view does not use the button');
  if (!/<button[^>]*class="btn-danger"[^>]*id="provider-key-remove"/.test(html)) {
    throw new Error('the button is not on the Remove key control');
  }

  return '36 px tall, 16 px padding, radius 12, danger #F31260 fill, white label at 14/20';
});

check('the Button / Ghost is drawn from node 0:10', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 73 x 32 on color/background and radius/row, with 16 px of side
  // padding and the guide's 14 px button label (label-md) on color/muted, where
  // the node draws its own 13 px line. Its 73 px width is the label
  // "See all" plus that padding, so the rule states the padding and lets the label
  // size it, exactly as the other variants of this family do.
  const button = ruleBody('.btn-ghost');
  const buttonChecks = [
    ['the 32 px node height', /height:\s*32px/],
    ['16 px of side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/muted label', /color:\s*var\(--zuri-text-muted\)/],
    ['the 14 px label size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the ghost button is missing ${buttonMissing.join(', ')}`);

  // The node has no outline; a border would add a shape the design does not draw.
  if (!/border:\s*0/.test(button)) throw new Error('the ghost button draws a border the node does not have');

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the ghost button rule holds a literal colour instead of a token');
  }

  // The guide's hover state is a surface tint plus a label that steps up from
  // muted to secondary; the node draws the default state only.
  const hover = ruleBody('.btn-ghost:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-surface-sunken\)/.test(hover)) {
    throw new Error('hover is not the guide\'s surface tint');
  }
  if (!/color:\s*var\(--zuri-text-secondary\)/.test(hover)) {
    throw new Error('the label does not step up on hover');
  }

  const focus = ruleBody('.btn-ghost:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-ghost:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  return '32 px tall, 16 px padding, radius 8, surface fill, muted label at 13 px';
});

check('the Button / Icon is drawn from node 0:18', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 28 x 28 square on color/background and radius/row, holding one
  // 20 px icon inset 4 px on each side (the spacing token), stroked on color/muted.
  const button = ruleBody('.btn-icon');
  const buttonChecks = [
    ['the 28 px node width', /width:\s*28px/],
    ['the 28 px node height', /height:\s*28px/],
    ['the 4 px icon inset as the spacing token', /padding:\s*var\(--zuri-space-1\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/muted icon', /color:\s*var\(--zuri-text-muted\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the icon button is missing ${buttonMissing.join(', ')}`);

  // The node has no outline; a border would add a shape the design does not draw.
  if (!/border:\s*0/.test(button)) throw new Error('the icon button draws a border the node does not have');

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the icon button rule holds a literal colour instead of a token');
  }

  // The node's icon frame is 20 x 20 inside the 28 px button, so the glyph cannot
  // grow to another icon set's 24 unit box.
  const glyph = ruleBody('.btn-icon-glyph');
  if (!/width:\s*20px/.test(glyph) || !/height:\s*20px/.test(glyph)) {
    throw new Error('the icon is not held to the node\'s 20 px box');
  }

  const hover = ruleBody('.btn-icon:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-surface-sunken\)/.test(hover)) {
    throw new Error('hover is not the guide\'s surface tint');
  }
  if (!/color:\s*var\(--zuri-text-secondary\)/.test(hover)) {
    throw new Error('the icon does not step up on hover');
  }

  const focus = ruleBody('.btn-icon:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-icon:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  return '28 x 28, radius 8, surface fill, 20 px muted icon inset 4 px';
});

check('the Button / Pill is drawn from node 0:3599: the active mode chip', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:3599 draws the segmented control's active mode chip: 22 px tall on
  // radius/pill, 16 px of side padding, filled on color/primary-soft with a
  // 14 px regular label on color/primary-soft-foreground. The node's fixed slot
  // width is the control's, not label plus padding, so the rule states the
  // padding and lets the label size the pill, as the rest of the family does.
  const pill = ruleBody('.btn-pill');
  const pillChecks = [
    ['the 22 px node height', /height:\s*22px/],
    ['the 16 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/pill corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/primary-soft fill', /background:\s*var\(--zuri-primary-soft\)/],
    ['the color/primary-soft-foreground label', /color:\s*var\(--zuri-primary-soft-foreground\)/],
    ['the 14 px label size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const pillMissing = pillChecks.filter(([, pattern]) => !pattern.test(pill)).map(([label]) => label);
  if (pillMissing.length > 0) throw new Error(`the pill is missing ${pillMissing.join(', ')}`);

  // The node has no outline; a border would add a shape the design does not draw.
  if (!/border:\s*0/.test(pill)) throw new Error('the pill draws a border the node does not have');

  // The pill must not fall back to the family's 8 px row corner: the node binds
  // radius/pill, so a square-ish chip would be a different control.
  if (/radius-row/.test(pill)) throw new Error('the pill uses the row corner instead of radius/pill');

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(pill)) {
    throw new Error('the pill rule holds a literal colour instead of a token');
  }

  // The guide's hover is a state step, not a second tint: the fill is already the
  // soft accent and the label its foreground, so hovering moves the label to the
  // accent itself. Focus and disabled follow the rest of the family.
  const hover = ruleBody('.btn-pill:hover:not(:disabled)');
  if (!/color:\s*var\(--zuri-accent\)/.test(hover)) {
    throw new Error('the pill label does not step up on hover');
  }

  const focus = ruleBody('.btn-pill:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-pill:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  return '28 px tall, 12 px padding, radius pill, accent-subtle fill, accent label at 13 px';
});

check('the Button / Primary is drawn from node 0:6', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 64 x 32 on color/primary and radius/row, with a 13 px regular
  // "Send" label on color/inverse inset 16 px from the sides. Its 64 px width is
  // that label (32 px) plus the padding, so the rule states the padding and lets
  // the label size the button, as the other variants of this family do.
  const button = ruleBody('.btn-primary');
  const buttonChecks = [
    ['the 32 px node height', /height:\s*32px/],
    ['the 16 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/primary fill', /background:\s*var\(--zuri-accent\)/],
    ['the color/inverse label', /color:\s*var\(--zuri-text-on-accent\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the primary button is missing ${buttonMissing.join(', ')}`);

  // The node has no outline; a border would add a shape the design does not draw.
  if (!/border:\s*0/.test(button)) throw new Error('the primary button draws a border the node does not have');

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the primary button rule holds a literal colour instead of a token');
  }

  // Hover is a state step on the fill, not a second shape: a filled control moves
  // one accent step and keeps its label. Focus and disabled follow the family.
  const hover = ruleBody('.btn-primary:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-accent-hover\)/.test(hover)) {
    throw new Error('the primary button does not step its fill on hover');
  }
  if (/color:/.test(hover)) throw new Error('the primary button moves its label on hover');

  const focus = ruleBody('.btn-primary:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-primary:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  return '32 px tall, 16 px padding, radius 8, accent fill, on-accent label at 13 px';
});

check('the Button / Secondary is drawn from node 0:20, the component the "Bordered" spec names', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 73 x 36 on its 12 px corner, filled with its bound surface-raised and
  // outlined 1 px INSIDE with its bound border-subtle, holding a 14 px regular
  // "Cancel" label on its bound text inset 16 px from the sides. Its 73 px width is
  // that label (41 px) plus the padding, so the rule states the padding and lets the
  // label size the button.
  const button = ruleBody('.btn-secondary');
  const buttonChecks = [
    ['the 36 px node height', /height:\s*36px/],
    ['the 16 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the node\'s 12 px corner', /border-radius:\s*var\(--zuri-radius-lg\)/],
    ['the surface-raised fill', /background:\s*var\(--zuri-bordered-button-surface\)/],
    ['the text label colour', /color:\s*var\(--zuri-bordered-button-label\)/],
    ['the 14 px label size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the 20 px label line box', /line-height:\s*var\(--zuri-line-height-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the secondary button is missing ${buttonMissing.join(', ')}`);

  // This is the family's one outlined variant: 1 px of border-subtle, drawn inside
  // the box. The outline has to stay that weight and that token, or the control
  // either loses the edge the node draws or grows a second, stronger one.
  if (!/border:\s*1px solid var\(--zuri-bordered-button-border\)/.test(button)) {
    throw new Error('the secondary button is not the node\'s 1 px border-subtle outline');
  }

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the secondary button rule holds a literal colour instead of a token');
  }

  // One node change, one edit: the three variables the node binds are the three
  // tokens, declared once per theme, carrying the design's own values in each.
  const blockOf = (theme) => {
    const start = tokens.indexOf(`:root[data-theme="${theme}"] {`);
    if (start === -1) throw new Error(`tokens.css has no ${theme} block`);
    return tokens.slice(start, tokens.indexOf('\n}', start));
  };
  const tokenOf = (theme, name) => {
    const match = blockOf(theme).match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`the ${theme} theme has no ${name} token`);
    return match[1].replace(/\s+/g, '').toLowerCase();
  };
  const drawn = [
    ['light', '--zuri-bordered-button-surface', '#ffffff', 'surface-raised'],
    ['light', '--zuri-bordered-button-border', 'rgba(17,17,17,0.08)', 'border-subtle #11111114'],
    ['light', '--zuri-bordered-button-label', '#11181c', 'text'],
    ['dark', '--zuri-bordered-button-surface', '#17171a', 'surface-raised'],
    ['dark', '--zuri-bordered-button-border', 'rgba(255,255,255,0.08)', 'border-subtle at 8%'],
    ['dark', '--zuri-bordered-button-label', '#ecedee', 'text'],
  ];
  const wrong = drawn
    .filter(([theme, name, value]) => tokenOf(theme, name) !== value)
    .map(([theme, name, value]) => `${theme} ${name} is not ${value}`);
  if (wrong.length > 0) throw new Error(wrong.join(', '));
  // A token declared in one theme only would leave the outlined control half-styled
  // after a theme swap.
  for (const name of ['--zuri-bordered-button-surface', '--zuri-bordered-button-border', '--zuri-bordered-button-label']) {
    const declared = tokens.match(new RegExp(`${name}\\s*:`, 'g')) ?? [];
    if (declared.length !== 2) {
      throw new Error(`tokens.css declares ${name} ${declared.length} times, not once per theme`);
    }
  }

  // Hover is the guide's subtle surface darken plus an edge that strengthens; the
  // label is already the strongest text step, so it does not move. Focus and
  // disabled follow the rest of the family.
  const hover = ruleBody('.btn-secondary:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-surface-sunken\)/.test(hover)) {
    throw new Error('hover is not the guide\'s subtle surface darken');
  }
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(hover)) {
    throw new Error('the outline does not strengthen on hover');
  }
  // The label must not move: match a standalone `color:` only, since the outline's
  // `border-color:` shares the prefix.
  if (/(?:^|[\s;])color:/.test(hover)) throw new Error('the secondary button moves its label on hover');

  const focus = ruleBody('.btn-secondary:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-secondary:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  return '36 px tall, 16 px padding, 12 px corner, surface-raised fill, 1 px border-subtle outline, text label at 14/20';
});

check('the Button / Small is drawn from node 0:16', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(selector + ' {');
    if (at === -1) throw new Error('components.css has no ' + selector + ' rule');
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 110 x 36 on its 12 px corner, with no fill and no stroke, and a
  // 14 px regular "Skip for now" label on color/text-subtle inset 16 px from the
  // sides. Its 110 px width is that label (78 px) plus that padding, so the rule
  // states the padding and lets the label size the button.
  const button = ruleBody('.btn-small');
  const buttonChecks = [
    ['the 36 px node height', /height:\s*36px/],
    ['the 16 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the 12 px node corner as the radius token', /border-radius:\s*var\(--zuri-radius-lg\)/],
    ['no fill of its own, the node draws none', /background:\s*transparent/],
    ['the color/text-subtle label', /color:\s*var\(--zuri-text-subtle\)/],
    ['the 14 px label size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks
    .filter(([, pattern]) => !pattern.test(button))
    .map(([label]) => label);
  if (buttonMissing.length > 0) {
    throw new Error('the small button is missing ' + buttonMissing.join(', '));
  }

  // The node draws no stroke, so the control keeps no border at all: a 1 px edge
  // would add a shape the design does not have.
  if (!/border:\s*0\s*;/.test(button)) {
    throw new Error('the small button draws an outline the node does not have');
  }

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the small button rule holds a literal colour instead of a token');
  }

  // The values the node binds are checked in the token layer itself: radius/md is
  // 12 and text-subtle is #6B6B75 in the design's Light mode.
  if (!/--zuri-radius-lg:\s*12px/.test(tokens)) {
    throw new Error('the radius token the button binds is not the node 12 px');
  }
  if (!/--zuri-text-subtle:\s*#6b6b75/i.test(tokens)) {
    throw new Error('the text-subtle token the button binds is not the node #6B6B75');
  }

  // Hover is the guide's subtle surface tint plus a label that steps up from
  // subtle to the primary text step; a text-only control has no edge to strengthen.
  const hover = ruleBody('.btn-small:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-surface-sunken\)/.test(hover)) {
    throw new Error('hover is not the guide subtle surface darken');
  }
  if (!/(?:^|[\s;])color:\s*var\(--zuri-text-primary\)/.test(hover)) {
    throw new Error('the label does not step up to the primary text colour on hover');
  }

  const focus = ruleBody('.btn-small:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-small:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) {
    throw new Error('disabled is not the guide 40% opacity');
  }

  return '36 px tall, 16 px padding, radius 12, no fill or outline, text-subtle label at 14 px';
});

/**
 * Custom property names declared inside the first rule whose selector text is
 * `selector`. Braces are counted so nested values (rgba()) cannot end the block.
 * @param {string} css
 * @param {string} selector
 * @returns {string[]}
 */
function tokenNamesIn(css, selector) {
  const selectorAt = css.indexOf(selector);
  if (selectorAt === -1) throw new Error(`no ${selector} block`);
  const blockStart = css.indexOf('{', selectorAt);
  let depth = 0;
  let blockEnd = -1;
  for (let index = blockStart; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) {
      blockEnd = index;
      break;
    }
  }
  if (blockEnd === -1) throw new Error(`the ${selector} block is not closed`);
  return [...css.slice(blockStart + 1, blockEnd).matchAll(/(--zuri-[\w-]+)\s*:/g)].map((match) => match[1]);
}

// One prefix per token family the card names: colour, spacing, radius, shadow, typography.
const TOKEN_FAMILIES = {
  colour: /^--zuri-(bg-|surface|border-|text-|accent|success|warning|danger|backdrop|overlay)/,
  spacing: /^--zuri-space-/,
  radius: /^--zuri-radius-/,
  shadow: /^--zuri-shadow-/,
  typography: /^--zuri-(font-|line-height-|tracking-)/,
};

check('the Input / Text is drawn from node 0:44', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 320 px column at an 8 px gap: its Label over a 320 x 40 field.
  // The field binds surface-secondary, color/border-subtle and radius/md (the design's
  // 12 px), holds its 14/22 text 16 px in from the left, and its placeholder is
  // the same color/muted as the label.
  const field = ruleBody('.field');
  const fieldChecks = [
    ['the node\'s 320 px width', /max-width:\s*320px/],
    ['the 8 px label gap as the spacing token', /gap:\s*var\(--zuri-space-2\)/],
    ['the vertical stack', /flex-direction:\s*column/],
  ];
  const fieldMissing = fieldChecks.filter(([, pattern]) => !pattern.test(field)).map(([label]) => label);
  if (fieldMissing.length > 0) throw new Error(`the field stack is missing ${fieldMissing.join(', ')}`);

  const label = ruleBody('.field-label');
  const labelChecks = [
    ['the color/muted label', /color:\s*var\(--zuri-text-muted\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the medium label weight', /font-weight:\s*var\(--zuri-font-weight-medium\)/],
    ['the node\'s 18 px label line height', /line-height:\s*var\(--zuri-line-height-field-label\)/],
  ];
  const labelMissing = labelChecks.filter(([, pattern]) => !pattern.test(label)).map(([name]) => name);
  if (labelMissing.length > 0) throw new Error(`the field label is missing ${labelMissing.join(', ')}`);

  const input = ruleBody('.field-input');
  const inputChecks = [
    ["the node's 40 px height", /height:\s*40px/],
    ["the node's 1 px stroke as an inset ring on the hairline token", /box-shadow:\s*inset 0 0 0 1px var\(--zuri-border-hairline\)/],
    ['the 16 px text inset as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/md corner', /border-radius:\s*var\(--zuri-radius-field\)/],
    ['the surface-secondary fill', /background:\s*var\(--zuri-surface-secondary\)/],
    ['a stroke drawn inside the box, not a border that grows it', /border:\s*0;/],
    ['the color/text value', /color:\s*var\(--zuri-text-primary\)/],
    ['the 14 px text size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
  ];
  const inputMissing = inputChecks.filter(([, pattern]) => !pattern.test(input)).map(([name]) => name);
  if (inputMissing.length > 0) throw new Error(`the field is missing ${inputMissing.join(', ')}`);

  // Every value has to come from the token layer, or a theme swap would leave the
  // field on one theme's colour.
  for (const [name, body] of Object.entries({ '.field': field, '.field-label': label, '.field-input': input })) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(body)) {
      throw new Error(`the ${name} rule holds a literal colour instead of a token`);
    }
  }

  // The node draws the field empty, so its Placeholder text is the colour to carry:
  // the same muted step as the label, not the typed-text colour.
  const placeholder = ruleBody('.field-input::placeholder');
  if (!/color:\s*var\(--zuri-text-muted\)/.test(placeholder)) {
    throw new Error('the placeholder is not color/muted');
  }

  // States the guide names but the node does not draw: hover and caret-focus
  // step the fill up, keyboard focus adds the ring, disabled dims.
  if (!/background: \s*var\(--zuri-surface-tertiary\)/.test(ruleBody('.field-input:hover:not(:disabled)'))) {
    throw new Error('the field does not step its fill up on hover');
  }
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(ruleBody('.field-input:focus-visible'))) {
    throw new Error('focus is not the accent ring');
  }
  if (!/opacity:\s*0\.4/.test(ruleBody('.field-input:disabled'))) {
    throw new Error('disabled is not the family\'s 40% opacity');
  }

  // The label's 13/18 is the node's own line height, so it is a token of its own
  // rather than a step borrowed from body-sm (13/20), declared in both themes.
  const labelToken = (tokens.match(/--zuri-line-height-field-label:\s*18px;/g) ?? []).length;
  if (labelToken !== 2) throw new Error(`--zuri-line-height-field-label: 18px is declared ${labelToken} times, not once per theme`);

  // Drawn once, consumed by the app: the Settings view's key field is it, and the
  // view keeps no second copy of the input styling that could drift from the node.
  if (!/<label class="field-label" for="provider-key">/.test(html)) {
    throw new Error('the Settings view does not draw the field label');
  }
  if (!/<input\s+class="field-input"\s+id="provider-key"/.test(html)) {
    throw new Error('the Settings view does not draw the field on the API key input');
  }
  if (/\.settings-(input|label)/.test(read('src/renderer/views/settings.css'))) {
    throw new Error('settings.css still styles its own input instead of using the component');
  }

  return '320 px stack, 40 px field, radius 12, surface-secondary fill, 1 px hairline, muted label at 13/18';
});

check('the Input / Textarea is drawn from node 0:27', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is the single-line field's sibling: the Field is 320 x 88 instead of
  // 320 x 40, so the value can wrap. It binds the same three values
  // (surface-secondary, color/border, radius/md) and keeps the 14/22 value in
  // color/text, but insets it 12 px on all four sides instead of centring one row.
  const textarea = ruleBody('.field-textarea');
  const checks = [
    ['the 12 px inset on every side as the spacing token', /padding:\s*var\(--zuri-space-3\)/],
    ["the node's 88 px resting height", /min-height:\s*88px/],
    ['the radius/md corner', /border-radius:\s*var\(--zuri-radius-field\)/],
    ['the surface-secondary fill', /background:\s*var\(--zuri-surface-secondary\)/],
    ['a stroke drawn inside the box, not a border that grows it', /border:\s*0;/],
    ['the color/text value', /color:\s*var\(--zuri-text-primary\)/],
    ['the 14 px value size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the 22 px value line height', /line-height:\s*var\(--zuri-line-height-body-md\)/],
    ['a paragraph field the person can drag taller', /resize:\s*vertical/],
  ];
  const missing = checks.filter(([, pattern]) => !pattern.test(textarea)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the textarea is missing ${missing.join(', ')}`);

  // The node's Field is a fixed box around text that resizes to fit, so 88 px is
  // where the control starts, not where it stops. A fixed height would clip the
  // fourth line the frame has room for.
  if (/(^|\n)\s*height:\s*\d+px/.test(textarea)) {
    throw new Error('the textarea fixes its height instead of growing from the node\'s 88 px');
  }

  // A colour written into the rule instead of named would stay put when the theme
  // swaps, so every value here has to come from the token layer.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(textarea)) {
    throw new Error('the .field-textarea rule holds a literal colour instead of a token');
  }

  // One node change, one edit: the two fields in the family must name the same
  // radius and edge tokens, or moving a binding in open-pencil would move only one.
  const boundTokens = (body) => (body.match(/var\(--zuri-(?:radius|border)-[\w-]+\)/g) ?? []).sort().join(',');
  if (boundTokens(ruleBody('.field-input')) !== boundTokens(textarea)) {
    throw new Error('the textarea and the single-line field no longer share their radius and edge tokens');
  }

  // The node draws the field filled, so its Placeholder is the one glyph colour to
  // carry over: the same muted step the label uses.
  if (!/color:\s*var\(--zuri-text-muted\)/.test(ruleBody('.field-textarea::placeholder'))) {
    throw new Error('the textarea placeholder is not color/muted');
  }

  // States the guide names but the node does not draw, identical to the rest of the
  // family: hover and caret-focus step the fill up, keyboard focus rings, and a
  // disabled field dims to the family's 40%.
  if (!/background: \s*var\(--zuri-surface-tertiary\)/.test(ruleBody('.field-textarea:hover:not(:disabled)'))) {
    throw new Error('the textarea does not step its fill up on hover');
  }
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(ruleBody('.field-textarea:focus-visible'))) {
    throw new Error('textarea focus is not the accent ring');
  }
  if (!/opacity:\s*0\.4/.test(ruleBody('.field-textarea:disabled'))) {
    throw new Error('a disabled textarea is not the family\'s 40% opacity');
  }

  // The chat prompt only looks like this: it is the composer's own borderless pill
  // that grows upward (decision 18), so the two must not be merged. The pill draws
  // its own controls now (ui/composer.js mounts them into index.html's #composer), so
  // the class is looked for in the module that renders it as well as in the page.
  const index = read('src/renderer/index.html');
  const composerModule = read('src/renderer/ui/composer.js');
  if (!/class="composer-input"/.test(index) && !/className = 'composer-input'/.test(composerModule)) {
    throw new Error('the composer prompt is no longer its own control (decision 18)');
  }

  return '320 px stack, 88 px field, radius 12, surface-secondary fill, 1 px hairline, 12 px inset, 14/22 value';
});

check('the Select / Default is drawn from node 0:61', () => {
  const css = read('src/renderer/styles/components.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is "Input / Select" (0:61): the family's 320 x 40 Field carrying a
  // chevron, with a 14/22 Value on text inset 12 px and a 16 x 16 Icon / custom
  // 24 px in from the right edge, which leaves the node's 268 px of value before it.
  if (!/max-width:\s*320px/.test(ruleBody('.select'))) {
    throw new Error("the select column is not the node's 320 px");
  }

  const field = ruleBody('.select-field');
  const fieldChecks = [
    ["the node's 40 px field height", /height:\s*40px/],
    ['the radius/md corner', /border-radius:\s*var\(--zuri-radius-field\)/],
    ['the surface-secondary fill', /background:\s*var\(--zuri-surface-secondary\)/],
    ['a stroke drawn inside the box, not a border that grows it', /border:\s*0;/],
  ];
  const fieldMissing = fieldChecks.filter(([, pattern]) => !pattern.test(field)).map(([name]) => name);
  if (fieldMissing.length > 0) throw new Error(`the select field is missing ${fieldMissing.join(', ')}`);

  // The value keeps the node's 12 px inset and stops at its 268 px: the right
  // padding is the chevron's 24 plus its 16, so a long value truncates before it
  // can run under the icon.
  const control = ruleBody('.select-control');
  const controlChecks = [
    ['the text value', /color:\s*var\(--zuri-text-primary\)/],
    ['the 14 px value size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the 22 px value line height', /line-height:\s*var\(--zuri-line-height-body-md\)/],
    ['the 12 px value inset as the spacing token', /0 var\(--zuri-space-3\);/],
    ['the room the chevron takes', /calc\(var\(--zuri-space-6\) \+ 16px\)/],
    ['the browser arrow the node does not draw', /appearance:\s*none/],
  ];
  const controlMissing = controlChecks.filter(([, pattern]) => !pattern.test(control)).map(([name]) => name);
  if (controlMissing.length > 0) throw new Error(`the select control is missing ${controlMissing.join(', ')}`);

  // The chevron is the node's own vector: three points on a 16 px grid, stroked at
  // the node's 1 pt with its butt cap and miter join, so the point stays as sharp as
  // the drawing instead of rounding off.
  const svg = html.slice(html.indexOf('class="select-icon"'));
  if (!/viewBox="0 0 16 16"/.test(svg.slice(0, 400))) throw new Error('the chevron is not on the 16 px grid');
  if (!/d="M4 6l4 4 4-4"/.test(svg)) throw new Error("the chevron is not the node's path");
  if (!/stroke-width="1"/.test(svg)) throw new Error("the chevron is not the node's 1 pt stroke");
  if (!/stroke-linejoin="miter"/.test(svg)) throw new Error("the chevron is not the node's miter join");

  // The icon is text-subtle and 24 px in from the edge, which is where the node
  // draws its 16 x 16 box (x=280 in the 320 frame). Binding it to that edge is also
  // the only placement that holds still while the value changes.
  const icon = ruleBody('.select-icon');
  const iconChecks = [
    ['the text-subtle chevron', /color:\s*var\(--zuri-text-subtle\)/],
    ['the 24 px inset from the edge', /right:\s*var\(--zuri-space-6\)/],
    ['the click passing through to the select', /pointer-events:\s*none/],
  ];
  const iconMissing = iconChecks.filter(([, pattern]) => !pattern.test(icon)).map(([name]) => name);
  if (iconMissing.length > 0) throw new Error(`the chevron is missing ${iconMissing.join(', ')}`);

  // A colour written into a rule instead of named would stay put when the theme
  // swaps, so every value here has to come from the token layer.
  for (const [name, body] of Object.entries({ '.select': ruleBody('.select'), '.select-field': field, '.select-control': control, '.select-icon': icon })) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(body)) {
      throw new Error(`the ${name} rule holds a literal colour instead of a token`);
    }
  }

  // One node change, one edit: the family's edge and radius must be named the same
  // way here and on the single-line field, or moving a binding in open-pencil would
  // move only one of them.
  const boundTokens = (body) => (body.match(/var\(--zuri-(?:radius|border)-[\w-]+\)/g) ?? []).sort().join(',');
  if (boundTokens(ruleBody('.field-input')) !== boundTokens(field)) {
    throw new Error('the select and the single-line field no longer share their radius and edge tokens');
  }

  // States the guide names for a field, drawn outside the node: hover and caret
  // focus step the fill up on the box, the keyboard ring is the accent one,
  // and a disabled select dims the whole component rather than its text alone.
  if (!/background: \s*var\(--zuri-surface-tertiary\)/.test(ruleBody('.select-field:hover'))) {
    throw new Error('the select does not step its fill up on hover');
  }
  if (!/background: \s*var\(--zuri-surface-tertiary\)/.test(ruleBody('.select-field:focus-within'))) {
    throw new Error('the select does not step its fill up while focused');
  }
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(ruleBody('.select-control:focus-visible'))) {
    throw new Error('select focus is not the accent ring');
  }
  if (!/opacity:\s*0\.4/.test(ruleBody('.select-field:has(.select-control:disabled)'))) {
    throw new Error("a disabled select is not the family's 40% opacity");
  }

  // Drawn once, consumed by the app: the Settings view's provider picker is it, and
  // the view keeps no second copy of the select styling that could drift from it.
  if (!/<select\s+class="select-control"\s+id="provider-key-provider"/.test(html)) {
    throw new Error('the Settings view does not draw the select on the provider picker');
  }
  if (/\.settings-select/.test(read('src/renderer/views/settings.css'))) {
    throw new Error('settings.css still styles its own select instead of using the component');
  }

  return '320 px column, 40 px field, radius 12, surface-secondary fill, 1 px hairline, 14/22 value, text-subtle 16 px chevron 24 px in';
});

check('the Select / Menu is drawn from node 0:43', () => {
  // The dropdown moved to its own sheet so the audit and onboarding pages can link it
  // without pulling in the shell's global body and box-sizing rules.
  const css = read('src/renderer/styles/dropdown.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`dropdown.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is the menu surface of the Select family: 260 px wide, color/background
  // inside a 1 px color/border edge on radius/card, carrying the card's drop shadow,
  // and holding a 12/16 group label over 28 px options.
  const menu = ruleBody('.select-menu');
  const menuChecks = [
    ['the 260 px node width', /max-width:\s*260px/],
    ['the node\'s 8 px inset, less the 1 px edge so the box stays its 128 px', /padding:\s*calc\(var\(--zuri-space-2\) - 1px\)/],
    ['the 4 px rhythm as the spacing token', /gap:\s*var\(--zuri-space-1\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/border outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
    ['the radius/card corner', /border-radius:\s*var\(--zuri-radius-card\)/],
    ['the node drop shadow', /box-shadow:\s*var\(--zuri-shadow-raised\)/],
    ['a column so the options stack', /flex-direction:\s*column/],
  ];
  const menuMissing = menuChecks.filter(([, pattern]) => !pattern.test(menu)).map(([name]) => name);
  if (menuMissing.length > 0) throw new Error(`the menu is missing ${menuMissing.join(', ')}`);

  // 128 px is the node's height and it is the sum of its parts (8 + 16 + 4 + three
  // 28 px rows + two 4 px gaps + 8). A written height would clip the fourth model a
  // real list carries, so the menu grows from the rhythm instead.
  if (/(?:^|[\s;])height:/.test(menu)) throw new Error("the menu fixes the node's sample height");

  const label = ruleBody('.select-menu-label');
  const labelChecks = [
    ['the color/muted group label', /color:\s*var\(--zuri-text-muted\)/],
    ['the 12 px label size', /font-size:\s*var\(--zuri-font-size-caption\)/],
    ['the 16 px label line height', /line-height:\s*var\(--zuri-line-height-caption\)/],
    ['the regular weight the node sets', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['no margin of its own', /margin:\s*0/],
  ];
  const labelMissing = labelChecks.filter(([, pattern]) => !pattern.test(label)).map(([name]) => name);
  if (labelMissing.length > 0) throw new Error(`the group label is missing ${labelMissing.join(', ')}`);

  const option = ruleBody('.select-menu-option');
  const optionChecks = [
    ["the node's 28 px row", /height:\s*28px/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background row fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/text label', /color:\s*var\(--zuri-text-primary\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the 18 px label line height', /line-height:\s*var\(--zuri-line-height-select-option\)/],
    ['the 8 px label inset as the spacing token', /padding:\s*0 var\(--zuri-space-2\)/],
    ['the check mark on the far edge', /justify-content:\s*space-between/],
  ];
  const optionMissing = optionChecks.filter(([, pattern]) => !pattern.test(option)).map(([name]) => name);
  if (optionMissing.length > 0) throw new Error(`the option is missing ${optionMissing.join(', ')}`);

  // color/primary-soft is the one thing the selected variant paints: the node keeps
  // the label at color/text, so a rule that recoloured it would be a redesign.
  const selected = ruleBody(".select-menu-option[aria-selected='true']");
  if (!/background:\s*var\(--zuri-accent-subtle\)/.test(selected)) {
    throw new Error('the selected option is not filled with the color/primary-soft token');
  }
  if (/color:\s*var\(--zuri-accent\)/.test(selected)) {
    throw new Error('the selected option recolours its label, which the node does not');
  }

  // The mark is the node's Icon / check: 1.33 stroke on color/primary.
  const mark = ruleBody(".select-menu-option[aria-selected='true']::after");
  const markChecks = [
    ['the color/primary stroke', /border-right:\s*1\.33px solid var\(--zuri-accent\)/],
    ['the second arm of the tick', /border-bottom:\s*1\.33px solid var\(--zuri-accent\)/],
    ['a turned box so the borders read as one tick', /transform:\s*rotate\(45deg\)/],
  ];
  const markMissing = markChecks.filter(([, pattern]) => !pattern.test(mark)).map(([name]) => name);
  if (markMissing.length > 0) throw new Error(`the check mark is missing ${markMissing.join(', ')}`);

  // A colour written into a rule instead of named would stay put when the theme
  // swaps, so every value in this family has to come from the token layer.
  const family = { '.select-menu': menu, '.select-menu-label': label, '.select-menu-option': option, '.select-menu-option[aria-selected]': selected, 'the check mark': mark };
  for (const [name, body] of Object.entries(family)) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(body)) {
      throw new Error(`the ${name} rule holds a literal colour instead of a token`);
    }
  }

  // States the guide names for a control, drawn outside the node: hover darkens the
  // surface for rows that are not the current choice, and the keyboard ring is the
  // accent one.
  if (!/background:\s*var\(--zuri-surface-active\)/.test(ruleBody(".select-menu-option:hover:not([aria-selected='true'])"))) {
    throw new Error('an unselected option does not tint on hover');
  }
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(ruleBody('.select-menu-option:focus-visible'))) {
    throw new Error('menu option focus is not the accent ring');
  }

  return '260 x 128 from its rhythm, radius 10, surface fill, 1 px hairline, raised shadow, 12/16 group label, 28 px rows on radius 8, primary-soft fill and accent tick';
});

check('the Modal / Scrim is drawn from node 0:95', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:95 is one filled rectangle and nothing more: 400 x 280, fill #1F232847
  // bound to color/overlay, no corner radius, no stroke, no effect, no children.
  // The sample is 400 x 280 and its use is the window-sized "Modal scrim" rectangle
  // in every dialog, so the component covers the viewport rather than being sized.
  const scrim = ruleBody('.modal-scrim');
  const checks = [
    ['a cover of the whole window', /position:\s*fixed/],
    ['edge-to-edge from the top left', /inset:\s*0/],
    ['the color/overlay fill', /background:\s*var\(--zuri-overlay\)/],
    ['a layer above the shell', /z-index:\s*\d+/],
  ];
  const missing = checks.filter(([, pattern]) => !pattern.test(scrim)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the scrim is missing ${missing.join(', ')}`);

  // A colour written into the rule would stay at the light value in the dark theme,
  // where the design's dark collection asks for black.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(scrim)) {
    throw new Error('the .modal-scrim rule holds a literal colour instead of a token');
  }

  // The node carries no radius, stroke, blur or shadow (its JSX is a bare fill), so
  // adding one would be a redesign of the component, not an implementation of it.
  const redressed = [
    ['border radius', /\bborder-radius:/],
    ['a border', /\bborder(-[a-z]+)?:/],
    ['a shadow', /\bbox-shadow:/],
    ['a blur', /backdrop-filter:/],
    ['an outline', /\boutline:/],
  ].filter(([, pattern]) => pattern.test(scrim)).map(([name]) => name);
  if (redressed.length > 0) {
    throw new Error(`the node draws no ${redressed.join(', ')} but the scrim adds one`);
  }

  // One node change, one edit: the scrim reads the design's two colour collections
  // through one token, so moving color/overlay in open-pencil moves the CSS and
  // nothing else has to be touched.
  const blockOf = (theme) => {
    const start = tokens.indexOf(`:root[data-theme="${theme}"] {`);
    if (start === -1) throw new Error(`tokens.css has no ${theme} block`);
    return tokens.slice(start, tokens.indexOf('\n}', start));
  };
  const overlayOf = (theme) => {
    const match = blockOf(theme).match(/--zuri-overlay:\s*([^;]+);/);
    if (!match) throw new Error(`the ${theme} theme has no --zuri-overlay token`);
    return match[1].replace(/\s+/g, '');
  };
  // The node's own fill is #1F232847 (near-black at 27.84%) and the dark
  // collection's color/overlay is black at 56.08%.
  if (overlayOf('light') !== 'rgba(31,35,40,0.28)') {
    throw new Error(`the light scrim is ${overlayOf('light')}, not the node's #1F232847`);
  }
  if (overlayOf('dark') !== 'rgba(0,0,0,0.56)') {
    throw new Error(`the dark scrim is ${overlayOf('dark')}, not color/overlay at 56.08%`);
  }

  // The guide's 150 ms fade is a state the node cannot draw; under reduced motion
  // the scrim has to arrive without it.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  if (!/\.modal-scrim\s*\{\s*animation:\s*none/.test(reduced)) {
    throw new Error('the scrim keeps its fade under prefers-reduced-motion');
  }

  return 'fixed inset 0, color/overlay fill, no radius or stroke, 28% light / 56% dark';
});

check('the Modal / Shell is drawn from node 0:96', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const tokenValue = (name) => {
    const match = tokens.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`tokens.css has no ${name}`);
    return match[1].replace(/\s+/g, ' ').trim();
  };

  // Node 0:96 is a 480 x 184 card: a color/raised fill inside a 1 px
  // color/border-strong stroke on radius/modal, the card drop shadow, 24 px of padding
  // and a 16 px rhythm between the title, the body and the footer.
  const shell = ruleBody('.modal-shell');
  const box = [
    ['the color/raised fill', /background:\s*var\(--zuri-surface-raised\)/],
    ['the color/border-strong outline', /border:\s*1px solid var\(--zuri-border-strong\)/],
    ['the radius/modal corners', /border-radius:\s*var\(--zuri-radius-modal\)/],
    ['the card drop shadow', /box-shadow:\s*var\(--zuri-shadow-raised\)/],
    ["the node's 24 px padding", /padding:\s*var\(--zuri-space-6\)/],
    ["the node's 16 px rhythm", /gap:\s*var\(--zuri-space-4\)/],
    ["the guide's 480 px dialog width", /max-width:\s*var\(--zuri-modal-width\)/],
  ];
  const missing = box.filter(([, pattern]) => !pattern.test(shell)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the modal shell is missing ${missing.join(', ')}`);

  // Both texts are color/text: title 20/28, body 14/22, regular weight and no tracking.
  const title = ruleBody('.modal-shell-title');
  const body = ruleBody('.modal-shell-body');
  const type = [
    ['the title on color/text', title, /color:\s*var\(--zuri-text-primary\)/],
    ['the title at 20 px', title, /font-size:\s*var\(--zuri-font-size-heading-md\)/],
    ['the title on 28 px', title, /line-height:\s*var\(--zuri-line-height-heading-md\)/],
    ['the body on color/text', body, /color:\s*var\(--zuri-text-primary\)/],
    ['the body at 14 px', body, /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the body on 22 px', body, /line-height:\s*var\(--zuri-line-height-body-md\)/],
  ];
  const untyped = type.filter(([, source, pattern]) => !pattern.test(source)).map(([name]) => name);
  if (untyped.length > 0) throw new Error(`the modal text is missing ${untyped.join(', ')}`);

  // The footer is one row of 32 px controls, right-aligned with the node's 8 px gap,
  // so the confirm action reads last.
  const footer = ruleBody('.modal-shell-footer');
  if (!/display:\s*flex/.test(footer)) throw new Error('the modal footer is not a row of controls');
  if (!/justify-content:\s*flex-end/.test(footer)) {
    throw new Error('the modal footer does not right-align its actions');
  }
  if (!/gap:\s*var\(--zuri-space-2\)/.test(footer)) {
    throw new Error("the modal footer is missing the node's 8 px gap");
  }

  // A literal colour would stay at the light value in the dark theme.
  const rules = [
    ['.modal-shell', shell],
    ['.modal-shell-title', title],
    ['.modal-shell-body', body],
    ['.modal-shell-footer', footer],
  ];
  const literal = rules.filter(([, source]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(source));
  if (literal.length > 0) {
    throw new Error(`the ${literal.map(([selector]) => selector).join(', ')} rule holds a literal colour`);
  }

  // One node change, one edit: what the node draws is what the tokens hold, so moving
  // radius/modal, the shadow or the 480 px width in open-pencil moves this component.
  const expected = [
    ['--zuri-radius-modal', '12px'],
    ['--zuri-modal-width', '480px'],
    ['--zuri-shadow-raised', '0 8px 24px rgba(17, 20, 24, 0.1)'],
  ];
  for (const [name, value] of expected) {
    const actual = tokenValue(name);
    if (actual !== value) throw new Error(`${name} is ${actual}, not the node's ${value}`);
  }

  return 'color/raised card on radius/modal, 24 px padding, 16 px rhythm, 480 px wide';
});

check('the Nav / Avatar Chip is drawn from node 0:76', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 28 x 28 circle on radius/pill filled with color/accent, holding
  // one 12/16 regular "AK" on color/inverse. Its 6 px inset is where centring puts
  // the sample's 17 x 16 text box, so the rule centres instead of padding.
  const chip = ruleBody('.nav-avatar-chip');
  const chipChecks = [
    ['the 28 px node width', /width:\s*28px/],
    ['the 28 px node height', /height:\s*28px/],
    ['the radius/pill corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the color/accent fill', /background:\s*var\(--zuri-accent\)/],
    ['horizontal centring of the initials', /justify-content:\s*center/],
    ['vertical centring of the initials', /align-items:\s*center/],
  ];
  const chipMissing = chipChecks.filter(([, pattern]) => !pattern.test(chip)).map(([label]) => label);
  if (chipMissing.length > 0) throw new Error(`the avatar chip is missing ${chipMissing.join(', ')}`);

  // The node draws one flat fill: no outline and no shadow to add.
  if (/border:(?!-radius)/.test(chip) || /box-shadow:/.test(chip)) {
    throw new Error('the avatar chip draws a border or a shadow the node does not have');
  }

  // The node binds radius/pill, so a square-ish mark would be a different control.
  if (/radius-row/.test(chip)) throw new Error('the avatar chip uses the row corner instead of radius/pill');

  // The node is a mark, not a control: it draws no hover or focus state.
  if (/\.nav-avatar-chip(?:-initials)?:(?:hover|focus)/.test(css)) {
    throw new Error('the avatar chip has a state the node does not draw');
  }

  // The node's child is the text, so the type and color/inverse live on the text
  // element and the chip itself paints only the fill.
  const initials = ruleBody('.nav-avatar-chip-initials');
  const initialsChecks = [
    ['the color/inverse text colour', /color:\s*var\(--zuri-text-on-accent\)/],
    ['the 12 px size as the caption token', /font-size:\s*var\(--zuri-font-size-caption\)/],
    ['the 16 px line height as the caption token', /line-height:\s*var\(--zuri-line-height-caption\)/],
    ['the regular weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const initialsMissing = initialsChecks.filter(([, pattern]) => !pattern.test(initials)).map(([label]) => label);
  if (initialsMissing.length > 0) {
    throw new Error(`the avatar chip initials are missing ${initialsMissing.join(', ')}`);
  }

  if (/(^|\s)color:/.test(chip)) {
    throw new Error('the chip paints a text colour the node puts on its text child');
  }

  // Every value has to come from the token layer, or a theme swap would leave the
  // mark on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(chip) || /#[0-9a-f]{3,8}\b|rgba?\(/i.test(initials)) {
    throw new Error('the avatar chip rules hold a literal colour instead of a token');
  }

  return '28 x 28, radius pill, accent fill, inverse 12/16 regular initials centred';
});
// The top bar is the bar over a surface: the surface's name, the theme toggle, the
// notification control and the surface's primary action. The card still names node
// 0:78, which the redraw turned into an unrelated icon path; the same component is
// now node 0:189 under Section / Navigation > Navigation Variants. This check reads
// the rules against that drawing, not against the number.
check('the Nav / Top Bar is drawn from node 0:189: name, two 44 px controls and a primary action', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const expect = (body, checks, what) => {
    const missing = checks.filter(([, pattern]) => !pattern.test(body)).map(([label]) => label);
    if (missing.length > 0) throw new Error(`${what} is missing ${missing.join(', ')}`);
  };

  // The bar itself: 1052 x 56 on color/surface, a radius-lg 14 corner, a 20 px inset
  // at each end, and the 6 px gap the node puts between its trailing controls.
  const bar = ruleBody('.nav-top-bar');
  expect(bar, [
    ['the 56 px node height', /height:\s*var\(--zuri-topbar-height\)/],
    ['the 20 px node side inset', /padding:\s*0 20px/],
    ['the radius-lg 14 corner', /border-radius:\s*var\(--zuri-nav-top-bar-radius\)/],
    ['the color/surface fill', /background:\s*var\(--zuri-nav-top-bar-surface\)/],
    ['a horizontal row', /display:\s*flex/],
    ['centred children', /align-items:\s*center/],
    ["the node's 6 px gap between the three trailing controls", /gap:\s*6px/],
    ['full width, since the bar spans the surface it heads', /width:\s*100%/],
    ['border-box sizing, so the inset sits inside the 56 px row', /box-sizing:\s*border-box/],
  ], 'the top bar');

  // The node draws a flat panel: no hairline and no shadow.
  if (/border:(?!-radius)/.test(bar) || /box-shadow:/.test(bar)) {
    throw new Error('the top bar draws a border or a shadow the node does not have');
  }

  // The name: 16/24 semibold on color/text, one line with an ellipsis, and 12 px
  // between it and the spacer (the bar's 6 px gap plus the node's other 6).
  const title = ruleBody('.nav-top-bar-title');
  expect(title, [
    ['the 16 px heading-sm size', /font-size:\s*var\(--zuri-font-size-heading-sm\)/],
    ['the 24 px heading-sm line height', /line-height:\s*var\(--zuri-line-height-heading-sm\)/],
    ['the semibold weight', /font-weight:\s*var\(--zuri-font-weight-semibold\)/],
    ['the color/text fill', /color:\s*var\(--zuri-nav-top-bar-title\)/],
    ["the ellipsis the node's truncation ending asks for", /text-overflow:\s*ellipsis/],
    ['one line only', /white-space:\s*nowrap/],
    ['the 12 px gap to the spacer', /margin-right:\s*6px/],
    ['a name box that can shrink, or the controls would be pushed off', /min-width:\s*0/],
  ], 'the top bar title');

  // The spacer draws nothing: the node's 1 px frame on the row's centre line, kept
  // 1 px tall so it cannot stretch the bar, and 10 px of margin for the 16 px
  // spacing the node leaves before the theme toggle.
  const spacer = ruleBody('.nav-top-bar-spacer');
  expect(spacer, [
    ["the bar's one part that gives", /flex:\s*1 1 auto/],
    ["the node's 1 px frame", /height:\s*1px/],
    ['the 16 px gap to the theme toggle', /margin-right:\s*10px/],
  ], 'the top bar spacer');

  // Theme and notification are one 44 px control twice, on radius-md 12, filled with
  // color/surface-secondary and drawing an 18 px color/text glyph 13 px in.
  const control = ruleBody('.nav-top-bar-control');
  expect(control, [
    ['the 44 px node width', /width:\s*44px/],
    ['the 44 px node height', /height:\s*44px/],
    ['the radius-md 12 corner', /border-radius:\s*var\(--zuri-nav-top-bar-control-radius\)/],
    ['the color/surface-secondary fill', /background:\s*var\(--zuri-nav-top-bar-control-surface\)/],
    ['the color/text glyph', /color:\s*var\(--zuri-nav-top-bar-icon\)/],
    ['the glyph centred across the box', /justify-content:\s*center/],
    ['the glyph centred down the box', /align-items:\s*center/],
    ['no inset of its own, since the glyph is centred', /padding:\s*0/],
  ], 'the top bar control');

  const glyph = ruleBody('.nav-top-bar-glyph');
  expect(glyph, [
    ["the node's 18 px glyph box", /width:\s*18px/],
    ['the 18 px glyph height', /height:\s*18px/],
    ['a block box, so the 18 px is the drawn size', /display:\s*block/],
  ], 'the top bar glyph');

  // The action: a 96 x 36 color/primary button with a radius-md 12 corner, its
  // color/primary-foreground label at 14/20 regular inset 16 px from the left.
  const action = ruleBody('.nav-top-bar-action');
  expect(action, [
    ["the node's 96 px width, kept as a minimum so a longer label grows", /min-width:\s*96px/],
    ["the node's 36 px height", /height:\s*36px/],
    ['the 16 px label inset', /padding:\s*0 16px/],
    ['the radius-md 12 corner', /border-radius:\s*var\(--zuri-nav-top-bar-control-radius\)/],
    ['the color/primary fill', /background:\s*var\(--zuri-accent\)/],
    ['the color/primary-foreground label', /color:\s*var\(--zuri-text-on-accent\)/],
    ['the 14 px label-md size', /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the 20 px label-md line height', /line-height:\s*var\(--zuri-line-height-label-md\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ["the label at the node's left edge", /justify-content:\s*flex-start/],
  ], 'the top bar action');

  // Every value has to come from the token layer, or a theme swap would leave one
  // theme's colour on the bar.
  const bodies = [bar, title, spacer, control, glyph, action].join('\n');
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(bodies)) {
    throw new Error('a top bar rule holds a literal colour instead of a token');
  }

  // Both themes must carry the component's pair, and the colours are tokens.json's
  // collections: color/surface, color/text and color/surface-secondary.
  const themeValues = [
    ['--zuri-nav-top-bar-surface: #18181b', 1, 'the dark color/surface fill'],
    ['--zuri-nav-top-bar-surface: #ffffff', 1, 'the light color/surface fill'],
    ['--zuri-nav-top-bar-title: #ecedee', 1, 'the dark color/text title'],
    ['--zuri-nav-top-bar-title: #11181c', 1, 'the light color/text title'],
    ['--zuri-nav-top-bar-icon: #ecedee', 1, 'the dark color/text glyph'],
    ['--zuri-nav-top-bar-icon: #11181c', 1, 'the light color/text glyph'],
    ['--zuri-nav-top-bar-control-surface: #27272a', 1, 'the dark color/surface-secondary control'],
    ['--zuri-nav-top-bar-control-surface: #f4f4f5', 1, 'the light color/surface-secondary control'],
    ['--zuri-nav-top-bar-radius: 14px', 2, 'the radius-lg 14 corner in both themes'],
    ['--zuri-nav-top-bar-control-radius: 12px', 2, 'the radius-md 12 corner in both themes'],
    ['--zuri-topbar-height: 56px', 2, "the node's 56 px row in both themes"],
  ];
  const missing = themeValues
    .filter(([declaration, count]) => tokens.split(declaration).length - 1 !== count)
    .map(([, , label]) => label);
  if (missing.length > 0) throw new Error(`the token layer is missing ${missing.join(', ')}`);

  return '56 px on color/surface, radius 14, 16/24 semibold name, two 44 px radius 12 controls, a 96 x 36 primary action, 20 px insets';
});


// The panel header is the caps line a nav group carries: "Caps Recent" (0:1093) over
// the thread list and "Caps Workspace" (0:1140) over the nav. The current file draws
// both with one label-caps text style on color/text-subtle, and the count on the same
// line at the row's right edge. The card still names node 0:73, which the redraw turned
// into an unrelated node, so this check follows the drawing rather than the number.
check('the Nav / Panel Header is drawn from node 0:1093: the caps line over a nav group', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // A token has to hold the node's value in both theme blocks, or a theme swap
  // changes the component behind the design's back.
  const tokenValues = (name) =>
    [...tokens.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((match) =>
      match[1].replace(/\s+/g, ' ').trim(),
    );

  const singleValue = (name, value) => {
    const values = tokenValues(name);
    if (values.length < 2) {
      throw new Error(`tokens.css declares ${name} ${values.length} time(s), not once per theme`);
    }
    const off = values.find((actual) => actual !== value);
    if (off) throw new Error(`${name} is ${off}, not the node's ${value}`);
  };

  // Node 0:1093 is a 236 x 16 strip of two texts and nothing else: no fill, stroke,
  // radius, shadow or auto layout. Both texts are 11/16 semibold with 0.66 px
  // tracking (0.06em at 11 px), in caps, on color/text-subtle.
  singleValue('--zuri-font-size-label-caps', '11px');
  singleValue('--zuri-line-height-label-caps', '16px');
  singleValue('--zuri-tracking-label-caps', '0.06em');
  singleValue('--zuri-font-weight-semibold', '600');
  singleValue('--zuri-space-1', '4px');

  // The node binds its fill to that variable instead of to a fixed grey, so the layer
  // must carry the light and the dark value the design resolves to.
  const subtle = tokenValues('--zuri-text-subtle');
  for (const [mode, value] of [['light', '#6b6b75'], ['dark', '#a1a1aa']]) {
    if (!subtle.includes(value)) throw new Error(`--zuri-text-subtle has no ${mode} value ${value}`);
  }

  const header = ruleBody('.nav-panel-header');
  const box = [
    ['a row of the two texts', /display:\s*flex/],
    ['the level pair of texts', /align-items:\s*center/],
    ["the count on the row's right edge", /justify-content:\s*space-between/],
    ['the 16 px caps row height', /height:\s*var\(--zuri-line-height-label-caps\)/],
    ["the node's 236 px column width as a fill", /width:\s*100%/],
    ["the node's 4 px text inset", /padding:\s*0 var\(--zuri-space-1\)/],
  ];
  const boxMissing = box.filter(([, pattern]) => !pattern.test(header)).map(([label]) => label);
  if (boxMissing.length > 0) throw new Error(`the panel header is missing ${boxMissing.join(', ')}`);

  // The node paints no box of its own, so a fill, outline, shadow or corner here
  // would be an addition rather than a match.
  if (/background:|border:(?!-radius)|box-shadow:|border-radius:/.test(header)) {
    throw new Error('the panel header draws a box the node does not have');
  }

  // The two texts sit on one line with no space between them: the label truncates and
  // the count keeps its width, so the row needs no gap.
  if (/\bgap:/.test(header)) throw new Error('the panel header adds a gap the node does not have');

  // A header is a label, not a control: the node draws no hover or focus state.
  if (/\.nav-panel-header[\w-]*:(?:hover|focus)/.test(css)) {
    throw new Error('the panel header has a state the node does not draw');
  }

  // The colour belongs on the node's text children, not on the row that holds them.
  if (/(^|\s)color:/.test(header)) {
    throw new Error('the row paints a text colour the node puts on its text children');
  }

  const label = ruleBody('.nav-panel-header-label');
  const count = ruleBody('.nav-panel-header-count');
  const caps = [
    ["the node's 11 px size", /font-size:\s*var\(--zuri-font-size-label-caps\)/],
    ["the node's 16 px line height", /line-height:\s*var\(--zuri-line-height-label-caps\)/],
    ['the semibold weight', /font-weight:\s*var\(--zuri-font-weight-semibold\)/],
    ["the node's 0.06em tracking", /letter-spacing:\s*var\(--zuri-tracking-label-caps\)/],
    ['the color/text-subtle fill', /color:\s*var\(--zuri-text-subtle\)/],
    ["the node's caps case", /text-transform:\s*uppercase/],
  ];
  for (const [selector, body] of [
    ['.nav-panel-header-label', label],
    ['.nav-panel-header-count', count],
  ]) {
    const missing = caps.filter(([, pattern]) => !pattern.test(body)).map(([text]) => text);
    if (missing.length > 0) throw new Error(`the panel header ${selector} is missing ${missing.join(', ')}`);
  }

  // The label ends in an ellipsis on one line (the node's textTruncation ENDING with
  // maxLines 1), and it may shrink, or the count beside it would be pushed off the row.
  if (!/text-overflow:\s*ellipsis/.test(label) || !/white-space:\s*nowrap/.test(label) || !/min-width:\s*0/.test(label)) {
    throw new Error('the panel header label wraps or overflows instead of truncating');
  }
  if (!/flex:\s*0 0 auto/.test(count)) throw new Error('the panel header count shrinks instead of holding its width');

  // Every value comes from the token layer, or the grey would stay at one theme's
  // value in the other.
  const literal = [
    ['.nav-panel-header', header],
    ['.nav-panel-header-label', label],
    ['.nav-panel-header-count', count],
  ].filter(([, source]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(source));
  if (literal.length > 0) {
    throw new Error(`the ${literal.map(([selector]) => selector).join(', ')} rule holds a literal colour`);
  }

  return '16 px caps row, 11/16 semibold tracked label and count on text-subtle, 4 px insets, no box, no gap';
});

check('the Nav / Sidebar Row is drawn from node 0:1142', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // A token has to hold the node's value in both theme blocks, or a theme swap
  // changes the component behind the design's back.
  const tokenValues = (name) =>
    [...tokens.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((match) =>
      match[1].replace(/\s+/g, ' ').trim(),
    );

  // The sidebar's row is "Nav Item Agents" (node 0:1153): a 236 x 34 box on
  // radius 12 inside the Nav List (0:1142), which stacks its rows 38 apart. Its
  // 18 px icon sits at x 12 and its label 8 px after it, which is centring plus
  // one 8 px step, not padding of its own. Unselected rows carry no fill of their
  // own - they sit on the sidebar card - and only the selected twin paints
  // primary-soft. The earlier 36 px surface-toned row this check was written
  // against no longer exists in the document.
  const row = ruleBody('.nav-sidebar-row');
  const box = [
    ['the two children on one line', /display:\s*flex/],
    ['the 34 px row height', /height:\s*34px/],
    ['the radius 12 corner', /border-radius:\s*var\(--zuri-radius-nav-row\)/],
    ['no fill on the unselected row', /background:\s*transparent/],
    ["the node's 12 px icon inset", /padding:\s*0 var\(--zuri-space-3\)/],
    ["the node's 8 px step between icon and label", /gap:\s*var\(--zuri-space-2\)/],
    ['vertical centring of both children', /align-items:\s*center/],
    ["the node's 236 px column width as a fill", /width:\s*100%/],
  ];
  const boxMissing = box.filter(([, pattern]) => !pattern.test(row)).map(([label]) => label);
  if (boxMissing.length > 0) throw new Error(`the sidebar row is missing ${boxMissing.join(', ')}`);

  // The node draws a flat fill: no outline and no shadow to add. `border: 0` is the
  // reset a <button> row needs, not an outline, so only a drawn border counts.
  if (/border:(?!\s*(?:0\b|none\b))/.test(row) || /box-shadow:/.test(row)) {
    throw new Error('the sidebar row draws a border or a shadow the node does not have');
  }

  // Node 0:1153 is the default row; the selected twin 0:1147 is what carries
  // the primary-soft fill, so the base rule must not paint it.
  if (/--zuri-active|color\/active/.test(row)) {
    throw new Error('the default sidebar row paints the Active node fill');
  }

  // The node draws the default state only, so a hover or focus paint here would
  // be a state the design does not have.
  if (/\.nav-sidebar-row[\w-]*:(?:hover|focus|active)/.test(css)) {
    throw new Error('the sidebar row has a state the node does not draw');
  }

  // The 18 px glyph is the node's color/text-subtle child, so its colour sits on
  // the icon element rather than on the row.
  const icon = ruleBody('.nav-sidebar-row-icon');
  const iconChecks = [
    ["the node's 18 px icon box", /width:\s*18px/],
    ["the node's 18 px icon height", /height:\s*18px/],
    ['the color/text-subtle glyph', /color:\s*var\(--zuri-text-subtle\)/],
  ];
  const iconMissing = iconChecks.filter(([, pattern]) => !pattern.test(icon)).map(([label]) => label);
  if (iconMissing.length > 0) throw new Error(`the sidebar row icon is missing ${iconMissing.join(', ')}`);

  // The label is the node's color/text-subtle child at 14/20.
  const label = ruleBody('.nav-sidebar-row-label');
  const labelChecks = [
    ["the node's 14 px label size", /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ["the node's 20 px label line height", /line-height:\s*var\(--zuri-line-height-nav-row\)/],
    ['the regular weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/text-subtle label colour', /color:\s*var\(--zuri-text-subtle\)/],
    ['the label held to one line', /white-space:\s*nowrap/],
  ];
  const labelMissing = labelChecks.filter(([, pattern]) => !pattern.test(label)).map(([text]) => text);
  if (labelMissing.length > 0) throw new Error(`the sidebar row label is missing ${labelMissing.join(', ')}`);

  // Every value comes from the token layer, or a theme swap would leave the row on
  // one theme's colour.
  const literal = [
    ['.nav-sidebar-row', row],
    ['.nav-sidebar-row-icon', icon],
    ['.nav-sidebar-row-label', label],
  ].filter(([, source]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(source));
  if (literal.length > 0) {
    throw new Error(`the ${literal.map(([selector]) => selector).join(', ')} rule holds a literal colour`);
  }

  // One node change, one edit: the label's line height and the row's corner are
  // token values, so changing them in open-pencil is what moves this component.
  const values = tokenValues('--zuri-line-height-nav-row');
  if (values.length < 2) {
    throw new Error(`tokens.css declares --zuri-line-height-nav-row ${values.length} time(s), not once per theme`);
  }
  const off = values.find((actual) => actual !== '20px');
  if (off) throw new Error(`--zuri-line-height-nav-row is ${off}, not the node's 20px`);

  const radii = tokenValues('--zuri-radius-nav-row');
  if (radii.length < 2) {
    throw new Error(`tokens.css declares --zuri-radius-nav-row ${radii.length} time(s), not once per theme`);
  }
  const radiusOff = radii.find((actual) => actual !== '12px');
  if (radiusOff) throw new Error(`--zuri-radius-nav-row is ${radiusOff}, not the node's 12px`);

  return '236 fill x 34, radius 12, no fill, 18 px subtle icon at 12 px, 14/20 regular subtle label 8 px after it';
});

check('the Nav / Sidebar Row Active paints the row the design draws as current', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(selector + ' {');
    if (at === -1) throw new Error('components.css has no rule for ' + selector);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  const themeBlock = (selector) => {
    const at = tokens.indexOf(selector);
    if (at === -1) throw new Error('tokens.css has no ' + selector + ' block');
    const open = tokens.indexOf('{', at);
    let depth = 0;
    for (let index = open; index < tokens.length; index += 1) {
      if (tokens[index] === '{') depth += 1;
      if (tokens[index] === '}') depth -= 1;
      if (depth === 0) return tokens.slice(open + 1, index);
    }
    throw new Error('the ' + selector + ' block is not closed');
  };

  const tokenValue = (selector, name) => {
    const match = themeBlock(selector).match(new RegExp(name + ':[^;]+;'));
    if (!match) throw new Error(selector + ' has no ' + name);
    const body = match[0];
    return body.slice(body.indexOf(':') + 1, -1).trim();
  };

  const ACTIVE = ".nav-sidebar-row[aria-current='page']";

  // The sidebar binds the current row's fill to primary-soft: "Nav Item Chats
  // Active" reads #E6F1FE light (node 0:1147) and #001731 dark (node 0:1256). The
  // fill plus the primary-soft-foreground glyph and label are the whole cue; any
  // other value would be a colour the design never drew.
  const active = ruleBody(ACTIVE);
  if (!/background:\s*var\(--zuri-primary-soft\)/.test(active)) {
    throw new Error('the selected sidebar row is not filled with the primary-soft token');
  }

  // Paint only. A second copy of a measurement would be a place for a node change
  // to go unapplied, so the selected row inherits the box from .nav-sidebar-row.
  const copied = [
    ['height', /(?:^|[\s;])height:/],
    ['width', /(?:^|[\s;])width:/],
    ['padding', /(?:^|[\s;])padding/],
    ['gap', /(?:^|[\s;])gap:/],
    ['display', /(?:^|[\s;])display:/],
    ['border-radius', /border-radius:/],
    ['margin', /(?:^|[\s;])margin/],
    ['font-size', /font-size:/],
    ['line-height', /line-height:/],
    ['letter-spacing', /letter-spacing:/],
  ]
    .filter(([, pattern]) => pattern.test(active))
    .map(([label]) => label);
  if (copied.length > 0) {
    throw new Error('the active sidebar row restates ' + copied.join(', ') + ' instead of inheriting the base row');
  }

  // The one cue the selected node adds next to the fill: the glyph and the label
  // leave the subtle tone for primary-soft-foreground. The node draws the label at
  // the same 400 weight in both states, so the state must not restate it.
  const icon = ruleBody(ACTIVE + ' .nav-sidebar-row-icon');
  if (!/color:\s*var\(--zuri-primary-soft-foreground\)/.test(icon)) {
    throw new Error('the selected row keeps the subtle icon instead of the primary tone');
  }

  const label = ruleBody(ACTIVE + ' .nav-sidebar-row-label');
  if (!/color:\s*var\(--zuri-primary-soft-foreground\)/.test(label)) {
    throw new Error('the selected row keeps the subtle label instead of the primary tone');
  }
  if (/font-weight:/.test(label)) {
    throw new Error('the selected row restates the label weight; the node draws 400 in both states');
  }

  for (const [part, body] of [['fill', active], ['icon', icon], ['label', label]]) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(body)) {
      throw new Error('the active row ' + part + ' holds a literal colour instead of a token');
    }
  }

  // primary-soft is the design's own pair, so a theme swap picks up the dark twin
  // without a derived colour: the light tint left on the dark panel would read as
  // a bright block rather than a selected row.
  const expected = {
    dark: { soft: '#001731', foreground: '#338ef7' },
    light: { soft: '#e6f1fe', foreground: '#005bc4' },
  };
  for (const [theme, values] of Object.entries(expected)) {
    const selector = ':root[data-theme="' + theme + '"]';
    const soft = tokenValue(selector, '--zuri-primary-soft');
    if (soft !== values.soft) {
      throw new Error('--zuri-primary-soft in ' + selector + ' is ' + soft + ', not the design node value ' + values.soft);
    }
    const foreground = tokenValue(selector, '--zuri-primary-soft-foreground');
    if (foreground !== values.foreground) {
      throw new Error(
        '--zuri-primary-soft-foreground in ' + selector + ' is ' + foreground + ', not the design node value ' + values.foreground,
      );
    }
  }

  // One node, one component: the selected state is an attribute on the row the
  // base rule already styles, so a second row class would be a copy of the box.
  if (/\.nav-sidebar-row-active\s*\{/.test(css)) {
    throw new Error('the active state copies the row into a second class');
  }
  if (!/aria-current/.test(css)) {
    throw new Error('components.css does not document how a row is marked current');
  }

  return 'the same row, filled with primary-soft and moved to the primary tone when aria-current="page"; no geometry and no weight of its own';
});

check('the Sidebar conversation list page is drawn from node 0:1075', () => {
  const css = read('src/renderer/styles/components.css');
  const markup = read('src/renderer/index.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open)).replace(/\s+/g, ' ');
  };
  // The panel is declared twice: the grid column first, then the floating card the
  // page actually draws, so the card is the later rule.
  const lastRule = (selector) => {
    const at = css.lastIndexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open)).replace(/\s+/g, ' ');
  };

  // The panel (0:1077) is one card floating on the shell's 12 px gutter: the glass
  // fill and hairline, radius 20 and the node's soft shadow, not a column flush
  // with the window edge.
  const panel = lastRule('.shell-column-sidebar');
  const panelDrawn = [
    ['the 12 px gutter', /margin:\s*var\(--zuri-shell-gutter\) 0 var\(--zuri-shell-gutter\) var\(--zuri-shell-gutter\)/],
    ['the glass fill', /background:\s*var\(--zuri-glass-card-surface\)/],
    ['the glass hairline', /border:\s*1px solid var\(--zuri-glass-card-border\)/],
    ['the card radius', /border-radius:\s*var\(--zuri-glass-card-radius\)/],
    ['the raised shadow', /box-shadow:\s*var\(--zuri-shadow-raised\)/],
  ];
  const panelMissing = panelDrawn.filter(([, pattern]) => !pattern.test(panel)).map(([label]) => label);
  if (panelMissing.length > 0) throw new Error(`the sidebar card is missing ${panelMissing.join(', ')}`);

  // The list of conversations: 46 px rows 2 px apart (0:1097), each row a 22 px mode
  // tile at x 10 with the title and time beside it.
  const threadRow = ruleBody('.thread-row');
  const threadList = ruleBody('.thread-list');
  const listDrawn = [
    ['the 46 px row', threadRow, /height:\s*46px/],
    ['the row radius', threadRow, /border-radius:\s*var\(--zuri-radius-lg\)/],
    ['the 10 px row inset', threadRow, /padding:\s*0 10px/],
    ['rows 2 px apart', threadList, /gap:\s*calc\(var\(--zuri-space-1\) \/ 2\)/],
    ['the 14/20 title', ruleBody('.thread-row-title'), /font-size:\s*var\(--zuri-font-size-label-md\)/],
    ['the 13 px time', ruleBody('.thread-row-time'), /font-size:\s*var\(--zuri-font-size-body-sm\)/],
  ];
  const listMissing = listDrawn.filter(([, body, pattern]) => !pattern.test(body)).map(([label]) => label);
  if (listMissing.length > 0) throw new Error(`the conversation list is missing ${listMissing.join(', ')}`);

  // Navigation (0:1142): eight 34 px rows 4 px apart, headed by the New chat action
  // (0:1146) and carrying the count badge the node draws on the Chats row (0:1151).
  const row = ruleBody('.nav-sidebar-row');
  const nav = ruleBody('.sidebar-nav');
  const badge = ruleBody('.nav-row-count');
  const navDrawn = [
    ['the 34 px row', row, /height:\s*34px/],
    ['4 px between rows', nav, /gap:\s*var\(--zuri-space-1\)/],
    ['the list 12 px inset', nav, /padding:\s*0 var\(--zuri-space-3\) var\(--zuri-space-3\)/],
    ['the 40 px New chat action', ruleBody('.sidebar-new-chat'), /height:\s*40px/],
    ['the 22 px badge width', badge, /min-width:\s*22px/],
    ['the 16 px badge height', badge, /height:\s*16px/],
    ['the pill badge', badge, /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the badge on the accent', badge, /background:\s*var\(--zuri-accent\)/],
    ['the 11/16 badge numeral', badge, /font-size:\s*var\(--zuri-font-size-label-caps\)/],
  ];
  const navMissing = navDrawn.filter(([, body, pattern]) => !pattern.test(body)).map(([label]) => label);
  if (navMissing.length > 0) throw new Error(`the sidebar nav is missing ${navMissing.join(', ')}`);

  // The rail: with the name gone, the mark and the collapse toggle stack, which is
  // 88 px of column against the 40 px the expanded row is fixed at. Leaving that
  // height on let the toggle spill out of the row and draw on top of New chat, so
  // the rail read as a blue block with an icon through it.
  const rail = ruleBody(".shell-column-sidebar[data-collapsed='true'] .sidebar-brand");
  if (!/height:\s*auto/.test(rail)) {
    throw new Error('the collapsed brand row keeps a fixed height, so the mark and the toggle overflow it');
  }
  if (!/flex-direction:\s*column/.test(rail)) {
    throw new Error('the collapsed brand row does not stack its mark over the toggle');
  }
  // The 13 px subtitle is wider than the 64 px rail, so it has to go with the name,
  // otherwise it draws across the rail's edge.
  if (!/\[data-collapsed='true'\] \.sidebar-brand-sub \{[\s\S]{0,160}?display:\s*none/.test(css)) {
    throw new Error('the collapsed rail still draws the brand subtitle');
  }
  // The markup is the node's list in the node's order. The New chat row is an
  // action, not a destination: if it carried a route the router would mark it
  // current beside the Chats row, and the list would show two places at once.
  const navStart = markup.indexOf('id="sidebar-nav"');
  if (navStart === -1) throw new Error('index.html has no #sidebar-nav');
  const navBlock = markup.slice(navStart, markup.indexOf('</nav>', navStart));
  const routes = [...navBlock.matchAll(/data-route="([a-z]+)"/g)].map((match) => match[1]);
  const expected = ['chats', 'agents', 'tasks', 'reminders', 'automations', 'files', 'settings'];
  if (routes.join(',') !== expected.join(',')) {
    throw new Error(`the nav lists ${routes.join(', ')}; the node draws New chat then ${expected.join(', ')}`);
  }
  const rowCount = (navBlock.match(/class="nav-sidebar-row"/g) ?? []).length;
  if (rowCount !== expected.length + 1) {
    throw new Error(`the nav draws ${rowCount} rows; node 0:1142 draws eight`);
  }

  const tagStart = navBlock.indexOf('class="nav-sidebar-row"');
  const firstTag = navBlock.slice(tagStart, navBlock.indexOf('>', tagStart));
  if (!/data-action="new-chat"/.test(firstTag)) {
    throw new Error('the first row is not the New chat action node 0:1146 draws');
  }
  if (/data-route=|aria-current/.test(firstTag)) {
    throw new Error('the New chat row is a destination, so the nav would show two current rows');
  }
  if (!/id="sidebar-chats-count"/.test(navBlock)) {
    throw new Error('the Chats row carries no count badge');
  }

  return 'the 260 px glass card on the 12 px gutter, 46 px thread rows, and the eight-row nav headed by New chat with the Chats count';
});

check('the App shell holds node 0:131 as one set of tokens', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const markup = read('src/renderer/index.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const blockOf = (theme) => {
    const start = tokens.indexOf(`:root[data-theme="${theme}"] {`);
    if (start === -1) throw new Error(`tokens.css has no ${theme} block`);
    return tokens.slice(start, tokens.indexOf('\n}', start));
  };
  const tokenValue = (theme, name) => {
    const match = blockOf(theme).match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`the ${theme} theme has no ${name}`);
    return match[1].replace(/\s+/g, ' ').trim();
  };

  // The current shell frame is "01 App Shell Light" (0:466, 1200x800): a full-height
  // 260 px Sidebar (0:467), a 12 px Rail Left (0:538), then a Workspace (0:540) whose
  // own 56 px Top Bar (0:541) sits over a Content Row (0:564) of Main Column 616,
  // Rail Right 12 and Context Panel 300. The earlier 1440-wide 52 px bar with a
  // 320 px rail no longer exists in the document, so those numbers are replaced
  // here rather than kept beside the new ones.
  const frame = [
    ['--zuri-sidebar-width', '260px'],
    ['--zuri-shell-topbar-height', '56px'],
    ['--zuri-context-panel-width', '300px'],
    ['--zuri-shell-gutter', '12px'],
  ];
  for (const theme of ['dark', 'light']) {
    for (const [name, value] of frame) {
      const actual = tokenValue(theme, name);
      if (actual !== value) throw new Error(`${name} in ${theme} is ${actual}, node 0:466 draws ${value}`);
    }
  }
  // The centre is the remainder of the frame, not a fourth number to keep:
  // 1200 - 260 - 12 - 300 - 12 = 616.
  if (260 + 12 + 300 + 12 >= 1200) throw new Error('the two panels leave no centre in the frame');

  const bar = ruleBody('.top-bar');
  const sidebar = ruleBody('.shell-column-sidebar');
  const chat = ruleBody('.shell-column-chat');
  const rail = ruleBody('.shell-column-context');
  const button = ruleBody('.top-bar-button');
  const title = ruleBody('.top-bar-title');
  const model = ruleBody('.top-bar-model');

  const drawn = [
    ["the frame's 56 px bar", bar, /height:\s*var\(--zuri-shell-topbar-height\)/],
    ["the frame's 1 px hairline under the bar", bar, /border-bottom:\s*1px solid var\(--zuri-border-hairline\)/],
    ["the frame's 16 px insets", bar, /padding:\s*0 var\(--zuri-space-4\)/],
    ["the reading surface behind the bar", bar, /background:\s*var\(--zuri-surface\)/],
    ["the 260 px sidebar", sidebar, /width:\s*var\(--zuri-sidebar-width\)/],
    ['the panel tone on the sidebar', sidebar, /background:\s*var\(--zuri-surface-secondary\)/],
    ['a centre that takes what the panels leave', chat, /flex:\s*1 1 auto/],
    ['the reading surface on the centre', chat, /background:\s*var\(--zuri-surface\)/],
    ['the 300 px context panel', rail, /width:\s*var\(--zuri-context-panel-width\)/],
    ['the 12 px rail before the context panel', rail, /margin-left:\s*var\(--zuri-shell-gutter\)/],
    ['the panel tone on the context panel', rail, /background:\s*var\(--zuri-surface-secondary\)/],
    ["the frame's 32 px controls", button, /width:\s*32px/],
    ["the frame's 32 px control height", button, /height:\s*32px/],
    ['radius 9 on the controls', button, /border-radius:\s*var\(--zuri-radius-search\)/],
    ["the frame's 15/18 section title", title, /font-size:\s*15px/],
    ["the frame's 18 px title line", title, /line-height:\s*18px/],
    ['radius/pill on the model chip', model, /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the panel tone on the model chip', model, /background:\s*var\(--zuri-surface-secondary\)/],
  ];
  const missing = drawn.filter(([, source, pattern]) => !pattern.test(source)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the shell is missing ${missing.join(', ')}`);

  // A literal colour in any of these rules would pin one theme and ignore the
  // design's second colour collection.
  const literals = [bar, sidebar, chat, rail, button, title, model].filter((rule) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(rule));
  if (literals.length > 0) throw new Error('a shell rule holds a literal colour instead of a token');

  // The markup is the node's parts in the node's order, and it names the node so
  // the next reader can see where the numbers came from. The current frame draws the
  // bar across the whole window, and the sidebar is a card inside the body row under
  // it (the "Sidebar conversation list" panel, node 0:1075, is inset 12 from the
  // window edge), so the bar comes first: bar, then sidebar, then the workspace
  // holding the centre and the rail. The earlier frame put the bar (0:541) inside
  // the workspace; its 260 / 56 / 300 / 12 numbers are the ones the tokens still
  // carry, so the order of the regions changed, not their sizes.
  const regions = ['class="top-bar"', 'id="sidebar"', 'class="workspace"', 'id="chat"', 'id="context-panel"'].map((needle) => markup.indexOf(needle));
  if (regions.includes(-1)) throw new Error('index.html is missing one of the shell regions the node draws');
  if (regions.join(',') !== [...regions].sort((left, right) => left - right).join(',')) {
    throw new Error('the shell regions are not in the node order: the window-wide bar, then the sidebar, then the workspace (the centre and the rail)');
  }
  if (!markup.includes('design node 0:131')) throw new Error('index.html does not name node 0:131 as its source');

  return '56 px bar across the window over 260 / 616 / 300, insets and gaps as tokens, every theme value declared';
});

check('the First-run welcome page is drawn from node 0:2328', () => {
  const css = read('src/renderer/views/onboarding.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const markup = read('src/renderer/views/onboarding.html');
  const script = read('src/renderer/views/onboarding.js');

  // The selector may head a rule on its own or sit in a comma list with its
  // siblings (the three states that outline the field in danger), so take the
  // block that follows whichever occurrence comes first.
  const ruleBody = (selector) => {
    const at = css.indexOf(selector);
    if (at === -1) throw new Error(`onboarding.css has no ${selector} rule`);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    if (open === -1 || close === -1) throw new Error(`onboarding.css has no ${selector} rule`);
    return css.slice(open + 1, close).replace(/\s+/g, ' ');
  };
  const needs = (selector, declarations) => {
    const body = ruleBody(selector);
    const missing = declarations.filter(([, pattern]) => !pattern.test(body)).map(([label]) => label);
    if (missing.length > 0) throw new Error(`${selector} is missing ${missing.join(', ')}, node 0:2328 draws it`);
  };
  const scoped = (selector) => {
    const at = tokens.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`tokens.css has no ${selector} block`);
    return tokens.slice(at, tokens.indexOf('\n}', at));
  };
  const valueOf = (source, name, where) => {
    const found = source.match(new RegExp(`--zuri-onboarding-${name}:\\s*([^;]+);`));
    if (!found) throw new Error(`${where} has no --zuri-onboarding-${name}`);
    return found[1].replace(/\s+/g, ' ').replace(/\/\*[\s\S]*?\*\//, '').trim();
  };
  const block = scoped('.onboarding-page');
  const darkBlock = scoped(":root[data-theme='dark'] .onboarding-page");

  // The palette belongs to the node, so the file says which one it came from.
  if (!tokens.includes('First-run welcome / provider setup (design node 0:2328)')) {
    throw new Error('tokens.css does not name node 0:2328 for this page');
  }

  // Frame 01 (0:2329) is the light collection; these are the collection variable
  // names the card's layers are bound to.
  const light = {
    canvas: '#fafafa',
    surface: '#ffffff',
    'surface-secondary': '#f4f4f5',
    'surface-tertiary': '#e4e4e7',
    'surface-quaternary': '#d4d4d8',
    text: '#11181c',
    'text-subtle': '#6b6b75',
    primary: '#006fee',
    'primary-foreground': '#ffffff',
    'primary-soft': '#e6f1fe',
    'primary-soft-foreground': '#005bc4',
    danger: '#f31260',
    'danger-soft': '#fdd8e5',
    'danger-soft-foreground': '#b80e4d',
    'success-soft': '#d3f7e3',
    'success-soft-foreground': '#0a7a3d',
    'wash-primary': '#e6f1fe',
    'wash-secondary': '#f2eafa',
  };
  for (const [name, expected] of Object.entries(light)) {
    const actual = valueOf(block, name, 'the .onboarding-page block');
    if (actual !== expected) throw new Error(`--zuri-onboarding-${name} is ${actual}, node 0:2328 binds ${expected}`);
  }

  // Frame 02 (0:2423) draws the same card after the theme step switched to dark, so
  // the page needs the dark collection under the same names or the card stays white.
  const dark = {
    canvas: '#0a0a0b',
    surface: '#18181b',
    'surface-secondary': '#27272a',
    'surface-tertiary': '#3f3f46',
    'surface-quaternary': '#52525b',
    text: '#ecedee',
    'text-subtle': '#a1a1aa',
    'primary-soft': '#001731',
    'primary-soft-foreground': '#338ef7',
    'wash-primary': '#001731',
    'wash-secondary': '#2a0e45',
  };
  for (const [name, expected] of Object.entries(dark)) {
    const actual = valueOf(darkBlock, name, 'the dark .onboarding-page block');
    if (actual !== expected) throw new Error(`the dark --zuri-onboarding-${name} is ${actual}, frame 0:2423 binds ${expected}`);
  }

  // The alphas the node paints: the 8% divider, the 14% scrim and the card shadow.
  if (valueOf(block, 'divider', 'the light block') !== 'rgba(17, 17, 17, 0.08)') {
    throw new Error("the card divider is not the node's #111111 at 8%");
  }
  if (valueOf(block, 'scrim', 'the light block') !== 'rgba(0, 0, 0, 0.14)') {
    throw new Error("the scrim is not the node's 14% black");
  }
  if (valueOf(block, 'card-shadow', 'the light block') !== '0 8px 32px rgba(15, 23, 42, 0.08)') {
    throw new Error("the card shadow is not the node's 0/8/32 shadow");
  }

  // One name list, two values: a name added to one block and not the other leaves
  // the dark card on a light colour.
  const names = (source) => [...source.matchAll(/--zuri-onboarding-([a-z-]+):/g)].map((match) => match[1]).sort();
  const lightNames = names(block);
  const darkNames = names(darkBlock);
  if (lightNames.length !== 30) throw new Error(`the light block declares ${lightNames.length} names, node 0:2328 needs 30`);
  if (lightNames.join(',') !== darkNames.join(',')) {
    throw new Error('the dark block does not declare the same names as the light one');
  }

  // Every colour comes from that block, and every name in it is read: a token no
  // rule uses is a leftover from another drawing.
  const unused = lightNames.filter((name) => !css.includes(`var(--zuri-onboarding-${name})`));
  if (unused.length > 0) {
    throw new Error(`onboarding.css never reads ${unused.map((name) => `--zuri-onboarding-${name}`).join(', ')}`);
  }
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) {
    throw new Error('onboarding.css holds a literal colour; the palette belongs in tokens.css');
  }

  // The card 520 x 426 at the centre of the 1200 x 800 frame: radius/2xl 24 with 32
  // padding, the node's shadow, and a 44 px badge at radius/lg 14.
  needs('.onboarding-card', [
    ["the node's 520 px width", /width:\s*520px/],
    ["the node's 32 px padding", /padding:\s*32px/],
    ['radius/2xl 24', /border-radius:\s*24px/],
    ['the card shadow token', /box-shadow:\s*var\(--zuri-onboarding-card-shadow\)/],
    ['the surface fill', /background:\s*var\(--zuri-onboarding-surface\)/],
  ]);
  needs('.onboarding-badge', [
    ['the 44 px badge', /width:\s*44px/],
    ['the 44 px badge height', /height:\s*44px/],
    ['radius/lg 14', /border-radius:\s*14px/],
    ['the primary-soft fill', /background:\s*var\(--zuri-onboarding-primary-soft\)/],
  ]);
  needs('.onboarding-title', [['the 28 px title', /font-size:\s*28px/], ['the 36 px title line', /line-height:\s*36px/]]);
  needs('.onboarding-subtitle', [['the 14 px subtitle', /font-size:\s*14px/], ['the 22 px subtitle line', /line-height:\s*22px/]]);

  // Three 144 x 4 bars on a 12 px gap: 520 - 2 x 32 padding - 2 x 12 = 432 / 3 = 144.
  needs('.onboarding-progress', [['the 12 px bar gap', /gap:\s*12px/]]);
  needs('.onboarding-step-bar', [
    ['the 4 px bar', /height:\s*4px/],
    ['radius/full', /border-radius:\s*999px/],
    ['surface-tertiary ahead of the current step', /background:\s*var\(--zuri-onboarding-surface-tertiary\)/],
  ]);
  needs('.onboarding-step-caption', [['the 13 px step label', /font-size:\s*13px/], ['the 20 px step line', /line-height:\s*20px/]]);

  // The form: a 14 px label over a 456 x 40 field at radius/md 12, the 13 px note, the
  // 1 px divider, then the 36 px buttons.
  needs('.onboarding-label', [['the 14 px field label', /font-size:\s*14px/]]);
  needs('.onboarding-input-wrap', [
    ['the 40 px field', /height:\s*40px/],
    ['radius/md 12', /border-radius:\s*12px/],
    ['the surface-secondary fill', /background:\s*var\(--zuri-onboarding-surface-secondary\)/],
  ]);
  needs('.onboarding-divider', [['the 1 px rule', /height:\s*1px/], ['the divider token', /background:\s*var\(--zuri-onboarding-divider\)/]]);
  needs('.onboarding-button', [
    ['the 36 px button', /height:\s*36px/],
    ['radius/md 12', /border-radius:\s*12px/],
    ['the 14 px label', /font-size:\s*14px/],
  ]);
  needs('.onboarding-privacy-text', [['the 13 px privacy line', /font-size:\s*13px/]]);

  // The window the card sits in: a 48 px top bar, a 260 px sidebar, the two washes at
  // the node's offsets, and the scrim over both.
  needs('.onboarding-topbar', [['the 48 px top bar', /height:\s*48px/]]);
  needs('.onboarding-sidebar', [['the 260 px sidebar', /width:\s*260px/]]);
  needs('.onboarding-wash-primary', [
    ['the 720 px wash', /width:\s*720px/],
    ['the 540 px wash', /height:\s*540px/],
    ['the -140 left offset', /left:\s*-140px/],
    ['the -180 top offset', /top:\s*-180px/],
  ]);
  needs('.onboarding-wash-secondary', [
    ['the 600 px wash', /width:\s*600px/],
    ['the 440 px wash', /height:\s*440px/],
    ['the -180 right offset', /right:\s*-180px/],
    ['the -60 bottom offset', /bottom:\s*-60px/],
  ]);

  // The frames that redraw the card rather than filling it.
  needs(".onboarding-card[data-state='success'] .onboarding-badge", [
    ['the 64 px success badge', /width:\s*64px/],
    ['the 64 px success badge height', /height:\s*64px/],
    ['the success-soft fill', /background:\s*var\(--zuri-onboarding-success-soft\)/],
  ]);
  needs(".onboarding-card[data-state='success'] .onboarding-title", [
    ['the 24 px confirmation', /font-size:\s*24px/],
    ['the 32 px confirmation line', /line-height:\s*32px/],
  ]);
  needs('.onboarding-success-status', [['the 13 px status line', /font-size:\s*13px/]]);
  needs(".onboarding-card[data-state='success'] .onboarding-success-status", [
    ['the status line shown on the confirmation only', /display:\s*flex/],
  ]);
  needs(".onboarding-card[data-state='name-error'] .onboarding-input-wrap", [
    ['the danger outline', /border-color:\s*var\(--zuri-onboarding-danger\)/],
  ]);

  // The four states that reuse a drawing still have to show the block they are
  // about, or opening them would look like the frame they borrow.
  needs(".onboarding-card[data-state='error'] .onboarding-alert", [
    ['the alert reveal', /display:\s*grid/],
  ]);
  needs(".onboarding-card[data-state='loading'] .onboarding-spinner", [
    ['the in-flight spinner', /display:\s*block/],
  ]);
  needs(".onboarding-card[data-state='disabled'] .onboarding-button", [
    ['the dimmed controls', /opacity:\s*0\.4/],
  ]);

  // One state per drawn frame: frames 01 to 08, in the order the canvas draws them.
  // Frame 09 draws the workspace's skip banner, not this card, so it is not a state.
  const states = script.match(/ONBOARDING_STATES = \[([\s\S]*?)\]/);
  if (!states) throw new Error('onboarding.js no longer exports ONBOARDING_STATES');
  const drawn = ['name', 'name-error', 'theme', 'key', 'key-too-short', 'key-rejected', 'saving', 'success'];
  const present = [...states[1].matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
  // Four states every page opens on, after the drawn eight: nothing answered yet,
  // a save in flight, a save that cannot be made, and no main process to answer at
  // all. The page check opens them, so the list has to name them.
  const pageStates = ['empty', 'loading', 'error', 'disabled'];
  const missingStates = pageStates.filter((name) => !present.includes(name));
  if (missingStates.length > 0) {
    throw new Error(`the page does not declare the ${missingStates.join(', ')} state(s) every page opens on`);
  }
  if (present.length !== drawn.length + pageStates.length) {
    throw new Error(`the page declares ${present.length} states, not ${drawn.length} drawn and ${pageStates.length} page states`);
  }
  if (present.slice(0, drawn.length).join(',') !== drawn.join(',')) {
    throw new Error(`the page draws ${present.slice(0, drawn.length).join(', ')}, node 0:2328 draws ${drawn.join(', ')}`);
  }

  // The frames' own sentences, as the page writes them.
  const copy = [
    ['frame 01 title', script, 'Welcome to Zuri'],
    ['frame 01 subtitle', script, 'Three quick steps, then your workspace is ready.'],
    ['frame 01 field label', script, 'Your name'],
    ['frame 01 note', script, 'Zuri greets you with this name and signs your notes.'],
    ['frame 01 privacy line', script, 'Keys are stored locally in secrets.json. Nothing leaves this PC.'],
    ['frame 01 primary label', script, "label: 'Continue'"],
    ['frame 01 skip label', markup, 'Skip for now'],
    ['frame 02 title', script, 'Pick a theme'],
    ['frame 03 title', script, 'Connect your provider'],
    ['frame 03 subtitle', script, 'Paste an API key so Ask, Act and Autopilot can run.'],
    ['frame 04 error line', script, 'Enter your name to continue.'],
    ['frame 05 error line', script, 'A provider key is at least 20 characters.'],
    ['frame 06 alert title', script, 'That key was rejected by your provider.'],
    ['frame 06 error line', script, 'Zuri could not save this key.'],
    ['frame 07 title', script, 'Finishing setup'],
    ['frame 08 title', script, "You're all set, {name}"],
    ['frame 08 body', script, 'Settings saved and your key is stored on this PC.'],
    ['frame 08 summary', markup, 'Name, theme and key saved'],
    ['frame 08 status line', markup, 'Opening your chat workspace'],
    ['frame 08 primary label', script, 'Open chat'],
    ['frame 08 privacy line', script, 'You can change the theme or key any time in Settings.'],
  ];
  for (const [part, source, sentence] of copy) {
    if (!source.includes(sentence)) throw new Error(`the page no longer draws the ${part} as "${sentence}"`);
  }

  return '1200 x 800 window, 520 x 426 card at radius 24 with a 44 px badge, 144 x 4 step bars, 40 px field, 36 px buttons, eight drawn states plus empty, loading, error and disabled, light and dark collections';
});

check('the Autopilot right rail is drawn from node 0:6978', () => {
  const css = read('src/renderer/views/reminders.css');
  const markup = read('src/renderer/views/reminders.html');
  const script = read('src/renderer/views/reminders.js');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`reminders.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:6978 draws the rail five times over one 320 px column: 0:6979 live,
  // 0:7068 empty, 0:7102 loading, 0:7143 error, 0:7172 collapsed. Every number
  // below is one of those frames; the CSS reads the palette from the token layer
  // so a node change is a token edit rather than a second copy of the picture.
  const frame = ruleBody('.rail-frame');
  const rail = ruleBody('.rail');
  const header = ruleBody('.rail-header');
  const collapse = ruleBody('.rail-collapse');
  const title = ruleBody('.rail-title');
  const status = ruleBody('.rail-status');
  const dot = ruleBody('.rail-status-dot');
  const divider = ruleBody('.rail-divider');
  const body = ruleBody('.rail-body');
  const section = ruleBody('.rail-section');
  const head = ruleBody('.rail-section-head');
  const label = ruleBody('.rail-label');
  const countStart = ruleBody('.rail-count-start');
  const card = ruleBody('.rail-card');
  const reminderHead = ruleBody('.reminder-head');
  const reminderTitle = ruleBody('.reminder-title');
  const reminderMeta = ruleBody('.reminder-meta');
  const badge = ruleBody('.reminder-badge');
  const actions = ruleBody('.reminder-actions');
  const button = ruleBody('.rail-button');
  const buttonOutline = ruleBody('.rail-button-outline');
  const taskRow = ruleBody('.task-row');
  const taskCheck = ruleBody('.task-check');
  const taskTitle = ruleBody('.task-title');
  const taskMeta = ruleBody('.task-meta');
  const more = ruleBody('.rail-more');
  const automationInner = ruleBody('.automation-inner');
  const automationHead = ruleBody('.automation-head');
  const track = ruleBody('.automation-track');
  const fillRunning = ruleBody('.automation-card[data-tone="running"] .automation-fill');
  const fillQueued = ruleBody('.automation-card[data-tone="queued"] .automation-fill');
  const quiet = ruleBody('.rail-quiet');
  const skeletonLabel = ruleBody('.rail-skeleton-label');
  const skeletonCard = ruleBody('.rail-skeleton-card');
  const errorCard = ruleBody('.rail-card-error');
  const errorTitle = ruleBody('.rail-error-title');
  const errorBody = ruleBody('.rail-error-body');
  const loadingNote = ruleBody('.rail-loading-note');
  const collapsedBadge = ruleBody('.rail-collapsed-badge');
  const collapsedIcon = ruleBody('.rail-collapsed-icon');


  const drawn = [
    ['the 340 px artboard (320 rail, 19 gutter, 1 page edge)', frame, /width:\s*340px/],
    ['the 320 px rail', rail, /width:\s*var\(--zuri-right-panel-width\)/],
    ["the node's 76 px header", header, /height:\s*76px/],
    ["the node's 12 px side inset", header, /padding:\s*0 var\(--zuri-space-3\)/],
    ['the 8 px button-to-titles gap', header, /gap:\s*var\(--zuri-space-2\)/],
    ["the node's 44 px collapse button", collapse, /width:\s*44px/],
    ['a square button', collapse, /height:\s*44px/],
    ['radius/row on the button', collapse, /border-radius:\s*var\(--zuri-radius-sm\)/],
    ['the button fill', collapse, /background:\s*var\(--zuri-rail-fill\)/],
    ['the button glyph colour', collapse, /color:\s*var\(--zuri-rail-text-secondary\)/],
    ["the node's 16 px panel title", title, /font-size:\s*var\(--zuri-font-size-heading-sm\)/],
    ['the 24 px title line', title, /line-height:\s*var\(--zuri-line-height-heading-sm\)/],
    ['a medium-weight title', title, /font-weight:\s*var\(--zuri-font-weight-medium\)/],
    ["the node's 16 px status row", status, /height:\s*16px/],
    ["the node's 12 px status line", status, /font-size:\s*var\(--zuri-rail-meta-size\)/],
    ['a muted status line', status, /color:\s*var\(--zuri-rail-text-muted\)/],
    ["the node's 6 px status dot", dot, /width:\s*6px/],
    ['a pill dot', dot, /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the running dot', dot, /background:\s*var\(--zuri-rail-success\)/],
    ['a 1 px header divider', divider, /height:\s*1px/],
    ["the node's 12 px divider inset", divider, /margin:\s*0 var\(--zuri-space-3\)/],
    ['one 24 px gap between the live sections', body, /gap:\s*var\(--zuri-space-6\)/],
    ["the node's 27 px first-section offset", body, /padding:\s*27px var\(--zuri-space-4\) var\(--zuri-space-4\)/],
    // The empty and loading frames share one grouped rule, so both are read from
    // the sheet rather than from a single selector body.
    ["the node's 20 px gap in the empty and loading frames", css, /\[data-state="empty"\] \.rail-body,[\s\S]*?gap:\s*var\(--zuri-space-5\)/],
    ["the node's 16 px gap in the error frame", css, /\[data-state="error"\] \.rail-body \{\s*gap:\s*var\(--zuri-space-4\)/],
    ['an 8 px gap inside a section', section, /gap:\s*var\(--zuri-space-2\)/],
    ["the node's 18 px section head", head, /height:\s*18px/],
    ["the node's 4 px under the label", head, /padding-bottom:\s*var\(--zuri-space-1\)/],
    ["the node's 11 px section label", label, /font-size:\s*var\(--zuri-rail-label-size\)/],
    ['the label tracking', label, /letter-spacing:\s*var\(--zuri-rail-label-tracking\)/],
    ['an upper-case label', label, /text-transform:\s*uppercase/],
    ['a muted label', label, /color:\s*var\(--zuri-rail-text-muted\)/],
    ['"2 running" at x 145, not at the right edge', countStart, /left:\s*145px/],
    ['the running count in the accent', countStart, /color:\s*var\(--zuri-rail-accent\)/],
    ["the node's 12 px card padding", card, /padding:\s*var\(--zuri-space-3\)/],
    ['an 8 px gap inside a card', card, /gap:\s*var\(--zuri-space-2\)/],
    ['radius/card on the card', card, /border-radius:\s*var\(--zuri-radius-card\)/],
    ['the card hairline as an inset stroke, so the 66 px card stays 66', card, /box-shadow:\s*inset 0 0 0 1px var\(--zuri-rail-border\)/],
    ["the node's 18 px reminder head", reminderHead, /min-height:\s*18px/],
    ["the node's 13 px reminder title", reminderTitle, /font-size:\s*var\(--zuri-rail-title-size\)/],
    ['the 18 px title line', reminderTitle, /line-height:\s*var\(--zuri-rail-title-line\)/],
    ['a two-line title', reminderTitle, /-webkit-line-clamp:\s*2/],
    ["the node's 12/16 reminder meta", reminderMeta, /font-size:\s*var\(--zuri-rail-meta-size\)/],
    ["the node's 38 px Due pill", badge, /width:\s*38px/],
    ["the pill's 18 px height", badge, /height:\s*18px/],
    ['the pill fill', badge, /background:\s*var\(--zuri-rail-danger\)/],
    ['the badge label', badge, /color:\s*var\(--zuri-rail-inverse\)/],
    ["the node's 26 px action row", actions, /height:\s*26px/],
    ["the node's 26 px button", button, /height:\s*26px/],
    ["the node's 10 px button inset", button, /padding:\s*0 10px/],
    ['radius 6 on the buttons', button, /border-radius:\s*var\(--zuri-rail-radius-control\)/],
    ['the outlined Snooze button', buttonOutline, /background:\s*var\(--zuri-rail-surface\)/],
    ["the node's 50 px task row", taskRow, /min-height:\s*50px/],
    ["the node's 10 px checkbox inset", taskRow, /padding:\s*0 10px/],
    ['radius/row on the task row', taskRow, /border-radius:\s*var\(--zuri-radius-row\)/],
    ["the node's 16 px checkbox", taskCheck, /width:\s*16px/],
    ['the checkbox outline', taskCheck, /box-shadow:\s*inset 0 0 0 1px var\(--zuri-rail-border-strong\)/],
    ["the node's 12 px row title", taskTitle, /font-size:\s*var\(--zuri-rail-row-title-size\)/],
    ["the node's 11 px row meta", taskMeta, /font-size:\s*var\(--zuri-rail-label-size\)/],
    ["the node's 26 px more row", more, /height:\s*26px/],
    ['a centred more row', more, /justify-content:\s*center/],
    ["the node's 171 px automation content column", automationInner, /width:\s*171px/],
    ['a 12 px gap inside the automation card', automationInner, /gap:\s*var\(--zuri-space-3\)/],
    ["the node's 16 px automation head", automationHead, /height:\s*16px/],
    ["the node's 4 px track", track, /height:\s*4px/],
    ['a pill track', track, /border-radius:\s*var\(--zuri-radius-pill\)/],
    ['the running fill the node draws', fillRunning, /width:\s*111px/],
    ['the queued fill the node draws', fillQueued, /width:\s*16px/],
    ["the node's two detail lines under a running automation", css, /\[data-tone="running"\] \.automation-detail \{\s*min-height:\s*32px/],
    ["the node's one detail line under a queued automation", css, /\[data-tone="queued"\] \.automation-detail \{\s*min-height:\s*16px/],
    ["the node's 32 px quiet row", quiet, /min-height:\s*32px/],
    ["the node's 54 px empty section (a 14 px label row, no count spacing)", css, /\[data-state="empty"\] \.rail-section-head \{\s*height:\s*14px/],
    ["the node's 10 px skeleton label", skeletonLabel, /height:\s*10px/],
    ['the skeleton card fill', skeletonCard, /background:\s*var\(--zuri-rail-surface\)/],
    ['the error card danger hairline', errorCard, /var\(--zuri-rail-danger-line\)/],
    ["the node's 100 px error title box", errorTitle, /width:\s*100px/],
    ['a secondary error body', errorBody, /color:\s*var\(--zuri-rail-text-secondary\)/],
    ["the node's 14 px loading note", loadingNote, /height:\s*14px/],
    ['a loading note with no paragraph margin', loadingNote, /margin:\s*0/],
    ["the node's 20 px due badge", collapsedBadge, /width:\s*20px/],
    ['the badge at (25, 25)', collapsedBadge, /top:\s*25px/],
    ['the collapsed count label', collapsedBadge, /color:\s*var\(--zuri-rail-inverse\)/],
    ['the glyphs at x 14', collapsedIcon, /left:\s*14px/],
  ];
  const missing = drawn.filter(([, source, pattern]) => !pattern.test(source)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the rail is missing ${missing.join(', ')}`);

  // The collapsed frame's own numbers: a 64 px strip, a 60 px header and the three
  // glyphs 24 px apart with the automation glyph in the accent.
  const collapsed = [
    ["the node's 64 px collapsed strip", /\[data-state="collapsed"\] \.rail-frame,[\s\S]*?width:\s*64px/],
    ["the node's 60 px collapsed header", /\[data-state="collapsed"\] \.rail-header \{[\s\S]*?height:\s*60px/],
    ["the reminders glyph at y 40", /\[data-slot="reminders"\] \{\s*top:\s*40px/],
    ["the tasks glyph at y 64", /\[data-slot="tasks"\] \{\s*top:\s*64px/],
    ["the automations glyph at y 88", /\[data-slot="automations"\] \{\s*top:\s*88px/],
    ['the accent on the automation glyph', /\[data-slot="automations"\] \{[^}]*var\(--zuri-rail-accent\)/],
  ];
  const missingCollapsed = collapsed.filter(([, pattern]) => !pattern.test(css)).map(([name]) => name);
  if (missingCollapsed.length > 0) {
    throw new Error(`the rail is missing ${missingCollapsed.join(', ')}`);
  }

  // One rail, five drawn frames: the markup carries every frame and the script
  // names all five, so the state can be switched without a second document.
  if (!markup.includes('data-state="live"')) throw new Error('the rail does not open on the live frame');
  if (!/RAIL_STATES\s*=\s*\['live', 'empty', 'loading', 'error', 'collapsed'\]/.test(script)) {
    throw new Error('reminders.js does not name the five node frames');
  }
  for (const state of ['live', 'empty', 'loading', 'error']) {
    if (!markup.includes(`data-body="${state}"`)) throw new Error(`the rail has no ${state} body`);
  }
  if (!markup.includes('class="rail-collapsed"')) throw new Error('the rail has no collapsed strip');

  // The node's copy, word for word across all five frames. A node edit that
  // changes the wording has to land here rather than in one file only.
  const plain = markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&rarr;/g, '\u2192')
    .replace(/\s+/g, ' ')
    .trim();
  const nodeCopy = [
    ['the panel title', 'Autopilot'],
    ['the live status', 'Running \u00b7 2 tasks'],
    ['the empty status', 'Idle \u00b7 nothing scheduled'],
    ['the loading status', 'Loading\u2026'],
    ['the error status', 'Paused \u00b7 data error'],
    ['the due reminder', 'Send the budget summary Due Was due today at 17:30 Snooze 1h Dismiss'],
    ['the next reminder', 'Review Contract.pdf action items Tomorrow \u00b7 09:00 \u00b7 once'],
    ['the weekly reminder', 'Weekly expense sweep Monday \u00b7 08:00 \u00b7 repeats weekly'],
    ['the first task', 'Send Q4 variance sheet to Priya Due today, 17:00'],
    ['the second task', 'Monday inbox brief Mon, 09:00 \u00b7 Auto'],
    ['the third task', 'Chase finance for net-30 Snoozed until Thu'],
    ['the more line', '2 more open \u2192'],
    ['the running automation', 'Monday inbox brief 42% Step 2 of 4 \u00b7 reading Outlook mail'],
    ['the queued automation', 'Expense sweep Queued Starts Monday at 08:00'],
    ['the running count', '2 running'],
    ['the empty reminders row', 'No reminders scheduled yet.'],
    ['the empty tasks row', 'Nothing open right now.'],
    ['the empty automations row', 'No automations running.'],
    ['the loading note', 'Loading rail\u2026'],
    ['the error title', "Rail data couldn't be read"],
    ['the error body', 'tasks.json is unreadable, so reminders, tasks and automations are hidden. Your chat and files are unaffected.'],
    ['the reload button', 'Reload rail'],
    ['the error hint', 'or open Settings'],
    ['the error footnote', 'Autopilot keeps its schedule and will run again once the file is fixed.'],
  ];
  const missingCopy = nodeCopy.filter(([, sentence]) => !plain.includes(sentence)).map(([part]) => part);
  if (missingCopy.length > 0) {
    throw new Error(`the rail does not draw the node's ${missingCopy.join(', ')}`);
  }
  if (/style="/.test(markup)) throw new Error('the rail carries an inline style instead of a token rule');

  // Nothing in the page rules is a literal colour: the node's palette lives in one
  // page-scoped token block, so a colour change in open-pencil changes a value
  // there, not a scatter of hex codes.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`reminders.css holds literal colours: ${[...new Set(literals)].join(', ')}`);

  const start = tokens.indexOf('.reminders-page {');
  if (start === -1) throw new Error('tokens.css has no page-scoped rail block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  if (!tokens.includes('Autopilot right rail (design node 0:6978)')) {
    throw new Error('the rail token block does not name node 0:6978');
  }
  // Node 0:6978 draws the rail once in the light colour collection, so the light
  // theme holds the node's own values and the dark theme holds the same
  // collection variable's dark twin. The page block keeps only the metrics: a
  // colour change in open-pencil must land in both theme blocks, never here.
  if (/#[0-9a-f]{3,8}\b/i.test(pageTokens)) {
    throw new Error('the rail page block pins colours instead of leaving them to the two theme blocks');
  }
  const themeBlock = (selector) => {
    const at = tokens.indexOf(selector);
    if (at === -1) throw new Error(`tokens.css has no ${selector} block`);
    return tokens.slice(at, tokens.indexOf('\n}', at));
  };
  const lightBlock = themeBlock(':root[data-theme="light"] {');
  const darkBlock = themeBlock(':root[data-theme="dark"] {');
  const palette = [
    ['--zuri-rail-canvas', '#f7f8f9', '#16181b'], // color/surface
    ['--zuri-rail-page', '#ffffff', '#0e1012'], // color/background
    ['--zuri-rail-surface', '#ffffff', '#1d2024'], // color/raised
    ['--zuri-rail-inverse', '#ffffff', '#0e1012'], // color/inverse
    ['--zuri-rail-border', '#e8eaed', 'rgba\\(255, 255, 255, 0\\.08\\)'], // color/border
    ['--zuri-rail-border-strong', '#cbd2da', 'rgba\\(255, 255, 255, 0\\.16\\)'], // the node's stroke, then border-strong
    ['--zuri-rail-fill', '#f0f1f3', '#262a2f'], // color/sunken, then color/active
    ['--zuri-rail-text', '#1f2328', '#edeff2'], // color/text
    ['--zuri-rail-text-secondary', '#6b7280', '#8a9099'], // color/subtle
    ['--zuri-rail-text-muted', '#8e9196', '#9aa0a6'], // color/muted
    ['--zuri-rail-accent', '#2f6bff', '#5b8cff'], // color/primary
    ['--zuri-rail-success', '#1f9d6b', '#34c38f'], // color/success
    ['--zuri-rail-danger', '#d14343', '#f06a6a'], // color/danger
  ];
  for (const [token, light, dark] of palette) {
    if (!new RegExp(`${token}:\\s*${light};`).test(lightBlock)) {
      throw new Error(`the light rail palette differs from node 0:6978 at ${token}`);
    }
    if (!new RegExp(`${token}:\\s*${dark};`).test(darkBlock)) {
      throw new Error(`the dark rail palette is not the dark collection's twin at ${token}`);
    }
  }
  // The node draws its card strokes at #D1434352, the danger at 32%, in each theme.
  if (!/--zuri-rail-danger-line:\s*rgba\(209, 67, 67, 0\.32\);/.test(lightBlock)) {
    throw new Error('the different-coloured card stroke is not the node\'s danger at 32%');
  }
  if (!/--zuri-rail-danger-line:\s*rgba\(240, 106, 106, 0\.32\);/.test(darkBlock)) {
    throw new Error('the dark card stroke is not the dark collection\'s danger at 32%');
  }

  // The radii the node's cards, rows and buttons are drawn with (tokens.json Mode 1).
  const radii = [
    ['--zuri-radius-card', '10px'],
    ['--zuri-radius-row', '8px'],
  ];
  for (const [token, value] of radii) {
    const declared = tokens.match(new RegExp(`${token}:\\s*([^;]+);`));
    if (!declared) throw new Error(`tokens.css has no ${token}`);
    if (declared[1].trim() !== value) throw new Error(`${token} is ${declared[1].trim()}, the design tokens say ${value}`);
  }

  return '320 px rail, five drawn frames, section cards at 66/100 px, 50 px task rows, 171 px automation column, node copy, light palette and its dark-collection twins';
});

check('the Automations list page is drawn from node 0:11359', () => {
  const html = read('src/renderer/views/automations.html');
  const css = read('src/renderer/views/automations.css');
  const js = read('src/renderer/views/automations-page.js');
  // The page's wiring belongs to the page file: the shell's Automations route is
  // views/automations.js, and a page module imported there would repaint the shell.
  if (!read('src/renderer/views/automations.html').includes('src="automations-page.js"')) {
    throw new Error('automations.html does not load automations-page.js');
  }
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:11359 draws the page once and five states beside it. Every frame has
  // to be in the document, because ?state= can ask for any of them and a missing
  // one is a blank screen; the paper checks that no extra state name slipped in.
  const frames = ['main', 'empty', 'loading', 'running', 'failed', 'delete'];
  for (const frame of frames) {
    if (!html.includes(`data-state="${frame}"`)) throw new Error(`automations.html has no ${frame} frame`);
  }
  const declared = [...html.matchAll(/<section class="automations-state[^"]*" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.sort().join(',') !== [...frames].sort().join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ')}`);
  }
  if (!js.includes("'delete']") || !js.includes('AUTOMATIONS_STATES')) {
    throw new Error('automations-page.js does not list the six states');
  }

  // The sidebar the node draws: brand and caption, the three modes with
  // Autopilot live, seven workspace destinations with Automations current, and
  // the three recent runs above the scheduler note.
  const sidebar = [
    ['COMMAND CENTRE', 'the brand caption'],
    ['New chat', 'the new chat button'],
    ['Autopilot', 'the mode switcher'],
    ['RECENT RUNS', 'the recent runs heading'],
    ['Inbox summary · done', 'the first recent run'],
    ['Invoice check · failed', 'the failed recent run'],
    ['Scheduler ticks every 30 s', 'the scheduler note'],
    ['Priya Raman', 'the person block'],
  ];
  for (const [copy, what] of sidebar) {
    if (!html.includes(copy)) throw new Error(`the sidebar has no ${what}`);
  }
  if (!/class="automations-nav-item automations-nav-item-active"[^>]*aria-current="page"/.test(html)) {
    throw new Error('Automations is not the current sidebar row');
  }
  const navRows = [...html.matchAll(/class="automations-nav-item/g)].length;
  if (navRows !== 7) throw new Error(`the sidebar draws ${navRows} destinations, the node draws 7`);

  // The header, the live strip and the filter bar, in the node's words.
  const header = [
    ['4 scheduled prompts · run by the scheduler while Zuri is open · stored in schedules.json', 'the header subtitle'],
    ['Run due now', 'the run due button'],
    ['New automation', 'the new automation button'],
    ['AUTOPILOT RUNNING', 'the live strip label'],
    ['Summarize today\'s inbox and draft replies', 'the live strip automation'],
    ['Step 2 of 4 · drafting reply 3', 'the live strip progress'],
    ['Today 09:00 · in 12 min', 'the live strip next run'],
    ['All 4', 'the all segment'],
    ['Scheduled 3', 'the scheduled segment'],
    ['Failed 1', 'the failed segment'],
    ['Sorted by last run', 'the sort note'],
    ['Runs go through the same tool layer as Act mode: results save to the workspace and log a run in runs.json.', 'the footer note'],
  ];
  for (const [copy, what] of header) {
    if (!html.includes(copy)) throw new Error(`the page has no ${what}`);
  }

  // The five rows of the main frame, in the node's order, each with its agent
  // line, mode word and last-run words. A row that loses its cadence or shows
  // another mode reads as a different drawing.
  const rows = [
    ['Summarise today\'s inbox and draft replies', 'Agent: Inbox scout · 3 allowed tools', 'Autopilot', 'Daily · 08:00', 'Running · step 2 of 4'],
    ['Draft Monday status update from Office files', 'Agent: Finance scout · Q3 board pack', 'Act', 'Daily · 17:30', 'Done · Fri 17:31'],
    ['Flag vendor invoices over £5,000', 'Agent: Ledger · last error: timeout', 'Act', 'Every 60 min', 'Failed · 2×'],
    ['Prepare the Friday client recap email', 'Agent: Comms · recap-template.docx', 'Ask', 'Daily · 16:00', 'Done · Fri 16:02'],
    ['File last month\'s receipts into Office', 'Agent: Archivist · receipts-Aug.zip', 'Act', 'Once · 1 Sep 09:00', 'Done · 1 Sep 09:04'],
  ];
  const listStart = html.indexOf('<ul class="automations-rows">');
  const listEnd = html.indexOf('</ul>', listStart);
  if (listStart === -1 || listEnd === -1) throw new Error('the page has no automation list');
  const list = html.slice(listStart, listEnd);
  const prompts = [...list.matchAll(/class="automations-row-prompt">([^<]+)</g)].map((m) => m[1]);
  if (prompts.length !== rows.length) {
    throw new Error(`the list draws ${prompts.length} rows, the node draws ${rows.length}`);
  }
  rows.forEach(([prompt, meta, mode, cadence, lastRun], index) => {
    if (prompts[index] !== prompt) throw new Error(`row ${index + 1} is "${prompts[index]}", the node draws "${prompt}"`);
    const row = list.slice(list.indexOf(prompt));
    for (const copy of [meta, `>${mode}<`, cadence, lastRun]) {
      if (!row.includes(copy)) throw new Error(`row ${index + 1} has no ${copy}`);
    }
  });
  if (!/class="automations-row automations-row-running"/.test(list.slice(0, list.indexOf(prompts[1])))) {
    throw new Error('the running row is not tinted as the node draws it');
  }
  if (!/class="automations-failed-badge"/.test(list)) throw new Error('the failed run badge is missing');

  // The five state cards carry the node's own captions, chip above title above
  // body, so a reviewer can open ?state= and read the same sentence as the node.
  const stateCopy = [
    ['No automations yet', 'the empty title'],
    ['schedules.json exists but holds no automations', 'the empty body'],
    ['No automations - press New automation', 'the empty panel title'],
    ['Loading automations', 'the loading title'],
    ['Reading schedules.json and the latest status of every run from runs.json', 'the loading body'],
    ['Row highlighted while it runs', 'the running title'],
    ['The automation being executed is tinted in the list', 'the running body'],
    ['Failed run badge from automation-runs.json', 'the failed title'],
    ['The newest run for this automation failed', 'the failed body'],
    ['Retry', 'the failed retry button'],
    ['Delete confirmation dialog', 'the delete title'],
    ['Delete automation?', 'the dialog title'],
    ['Its run history stays in runs.json', 'the dialog body'],
  ];
  for (const [copy, what] of stateCopy) {
    if (!html.includes(copy)) throw new Error(`the page has no ${what}`);
  }
  const skeletons = [...html.matchAll(/class="automations-skeleton-row"/g)].length;
  if (skeletons !== 4) throw new Error(`the loading frame draws ${skeletons} skeleton rows, the node draws 4`);

  // The page palette, name by name, from the node's token bindings. The light
  // block is the node's own collection; the dark block is the Dark collection
  // the same names resolve to, so the screen keeps the drawing's relationships
  // in either theme.
  const blockOf = (selector) => {
    const start = tokens.indexOf(selector);
    if (start === -1) throw new Error(`tokens.css has no ${selector} block`);
    const end = tokens.indexOf('}', start);
    return tokens.slice(start, end);
  };
  const light = blockOf('.automations-page {');
  const lightPairs = [
    ['--zuri-automations-canvas', '#fafafa'], // Light --color-canvas
    ['--zuri-automations-surface', '#ffffff'], // Light --color-surface
    ['--zuri-automations-surface-raised', '#ffffff'], // Light --color-surface-raised
    ['--zuri-automations-sunken', '#f4f4f5'], // Light --color-surface-secondary
    ['--zuri-automations-active', '#e4e4e7'], // Light --color-surface-tertiary
    ['--zuri-automations-track', '#d4d4d8'], // Light --color-surface-quaternary
    ['--zuri-automations-text', '#11181c'], // Light --color-text
    ['--zuri-automations-text-subtle', '#6b6b75'], // Light --color-text-subtle
    ['--zuri-automations-divider', '#111111'], // Light --color-divider
    ['--zuri-automations-primary', '#006fee'], // Light --color-primary
    ['--zuri-automations-primary-hover', '#005bc4'], // Light --color-primary-hover
    ['--zuri-automations-primary-soft', '#e6f1fe'], // Light --color-primary-soft
    ['--zuri-automations-primary-soft-foreground', '#005bc4'], // Light --color-primary-soft-foreground
    ['--zuri-automations-secondary', '#7828c8'], // Light --color-secondary
    ['--zuri-automations-secondary-soft', '#f2eafa'], // Light --color-secondary-soft
    ['--zuri-automations-success', '#17c964'], // Light --color-success
    ['--zuri-automations-danger', '#f31260'], // Light --color-danger
    ['--zuri-automations-danger-soft', '#fdd8e5'], // Light --color-danger-soft
    ['--zuri-automations-danger-soft-foreground', '#b80e4d'], // Light --color-danger-soft-foreground
    ['--zuri-automations-scrim', '#000000'], // Light --color-overlay-scrim
  ];
  for (const [token, value] of lightPairs) {
    if (!light.includes(`${token}: ${value};`)) throw new Error(`${token} is not the node's ${value}`);
  }
  const dark = blockOf(":root[data-theme='dark'] .automations-page {");
  const darkPairs = [
    ['--zuri-automations-canvas', '#0a0a0b'], // Dark --color-canvas
    ['--zuri-automations-surface', '#18181b'], // Dark --color-surface
    ['--zuri-automations-sunken', '#27272a'], // Dark --color-surface-secondary
    ['--zuri-automations-active', '#3f3f46'], // Dark --color-surface-tertiary
    ['--zuri-automations-track', '#52525b'], // Dark --color-surface-quaternary
    ['--zuri-automations-text', '#ecedee'], // Dark --color-text
    ['--zuri-automations-text-subtle', '#a1a1aa'], // Dark --color-text-subtle
    ['--zuri-automations-divider', '#ffffff'], // Dark --color-divider
    ['--zuri-automations-primary-soft', '#001731'], // Dark --color-primary-soft
    ['--zuri-automations-primary-soft-foreground', '#338ef7'], // Dark --color-primary-soft-foreground
    ['--zuri-automations-secondary-soft', '#2a0e45'], // Dark --color-secondary-soft
    ['--zuri-automations-danger-soft', '#310413'], // Dark --color-danger-soft
    ['--zuri-automations-danger-soft-foreground', '#ff8fb0'], // Dark --color-danger-soft-foreground
  ];
  for (const [token, value] of darkPairs) {
    if (!dark.includes(`${token}: ${value};`)) throw new Error(`the dark twin sets ${token} to something other than ${value}`);
  }

  // The measurements the node fixes. A row of another height, a head that is not
  // 36 px or tracks that do not start at the node's x positions all read as a
  // different drawing, so each is pinned here.
  const metrics = [
    '--zuri-automations-sidebar-width: 248px',
    '--zuri-automations-shell-max: 1440px',
    '--zuri-automations-row-height: 84px',
    '--zuri-automations-head-height: 36px',
    '--zuri-automations-label-tracking: 0.66px',
    '--zuri-automations-grid: minmax(0, 1fr) 96px 166px 142px 44px',
  ];
  for (const metric of metrics) {
    if (!light.includes(metric)) throw new Error(`the automations page block has no ${metric}`);
  }
  const layout = [
    [/\.automations-row \{[^}]*grid-template-columns: var\(--zuri-automations-grid\);/, 'the row does not use the node column tracks'],
    [/\.automations-row \{[^}]*min-height: var\(--zuri-automations-row-height\);/, 'the row is not the node\'s 84 px'],
    [/\.automations-table-head \{[^}]*grid-template-columns: var\(--zuri-automations-grid\);/, 'the column labels do not sit on the row tracks'],
    [/\.automations-live \{[^}]*grid-template-columns: minmax\(0, 1\.05fr\) 1px/, 'the live strip does not set its three cells and rules'],
    [/\.automations-progress-fill-row \{\s*width: 48%;/, 'the row progress is not the node\'s 48%'],
    [/\.automations-progress-fill-strip \{\s*width: 48%;/, 'the strip progress is not the node\'s 48%'],
    [/\.automations-tabbar \{[^}]*position: fixed;/, 'the phone navigation is not fixed to the bottom'],
    [/\.automations-tabbar \{[^}]*padding-bottom: env\(safe-area-inset-bottom\);/, 'the phone navigation ignores the safe area'],
    [/\.automations-main \{[^}]*padding-bottom: calc\(56px \+ env\(safe-area-inset-bottom\)\);/, 'the scrolling area does not clear the phone navigation'],
    [/\.automations-sidebar \{[^}]*display: none;/, 'the sidebar is not hidden on a phone'],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }
  const tabs = [...html.matchAll(/class="automations-tab[ "]/g)].length;
  if (tabs !== 5) throw new Error(`the phone navigation draws ${tabs} destinations, the page asks for 5`);

  // A page that allowed inline script or style would undercut the token layer,
  // and every width has to come from a class rather than a style attribute for
  // the same reason.
  if (/'unsafe-inline'/.test(html)) throw new Error('automations.html allows inline script or style');
  if (/\sstyle="/.test(html)) throw new Error('automations.html sets a width or colour inline');
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/.test(html)) {
    throw new Error('automations.html has no phone viewport');
  }
  if (!/<script type="module" src="automations-page\.js"><\/script>/.test(html)) {
    throw new Error('automations.html does not load its module');
  }

  return 'six drawn frames, a 248 px sidebar and its 5-tab phone twin, five rows on the node column tracks, 84 px rows, 36 px header, 48% progress, node copy, light palette and its Dark twin';
});

check('the run result / history page is drawn from node 0:12100', () => {
  const html = read('src/renderer/views/runs.html');
  const css = read('src/renderer/views/runs.css');
  const js = read('src/renderer/views/runs.js');

  // The page is drawn once in full and then once per state, so every frame a
  // reader can reach through ?state= has to be in the document: a state name with
  // no frame is a blank page.
  const frames = ['main', 'empty', 'loading', 'failed', 'running', 'pagination'];
  const declared = [...html.matchAll(/<section class="runs-state[^"]*" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['main', 'empty', 'loading', 'failed', 'running', 'pagination']") || !js.includes('RUNS_STATES')) {
    throw new Error('runs.js does not list the six states');
  }

  // The node's own words. A page that rewords them is no longer the drawing.
  const copy = [
    'Run history',
    'Runs for Invoice check and 3 other automations, newest first, from automation-runs.json',
    'All statuses',
    'TOTAL RUNS',
    'SUCCEEDED',
    'FAILED',
    'NEED FOLLOW-UP',
    'STARTED',
    'AUTOMATION',
    'STATUS',
    'DURATION',
    'OUTPUT',
    'FOLLOW-UP',
    'Inbox summary',
    'Invoice check',
    'Pipeline digest',
    'Status update',
    'Weekly client report',
    'Succeeded',
    'Failed',
    'Running',
    'Showing 1-6 of 128 runs · history kept for 90 days',
    'STATE - EMPTY, NO RUNS RECORDED',
    'No runs yet',
    'Runs appear here as soon as an automation fires.',
    'Run Invoice check now',
    'STATE - LOADING, READING automation-runs.json',
    'STATE - FAILED RUN EXPANDED WITH ERROR',
    'Excel could not open invoices.xlsx - locked by WINWORD.EXE.',
    'Run again',
    'STATE - RUN IN PROGRESS',
    'Step 2 of 4 · drafting the recap email',
    'The run keeps going if this view is closed; the row refreshes every 5 seconds.',
    'STATE - PAGINATION FOR LONG HISTORY',
    'Showing 121-128 of 128 runs',
    'History keeps 90 days of runs: 128 runs across 13 pages, 10 rows per page.',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`the page does not carry the node's "${text}"`);
  }

  // One page-scoped palette, and its Dark twin. The page owns these rather than
  // tokens.css because they are the node's own colours, not a shared scale.
  const blockOf = (selector) => {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`runs.css has no ${selector} block`);
    return css.slice(start, css.indexOf('}', start));
  };
  const light = blockOf('.runs-page {');
  const lightPairs = [
    ['--runs-canvas', '#fafafa'], // Light --color-canvas
    ['--runs-surface', '#ffffff'], // Light --color-surface
    ['--runs-sunken', '#f4f4f5'], // Light --color-surface-secondary
    ['--runs-line', '#e4e4e7'], // Light --color-surface-tertiary
    ['--runs-text', '#11181c'], // Light --color-text
    ['--runs-text-subtle', '#6b6b75'], // Light --color-text-subtle
    ['--runs-primary', '#006fee'], // Light --color-primary
    ['--runs-primary-soft', '#e6f1fe'], // Light --color-primary-soft
    ['--runs-primary-soft-text', '#005bc4'], // Light --color-primary-soft-foreground
    ['--runs-success-soft', '#d3f7e3'], // Light --color-success-soft
    ['--runs-success-text', '#0a7a3d'], // Light --color-success-soft-foreground
    ['--runs-danger', '#f31260'], // Light --color-danger
    ['--runs-danger-soft', '#fdd8e5'], // Light --color-danger-soft
    ['--runs-danger-text', '#b80e4d'], // Light --color-danger-soft-foreground
    ['--runs-warning-soft', '#fdedd3'], // Light --color-warning-soft
    ['--runs-warning-text', '#b45309'], // the node's follow-up chip
  ];
  for (const [token, value] of lightPairs) {
    if (!light.includes(`${token}: ${value};`)) throw new Error(`${token} is not the node's ${value}`);
  }
  const dark = blockOf(":root[data-theme='dark'] .runs-page {");
  const darkPairs = [
    ['--runs-canvas', '#0a0a0b'], // Dark --color-canvas
    ['--runs-surface', '#18181b'], // Dark --color-surface
    ['--runs-sunken', '#27272a'], // Dark --color-surface-secondary
    ['--runs-line', '#3f3f46'], // Dark --color-surface-tertiary
    ['--runs-text', '#ecedee'], // Dark --color-text
    ['--runs-text-subtle', '#a1a1aa'], // Dark --color-text-subtle
    ['--runs-primary', '#006fee'], // Dark --color-primary
    ['--runs-primary-soft', '#001731'], // Dark --color-primary-soft
    ['--runs-primary-soft-text', '#338ef7'], // Dark --color-primary-soft-foreground
    ['--runs-success-soft', '#052814'], // Dark --color-success-soft
    ['--runs-success-text', '#4ade80'], // Dark --color-success-soft-foreground
    ['--runs-danger-soft', '#310413'], // Dark --color-danger-soft
    ['--runs-danger-text', '#ff8fb0'], // Dark --color-danger-soft-foreground
    ['--runs-warning-text', '#f5a524'], // Dark --color-warning
  ];
  for (const [token, value] of darkPairs) {
    if (!dark.includes(`${token}: ${value};`)) throw new Error(`the dark twin sets ${token} to something other than ${value}`);
  }

  // The measurements the node fixes. The shell, the summary strip, the row grid
  // and the error row are the ones a picture alone gets wrong, so each is pinned.
  const layout = [
    [/\.runs-shell \{[^}]*grid-template-columns: 248px minmax\(0, 1fr\);/, 'the shell does not draw the node\'s 248 px sidebar'],
    [/\.runs-shell \{[^}]*max-width: 1440px;/, 'the shell is not centred in a 1440 px column'],
    [/\.runs-main \{[^}]*padding: 24px;/, 'the main card does not keep the node\'s 24 px gutter'],
    [/\.runs-summary \{[^}]*height: 72px;/, 'the summary strip is not the node\'s 72 px'],
    [/\.runs-summary \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, 'the four stats do not spread on the node\'s four tracks'],
    [/\.runs-columns \{[^}]*124px minmax\(0, 1\.35fr\) 108px 88px/, 'the column labels do not use the node\'s tracks'],
    [/\.runs-row \{[^}]*min-height: 52px;/, 'a run row is not the node\'s 52 px'],
    [/\.runs-error \{[^}]*min-height: 64px;/, 'the expanded error is not the node\'s 64 px'],
    [/\.runs-error \{[^}]*padding: 8px 75px 8px 20px;/, 'the error text and retry link are not at the node\'s offsets'],
    [/\.runs-badge \{[^}]*height: 22px;/, 'a status badge is not the node\'s 22 px'],
    [/\.runs-chip \{[^}]*height: 24px;/, 'a follow-up chip is not the node\'s 24 px'],
    [/\.runs-filters \{[^}]*width: 268px;/, 'the filter row is not the node\'s 268 px'],
    [/\.runs-select \{[^}]*height: 36px;/, 'the status select is not the node\'s 36 px'],
    [/\.runs-page-button \{[^}]*width: 32px;/, 'a pager button is not the node\'s 32 px'],
    [/\.runs-state-empty,[\s\S]*?max-width: 640px;/, 'the state panels are not the node\'s 640 px'],
    [/\.runs-empty \{[^}]*height: 288px;/, 'the empty block is not the node\'s 288 px'],
    [/\.runs-skeleton \{[^}]*height: 232px;/, 'the loading block is not the node\'s 232 px'],
    [/\.runs-skeleton-row:nth-of-type\(4\) \{\s*top: 172px;/, 'the skeleton rows are not on the node\'s 44 px pitch'],
    [/\.runs-pager-card \{[^}]*height: 128px;/, 'the pagination card is not the node\'s 128 px'],
    [/\.runs-progress \{[^}]*height: 48px;/, 'the progress block is not the node\'s 48 px'],
    [/\.runs-progress-track \{[^}]*width: 320px;/, 'the progress bar is not the node\'s 320 px'],
    [/\.runs-tabbar \{[^}]*position: fixed;/, 'the phone navigation is not fixed to the bottom'],
    [/\.runs-tabbar \{[^}]*padding-bottom: env\(safe-area-inset-bottom\);/, 'the phone navigation ignores the safe area'],
    [/\.runs-main \{[^}]*padding: 16px 16px calc\(76px \+ env\(safe-area-inset-bottom\)\);/, 'the scrolling area does not clear the phone navigation'],
    [/\.runs-sidebar \{[^}]*display: none;/, 'the sidebar is not hidden on a phone'],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }
  const tabs = [...html.matchAll(/class="runs-tab[ "]/g)].length;
  if (tabs !== 5) throw new Error(`the phone navigation draws ${tabs} destinations, the page asks for 5`);

  // A page that allowed inline script or style would undercut the token layer,
  // and every width has to come from a class for the same reason.
  if (/'unsafe-inline'/.test(html)) throw new Error('runs.html allows inline script or style');
  if (/\sstyle="/.test(html)) throw new Error('runs.html sets a width or colour inline');
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/.test(html)) {
    throw new Error('runs.html has no phone viewport');
  }
  if (!/<script type="module" src="runs\.js"><\/script>/.test(html)) {
    throw new Error('runs.html does not load its module');
  }
  // The automations list reaches this page from every row's result link.
  if (!read('src/renderer/views/automations.html').includes('href="runs.html"')) {
    throw new Error('no automation row links to the run result page');
  }

  return 'six drawn frames, node copy, 248 px sidebar and its 5-tab phone twin, 72 px summary on four tracks, 52 px rows with one 64 px error row, 32 px pager, 640 px state panels, light palette and its Dark twin';
});

check('the Confirm open app dialog is drawn from node 0:4629', () => {
  const html = read('src/renderer/views/open-app.html');
  const css = read('src/renderer/views/open-app.css');
  const js = read('src/renderer/views/open-app.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:4629 draws the whole window once and then redraws only the dialog for
  // the running, rejected and cancelled states, so the page carries all four
  // frames and no other state name: a frame missing here is a screen a reader
  // reaches through ?state= and lands on nothing.
  const frames = ['pending', 'running', 'rejected', 'cancelled'];
  const declared = [...html.matchAll(/<section\s+class="dialog"\s+data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['pending', 'running', 'rejected', 'cancelled']") || !js.includes('OPEN_APP_STATES')) {
    throw new Error('open-app.js does not list the four states');
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('open-app.js does not publish its states');

  // The node's own copy, in every frame, so none of them can rot into a
  // placeholder and the allow-list wording stays the design's.
  const copy = [
    'Open Microsoft Excel',
    'Microsoft Excel · Q3-forecast.xlsx',
    'C:\\Program Files\\Microsoft Office\\root\\EXCEL.EXE',
    'desktop.open · Act mode · step 2 of 3',
    'Allowed by your settings allow-list',
    'allowlist.js lets Act mode call desktop.open for this app. Zuri only launches apps you list in',
    'desktop.open · launching the app…',
    'Approved · allow-list checked',
    'allowlist.js returned allowed for desktop.open. You can still cancel while the app starts.',
    'Step 2 of 3 · waiting for the app to open',
    'desktop.open · Act mode · rejected by allow-list',
    'Target is not in your allow-list',
    'allowlist.js refused desktop.open: “Microsoft Excel” is not in Settings → Allowed apps. Add',
    'Confirm stays disabled until the app is allow-listed.',
    'desktop.open · Act mode · cancelled',
    'Step cancelled - nothing was opened',
    'tools:cancel marked the step cancelled, so Zuri never launched Microsoft Excel and the',
    'Cancel',
    'Confirm',
    'Open Settings',
    'Re-run step',
    'Close',
    // The window the node draws behind the scrim.
    'Search chats, files, tasks',
    'Q3 forecast summary',
    'Supplier contract notes',
    'Open Excel with Q3 forecast…',
    'I can open Microsoft Excel with that workbook. This step needs your approval before Zuri',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`open-app.html is missing "${text}"`);
  }

  // The rejected frame is the only one the node gives a disabled Confirm and a
  // left rule on its alert; both are drawing, not decoration that can drift.
  if (!/<button class="button button-primary" type="button" disabled>Confirm<\/button>/.test(html)) {
    throw new Error('the rejected frame does not disable Confirm');
  }
  if (!/\.note\[data-tone="danger"\]::before \{[^}]*width: var\(--zuri-openapp-note-rule\)/.test(css)) {
    throw new Error('the rejected alert does not draw its left rule');
  }
  // Every frame draws the focus ring on its default action, so the ring rides on
  // the frame and not on whatever the browser happens to focus.
  if ((html.match(/data-drawn-focus="true"/g) || []).length !== 4) {
    throw new Error('not every frame marks its default action with the drawn focus ring');
  }
  // The scrim starts under the 48 px top bar, as the node draws it, so the bar
  // stays lit while the rest of the window is dimmed.
  if (!/\.scrim \{[^}]*top: var\(--zuri-openapp-topbar-height\)/.test(css)) {
    throw new Error('the scrim does not start below the top bar');
  }

  // The node's palette is one page-scoped token block in two themes, and the page
  // rules hold no literal colour, so a colour changed in open-pencil is one edit.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`open-app.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  const label = 'Confirm open app dialog (design node 0:4629)';
  if (!tokens.includes(label)) throw new Error('tokens.css has no open-app page block naming node 0:4629');
  const start = tokens.indexOf('.open-app-page {');
  if (start === -1) throw new Error('tokens.css has no .open-app-page block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  const palette = [
    ['--zuri-openapp-surface', '#ffffff', '#18181b'], // color/surface
    ['--zuri-openapp-surface-secondary', '#f4f4f5', '#27272a'], // the target card, buttons
    ['--zuri-openapp-text', '#11181c', '#ecedee'], // color/text
    ['--zuri-openapp-primary', '#006fee', '#006fee'], // color/primary, Confirm and the brand mark
    ['--zuri-openapp-primary-soft', '#e6f1fe', '#001731'], // the icon badge and the allow-list note
    ['--zuri-openapp-primary-soft-foreground', '#005bc4', '#338ef7'], // the note's glyph and title
    ['--zuri-openapp-danger-soft', '#fdd8e5', '#310413'], // the rejected badge and alert
    ['--zuri-openapp-danger-soft-foreground', '#b80e4d', '#ff8fb0'], // the alert's words
  ];
  for (const [name, light, dark] of palette) {
    const lightBlock = tokens.slice(tokens.indexOf(':root[data-theme="light"] .open-app-page {'));
    const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"] .open-app-page {'));
    if (!lightBlock.slice(0, lightBlock.indexOf('}')).includes(`${name}: ${light}`)) {
      throw new Error(`${name} is not ${light} in the light block`);
    }
    if (!darkBlock.slice(0, darkBlock.indexOf('}')).includes(`${name}: ${dark}`)) {
      throw new Error(`${name} is not ${dark} in the dark block`);
    }
  }
  // The node draws the scrim as black at 40%; the frame geometry it draws is the
  // dialog's 480 px width, 24 px inset and 24 px corner.
  if (!tokens.includes('--zuri-openapp-scrim: rgba(0, 0, 0, 0.4);')) {
    throw new Error('the light scrim is not the node’s 40% black');
  }
  for (const rule of [
    '--zuri-openapp-dialog-width: 480px;',
    '--zuri-openapp-dialog-padding: 24px;',
    '--zuri-openapp-dialog-radius: 24px;',
  ]) {
    if (!pageTokens.includes(rule)) throw new Error(`tokens.css is missing ${rule}`);
  }

  // A phone keeps its destinations on screen, the thread carries the bar's
  // height, and nothing scrolls sideways: the same contract as the other pages.
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/.test(html)) {
    throw new Error('open-app.html has no phone viewport');
  }
  if (!/min-height: 100dvh/.test(css)) throw new Error('open-app.css sizes the page in dvh');
  if (!/padding-bottom: env\(safe-area-inset-bottom\)/.test(css)) {
    throw new Error('the phone tab bar does not clear the home indicator');
  }
  if (!/@media \(max-width: 767px\)[\s\S]*?\.tabbar \{[^}]*position: fixed/.test(css)) {
    throw new Error('the tab bar is not pinned to the foot of a phone screen');
  }
  if (!/@media \(max-width: 767px\)[\s\S]*?\.chat \{[^}]*padding-bottom: calc\(var\(--zuri-openapp-tabbar-height\)/.test(css)) {
    throw new Error('the thread does not keep clear of the tab bar');
  }
});

check('the Quick assistant overlay page is drawn from node 0:13351', () => {
  const html = read('src/renderer/views/overlay.html');
  const css = read('src/renderer/views/overlay.css');
  const js = read('src/renderer/views/overlay.js');

  // Node 0:13351 draws the floating window five times, so the page carries every
  // frame and no other state name: a frame that is missing is a screen a user can
  // reach through ?state= and land on nothing. The node names them expanded with
  // a reply, collapsed, streaming, send failed and no active thread, in that order.
  const frames = ['expanded', 'collapsed', 'streaming', 'error', 'no-thread'];
  const declared = [...html.matchAll(/<section class="overlay-state" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['expanded', 'collapsed', 'streaming', 'error', 'no-thread']") || !js.includes('OVERLAY_STATES')) {
    throw new Error('overlay.js does not list the five frames');
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('overlay.js does not publish its frames');

  // The node draws the window in the light collection; the dark collection swaps
  // the same names, so the page opens light and lets ?theme= or the machine decide.
  if (!/<html lang="en" data-theme="light">/.test(html)) throw new Error('overlay.html does not open in the light collection');
  if (!/<meta name="color-scheme" content="light dark" \/>/.test(html)) {
    throw new Error('overlay.html does not declare both color schemes');
  }
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/.test(html)) {
    throw new Error('overlay.html has no viewport meta');
  }
  if (!/\.overlay-page \{/.test(css) || !/:root\[data-theme="dark"\] \.overlay-page \{/.test(css)) {
    throw new Error('overlay.css does not carry both theme blocks');
  }
  if (!css.includes('design node 0:13351')) throw new Error('overlay.css never names the node it is drawn from');

  // The copy of all five frames, so none of them can rot into a placeholder.
  const copy = [
    'Q3 forecast review',
    'ZURI · ASK MODE · JUST NOW',
    'Q3 closed 6% under plan at $4.28M. EMEA slipped 9% after two renewals moved to Q4, and APAC landed 4%',
    'ahead. The $180K freed in marketing covers the Q4 hire without a new budget ask.',
    'MIRRORED IN MAIN WINDOW · ENTER ASKS A FOLLOW-UP',
    'Ask a follow-up…',
    'Ask Zuri anything…',
    'ZURI · ASK MODE · STREAMING',
    'and APAC is still',
    'ESC STOPS · MIRRORS LIVE TO MAIN WINDOW',
    'Zuri is replying…',
    'ZURI · ASK MODE · SEND FAILED',
    'No API key for this provider',
    'Zuri cannot answer in the overlay until a key is saved. Nothing was sent.',
    'Retry',
    'Open Settings ↗',
    'ESC DISMISSES · RETRY SENDS THE SAME PROMPT',
    'Retry or ask something else…',
    'New conversation',
    'ZURI · NO ACTIVE THREAD',
    'No thread is active yet.',
    'mirrors the reply into the main window.',
    'ENTER CREATES A THREAD AND SENDS',
    'Summarise the EMEA slip and flag risk',
    'Copy',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`overlay.html is missing "${text}"`);
  }

  // The measurements the node fixes: a 360 x 304 window (360 x 56 collapsed)
  // centred on the desktop 104 px off the bottom, a 24 px brand, a 44 px header
  // rule, a 336 x 190 reply area, a 336 x 42 input bar and a 32 px send control.
  // A window that drifts reads as a different drawing, so each is pinned here.
  const layout = [
    [/--qa-window-width: 360px;/, "the window is not the node's 360 px wide"],
    [/--qa-window-height: 304px;/, "the window is not the node's 304 px tall"],
    [/--qa-bar-height: 56px;/, "the collapsed bar is not the node's 56 px tall"],
    [/--qa-overlay-lift: 104px;/, 'the window does not float 56 px above the taskbar'],
    [/--qa-reply-height: 190px;/, "the reply area is not the node's 190 px tall"],
    [/--qa-input-height: 42px;/, "the input bar is not the node's 42 px tall"],
    [/--qa-taskbar-height: 48px;/, "the taskbar is not the node's 48 px tall"],
    [/--qa-radius-window: 24px;/, 'the window is not on radius-2xl'],
    [/--qa-radius-input: 20px;/, 'the input bar is not on radius-xl'],
    [/--qa-radius-error: 12px;/, 'the error block is not on radius-md'],
    [/--qa-title-size: 14px;/, "the thread title is not the node's 14 px"],
    [/--qa-body-size: 15px;/, "the reply body is not the node's 15 px"],
    [/--qa-label-size: 11px;/, "the author and hint rows are not the node's 11 px"],
    [/--qa-label-tracking: 0.66px;/, "the author and hint rows lost the node's letter spacing"],
    [/\.overlay-state \{[^}]*left: 50%;[^}]*bottom: var\(--qa-overlay-lift\);/, 'the window is not centred and lifted off the bottom'],
    [/\.overlay-window \{[^}]*width: var\(--qa-window-width\);/, 'the window ignores its drawn width'],
    [/\.overlay-brand \{[^}]*top: 10px;[^}]*width: 24px;\s*height: 24px;/, "the brand is not the node's 24 px at 10 px down"],
    [/\.overlay-thread-title \{[^}]*left: 44px;\s*top: 12px;\s*width: 124px;/, 'the thread title is not 124 px wide at (44, 12)'],
    [/\.overlay-copy \{[^}]*right: 86px;\s*top: 8px;[\s\S]{0,120}?width: 52px;\s*height: 28px;/, "the copy control is not 52 x 28 at the node's edge"],
    [/\.overlay-icon-button \{[^}]*top: 8px;[\s\S]{0,160}?width: var\(--qa-control\);\s*height: var\(--qa-control\);/, 'the collapse and close controls are not 28 px on the 8 px line'],
    [/\.overlay-collapse \{\s*right: 52px;/, 'the collapse control is not where the node puts it'],
    [/\.overlay-close \{\s*right: 18px;/, 'the close control is not where the node puts it'],
    [/\.overlay-divider \{[^}]*top: 44px;\s*height: 1px;/, 'the header rule is not 1 px at 44 px down'],
    [/\.overlay-reply \{[^}]*top: 52px;\s*height: var\(--qa-reply-height\);/, 'the reply area does not start 52 px down'],
    [/\.overlay-reply-hint \{[^}]*bottom: 6px;/, "the hint row is not the node's 6 px off the reply floor"],
    [/\.overlay-input \{[^}]*top: 250px;/, 'the input bar is not 250 px down'],
    [/\.overlay-send \{[^}]*right: 8px;\s*top: 5px;[\s\S]{0,120}?width: 32px;\s*height: 32px;/, "the send control is not the node's 32 px"],
    [/\.overlay-error \{[^}]*width: 320px;[\s\S]{0,80}?height: 100px;/, "the error block is not the node's 320 x 100"],
    [/\.overlay-window-collapsed \.overlay-input \{[^}]*left: 44px;\s*right: 48px;\s*top: 9px;/, "the collapsed bar's input is not at the node's inset"],
    [/\.overlay-expand \{[^}]*right: 10px;\s*top: 13px;/, 'the expand control is not where the node puts it'],
    [/\.overlay-app-bar \{[^}]*height: 41px;/, 'the app window title bar is not 40 px plus its rule'],
    [/\.overlay-app-sidebar \{[^}]*width: 132px;/, "the app window sidebar is not the node's 132 px"],
    [/\.overlay-app-thread \{[^}]*left: 160px;\s*top: 72px;\s*width: 400px;/, "the skeleton thread is not at the node's (160, 72)"],
    [/-webkit-backdrop-filter: blur\(20px\)/, "the window does not take the node's 20 px background blur"],
    [/--qa-shadow-overlay: 0 12px 32px rgba\(15, 23, 42, 0\.1216\);/, "the window shadow is not the node's"],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('overlay.html allows inline script or style');
  if (!/<script type="module" src="overlay\.js"><\/script>/.test(html)) {
    throw new Error('overlay.html does not load its module');
  }

  return 'five drawn frames, 360 x 304 window (360 x 56 collapsed), 24 px brand, 44 px header rule, 336 x 190 reply, 336 x 42 input, 320 x 100 error block, light and dark palettes, node copy';
});

check('the Error / not-found view is drawn from node 0:104020', () => {
  const html = read('src/renderer/views/404.html');
  const css = read('src/renderer/views/404.css');
  const js = read('src/renderer/views/404.js');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`404.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:104020 draws four frames: the view that failed to load (its default),
  // an unknown route, a reload in progress, and the same panel at 390 px. A frame
  // that is missing is a screen ?state= can name and land on nothing.
  const frames = ['error', 'not-found', 'recovering'];
  const declared = [...html.matchAll(/<section class="error-state" data-state="([\w-]+)"/g)].map((match) => match[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['error', 'not-found', 'recovering']") || !js.includes('STATES')) {
    throw new Error('404.js does not list the three states');
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('404.js does not publish its states');
  if (!/<body class="error-page" data-state="error">/.test(html)) {
    throw new Error('the default frame is not the one the node marks default');
  }

  // The page follows the app theme like every other view (decision 3): the markup
  // opens in the node's light collection and ?theme=dark opens the dark one, whose
  // values are the same semantic roles in the dark collection.
  if (!/<html lang="en" data-theme="light">/.test(html)) throw new Error('404.html does not open in the light collection');
  if (!/name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/.test(html)) {
    throw new Error('404.html has no phone viewport with the safe area');
  }
  if (!/<meta name="color-scheme" content="light dark" \/>/.test(html)) {
    throw new Error('404.html declares one color scheme, so the dark page keeps light scrollbars');
  }
  if (!/themeFromSearch\(window\.location\.search\)/.test(js) || !/paintTheme\(/.test(js)) {
    throw new Error('404.js does not settle the theme the address asks for');
  }
  if (!js.includes("matchMedia('(prefers-color-scheme: dark)')")) {
    throw new Error('404.js never falls back to the system theme');
  }
  if (!/:root\[data-theme="dark"\] \.error-page \{/.test(tokens)) {
    throw new Error('tokens.css has no dark collection for the error page');
  }
  if (!/min-height: 100dvh;/.test(ruleBody('.error-page'))) {
    throw new Error('the page is not 100dvh tall, so a phone address bar cuts it off');
  }

  // The copy of all four frames, so none of them can rot into a placeholder.
  // The dash the node draws is an entity in the markup, so the fragments below
  // stop before it.
  const copy = [
    'Zuri Desktop',
    'New chat',
    'Variance column for Q4',
    'Rewrite the launch email',
    'Travel policy questions',
    'Add variance column',
    'Q4 budget',
    "This view couldn't load",
    'Something went wrong while rendering the chat view. Your conversations are safe',
    'Something went wrong while rendering this view. Your conversations are safe',
    'Back to chat',
    'Reload view',
    'If this keeps happening, quit Zuri Desk from the tray and start it again.',
    "That page doesn't exist",
    "This route isn't part of Zuri Desk. It may have been opened from an old link or",
    'Desktop routes live in the main window',
    'Reloading this view',
    'Holding the window so it never goes blank. This usually takes a second.',
    'Reloading',
    'Or quit from the tray and reopen',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`404.html is missing "${text}"`);
  }

  // The node draws the alert glyph in the two failure frames and the loader in
  // the recovering one, so the third frame must not reuse the alert circle.
  const alertGlyphs = [...html.matchAll(/<circle cx="12" cy="12" r="10" \/>/g)].length;
  if (alertGlyphs !== 2) throw new Error(`the alert glyph is drawn ${alertGlyphs} times, not in two frames`);
  if (!html.includes('M21 12a9 9 0 1 1-6.22-8.56')) throw new Error('the recovering frame has no loader glyph');

  // The recovering frame draws its primary action disabled: a sunken fill and a
  // muted label, with the white glyph the node still binds to it.
  const recovering = [
    [/\.error-state\[data-state="recovering"\] \.error-action-primary \{[^}]*background: var\(--zuri-error-sunken\);/, 'the recovering action is not drawn disabled'],
    [/\.error-state\[data-state="recovering"\] \.error-action-primary \{[^}]*color: var\(--zuri-error-text-muted\);/, 'the recovering label is not the node\'s muted grey'],
    [/\.error-state\[data-state="recovering"\] \.error-action-primary svg \{[^}]*stroke: var\(--zuri-error-on-primary\);/, 'the recovering glyph lost the node\'s white stroke'],
    [/\.error-state\[data-state="recovering"\] \.error-disc \{/, 'the recovering disc has no colour of its own'],
    [/\.error-state\[data-state="recovering"\] \.error-disc \{[^}]*color: var\(--zuri-error-primary\);/, 'the recovering disc is not the node\'s primary blue'],
  ];
  for (const [pattern, message] of recovering) {
    if (!pattern.test(css)) throw new Error(message);
  }

  // The node's geometry, read from the token layer rather than copied into rules.
  const panel = ruleBody('.error-panel');
  const geometry = [
    ["the node's 600 px panel", ruleBody('.error-state'), /width: min\(100%, var\(--zuri-error-panel-width\)\)/],
    ["the node's 340 px panel height", panel, /min-height: var\(--zuri-error-panel-min-height\)/],
    ["the node's 32 / 28 / 28 panel padding", panel, /padding: var\(--zuri-error-panel-padding\)/],
    ["the node's 12 px panel radius", panel, /border-radius: var\(--zuri-radius-modal\)/],
    ["the node's panel shadow", panel, /box-shadow: var\(--zuri-error-panel-shadow\)/],
    ["the node's 44 px disc", ruleBody('.error-disc'), /width: var\(--zuri-error-disc\)/],
    ["the node's 40 px actions", ruleBody('.error-action'), /height: var\(--zuri-error-control-height\)/],
    ["the node's 48 px restart strip", ruleBody('.error-hint'), /min-height: var\(--zuri-error-hint-height\)/],
    ["the node's 260 px sidebar", ruleBody('.error-sidebar'), /width: var\(--zuri-error-sidebar-width\)/],
    ["the node's 320 px rail", ruleBody('.error-rail'), /width: var\(--zuri-error-rail-width\)/],
    ["the node's 32 px title bar", ruleBody('.error-titlebar'), /height: var\(--zuri-error-titlebar-height\)/],
    ["the node's 52 px top bar", ruleBody('.error-topbar'), /height: var\(--zuri-error-topbar-height\)/],
    ["the panel's 150 px top edge", ruleBody('.error-main'), /padding: var\(--zuri-error-main-top\)/],
  ];
  for (const [label, body, pattern] of geometry) {
    if (!pattern.test(body)) throw new Error(`${label} is not in 404.css`);
  }

  // The fourth frame is the same page at 390 px: no sidebar or rail, a 20 px
  // panel inset, 44 px actions, a 32 px strip and the shorter sentence.
  const phone = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (prefers-reduced-motion'));
  const phoneRules = [
    [/\.error-sidebar,\s*\n\s*\.error-rail \{\s*\n\s*display: none;/, 'the phone frame keeps the sidebar or rail'],
    [/\.error-panel \{[^}]*padding: 24px 20px 20px;/, 'the phone panel is not the node\'s 20 px inset'],
    [/\.error-action \{[^}]*height: 44px;/, 'the phone actions are not the node\'s 44 px'],
    [/\.error-action-quiet \{[^}]*width: 48px;/, 'the phone reload button is not the node\'s 48 px square'],
    [/\.error-action-primary \{\s*\n\s*flex: none;\s*\n\s*width: 230px;/, 'the phone primary is not the node\'s 230 px, so the pair no longer stops short of the edge'],
    [/\.error-hint \{[^}]*min-height: 32px;/, 'the phone strip is not the node\'s 32 px'],
    [/\.error-hint \{[^}]*gap: 6px;/, 'the phone strip does not keep the node\'s 6 px between glyph and sentence'],
    [/\.error-state\[data-state="error"\] \.error-hint-short \{/, 'the phone frame does not swap in the shorter sentence'],
    [/\.error-state\[data-state="error"\] \.error-message-short \{/, 'the phone frame keeps the desktop wording of the message'],
  ];
  for (const [pattern, message] of phoneRules) {
    if (!pattern.test(phone)) throw new Error(message);
  }

  // Below 768 px the shell's destinations stay on screen as a bottom bar, which is
  // the project's phone rule and what the page needs once the sidebar and rail are
  // gone. A hamburger is not an option, so the drawn menu glyph is gone for good.
  const tabbar = /<nav class="error-tabbar" aria-label="Primary">([\s\S]*?)<\/nav>/.exec(html);
  if (tabbar === null) throw new Error('404.html has no phone navigation bar');
  const destinations = [...tabbar[1].matchAll(/class="error-tabbar-item"/g)].length;
  if (destinations < 3 || destinations > 5) {
    throw new Error(`the phone bar carries ${destinations} destinations, not the 3 to 5 a phone needs`);
  }
  if (!/aria-current="page"/.test(tabbar[1])) {
    throw new Error('the phone bar marks no current destination');
  }
  if (/error-menu/.test(html) || /\.error-menu/.test(css)) {
    throw new Error('the phone navigation hides behind a menu button again');
  }
  if (!/\.error-tabbar \{[^}]*padding-bottom: env\(safe-area-inset-bottom\);/.test(css)) {
    throw new Error('the phone bar does not clear the home indicator');
  }
  if (!/\.error-tabbar \{\s*\n\s*display: flex;/.test(phone)) {
    throw new Error('the phone frame never shows the navigation bar');
  }
  if (!/\.error-tabbar \{[^}]*position: fixed;/.test(phone)) {
    throw new Error('the phone navigation scrolls away with the column');
  }
  if (
    !/\.error-main \{[^}]*padding-bottom: calc\(var\(--zuri-error-tabbar-height\) \+ 24px \+ env\(safe-area-inset-bottom\)\)/.test(
      phone,
    )
  ) {
    throw new Error('the phone column does not leave room for the navigation bar');
  }
  if (!/--zuri-error-tabbar-height: 56px;/.test(tokens)) {
    throw new Error('the phone bar has no height in the token layer');
  }

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('404.html allows inline script or style');
  if (!/<script type="module" src="404\.js"><\/script>/.test(html)) {
    throw new Error('404.html does not load its module');
  }

  // The node's palette is one page-scoped token block, so a colour changed in
  // open-pencil is a single value edit. The page rules hold no literal colour.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`404.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  const label = 'Error / not-found view (design node 0:104020)';
  if (!tokens.includes(label)) throw new Error('tokens.css has no error page block naming node 0:104020');
  const start = tokens.indexOf('.error-page {');
  if (start === -1) throw new Error('tokens.css has no .error-page block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  const palette = [
    ['--zuri-error-window', '#ffffff'], // color/inverse
    ['--zuri-error-panel', '#ffffff'], // color/inverse
    ['--zuri-error-hairline', '#e8eaed'], // color/border
    ['--zuri-error-panel-shadow', '0 4px 16px rgba(15, 23, 42, 0.08)'], // the node's 0 4 16 #0F172A14
    ['--zuri-error-sunken', '#f0f1f3'], // color/sunken
    ['--zuri-error-surface', '#f7f8f9'], // color/surface
    ['--zuri-error-text', '#1f2328'], // color/text
    ['--zuri-error-text-subtle', '#6b7280'], // color/subtle
    ['--zuri-error-text-muted', '#8e9196'], // color/muted
    ['--zuri-error-primary', '#2f6bff'], // color/primary
    ['--zuri-error-on-primary', '#ffffff'],
    ['--zuri-error-alert', '#d14343'],
    ['--zuri-error-avatar', '#6b4eff'], // color/accent
  ];
  for (const [token, value] of palette) {
    if (!pageTokens.includes(`${token}: ${value};`)) {
      throw new Error(`${token} is not the value node 0:104020 binds`);
    }
  }
  // The chrome fades and the phone measurements are the node's own numbers.
  const numbers = [
    ['--zuri-error-panel-width', '600px'],
    ['--zuri-error-panel-min-height', '340px'],
    ['--zuri-error-panel-padding', '32px 28px 28px'],
    ['--zuri-error-disc', '44px'],
    ['--zuri-error-control-height', '40px'],
    ['--zuri-error-hint-height', '48px'],
    ['--zuri-error-sidebar-width', '260px'],
    ['--zuri-error-rail-width', '320px'],
    ['--zuri-error-titlebar-height', '32px'],
    ['--zuri-error-topbar-height', '52px'],
    ['--zuri-error-main-top', '150px'],
    ['--zuri-error-chrome-fade', '0.5'],
    ['--zuri-error-card-fade', '0.6'],
  ];
  for (const [token, value] of numbers) {
    if (!pageTokens.includes(`${token}: ${value};`)) {
      throw new Error(`${token} is not the measurement node 0:104020 draws`);
    }
  }

  return 'three desktop frames over one shell, 600 x 340 panel at 150 px, 44 px disc, 40 px actions, 48 px strip, 260 / 320 side rails, 390 px frame with a 3 item bottom bar, node copy, one page-scoped palette in both collections';
});

check('the Self-test results view is drawn from node 0:15423 at /selftest', () => {
  const html = read('src/renderer/views/selftest.html');
  const css = read('src/renderer/views/selftest.css');
  const js = read('src/renderer/views/selftest.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // pages.md gives this page the route /selftest, and preview.js serves a route
  // from the view file of the same name, so the file name is the route.
  if (!exists('src/renderer/views/selftest.html')) {
    throw new Error('/selftest has no view file');
  }

  // A phone shows a shrunken desktop page without the viewport line, and the
  // safe area is what keeps the last row off the home indicator.
  if (
    !html.includes(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    )
  ) {
    throw new Error('selftest.html does not declare the phone viewport');
  }
  if (!/<html lang="en" data-theme="light">/.test(html)) throw new Error('selftest.html does not pin the light theme');
  if (/'unsafe-inline'/.test(html)) throw new Error('selftest.html allows inline script or style');
  if (!html.includes('<link rel="stylesheet" href="../styles/tokens.css" />')) {
    throw new Error('selftest.html does not load the token layer');
  }
  if (!html.includes('<link rel="stylesheet" href="selftest.css" />')) {
    throw new Error('selftest.html does not load its own stylesheet');
  }
  if (!html.includes('<script src="selftest.js" defer></script>')) {
    throw new Error('selftest.html does not load its script');
  }

  // The five frames the node draws, plus the four the screen check opens by name,
  // loading, error, disabled and empty. Every name needs a branch, or the
  // check lands on a page that looks like a different frame.
  const frames = ['pass', 'fail', 'running', 'idle', 'loading', 'error', 'disabled', 'empty'];
  const declared = js.match(/const STATES = \[([^\]]+)\]/);
  if (declared === null) throw new Error('selftest.js does not list its states');
  const names = [...declared[1].matchAll(/'([\w-]+)'/g)].map((match) => match[1]);
  if (names.join(',') !== frames.join(',')) throw new Error(`the frames are ${names.join(', ') || 'none'}`);
  if (!js.includes('window.__KAI_STATES__')) throw new Error('selftest.js does not publish its states');
  if (!/<body class="selftest-page" data-state="pass">/.test(html)) {
    throw new Error('the default frame is not the passing run');
  }
  for (const frame of frames) {
    if (!js.includes(`${frame}: {`) && !js.includes(`'${frame}'`)) {
      throw new Error(`selftest.js has no ${frame} frame`);
    }
  }

  // The three suites pages.md names, each with the file its checks cover.
  const suites = [
    ['Store', 'store.js'],
    ['Scheduler', 'scheduler.js'],
    ['Tool allow-list', 'tools/index.js'],
  ];
  for (const [name, file] of suites) {
    if (!html.includes(`>${name}<`) || !html.includes(`>${file}<`)) {
      throw new Error(`the ${name} suite is not drawn`);
    }
  }
  if (!js.includes("id: 'store'") || !js.includes("id: 'scheduler'") || !js.includes("id: 'tools'")) {
    throw new Error('selftest.js does not fill the three suites');
  }

  // The summary sentence is derived from the same table as the rows, so the
  // count in the heading cannot disagree with the checks under it.
  if (!js.includes('All ${ALL_CHECKS.length} checks passed')) {
    throw new Error('the summary count is not derived from the check table');
  }
  if (!js.includes('exit code 0') || !js.includes('exit code 1')) {
    throw new Error('the exit-code caption is missing from a frame');
  }
  if (!html.includes('Run again')) throw new Error('the run-again button is missing');

  // Radii are the tokens.json bindings the node uses: cards 10, rows 8, pills 999.
  const palette = tokens.slice(tokens.indexOf('.selftest-page {'));
  const body = palette.slice(0, palette.indexOf('\n}'));
  const radii = [
    ['--zuri-selftest-card-radius', 'var(--zuri-radius-card)'],
    ['--zuri-selftest-row-radius', 'var(--zuri-radius-row)'],
    ['--zuri-selftest-pill-radius', 'var(--zuri-radius-pill)'],
  ];
  for (const [token, value] of radii) {
    if (!body.includes(`${token}: ${value};`)) throw new Error(`${token} is not the node's radius binding`);
  }

  // No literal colour in the view: the palette is the page-scoped token block.
  if (/#[0-9a-fA-F]{3,8}\b/.test(css)) throw new Error('selftest.css holds a literal colour');
  if (/rgba?\(/.test(css)) throw new Error('selftest.css holds a literal colour');

  // The page's CSP has no unsafe-inline, so a style attribute the script builds
  // is dropped by the browser and the loading frame loses its placeholder.
  if (/style\s*=/.test(js)) throw new Error('selftest.js writes a style attribute the CSP blocks');

  // The page is drawn for a desktop, and pages.md marks it phone-version "no";
  // these rules are what keep 390 px from scrolling sideways all the same.
  if (!/@media \(max-width: 860px\)/.test(css)) throw new Error('the settings nav never becomes a row');
  if (!/@media \(max-width: 620px\)/.test(css)) throw new Error('the phone layout has no rules');
  if (!css.includes('env(safe-area-inset-bottom)')) throw new Error('the phone layout ignores the safe area');

  return 'route /selftest, seven frames from one tree, three suites with their assertion text, summary and rail, radius-card 10 / radius-row 8 / radius-pill 999, one page-scoped palette';
});

check('the smoke and first-run check overlay is drawn from node 0:15576 at /diagnostics', () => {
  const html = read('src/renderer/views/diagnostics.html');
  const css = read('src/renderer/views/diagnostics.css');
  const js = read('src/renderer/views/diagnostics.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // pages.md gives this page the route /diagnostics, and preview.js serves a
  // route from the view file of the same name, so the file name is the route.
  if (!exists('src/renderer/views/diagnostics.html')) throw new Error('/diagnostics has no view file');
  if (!exists('src/renderer/views/diagnostics.css')) throw new Error('/diagnostics has no stylesheet');
  if (!exists('src/renderer/views/diagnostics.js')) throw new Error('/diagnostics has no script');

  // A phone shows a shrunken desktop page without the viewport line, and the
  // safe area is what keeps the last row off the home indicator.
  if (
    !html.includes(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    )
  ) {
    throw new Error('diagnostics.html does not declare the phone viewport');
  }
  if (!/<html lang="en" data-theme="light">/.test(html)) throw new Error('diagnostics.html does not pin its theme');
  if (/'unsafe-inline'/.test(html)) throw new Error('diagnostics.html allows inline script or style');
  if (!html.includes('<link rel="stylesheet" href="../styles/tokens.css" />')) {
    throw new Error('diagnostics.html does not load the token layer');
  }
  if (!html.includes('<link rel="stylesheet" href="diagnostics.css" />')) {
    throw new Error('diagnostics.html does not load its own stylesheet');
  }
  if (!html.includes('<script src="diagnostics.js" defer></script>')) {
    throw new Error('diagnostics.html does not load its script');
  }

  // The four frames pages.md lists, plus the aliases a screen check opens by
  // name: an alias without a branch would land on a frame that looks like run.
  const frames = ['pass', 'fail', 'running', 'idle'];
  const declared = js.match(/const STATES = \[([^\]]+)\]/);
  if (declared === null) throw new Error('diagnostics.js does not list its states');
  const names = [...declared[1].matchAll(/'([\w-]+)'/g)].map((match) => match[1]);
  if (names.join(',') !== frames.join(',')) throw new Error(`the frames are ${names.join(', ') || 'none'}`);
  for (const alias of ['empty', 'loading', 'error', 'disabled']) {
    if (!js.includes(`${alias}: '`)) throw new Error(`diagnostics.js has no ${alias} alias`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('diagnostics.js does not publish its states');
  if (!/<body class="diagnostics-page" data-state="pass">/.test(html)) {
    throw new Error('the default frame is not the passing run');
  }
  for (const frame of frames) {
    if (!js.includes(`${frame}: {`)) throw new Error(`diagnostics.js has no ${frame} frame`);
  }

  // The shell behind the scrim is the three regions the smoke run asserts, and
  // each is named in the markup because that is what the check looks for.
  for (const region of ['sidebar', 'chat', 'context-panel']) {
    if (!html.includes(`id="${region}"`)) throw new Error(`the shell does not draw #${region}`);
    if (!js.includes(`subject: '#${region}'`)) throw new Error(`the assertion list does not name #${region}`);
  }
  if (!js.includes("subject: 'console errors'")) throw new Error('the assertion list does not name the console check');
  if (!/<section\s+[\s\S]*?role="dialog"/.test(html)) throw new Error('the panel is not drawn as a dialog over the shell');

  // pages.md: two run buttons, the assertion list, the console log and the
  // settings path. The frame that fails has to name the failure and exit 1.
  if (!html.includes('Run shell check')) throw new Error('the shell check button is missing');
  if (!html.includes('Run first-run check')) throw new Error('the first-run check button is missing');
  if (!js.includes('exit code 0') || !js.includes('exit code 1')) {
    throw new Error('the exit-code caption is missing from a frame');
  }
  if (!js.includes('FAILED_ASSERTION') || !js.includes('expected')) {
    throw new Error('the failing frame does not name the assertion it caught');
  }
  if (!html.includes('data-log') || !html.includes('data-log-count')) {
    throw new Error('the console-error log is missing');
  }
  if (!html.includes('settings.json') || !html.includes('data-settings-path')) {
    throw new Error('the settings path is missing');
  }

  // The summary count is derived from the assertion table, so the heading
  // cannot disagree with the rows under it.
  if (!js.includes('All ${ASSERTIONS.length} assertions passed')) {
    throw new Error('the summary count is not derived from the assertion table');
  }

  // Radii are the tokens.json bindings this node uses: the panel on
  // radius-overlay 12, rows and buttons on radius-row 8, log on card 10, pills 999.
  const palette = tokens.slice(tokens.indexOf('.diagnostics-page {'));
  if (palette === '') throw new Error('tokens.css has no .diagnostics-page block');
  const pageTokens = palette.slice(0, palette.indexOf('\n}'));
  const radii = [
    ['--zuri-diagnostics-panel-radius', 'var(--zuri-radius-overlay)'],
    ['--zuri-diagnostics-row-radius', 'var(--zuri-radius-row)'],
    ['--zuri-diagnostics-card-radius', 'var(--zuri-radius-card)'],
    ['--zuri-diagnostics-pill-radius', 'var(--zuri-radius-pill)'],
  ];
  for (const [token, value] of radii) {
    if (!pageTokens.includes(`${token}: ${value};`)) throw new Error(`${token} is not the node's radius binding`);
  }
  // The panel's drawn geometry: 560 px wide, sitting 96 px under the bar.
  for (const [token, value] of [
    ['--zuri-diagnostics-overlay-width', '560px'],
    ['--zuri-diagnostics-overlay-top', '96px'],
  ]) {
    if (!pageTokens.includes(`${token}: ${value};`)) throw new Error(`${token} is not the drawn ${value}`);
  }
  // The fail frame's log is taller than the pass frame's: the panel has to scroll
  // inside itself rather than run its buttons off the bottom of the window.
  if (!/\.diagnostics-overlay \{[^}]*overflow-y: auto/.test(css)) {
    throw new Error('a tall frame would run off screen: the overlay has no scroll box');
  }

  // No literal colour in the view: the palette is the page-scoped token block.
  if (/#[0-9a-fA-F]{3,8}\b/.test(css)) throw new Error('diagnostics.css holds a literal colour');
  if (/rgba?\(/.test(css)) throw new Error('diagnostics.css holds a literal colour');

  // The page's CSP has no unsafe-inline, so a style attribute the script builds
  // is dropped by the browser and the drawn frame loses its tone.
  if (/style\s*=/.test(js)) throw new Error('diagnostics.js writes a style attribute the CSP blocks');
  if (!js.includes('dataset.tone')) throw new Error('the rows carry no tone for the palette to paint');

  // pages.md marks this page phone version "no"; these rules are what keep
  // 390 px from scrolling sideways and the footer off the home indicator.
  if (!/@media \(max-width: 880px\)/.test(css)) throw new Error('the shell columns never give way');
  if (!/@media \(max-width: 620px\)/.test(css)) throw new Error('the phone layout has no rules');
  if (!css.includes('env(safe-area-inset-bottom)')) throw new Error('the phone layout ignores the safe area');
  if (!/\.diagnostics-button \{[^}]*height: 44px/.test(css)) throw new Error('the phone buttons are not 44 px targets');
  if (!/\.diagnostics-topbar \{[^}]*width: 100%;/.test(css)) throw new Error('the top bar does not span the window');

  // Two wraps the 390 px screenshots showed going wrong: the seconds unit left
  // alone on its own line, and the settings path split through a file name.
  if (!/const NBSP = '\\u00a0'/.test(js) || !/formatSeconds[\s\S]{0,160}NBSP/.test(js)) {
    throw new Error('the seconds value can split from its unit');
  }
  if ((html.match(/<wbr \/>/g) ?? []).length < 5) {
    throw new Error('the settings path has no break points between its folders');
  }
  if (/\.diagnostics-path-value \{[^}]*overflow-wrap: anywhere/.test(css)) {
    throw new Error('the settings path can wrap through the middle of a file name');
  }

  return 'route /diagnostics, four frames plus four aliases, shell behind a scrim with #sidebar / #chat / #context-panel, two run buttons, console log and settings path, overlay 12 / row 8 / card 10 / pill 999, one page-scoped palette';
});

check('the Sign-in view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/sign-in.js');
  const css = read('src/renderer/views/sign-in.css');

  // The node draws four frames; `disabled` is the standard state it has no frame
  // for, so it borrows one. A page that lists only the drawn frames leaves the
  // screen check with a state it can open and land on nothing.
  const frames = js.match(/const FRAMES = \[([^\]]*)\]/);
  if (!frames) throw new Error('sign-in.js does not list the node frames');
  if (frames[1].includes('disabled')) throw new Error('disabled is listed as a drawn frame');

  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('sign-in.js does not list the states a check can open');
  for (const state of ['empty', 'loading', 'error', 'disabled']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`sign-in.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('sign-in.js does not publish its states');

  // The disabled state is the drawn frame with the form out of reach: the style
  // guide's disabled control look, and attributes so the fields really are off.
  const disabled = /\.signin-page\[data-state="disabled"\] \.signin-input,[\s\S]*?\{([^}]*)\}/.exec(css);
  if (!disabled) throw new Error('sign-in.css has no disabled state rule');
  if (!/opacity: 0\.4;/.test(disabled[1])) throw new Error('the disabled form is not the style guide 40% opacity');
  if (!/pointer-events: none;/.test(disabled[1])) throw new Error('the disabled form still takes the pointer');
  for (const control of ['emailInput.disabled', 'passwordInput.disabled', 'revealButton.disabled', 'submitButton.disabled', 'rememberInput.disabled']) {
    if (!js.includes(control)) throw new Error(`${control} is not set, so the control stays live`);
  }

  return 'four drawn frames plus the standard disabled state, 40% opacity, no pointer, every control switched off';
});

check('the Sign-up view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/sign-up.js');
  const css = read('src/renderer/views/sign-up.css');
  const html = read('src/renderer/views/sign-up.html');

  // The node draws all five frames, the out-of-reach one included, so every state
  // the page can open is a frame the drawing has already answered.
  const frames = js.match(/const FRAMES = \[([^\]]*)\]/);
  if (!frames) throw new Error('sign-up.js does not list the node frames');
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('sign-up.js does not list the states a check can open');
  for (const state of ['empty', 'loading', 'error', 'disabled', 'success']) {
    if (!frames[1].includes(`'${state}'`)) throw new Error(`sign-up.js does not list the ${state} frame`);
    if (!states[1].includes(`'${state}'`)) throw new Error(`sign-up.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('sign-up.js does not publish its states');

  // The out-of-reach frame is drawn: a sunken button and a muted label rather than
  // the style guide's 40% fade, with the controls switched off to match it.
  const disabledButton = /\.signup-page\[data-state="disabled"\] \.signup-submit \{([^}]*)\}/.exec(css);
  if (!disabledButton) throw new Error('sign-up.css has no out-of-reach button rule');
  if (!/background: var\(--zuri-signup-sunken\)/.test(disabledButton[1])) {
    throw new Error('the out-of-reach button is not on the sunken fill');
  }
  if (!/color: var\(--zuri-signup-text-muted\)/.test(disabledButton[1])) {
    throw new Error('the out-of-reach label is not on the muted tone');
  }
  for (const control of ['nameInput.disabled', 'emailInput.disabled', 'passwordInput.disabled', 'revealButton.disabled', 'submitButton.disabled']) {
    if (!js.includes(control)) throw new Error(`${control} is not set, so the control stays live`);
  }

  // The strength row draws three bands: nothing, one amber bar, three green.
  for (const band of ['weak', 'strong']) {
    if (!css.includes(`.signup-strength[data-strength="${band}"]`)) {
      throw new Error(`sign-up.css has no ${band} strength rule`);
    }
  }
  if (!js.includes("return longEnough && varied ? 'strong' : 'weak';")) {
    throw new Error('the strength row is not read from the value that was typed');
  }

  // "The design only changes when the node changes" needs one place to edit: the
  // page block in tokens.css. A colour literal in the page's own stylesheet is a
  // second place, and the two drift.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) throw new Error('sign-up.css holds a colour literal instead of a token');

  // The page is the one the sign-in page hands over to.
  if (!read('src/renderer/views/sign-in.html').includes('href="sign-up.html"')) {
    throw new Error('the sign-in page no longer links the sign-up page');
  }
  if (!html.includes('class="signup-page"')) throw new Error('sign-up.html is not the sign-up page');

  return 'five drawn frames, the out-of-reach one in its own tones with every control off, three strength bands, colours only from the page token block';
});

check('the Forgot-password view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/forgot-password.js');
  const css = read('src/renderer/views/forgot-password.css');
  const html = read('src/renderer/views/forgot-password.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The node draws all five frames, the blank-email one included, so every state
  // the page can open is a frame the drawing has already answered.
  const frames = js.match(/const FRAMES = \[([^\]]*)\]/);
  if (!frames) throw new Error('forgot-password.js does not list the node frames');
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('forgot-password.js does not list the states a check can open');
  for (const state of ['empty', 'loading', 'sent', 'error', 'disabled']) {
    if (!frames[1].includes(`'${state}'`)) throw new Error(`forgot-password.js does not list the ${state} frame`);
    if (!states[1].includes(`'${state}'`)) throw new Error(`forgot-password.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('forgot-password.js does not publish its states');

  // The blank-email frame is drawn: a sunken button and a muted label, with the
  // controls switched off to match it.
  const disabledButton = /\.forgot-page \.forgot-submit:disabled \{([^}]*)\}/.exec(css);
  if (!disabledButton) throw new Error('forgot-password.css has no inert button rule');
  if (!/background: var\(--zuri-forgot-sunken\)/.test(disabledButton[1])) {
    throw new Error('the inert button is not on the sunken fill');
  }
  if (!/color: var\(--zuri-forgot-text-muted\)/.test(disabledButton[1])) {
    throw new Error('the inert label is not on the muted tone');
  }
  for (const control of ['emailInput.disabled', 'submitButton.disabled']) {
    if (!js.includes(control)) throw new Error(`${control} is not set, so the control stays live`);
  }

  // The node draws the card in three heights and the sent card 40 px lower.
  for (const state of ['error', 'sent']) {
    if (!css.includes(`.forgot-page[data-state="${state}"] .forgot-card`)) {
      throw new Error(`forgot-password.css does not set the ${state} card height`);
    }
  }
  if (!css.includes('.forgot-page[data-state="sent"] .forgot-form')) {
    throw new Error('forgot-password.css does not move the sent card');
  }

  // "The design only changes when the node changes" needs one place to edit: the
  // page block in tokens.css. A colour literal in the page's own stylesheet is a
  // second place, and the two drift.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) throw new Error('forgot-password.css holds a colour literal instead of a token');
  if (!tokens.includes('.forgot-page {')) throw new Error('tokens.css has no forgot-password page block');
  const used = new Set([...css.matchAll(/var\((--zuri-forgot-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }

  // The page is the one the sign-in page hands over to.
  if (!read('src/renderer/views/sign-in.html').includes('href="forgot-password.html"')) {
    throw new Error('the sign-in page no longer links the forgot-password page');
  }
  if (!html.includes('class="forgot-page"')) throw new Error('forgot-password.html is not the forgot-password page');

  return 'five drawn frames, the blank-email one in its own tones with the controls off, three card heights, colours and measurements only from the page token block';
});

check('the Reset-password view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/reset-password.js');
  const css = read('src/renderer/views/reset-password.css');
  const html = read('src/renderer/views/reset-password.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The expired link is opened as the page's error frame, and disabled is the
  // saving frame's inert control treatment with no save behind it. Both names
  // have to be in the list the page publishes, or a screen check cannot open them.
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('reset-password.js does not list the states a check can open');
  for (const state of ['empty', 'loading', 'error', 'mismatch', 'disabled', 'success']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`reset-password.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('reset-password.js does not publish its states');

  // The error state shows the result panel the node draws for it, at its height.
  if (!html.includes('reset-panel-error')) throw new Error('reset-password.html has no error panel');
  if (!css.includes('.reset-page[data-state="error"] .reset-panel-error')) {
    throw new Error('reset-password.css does not show the error panel for the error state');
  }
  if (!css.includes('.reset-page[data-state="error"] .reset-card')) {
    throw new Error('reset-password.css does not set the error card height');
  }

  // The disabled frame switches both fields off and draws the button inert.
  for (const control of ['newInput.disabled', 'confirmInput.disabled', 'submitButton.disabled', 'button.disabled']) {
    if (!js.includes(control)) throw new Error(`${control} is not set, so the control stays live`);
  }
  const inertButton = /\.reset-page \.reset-submit:disabled \{([^}]*)\}/.exec(css);
  if (!inertButton) throw new Error('reset-password.css has no inert button rule');
  if (!/background: var\(--zuri-reset-sunken\)/.test(inertButton[1])) {
    throw new Error('the inert button is not on the sunken fill');
  }
  if (!/color: var\(--zuri-reset-text-muted\)/.test(inertButton[1])) {
    throw new Error('the inert label is not on the muted tone');
  }
  if (!css.includes('.reset-page[data-state="disabled"] .reset-input')) {
    throw new Error('the disabled frame does not draw its fields sunken');
  }
  // The saving frame keeps the node's own tones, so its rule must come after the
  // inert one: equal specificity, and the later rule wins.
  if (
    css.indexOf('.reset-page[data-state="loading"] .reset-submit {') <
    css.indexOf('.reset-page .reset-submit:disabled {')
  ) {
    throw new Error('the inert button rule comes after the saving frame and overrides it');
  }

  // A link written before the rename still opens the error frame.
  if (!js.includes("ALIASES = { expired: 'error' }")) {
    throw new Error('reset-password.js no longer maps the old expired state');
  }

  // "The design only changes when the node changes" needs one place to edit: the
  // page block in tokens.css. A colour literal in the page's own stylesheet is a
  // second place, and the two drift.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) throw new Error('reset-password.css holds a colour literal instead of a token');
  const used = new Set([...css.matchAll(/var\((--zuri-reset-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }

  return 'six states, the expired link opened as the error frame, the disabled frame with both fields and the button off, colours only from the page token block';
});

check('the Account view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/account.js');
  const css = read('src/renderer/views/account.css');
  const html = read('src/renderer/views/account.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The node draws five frames of the same page. The screen check also opens
  // empty, loading and disabled. Each name has to be in the published list, or a
  // check cannot open that frame and lands on the default page instead.
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('account.js does not list the states a check can open');
  for (const state of ['default', 'dirty', 'saving', 'saved', 'error', 'empty', 'loading', 'disabled']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`account.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('account.js does not publish its states');

  // The page's parts: the name field, the data folder row, the counts, the reset
  // dialog, the saved toast and the read-error banner.
  for (const part of [
    'id="account-name"',
    'id="account-path"',
    'data-stat="threads"',
    'id="account-banner"',
    'id="account-toast"',
    'id="account-scrim"',
    'role="dialog"',
    'id="account-reset-confirm"',
  ]) {
    if (!html.includes(part)) throw new Error(`account.html has no ${part}`);
  }

  // The frames differ in four visible places, so the check pins each one.
  if (!js.includes('el.banner.hidden = !failed')) throw new Error('the error frame never shows the banner');
  if (!js.includes("el.toast.hidden = next !== 'saved'")) throw new Error('the saved frame never shows the toast');
  if (!js.includes("el.save.disabled = next !== 'dirty'")) {
    throw new Error('Save is not live only in the dirty frame');
  }
  if (!js.includes('el.name.disabled = failed || saving || loading || locked;')) {
    throw new Error('the field stays editable while saving, loading or after a read error');
  }
  if (!js.includes("stat.textContent = failed ? '-' : loading ? '' : empty ? '0' : DRAWN_COUNTS[index];")) {
    throw new Error('the new frames keep counts the page has not read');
  }

  // The three standard frames are drawn, not just declared: empty clears the name
  // and zeroes the counts, loading fades the count cells, disabled switches every
  // control off and takes the pointer away.
  if (!js.includes("if (failed || loading || empty) el.name.value = '';")) {
    throw new Error('the empty frame keeps a name the store has not got');
  }
  for (const control of ['el.openFolder.disabled', 'el.reset.disabled', 'el.themeButton.disabled', 'option.disabled']) {
    if (!js.includes(control)) throw new Error(`${control} is not set, so the control stays live`);
  }
  const locked = /\.account-page\[data-state='disabled'\] \.account-input,[\s\S]*?\{([^}]*)\}/.exec(css);
  if (!locked) throw new Error('account.css has no disabled state rule');
  if (!/opacity: 0\.4;/.test(locked[1])) throw new Error('the disabled page is not the style guide 40% opacity');
  if (!/pointer-events: none;/.test(locked[1])) throw new Error('the disabled page still takes the pointer');
  if (!css.includes("[data-state='loading'] .account-stat-value")) {
    throw new Error('the loading frame draws no count placeholder');
  }
  if (!css.includes("[data-state='empty'] .account-avatar-glyph")) {
    throw new Error('the empty frame draws no avatar placeholder');
  }

  // The danger card opens the confirmation dialog, and Cancel, the scrim and
  // Escape all close it again.
  for (const wiring of [
    "el.reset.addEventListener('click', () => setResetDialog(true))",
    "el.cancel.addEventListener('click', () => setResetDialog(false))",
    "event.key === 'Escape'",
    'event.target === el.scrim',
  ]) {
    if (!js.includes(wiring)) throw new Error(`the reset dialog wiring is missing: ${wiring}`);
  }

  // The radii are the tokens.json values this node binds.
  for (const binding of [
    '--zuri-account-card-radius: var(--zuri-radius-md)',
    '--zuri-account-dialog-radius: var(--zuri-radius-lg)',
    '--zuri-account-overlay-radius: var(--zuri-radius-lg)',
    '--zuri-account-row-radius: var(--zuri-radius-row)',
    '--zuri-account-pill-radius: var(--zuri-radius-pill)',
  ]) {
    if (!tokens.includes(binding)) throw new Error(`tokens.css does not bind ${binding}`);
  }

  // One place to edit when the node changes: the page block in tokens.css.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) {
    throw new Error('account.css holds a colour literal instead of a token');
  }
  const used = new Set([...css.matchAll(/var\((--zuri-account-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }

  return 'eight states, five drawn frames plus empty, loading and disabled, the reset dialog from the danger card, colours and radii only from the page token block';
});

check('the Connectors view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/connectors.js');
  const css = read('src/renderer/views/connectors.css');
  const html = read('src/renderer/views/connectors.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The node draws eight frames of the same page: connected, empty, loading,
  // connecting, a rejected key, a run in flight, a restart and the phone frame.
  // A name missing here is a frame a check can open and land on nothing.
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('connectors.js does not list the states a check can open');
  for (const state of ['default', 'empty', 'loading', 'connecting', 'error', 'disabled', 'restart', 'phone']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`connectors.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('connectors.js does not publish its states');

  // The page's parts: the two connector cards, the URL field, the empty card,
  // the skeleton card and the live line the state changes announce through.
  for (const part of [
    'id="connectors-list"',
    'id="composio-card"',
    'id="composio-disconnect"',
    'id="railway-card"',
    'id="railway-url"',
    'id="railway-error"',
    'id="connectors-empty"',
    'id="connectors-skeleton"',
    'id="connectors-live"',
    'role="status"',
  ]) {
    if (!html.includes(part)) throw new Error(`connectors.html has no ${part}`);
  }

  // The node's copy, so a rewrite of the page cannot quietly invent new words.
  for (const line of [
    'Tools Zuri can use. Keys are stored server-side and never shown again.',
    'Permission scope',
    'Read mail',
    'Write calendar',
    'Read contacts',
    'Key stored server-side',
    'No tools connected yet',
    'Connect a tool',
    'Keys are stored server-side',
    'Needs auth',
    'Test connection',
    "That key didn't work",
  ]) {
    if (!html.includes(line)) throw new Error(`connectors.html has lost the node's line: ${line}`);
  }

  // The frames differ in four visible places, so the check pins each one: the
  // status word, the keys note, the rejected-key block and the busy lock.
  if (!js.includes("elements.statusLabel.textContent = state === 'connecting' ? 'Connecting' : 'Connected';")) {
    throw new Error('the connecting frame never changes the status word');
  }
  if (!js.includes("elements.railwayStatus.hidden = !isList;")) {
    throw new Error('the hidden Railway card still announces a status');
  }
  if (!js.includes('elements.noteText.textContent = note;')) {
    throw new Error('the restart frame never re-reads the keys note');
  }
  if (!js.includes("elements.error.hidden = state !== 'error';")) {
    throw new Error('the error frame never shows the rejected-key block');
  }
  if (!js.includes('elements.disconnect.disabled =')) {
    throw new Error('Disconnect is never switched off, so it stays live while a run holds the keys');
  }
  if (!js.includes("elements.page.dataset.state = state;")) {
    throw new Error('the page never records which frame is open');
  }

  // Empty and loading replace the card list rather than adding to it.
  if (!js.includes('elements.list.hidden = !isList;')) throw new Error('the empty frame keeps the connector cards');
  if (!js.includes("elements.skeleton.hidden = state !== 'loading';")) {
    throw new Error('the loading frame draws no skeleton card');
  }

  // The phone frame is a width as well as a query string, and it is written once.
  if (!js.includes('PHONE_WIDTH') || !js.includes("classList.toggle('is-phone'")) {
    throw new Error('the phone frame does not follow the window width');
  }
  for (const rule of [
    '.connectors-page.is-phone .connectors-topbar',
    '.connectors-page.is-phone .connectors-settings-nav',
    '.connectors-page.is-phone .connectors-status',
    '.connectors-page.is-phone .connectors-actions',
  ]) {
    if (!css.includes(rule)) throw new Error(`connectors.css has no phone frame rule: ${rule}`);
  }

  // The radii are the tokens.json values this node binds.
  for (const binding of [
    '--zuri-connectors-card-radius: var(--zuri-radius-md)',
    '--zuri-connectors-row-radius: var(--zuri-radius-row)',
    '--zuri-connectors-pill-radius: var(--zuri-radius-pill)',
  ]) {
    if (!tokens.includes(binding)) throw new Error(`tokens.css does not bind ${binding}`);
  }

  // "The design only changes when the node changes" needs one place to edit: the
  // page block in tokens.css. A colour literal in the page's own stylesheet is a
  // second place, and the two drift.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) {
    throw new Error('connectors.css holds a colour literal instead of a token');
  }
  const used = new Set([...css.matchAll(/var\((--zuri-connectors-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }

  return 'eight states, the two connector cards, the empty and loading frames, the phone frame, colours and radii only from the page token block';
});

check('the Desktop capabilities view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/desktop.js');
  const css = read('src/renderer/views/desktop.css');
  const html = read('src/renderer/views/desktop.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The node draws five frames of the same panel: default, saving (the overlay
  // switch is out of reach while the change lands), empty (nothing is
  // allow-listed), error (the entry cannot be opened) and saved. Loading and
  // disabled are the two the screen check opens beyond those. A name missing
  // here is a frame a check can open and land on nothing.
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('desktop.js does not list the states a check can open');
  for (const state of ['default', 'saving', 'empty', 'error', 'saved', 'loading', 'disabled']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`desktop.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('desktop.js does not publish its states');

  // The page's parts: the four capability rows, the overlay switch, the two
  // allow-list editors, the empty and error notes, the save action and the toast.
  for (const part of [
    'id="desktop-capabilities"',
    'id="desktop-overlay-toggle"',
    'role="switch"',
    'aria-checked="true"',
    'id="desktop-overlay-state"',
    'id="desktop-url-input"',
    'id="desktop-url-add"',
    'id="desktop-url-list"',
    'id="desktop-app-input"',
    'id="desktop-app-add"',
    'id="desktop-app-list"',
    'id="desktop-allowlist-empty"',
    'id="desktop-entry-error"',
    'id="desktop-save"',
    'id="desktop-toast"',
    'id="desktop-live"',
    'role="status"',
  ]) {
    if (!html.includes(part)) throw new Error(`desktop.html has no ${part}`);
  }

  // The node's copy, so a rewrite of the page cannot quietly invent new words.
  for (const line of [
    'Desktop capabilities',
    'What Zuri can only do in the installed app.',
    'Quick overlay',
    'Notifications',
    'File tools',
    'App launch',
    'Takes effect next launch.',
    'Allow-list',
    'Act mode may only open these.',
    'Website addresses',
    'Applications',
    'Nothing is allow-listed. Act mode cannot open a link or start an app until you add one.',
    'Use a full address, like https://example.com. Usernames and passwords are not allowed.',
    'Allow-list saved.',
  ]) {
    if (!html.includes(line)) throw new Error(`desktop.html has lost the node's line: ${line}`);
  }

  // The frames differ in four visible places, so the check pins each one: the
  // empty warning, the refused entry, the saved toast and the busy switch.
  if (!js.includes('el.empty.hidden = !empty;')) throw new Error('the empty frame never shows the allow-list warning');
  if (!js.includes('el.error.hidden = !failed;')) throw new Error('the error frame never shows the refused entry');
  if (!js.includes("el.toast.hidden = next !== 'saved';")) throw new Error('the saved frame never shows the toast');
  if (!js.includes('el.overlay.disabled = saving || failed;')) {
    throw new Error('the overlay switch stays live while the change is saving');
  }
  if (!js.includes("el.overlay.setAttribute('aria-checked', overlayOn ? 'true' : 'false');")) {
    throw new Error('the switch never reports its position');
  }
  if (!js.includes("el.overlayNote.textContent = saving ? 'Saving the change.' : 'Takes effect next launch.';")) {
    throw new Error('the note does not come back after the saving frame');
  }
  if (!js.includes('el.page.dataset.state = next;')) {
    throw new Error('the page never records which frame is open');
  }

  // Empty draws both lists empty rather than adding to them, and the entry
  // checks are the same two rules src/main/tools/index.js applies.
  if (!js.includes('renderEntries(empty ? [] : entries.urls, empty ? [] : entries.apps);')) {
    throw new Error('the empty frame keeps the allow-list rows');
  }
  if (!js.includes('isUsableUrl(trimmed)') || !js.includes('APP_NAME.test(trimmed)')) {
    throw new Error('an entry is added without the URL or app-name check');
  }

  // Loading draws placeholder rows instead of the entries, so it reads as "not
  // read yet"; disabled keeps the drawn rows and puts every control out of reach.
  if (!js.includes('renderSkeleton(el.urlList, SKELETON_ROWS)')) {
    throw new Error('the loading frame draws the entries before they are read');
  }
  if (!js.includes("if (loading || locked) el.overlay.disabled = true;")) {
    throw new Error('the loading and disabled frames leave the switch live');
  }
  if (!js.includes('el.urlInput.disabled = busy || locked;')) {
    throw new Error('the disabled frame leaves the allow-list editors live');
  }
  if (!js.includes("button).disabled = locked")) {
    throw new Error('the disabled frame leaves the Remove buttons live');
  }

  // The radii are the tokens.json values this node binds.
  for (const binding of [
    '--zuri-desktop-card-radius: var(--zuri-radius-md)',
    '--zuri-desktop-row-radius: var(--zuri-radius-row)',
    '--zuri-desktop-pill-radius: var(--zuri-radius-pill)',
  ]) {
    if (!tokens.includes(binding)) throw new Error(`tokens.css does not bind ${binding}`);
  }

  // "The design only changes when the node changes" needs one place to edit: the
  // page block in tokens.css. A colour literal in the page's own stylesheet is a
  // second place, and the two drift.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) {
    throw new Error('desktop.css holds a colour literal instead of a token');
  }
  const used = new Set([...css.matchAll(/var\((--zuri-desktop-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }
  if (used.size < 40) throw new Error('desktop.css is not reading the page token block');

  return 'seven states, the four capability rows, the overlay switch, both allow-list editors, the empty and error notes and the toast, colours and radii only from the page token block';
});

check('the Audit log view offers every state a screen check opens', () => {
  const js = read('src/renderer/views/audit.js');
  const css = read('src/renderer/views/audit.css');
  const html = read('src/renderer/views/audit.html');
  const tokens = read('src/renderer/styles/tokens.css');

  // The node draws six frames of the same page: default, loading (the log is
  // still being read), empty (nothing recorded), filtered (no entry matches),
  // expanded (one entry's detail is open) and exporting. The screen check also
  // opens error and disabled, the two standard states this node has no frame
  // for. A name missing here is a frame a check can open and land on nothing.
  const states = js.match(/const STATES = \[([^\]]*)\]/);
  if (!states) throw new Error('audit.js does not list the states a check can open');
  for (const state of ['default', 'loading', 'empty', 'filtered', 'expanded', 'exporting', 'error', 'disabled']) {
    if (!states[1].includes(`'${state}'`)) throw new Error(`audit.js does not offer the ${state} state`);
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('audit.js does not publish its states');

  // The page's parts: three filters, one export, the table and its two
  // replacement frames, the row template and the live region.
  for (const part of [
    'id="audit-filter-tool"',
    'id="audit-filter-status"',
    'id="audit-filter-date"',
    'id="audit-export"',
    'id="audit-rows"',
    'id="audit-empty-body"',
    'id="audit-filtered-body"',
    'id="audit-error-body"',
    'id="audit-clear"',
    'id="audit-retry"',
    'id="audit-footnote"',
    'id="audit-row-template"',
    'class="audit-detail"',
    'id="audit-live"',
    'role="status"',
    'aria-current="page"',
    'href="audit.html"',
  ]) {
    if (!html.includes(part)) throw new Error(`audit.html has no ${part}`);
  }

  // Every frame has to be reachable from `?state=`, and every state name has to
  // differ from the next in a way a screenshot can see.
  if (!js.includes("el.page.dataset.state = next;")) {
    throw new Error('the page never records which frame is open');
  }
  if (!js.includes('renderSkeleton();')) throw new Error('the loading frame draws entries before they are read');
  if (!js.includes('el.emptyBody.hidden = false;')) throw new Error('the empty frame never shows the empty card');
  if (!js.includes('el.filteredBody.hidden = false;')) {
    throw new Error('the filtered frame never shows the no-match card');
  }
  if (!js.includes("setDetailOpen(drawn[0].entry, true);")) {
    throw new Error('the expanded frame opens no entry');
  }
  if (!js.includes("el.exportLabel.textContent = 'Exporting...';")) {
    throw new Error('the exporting frame leaves the export button unchanged');
  }
  if (!js.includes('el.export.disabled = next === ' + "'" + 'exporting' + "'" + ';')) {
    throw new Error('the exporting frame leaves the export button live');
  }

  // Error and disabled are drawn, not only declared: the error frame shows its
  // card and Try again, and disabled keeps the rows while every control is off.
  if (!js.includes('el.errorBody.hidden = false;')) {
    throw new Error('the error frame never shows the read-error card');
  }
  if (!js.includes('el.errorBody.hidden = true;')) {
    throw new Error('the error card stays up in the frames that can show rows');
  }
  if (!js.includes("el.retry.addEventListener('click', () => applyState('default'))")) {
    throw new Error('the Try again button never re-reads the log');
  }
  if (!js.includes('for (const { toggle } of drawn) toggle.disabled = true;')) {
    throw new Error('the disabled frame leaves the entry chevrons live');
  }
  if (!js.includes('el.footnote.textContent = FOOTNOTE;')) {
    throw new Error('the error and disabled frames keep the drawn closing note');
  }

  // The disabled frame follows the style guide: 40% opacity, no pointer.
  const locked = /\.audit-page\[data-state='disabled'\] \.audit-toolbar,[\s\S]*?\{([^}]*)\}/.exec(css);
  if (!locked) throw new Error('audit.css has no disabled state rule');
  if (!/opacity: 0\.4;/.test(locked[1])) throw new Error('the disabled page is not the style guide 40% opacity');
  if (!/pointer-events: none;/.test(locked[1])) throw new Error('the disabled page still takes the pointer');
  if (!css.includes("[data-state='error'] .audit-head")) {
    throw new Error('the error frame leaves the column labels over a card with no rows');
  }

  // Filtering is the one behaviour the page owns, so it is pinned: a row is
  // hidden by the tool, the status and the date filter, and the no-match frame
  // appears only when entries exist but none survive.
  if (!js.includes('if (!matches(el.tool.value, entry.tool)) return false;')) {
    throw new Error('the tool filter does not hide a non-matching entry');
  }
  if (!js.includes('if (!matches(el.status.value, entry.status)) return false;')) {
    throw new Error('the status filter does not hide a non-matching entry');
  }
  if (!js.includes('return Number.isFinite(days) ? entry.ageDays <= days : true;')) {
    throw new Error('the date filter does not compare the entry age');
  }
  if (!js.includes('el.filteredBody.hidden = shown > 0 || drawn.length === 0;')) {
    throw new Error('the no-match frame appears with nothing to match');
  }

  // Opening an entry is announced and wired to its panel, so the chevron and
  // the panel cannot disagree about which entry is open.
  if (!js.includes("pair.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');")) {
    throw new Error('an open entry never reports its state');
  }
  if (!js.includes('pair.detail.hidden = !open;')) throw new Error('an entry never opens its detail panel');

  // The CSV is written from the table, and its file name is built from local
  // date parts: toISOString() would date an evening export tomorrow.
  if (!js.includes("['Time', 'Tool', 'Target', 'Status', 'Details'].map(csvField).join(',')")) {
    throw new Error('the export has no header row');
  }
  if (!js.includes('return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;')) {
    throw new Error('the export dates the file from anything but local date parts');
  }

  // The radii are the tokens.json values this node binds.
  for (const binding of [
    '--zuri-audit-card-radius: var(--zuri-radius-md)',
    '--zuri-audit-row-radius: var(--zuri-radius-row)',
    '--zuri-audit-pill-radius: var(--zuri-radius-pill)',
  ]) {
    if (!tokens.includes(binding)) throw new Error(`tokens.css does not bind ${binding}`);
  }

  // One place to edit when the node changes: the page block in tokens.css.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) {
    throw new Error('audit.css holds a colour literal instead of a token');
  }
  const used = new Set([...css.matchAll(/var\((--zuri-audit-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const token of used) {
    if (!tokens.includes(`${token}:`)) throw new Error(`${token} is used by the page but never defined`);
  }
  if (used.size < 40) throw new Error('audit.css is not reading the page token block');

  return 'eight states, three filters, the entry table with its detail panel, the empty, no-match and read-error frames, the disabled page, the CSV export, colours and radii only from the page token block';
});

check('tokens.css defines every token family for both themes', () => {
  const css = read('src/renderer/styles/tokens.css');
  const themes = {
    dark: tokenNamesIn(css, ':root[data-theme="dark"]'),
    light: tokenNamesIn(css, ':root[data-theme="light"]'),
  };

  for (const [theme, names] of Object.entries(themes)) {
    if (names.length === 0) throw new Error(`${theme} theme declares no tokens`);
    for (const [family, pattern] of Object.entries(TOKEN_FAMILIES)) {
      if (!names.some((name) => pattern.test(name))) {
        throw new Error(`${theme} theme has no ${family} token`);
      }
    }
  }

  // A property that exists in one theme only leaves a component unstyled after a
  // theme swap, so the two blocks must declare exactly the same names.
  const missingInLight = themes.dark.filter((name) => !themes.light.includes(name));
  const missingInDark = themes.light.filter((name) => !themes.dark.includes(name));
  if (missingInLight.length > 0) throw new Error(`light theme is missing ${missingInLight.join(', ')}`);
  if (missingInDark.length > 0) throw new Error(`dark theme is missing ${missingInDark.join(', ')}`);

  return `${themes.dark.length} tokens in each theme`;
});

check('every token value carries a source comment', () => {
  const lines = read('src/renderer/styles/tokens.css').split('\n');
  const undocumented = [];
  lines.forEach((line, index) => {
    if (!/^\s*--zuri-[\w-]+\s*:/.test(line)) return;
    const commentAbove = (lines[index - 1] ?? '').trimEnd().endsWith('*/');
    if (!line.includes('/*') && !commentAbove) undocumented.push(line.trim().split(':')[0]);
  });
  if (undocumented.length > 0) throw new Error(`no source comment on ${undocumented.join(', ')}`);
  return 'colour, spacing, radius, shadow and type values all name their source';
});

check('no component library is installed', () => {
  const dependencies = Object.keys(pkg.dependencies ?? {});
  const libraries = dependencies.filter((name) => /(@heroui|tailwind|bootstrap|@mui|antd)/i.test(name));
  if (libraries.length > 0) throw new Error(`component library in dependencies: ${libraries.join(', ')}`);
});

check('the theme is dark until settings are read', () => {
  if (!/<html[^>]*data-theme="dark"/.test(read('src/renderer/index.html'))) {
    throw new Error('index.html does not set data-theme="dark" on <html>');
  }
  if (!/theme:\s*'dark'/.test(read('src/main/store.js'))) {
    throw new Error('store.js does not default settings.theme to dark');
  }
  // app.js must land on dark for a missing or unknown theme, not leave <html> bare.
  if (!/: (DARK_THEME);/.test(read('src/renderer/app.js'))) {
    throw new Error('app.js does not fall back to the dark theme');
  }
});

check('views/files.js lists workspace files with Open and Reveal through the bridge', () => {
  const source = read('src/renderer/views/files.js');
  for (const call of ['api.files.list(', 'api.files.open(', 'api.files.reveal(']) {
    if (!source.includes(call)) throw new Error(`files.js never calls ${call.slice(0, -1)}`);
  }
  if (!/Reveal in Explorer/.test(source)) throw new Error('the reveal action is not labelled');
  // The view lists through main; a direct read would bypass the workspace guard.
  if (/from 'node:fs|require\(/.test(source)) throw new Error('files.js reaches for the disk itself');

  const page = read('src/renderer/views/files.html');
  if (!/id="files-list"/.test(page)) throw new Error('files.html has no #files-list');
  if (!/type="module" src="files\.js"/.test(page)) throw new Error('files.html does not load files.js');

  const exposed = channelsIn(read('src/main/preload.js'), 'const CHANNELS = Object.freeze([');
  for (const channel of ['zuri:files:list', 'zuri:files:open', 'zuri:files:reveal']) {
    if (!exposed.includes(channel)) throw new Error(`the bridge does not expose ${channel}`);
  }
  return 'list, open, reveal';
});

/**
 * Quoted `zuri:` channel names inside the block between two markers.
 * @param {string} source
 * @param {string} startMarker
 * @returns {string[]}
 */
function channelsIn(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = source.indexOf(']);', start);
  if (end === -1) throw new Error(`block not closed after ${startMarker}`);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith('zuri:'));
}

const preloadSource = read('src/main/preload.js');
const mainSource = read('src/main/main.js');

check('preload.js declares the channel list and exposes window.zuri', () => {
  const exposed = channelsIn(preloadSource, 'const CHANNELS = Object.freeze([');
  if (exposed.length === 0) throw new Error('CHANNELS is empty');
  if (!/contextBridge\.exposeInMainWorld\('zuri',/.test(preloadSource)) {
    throw new Error('window.zuri is not exposed through contextBridge');
  }
  return exposed.join(', ');
});

check('preload.js rejects a channel outside its list', () => {
  if (!/CHANNELS\.includes\(channel\)/.test(preloadSource)) {
    throw new Error('invoke does not check the channel against CHANNELS');
  }
  if (!/Unknown IPC channel/.test(preloadSource)) {
    throw new Error('invoke does not throw for an unlisted channel');
  }
});

check('main registers a handler for exactly the declared channels', () => {
  const exposed = [...channelsIn(preloadSource, 'const CHANNELS = Object.freeze([')].sort();
  const handled = [...channelsIn(mainSource, 'const HANDLERS = new Map([')].sort();
  if (exposed.join('|') !== handled.join('|')) {
    throw new Error(`preload: ${exposed.join(', ')} / main: ${handled.join(', ')}`);
  }
  if (!/ipcMain\.handle\(/.test(mainSource)) throw new Error('main.js never calls ipcMain.handle');
  return `${handled.length} channels`;
});

check('the main window loads the preload script', () => {
  if (!/preload:\s*PRELOAD_ENTRY/.test(mainSource)) throw new Error('webPreferences.preload is not set');
  if (!/const PRELOAD_ENTRY = .*'preload\.js'/.test(mainSource)) {
    throw new Error('PRELOAD_ENTRY does not point at preload.js');
  }
});

// store.js is exercised against a throwaway directory under os.tmpdir(): the checks
// must never read or write the developer's real userData/zuri folder.
const tempRoots = [];

/**
 * Create a fresh temp directory, point the store at it, and remember it for cleanup.
 * @returns {Promise<string>} Absolute path of the new store root.
 */
async function freshStoreRoot() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zuri-store-'));
  tempRoots.push(directory);
  store.setStoreRoot(directory);
  return directory;
}

await checkAsync('store.js creates each file with its default shape on first read', async () => {
  const root = await freshStoreRoot();
  for (const key of store.STORE_KEYS) {
    const result = await store.readStore(key);
    if (!result.ok) throw new Error(`${key}: ${result.error.message}`);

    const expected = store.DEFAULT_DATA[key];
    if (JSON.stringify(result.data) !== JSON.stringify(expected)) {
      throw new Error(`${store.fileNameFor(key)} returned ${JSON.stringify(result.data)}`);
    }

    const filePath = path.join(root, store.fileNameFor(key));
    if (!fs.existsSync(filePath)) throw new Error(`${store.fileNameFor(key)} was not created`);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (JSON.stringify(onDisk) !== JSON.stringify(expected)) {
      throw new Error(`${store.fileNameFor(key)} on disk holds ${JSON.stringify(onDisk)}`);
    }
  }
  return store.STORE_KEYS.map((key) => store.fileNameFor(key)).join(', ');
});

await checkAsync('store.js write then read returns the same value', async () => {
  const root = await freshStoreRoot();
  const tasks = [{ id: 't1', title: 'Draft the brief', isDone: false, createdAt: '2026-10-18T00:00:00.000Z' }];
  const settings = { name: 'Amina', theme: 'light' };

  for (const [key, value] of [['tasks', tasks], ['settings', settings]]) {
    const written = await store.writeStore(key, value);
    if (!written.ok) throw new Error(`${key} write: ${written.error.message}`);

    const readBack = await store.readStore(key);
    if (!readBack.ok) throw new Error(`${key} read: ${readBack.error.message}`);
    if (JSON.stringify(readBack.data) !== JSON.stringify(value)) {
      throw new Error(`${key} read back ${JSON.stringify(readBack.data)}`);
    }

    const onDisk = JSON.parse(fs.readFileSync(path.join(root, store.fileNameFor(key)), 'utf8'));
    if (JSON.stringify(onDisk) !== JSON.stringify(value)) {
      throw new Error(`${key} on disk holds ${JSON.stringify(onDisk)}`);
    }
  }
  return 'tasks.json, settings.json';
});

await checkAsync('store.js reports corrupt JSON instead of overwriting it', async () => {
  const root = await freshStoreRoot();
  const broken = '{"id": "r1", broken';
  const remindersPath = path.join(root, 'reminders.json');
  fs.writeFileSync(remindersPath, broken);

  const result = await store.readStore('reminders');
  if (result.ok) throw new Error('a corrupt file was returned as data');
  if (result.error.code !== 'STORE_READ_FAILED') throw new Error(`code was ${result.error.code}`);
  if (fs.readFileSync(remindersPath, 'utf8') !== broken) {
    throw new Error('the corrupt file was rewritten');
  }

  // Wrong shape is the other way a file can be unusable: valid JSON, but not a list.
  fs.writeFileSync(path.join(root, 'tasks.json'), '{"tasks": []}');
  const wrongShape = await store.readStore('tasks');
  if (wrongShape.ok) throw new Error('an object was returned where tasks.json must hold an array');

  return result.error.code;
});

await checkAsync('store.js concurrent reads and writes leave valid JSON', async () => {
  const root = await freshStoreRoot();
  const operations = [];
  for (let index = 0; index < 20; index += 1) {
    operations.push(store.writeStore('chats', [{ id: `chat-${index}`, title: `Chat ${index}` }]));
    operations.push(store.readStore('chats'));
  }

  const results = await Promise.all(operations);
  for (const result of results) {
    if (!result.ok) throw new Error(result.error.message);
  }

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8'));
  if (!Array.isArray(onDisk)) throw new Error('chats.json is not an array after concurrent writes');

  const leftovers = fs.readdirSync(root).filter((name) => name.endsWith('.tmp'));
  if (leftovers.length > 0) throw new Error(`temp files left behind: ${leftovers.join(', ')}`);

  return `${results.length} operations, no partial file`;
});

await checkAsync('store.js creates a chat thread with the stored shape', async () => {
  const root = await freshStoreRoot();
  const created = await store.createThread();
  if (!created.ok) throw new Error(created.error.message);

  const thread = created.data;
  const keys = Object.keys(thread).sort().join(',');
  if (keys !== 'createdAt,id,messages,title,updatedAt') throw new Error(`thread keys are ${keys}`);
  if (typeof thread.id !== 'string' || thread.id.length < 8) throw new Error(`id is ${thread.id}`);
  if (thread.title !== store.UNTITLED_THREAD) throw new Error(`title is ${thread.title}`);
  if (!Array.isArray(thread.messages) || thread.messages.length !== 0) {
    throw new Error(`messages is ${JSON.stringify(thread.messages)}`);
  }
  if (Number.isNaN(Date.parse(thread.createdAt))) throw new Error(`createdAt is ${thread.createdAt}`);

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8'));
  if (onDisk.length !== 1 || onDisk[0].id !== thread.id) {
    throw new Error(`chats.json holds ${JSON.stringify(onDisk)}`);
  }

  return `${thread.title} (${thread.id})`;
});

await checkAsync('store.js appends a message, bumps updatedAt and names the thread', async () => {
  const root = await freshStoreRoot();
  const created = await store.createThread();
  if (!created.ok) throw new Error(created.error.message);
  const threadId = created.data.id;

  const empty = await store.appendMessage(threadId, { role: 'user', content: '   ' });
  if (empty.ok) throw new Error('blank content was stored');
  if (empty.error.code !== 'CHAT_INVALID_MESSAGE') throw new Error(`code was ${empty.error.code}`);

  const missing = await store.appendMessage('not-a-thread', { role: 'user', content: 'hello' });
  if (missing.ok) throw new Error('a message was appended to an unknown thread');
  if (missing.error.code !== 'CHAT_NOT_FOUND') throw new Error(`code was ${missing.error.code}`);

  const appended = await store.appendMessage(threadId, { role: 'user', content: '  Draft the launch note  ' });
  if (!appended.ok) throw new Error(appended.error.message);

  const message = appended.data.message;
  if (message.content !== 'Draft the launch note') throw new Error(`content is ${message.content}`);
  if (message.role !== 'user') throw new Error(`role is ${message.role}`);
  if (Number.isNaN(Date.parse(message.createdAt))) throw new Error(`createdAt is ${message.createdAt}`);

  const thread = appended.data.thread;
  if (thread.messages.length !== 1) throw new Error(`thread holds ${thread.messages.length} messages`);
  if (thread.updatedAt < thread.createdAt) throw new Error('updatedAt went backwards');
  if (thread.title !== 'Draft the launch note') throw new Error(`title is ${thread.title}`);

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8'));
  if (onDisk[0].messages.length !== 1 || onDisk[0].messages[0].id !== message.id) {
    throw new Error(`chats.json holds ${JSON.stringify(onDisk[0].messages)}`);
  }

  return `${message.role}: ${message.content}`;
});

await checkAsync('store.js lists threads newest first by updatedAt', async () => {
  await freshStoreRoot();
  // Real time between creations: identical timestamps would make the order
  // ambiguous, and this check is about the order.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

  const first = await store.createThread();
  await pause();
  const second = await store.createThread();
  await pause();
  const third = await store.createThread();
  if (!first.ok || !second.ok || !third.ok) throw new Error('a thread was not created');

  // Touch the oldest one, so ordering has to come from updatedAt and not from the
  // order the threads were appended to the file.
  await pause();
  const touched = await store.appendMessage(first.data.id, { role: 'user', content: 'Latest activity' });
  if (!touched.ok) throw new Error(touched.error.message);

  const listed = await store.listThreads();
  if (!listed.ok) throw new Error(listed.error.message);
  const order = listed.data.map((thread) => thread.id).join(',');
  if (order !== [first.data.id, third.data.id, second.data.id].join(',')) {
    throw new Error(`order was ${order}`);
  }

  return `${listed.data.length} threads, most recent first`;
});

check('store.js writes through a temp file and renames it into place', () => {
  const source = read('src/main/store.js');
  if (!/\.tmp/.test(source)) throw new Error('no .tmp path in store.js');
  if (!/fs\.rename\(/.test(source)) throw new Error('store.js never renames the temp file');
  if (!/fs\.mkdir\(/.test(source)) throw new Error('store.js never creates the store directory');
  if (!/app\.getPath\('userData'\)/.test(source)) {
    throw new Error('store.js does not resolve its root from app.getPath(\'userData\')');
  }
});

/* ---------------------------------------------------------------------------
   Act tools

   The registry, its guards and the workspace boundary. Nothing here fetches, opens
   a link or launches an app: every side effect is an injected fake, and the
   workspace is a throwaway directory under os.tmpdir().
   ------------------------------------------------------------------------- */

check('tools/index.js registers the seven Act tools with a handler', () => {
  const expected = ['webSearch', 'webFetch', 'readFile', 'writeFile', 'summarizeDocument', 'openUrl', 'openApp'];
  const names = tools.TOOLS.map((tool) => tool.name);
  if (names.join(',') !== expected.join(',')) throw new Error(`registered ${names.join(', ')}`);

  for (const tool of tools.TOOLS) {
    if (typeof tool.description !== 'string' || tool.description.length < 20) {
      throw new Error(`${tool.name} has no usable description`);
    }
    if (typeof tool.requiresConfirmation !== 'boolean') {
      throw new Error(`${tool.name} does not declare requiresConfirmation`);
    }
    if (typeof tool.handler !== 'function') throw new Error(`${tool.name} has no handler`);
  }

  // The three tools that touch something outside Zuri must never run unasked.
  const ungated = ['writeFile', 'openUrl', 'openApp'].filter(
    (name) => tools.getTool(name)?.requiresConfirmation !== true,
  );
  if (ungated.length > 0) throw new Error(`${ungated.join(', ')} would run without confirmation`);

  return names.join(', ');
});

await checkAsync('tools/index.js rejects an unknown tool name', async () => {
  const result = await tools.runTool('deleteEverything', { path: 'notes.md' }, { confirmed: true });
  if (result.ok) throw new Error('an unknown tool name ran');
  if (result.error.code !== 'TOOL_UNKNOWN') throw new Error(`code was ${result.error.code}`);
  if (tools.getTool('deleteEverything') !== null) throw new Error('getTool() returned a descriptor for an unknown name');
  return result.error.code;
});

await checkAsync('tools/index.js refuses an app outside the openApp allow-list', async () => {
  await freshStoreRoot();
  // The allow-list is read from settings.json, not from the call, so this check
  // drives the same path the app does.
  await store.writeStore('settings', {
    name: '',
    theme: 'dark',
    allowedApps: ['notepad'],
    allowedUrls: ['https://example.com/docs'],
  });

  const launched = [];
  const opened = [];
  const dependencies = {
    launchApp: async (name) => {
      launched.push(name);
    },
    openExternal: async (url) => {
      opened.push(url);
    },
  };

  const deniedApp = await tools.runTool('openApp', { app: 'powershell' }, { confirmed: true, dependencies });
  if (deniedApp.ok) throw new Error('a non-allow-listed app was launched');
  if (deniedApp.error.code !== 'TOOL_APP_NOT_ALLOWED') throw new Error(`app code was ${deniedApp.error.code}`);

  const deniedUrl = await tools.runTool(
    'openUrl',
    { url: 'https://malicious.example/login' },
    { confirmed: true, dependencies },
  );
  if (deniedUrl.ok) throw new Error('a non-allow-listed URL was opened');
  if (deniedUrl.error.code !== 'TOOL_URL_NOT_ALLOWED') throw new Error(`url code was ${deniedUrl.error.code}`);

  // A scheme outside http(s) is refused even if the host were allow-listed.
  const fileUrl = await tools.runTool(
    'openUrl',
    { url: 'file:///C:/Windows/System32/calc.exe' },
    { confirmed: true, dependencies },
  );
  if (fileUrl.ok) throw new Error('a file:// URL was opened');
  if (fileUrl.error.code !== 'TOOL_URL_NOT_ALLOWED') throw new Error(`file url code was ${fileUrl.error.code}`);

  if (launched.length !== 0 || opened.length !== 0) throw new Error('a refused call still reached the desktop');

  // The allow-listed side still works, matched case-insensitively and below the
  // allow-listed path.
  const allowedApp = await tools.runTool('openApp', { app: 'NOTEPAD.EXE' }, { confirmed: true, dependencies });
  if (!allowedApp.ok) throw new Error(`allow-listed app: ${allowedApp.error.message}`);

  const allowedUrl = await tools.runTool(
    'openUrl',
    { url: 'https://example.com/docs/report' },
    { confirmed: true, dependencies },
  );
  if (!allowedUrl.ok) throw new Error(`allow-listed url: ${allowedUrl.error.message}`);

  if (launched.join(',') !== 'notepad') throw new Error(`launched ${launched.join(', ')}`);
  if (opened.join(',') !== 'https://example.com/docs/report') throw new Error(`opened ${opened.join(', ')}`);

  return `${deniedApp.error.code}, ${deniedUrl.error.code}, allow-list honoured`;
});

await checkAsync('tools/index.js holds the confirmation gate in the main process', async () => {
  await freshStoreRoot();
  await store.writeStore('settings', { name: '', theme: 'dark', allowedApps: ['notepad'], allowedUrls: [] });

  const launched = [];
  const result = await tools.runTool(
    'openApp',
    { app: 'notepad' },
    { dependencies: { launchApp: async (name) => launched.push(name) } },
  );
  if (result.ok) throw new Error('openApp ran without confirmation');
  if (result.error.code !== 'TOOL_CONFIRMATION_REQUIRED') throw new Error(`code was ${result.error.code}`);
  if (launched.length !== 0) throw new Error('the app was launched before confirmation');
  return result.error.code;
});

await checkAsync('tools/index.js keeps writeFile inside the workspace', async () => {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zuri-workspace-'));
  tempRoots.push(workspace);
  tools.setWorkspaceRoot(workspace);

  const saved = await tools.runTool(
    'writeFile',
    { path: 'notes/summary.md', content: '# Summary\n' },
    { confirmed: true },
  );
  if (!saved.ok) throw new Error(saved.error.message);
  if (fs.readFileSync(path.join(workspace, 'notes', 'summary.md'), 'utf8') !== '# Summary\n') {
    throw new Error('the workspace file does not hold the content');
  }

  // Unique per run, so a leftover from a crashed run cannot make this check pass or
  // fail for the wrong reason.
  const escapePath = path.join(os.tmpdir(), `zuri-selftest-escape-${process.pid}.txt`);
  const traversal = await tools.runTool(
    'writeFile',
    { path: `../${path.basename(escapePath)}`, content: 'nope' },
    { confirmed: true },
  );
  if (traversal.ok) throw new Error('a traversal path was written');
  if (traversal.error.code !== 'TOOL_PATH_OUTSIDE_WORKSPACE') throw new Error(`traversal code was ${traversal.error.code}`);
  if (fs.existsSync(escapePath)) {
    fs.rmSync(escapePath, { force: true });
    throw new Error('escape.txt landed outside the workspace');
  }

  const outside = await tools.runTool('writeFile', { path: escapePath, content: 'nope' }, { confirmed: true });
  if (outside.ok) throw new Error('an absolute path outside the workspace was written');
  if (outside.error.code !== 'TOOL_PATH_OUTSIDE_WORKSPACE') throw new Error(`absolute code was ${outside.error.code}`);
  if (fs.existsSync(escapePath)) {
    fs.rmSync(escapePath, { force: true });
    throw new Error('the absolute path was written');
  }

  return 'notes/summary.md saved, two escapes refused';
});

await checkAsync('tools/index.js creates the workspace folder and lists what is in it', async () => {
  // The parent exists but `workspace` does not, which is the first-run state.
  const parent = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zuri-listing-'));
  tempRoots.push(parent);
  const workspace = path.join(parent, 'workspace');
  tools.setWorkspaceRoot(workspace);

  await tools.ensureWorkspace();
  if (!fs.existsSync(workspace)) throw new Error('ensureWorkspace did not create the folder');

  const nested = await tools.runTool(
    'writeFile',
    { path: 'reports/today.md', content: '# Today\n' },
    { confirmed: true },
  );
  if (!nested.ok) throw new Error(nested.error.message);
  const flat = await tools.runTool('writeFile', { path: 'notes.txt', content: 'hi' }, { confirmed: true });
  if (!flat.ok) throw new Error(flat.error.message);

  // Pin one mtime into the past so "newest first" is decided by data, not timing.
  const old = new Date(2020, 0, 1);
  fs.utimesSync(path.join(workspace, 'notes.txt'), old, old);

  const listing = await tools.listWorkspaceFiles();
  const paths = listing.files.map((file) => file.path).sort();
  if (paths.join(',') !== 'notes.txt,reports/today.md') {
    throw new Error(`listing returned ${paths.join(', ') || 'nothing'}`);
  }
  if (listing.truncated) throw new Error('a two-file workspace was reported truncated');
  if (listing.files.some((file) => file.path.includes('\\') || path.isAbsolute(file.path))) {
    throw new Error('paths are not workspace-relative with forward slashes');
  }
  if (listing.files[0].path !== 'reports/today.md') throw new Error('the list is not newest first');
  if (listing.files.find((file) => file.path === 'notes.txt').bytes !== Buffer.byteLength('hi')) {
    throw new Error('bytes does not match the file');
  }

  // Open and reveal resolve through the same guard as writeFile.
  const refusals = [];
  for (const requested of ['../outside.txt', path.join(parent, 'outside.txt')]) {
    try {
      await tools.resolveWorkspaceFile(requested);
      refusals.push(`${requested} was resolved`);
    } catch (error) {
      if (error.code !== 'TOOL_PATH_OUTSIDE_WORKSPACE') refusals.push(`${requested} gave ${error.code}`);
    }
  }
  if (refusals.length > 0) throw new Error(refusals.join('; '));

  try {
    await tools.resolveWorkspaceFile('gone.txt');
    refusals.push('a missing file was resolved');
  } catch (error) {
    if (error.code !== 'TOOL_FILE_MISSING') refusals.push(`a missing file gave ${error.code}`);
  }

  return 'folder created, 2 files listed newest first, escapes refused';
});

/* ---------------------------------------------------------------------------
   Scheduler tick selection

   The 30-second tick belongs to the scheduler card; what is checked here is the
   choice it makes, driven by a fixed clock so no check waits on real time.
   ------------------------------------------------------------------------- */

/** @param {string} id @param {unknown} nextRunAt @param {object} [extra] */
const scheduleOf = (id, nextRunAt, extra = {}) => ({ id, prompt: `Run ${id}`, nextRunAt, ...extra });

check('scheduler.js selects the automations whose nextRunAt has passed', () => {
  const now = Date.parse('2025-03-04T12:00:00.000Z');
  const schedules = [
    scheduleOf('late', '2025-03-04T11:55:00.000Z'),
    scheduleOf('future', '2025-03-04T12:05:00.000Z'),
    scheduleOf('dueNow', '2025-03-04T12:00:00.000Z'),
  ];

  const due = scheduler.dueSchedules(schedules, now).map((entry) => entry.id);
  if (due.join(',') !== 'late,dueNow') throw new Error(`selected ${due.join(', ') || 'nothing'}`);
  // The boundary counts as due, so a tick that lands exactly on nextRunAt fires it.
  if (!scheduler.hasDueSchedule(schedules, now)) throw new Error('hasDueSchedule said nothing is due');
  if (scheduler.hasDueSchedule(schedules, Date.parse('2025-03-04T11:54:00.000Z'))) {
    throw new Error('hasDueSchedule saw work due a minute early');
  }
  return 'late and dueNow fire, future waits';
});

check('a run missed while Zuri was closed is replayed once, not once per interval', () => {
  // Nine hourly runs were missed overnight. The sweep must fire the automation once
  // and let the run advance nextRunAt, or reopening Zuri would flood the run log.
  const now = Date.parse('2025-03-04T12:00:00.000Z');
  const missed = scheduleOf('hourly', '2025-03-04T03:00:00.000Z', { cadence: 'interval:60' });
  const due = scheduler.dueSchedules([missed], now);

  if (due.length !== 1) throw new Error(`${due.length} replays for one missed automation`);
  // The stored object comes back, so the caller's advance of nextRunAt is kept.
  if (due[0] !== missed) throw new Error('the selector returned a copy');
  return '9 missed intervals, one replay';
});

check('scheduler.js skips a paused automation and one with no readable next run', () => {
  const now = Date.parse('2025-03-04T12:00:00.000Z');
  const due = scheduler
    .dueSchedules(
      [
        scheduleOf('paused', '2025-03-04T11:00:00.000Z', { enabled: false }),
        scheduleOf('draft', undefined),
        scheduleOf('garbage', 'next tuesday-ish'),
        scheduleOf('live', '2025-03-04T11:30:00.000Z'),
      ],
      now,
    )
    .map((entry) => entry.id);

  if (due.join(',') !== 'live') throw new Error(`selected ${due.join(', ') || 'nothing'}`);
  return 'live only';
});

check('scheduler.js refuses a schedule list or clock it cannot read', () => {
  const problems = [];
  const attempts = [
    ['a missing list', () => scheduler.dueSchedules(undefined, Date.now())],
    ['an unreadable clock', () => scheduler.dueSchedules([], Number.NaN)],
  ];
  for (const [label, run] of attempts) {
    try {
      run();
      problems.push(`${label} was accepted`);
    } catch (error) {
      if (!(error instanceof TypeError)) problems.push(`${label} gave ${error.name}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
  return 'TypeError for both';
});

/* ---------------------------------------------------------------------------
   Provider secrets

   secrets.json sits beside the store files, so every check below runs against a
   throwaway root: the developer's real userData never sees the test key.
   ------------------------------------------------------------------------- */

/**
 * Every text file under a directory, so a scan covers views, modules and markup.
 * @param {string} directory
 * @returns {string[]}
 */
function textFilesUnder(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...textFilesUnder(full));
    else if (/\.(js|html|css|json|md)$/.test(entry.name)) found.push(full);
  }
  return found;
}

check('.gitignore lists secrets.json', () => {
  if (!exists('.gitignore')) throw new Error('there is no .gitignore');
  const listed = read('.gitignore')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (!listed.includes('secrets.json')) throw new Error('.gitignore does not list secrets.json');
  return listed.join(', ');
});

check('secrets.js exposes hasKey() and getKey() to main modules only', () => {
  for (const name of ['hasKey', 'getKey']) {
    if (typeof secrets[name] !== 'function') throw new Error(`secrets.js does not export ${name}()`);
  }
  if (/getKey\(/.test(preloadSource)) throw new Error('preload.js calls getKey');

  // A renderer may name the file it cannot read; it may not call the reader.
  const leaks = textFilesUnder(path.join(root, 'src', 'renderer')).filter((file) =>
    /getKey\(/.test(fs.readFileSync(file, 'utf8')),
  );
  if (leaks.length > 0) {
    throw new Error(`renderer code reaches for a key: ${leaks.map((file) => path.relative(root, file)).join(', ')}`);
  }

  const exposed = channelsIn(preloadSource, 'const CHANNELS = Object.freeze([');
  if (!exposed.includes('zuri:settings:setKey')) throw new Error('the bridge does not expose zuri:settings:setKey');
  return `${exposed.length} channels, no key reader in the bridge`;
});

await checkAsync('secrets.js writes the key to userData/zuri/secrets.json', async () => {
  const directory = await freshStoreRoot();
  const key = 'sk-selftest-7d1f4c9a2e6b8d3f';

  const saved = await secrets.setKey('openai', key);
  if (!saved.ok) throw new Error(saved.error.message);
  if (saved.data.hasKey !== true) throw new Error('setKey did not report the stored key');
  if (JSON.stringify(saved).includes(key)) throw new Error('setKey returned the key itself');

  const file = path.join(directory, 'secrets.json');
  if (!fs.existsSync(file)) throw new Error(`no secrets.json at ${file}`);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (stored?.keys?.openai !== key) throw new Error('secrets.json does not hold the key');

  if (!secrets.hasKey('openai')) throw new Error('hasKey() is false after saving');
  if (secrets.getKey('openai') !== key) throw new Error('getKey() does not return the saved key');
  if (secrets.hasKey('anthropic')) throw new Error('hasKey() leaked across providers');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode !== 0o600) throw new Error(`secrets.json mode is 0${mode.toString(8)}, expected 0600`);
  }

  return `${path.relative(directory, file)} holds the key, permissions owner-only`;
});

await checkAsync('no key yet means hasKey() false and no file written', async () => {
  const directory = await freshStoreRoot();

  if (secrets.hasKey('openai')) throw new Error('hasKey() is true on an empty root');
  if (secrets.getKey('openai') !== null) throw new Error('getKey() returned a value on an empty root');
  const status = secrets.keyStatus('openai');
  if (!status.ok || status.data.hasKey !== false) throw new Error('keyStatus did not report no key');

  const file = path.join(directory, 'secrets.json');
  if (fs.existsSync(file)) throw new Error('reading the status created a secrets file');
  return 'no file, hasKey() false';
});

await checkAsync('setKey rejects a missing or unusable key', async () => {
  const directory = await freshStoreRoot();

  const cases = [
    ['', 'SECRETS_INVALID_KEY'],
    ['short', 'SECRETS_INVALID_KEY'],
    ['sk-two words here', 'SECRETS_INVALID_KEY'],
    [undefined, 'SECRETS_INVALID_KEY'],
  ];
  for (const [value, expected] of cases) {
    const result = await secrets.setKey('openai', value);
    if (result.ok) throw new Error(`setKey accepted ${JSON.stringify(value)}`);
    if (result.error.code !== expected) throw new Error(`${JSON.stringify(value)} gave ${result.error.code}`);
  }

  const unknown = await secrets.setKey('nope', 'sk-selftest-7d1f4c9a2e6b8d3f');
  if (unknown.ok || unknown.error.code !== 'SECRETS_UNKNOWN_PROVIDER') {
    throw new Error(`an unknown provider gave ${unknown.ok ? 'ok' : unknown.error.code}`);
  }

  if (fs.existsSync(path.join(directory, 'secrets.json'))) throw new Error('a rejected key still wrote a file');
  return `${cases.length} bad keys rejected, no file written`;
});

await checkAsync('store.js cannot read the secrets file by key', async () => {
  const directory = await freshStoreRoot();
  const key = 'sk-selftest-9a8b7c6d5e4f3a2b';
  const saved = await secrets.setKey('anthropic', key);
  if (!saved.ok) throw new Error(saved.error.message);

  const read = await store.readStore('secrets');
  if (read.ok) throw new Error('readStore("secrets") handed back the key file');
  if (read.error.code !== 'STORE_UNKNOWN_KEY') throw new Error(`readStore gave ${read.error.code}`);
  if (JSON.stringify(read).includes(key)) throw new Error('the store error carried the key');
  return 'store keys do not include secrets';
});

await checkAsync('no chat log or store file contains the key', async () => {
  const directory = await freshStoreRoot();
  const key = 'sk-selftest-2b3c4d5e6f7a8b9c';
  const saved = await secrets.setKey('openai', key);
  if (!saved.ok) throw new Error(saved.error.message);

  const thread = await store.createThread();
  if (!thread.ok) throw new Error(thread.error.message);
  const appended = await store.appendMessage(thread.data.id, {
    role: 'user',
    content: 'Summarise the file I attached.',
  });
  if (!appended.ok) throw new Error(appended.error.message);

  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  const leaks = files.filter(
    (name) => name !== 'secrets.json' && fs.readFileSync(path.join(directory, name), 'utf8').includes(key),
  );
  if (leaks.length > 0) throw new Error(`the key appears in ${leaks.join(', ')}`);
  if (!files.includes('chats.json')) throw new Error('the chat was not written, so the scan proves nothing');
  return `${files.length} files scanned, only secrets.json holds the key`;
});

await checkAsync('clearKey forgets one provider and deletes the file with the last key', async () => {
  const directory = await freshStoreRoot();
  const file = path.join(directory, 'secrets.json');

  const first = await secrets.setKey('openai', 'sk-selftest-aaaa1111bbbb2222');
  if (!first.ok) throw new Error(first.error.message);
  const second = await secrets.setKey('anthropic', 'sk-ant-selftest-cccc3333');
  if (!second.ok) throw new Error(second.error.message);

  const removedOne = await secrets.clearKey('openai');
  if (!removedOne.ok) throw new Error(removedOne.error.message);
  if (removedOne.data.hasKey !== false) throw new Error('clearKey did not report the removal');
  if (secrets.hasKey('openai')) throw new Error('the cleared key is still there');
  if (!secrets.hasKey('anthropic')) throw new Error('clearing one provider dropped the other');
  if (!fs.existsSync(file)) throw new Error('the file was deleted while a key remained');
  if (JSON.stringify(removedOne).includes('sk-selftest-aaaa1111bbbb2222')) {
    throw new Error('clearKey returned the key it deleted');
  }

  const removedLast = await secrets.clearKey('anthropic');
  if (!removedLast.ok) throw new Error(removedLast.error.message);
  if (fs.existsSync(file)) throw new Error('secrets.json still exists with no keys left');
  if (secrets.getKey('anthropic') !== null) throw new Error('getKey() still returns the removed key');

  return 'one provider kept, last key deletes the file';
});

await checkAsync('a corrupt secrets file is reported, not overwritten', async () => {
  const directory = await freshStoreRoot();
  const file = path.join(directory, 'secrets.json');
  const corrupt = '{"keys": {"openai": "sk-half-written';
  fs.writeFileSync(file, corrupt, 'utf8');

  const replaced = await secrets.setKey('anthropic', 'sk-ant-selftest-eeee4444');
  if (replaced.ok) throw new Error('setKey wrote over a corrupt secrets file');
  if (replaced.error.code !== 'SECRETS_READ_FAILED') throw new Error(`setKey gave ${replaced.error.code}`);

  if (secrets.getKey('openai') !== null) throw new Error('getKey() read a key out of a corrupt file');
  if (fs.readFileSync(file, 'utf8') !== corrupt) throw new Error('the corrupt file was modified');
  return 'the write stops and the file is left alone';
});

// --- Ask mode: the provider adapter -----------------------------------------
// Driven with a fake fetch so these checks prove the stream, the saved reply and
// the failure wording without touching the network or needing a real key.

/** Frames arrive as one Response with an SSE body, the way a provider streams. */
function streamResponse(frames) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

await checkAsync('providers/chat.js refuses to send with no key and saves nothing', async () => {
  await freshStoreRoot();
  const thread = await store.createThread({ title: 'Keyless' });
  if (!thread.ok) throw new Error(thread.error.message);
  const appended = await store.appendMessage(thread.data.id, { role: 'user', content: 'Are you there?' });
  if (!appended.ok) throw new Error(appended.error.message);

  const events = [];
  const result = await chat.sendChatMessage(thread.data.id, { emit: (event) => events.push(event) });

  if (result.ok) throw new Error('a send with no key succeeded');
  if (result.error.code !== 'CHAT_NO_KEY') throw new Error(`expected CHAT_NO_KEY, got ${result.error.code}`);
  if (!result.error.message.includes('Settings')) throw new Error('the message does not say where to fix it');
  if (events.length > 0) throw new Error('tokens were emitted with no key saved');

  const threads = await store.listThreads();
  const stored = threads.data.find((entry) => entry.id === thread.data.id);
  if (stored.messages.length !== 1) throw new Error('a reply was saved without a key');
  return result.error.message;
});

await checkAsync('providers/chat.js streams tokens and saves the reply', async () => {
  await freshStoreRoot();
  const saved = await secrets.setKey('openai', 'sk-selftest-chat000111');
  if (!saved.ok) throw new Error(saved.error.message);

  const thread = await store.createThread({ title: 'Colours' });
  if (!thread.ok) throw new Error(thread.error.message);
  const appended = await store.appendMessage(thread.data.id, {
    role: 'user',
    content: 'Name the three primary colours.',
  });
  if (!appended.ok) throw new Error(appended.error.message);

  let request = null;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"Red"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", green"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  };

  const events = [];
  const result = await chat.sendChatMessage(thread.data.id, {
    emit: (event) => events.push(event),
    fetchImpl,
  });

  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  if (result.data.message.content !== 'Red, green') {
    throw new Error(`saved "${result.data.message.content}"`);
  }
  if (result.data.message.role !== 'assistant') throw new Error('the saved message is not an assistant turn');
  if (result.data.provider !== 'openai') throw new Error(`answered as ${result.data.provider}`);

  const streamed = events.filter((event) => typeof event.delta === 'string').map((event) => event.delta).join('');
  if (streamed !== 'Red, green') throw new Error(`streamed "${streamed}"`);
  if (!events.some((event) => event.done === true)) throw new Error('no end-of-stream event');
  if (!events.every((event) => event.threadId === thread.data.id)) throw new Error('an event lost its thread id');

  const body = JSON.parse(request.init.body);
  if (body.stream !== true) throw new Error('the request did not ask for a stream');
  if (!body.messages.some((message) => message.content === 'Name the three primary colours.')) {
    throw new Error('the thread messages were not sent');
  }
  if (request.init.headers.authorization !== 'Bearer sk-selftest-chat000111') {
    throw new Error('the key was not sent as a bearer token');
  }

  const threads = await store.listThreads();
  const onDisk = threads.data.find((entry) => entry.id === thread.data.id);
  if (onDisk.messages.length !== 2) throw new Error('the reply is not in chats.json');
  if (onDisk.messages[1].content !== 'Red, green') throw new Error('chats.json holds different text');

  return `${events.length} events, reply saved to ${store.fileNameFor('chats')}`;
});

// A provider the app accepts but never offers is a key that can be stored and never
// chosen, so every picker is checked against the accepted list rather than a copy of it.
// All three surfaces are swept, because each is written somewhere different - two HTML
// pages and the shell's own builder - and they drifted one at a time: the standalone
// Settings page shipped OpenAI and Anthropic only while the shell listed all five.
check('every provider picker offers a key field for every provider the app accepts', () => {
  const surfaces = [];

  // 1. Markup pickers: any <select> whose id names it a provider picker.
  const viewsDir = path.join(root, 'src', 'renderer', 'views');
  const pages = fs
    .readdirSync(viewsDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => ({ name, html: read(`src/renderer/views/${name}`) }));
  for (const page of pages) {
    const pickers = page.html.matchAll(/<select\b[^>]*\bid="([^"]*provider[^"]*)"[^>]*>([\s\S]*?)<\/select>/gu);
    for (const picker of pickers) {
      const values = Array.from(picker[2].matchAll(/value="([^"]*)"/gu), (option) => option[1]);
      surfaces.push({ where: `${page.name} #${picker[1]}`, values });
    }
  }

  // 2. The shell's Providers panel builds its options in views/settings.js.
  const shellView = read('src/renderer/views/settings.js');
  surfaces.push({
    where: 'views/settings.js',
    values: Array.from(shellView.matchAll(/\['([a-z0-9]+)', '[^']*'\]/gu), (pair) => pair[1]),
  });

  // 3. The standalone Providers page maps each provider id to a default model.
  const providersView = read('src/renderer/views/providers-page.js');
  surfaces.push({
    where: 'views/providers-page.js',
    values: Array.from(
      providersView.matchAll(/^\s{2}([a-z0-9]+): \{ name: '[^']*', model: '[^']*' \},$/gmu),
      (entry) => entry[1],
    ),
  });

  // Two pages carry a picker and the shell builds one, so a sweep that found fewer has
  // stopped matching the markup and would otherwise pass while checking nothing.
  if (surfaces.length < 3) {
    throw new Error(`only ${surfaces.length} provider picker(s) found; the sweep missed one`);
  }

  const short = [];
  for (const surface of surfaces) {
    const missing = secrets.PROVIDERS.filter((name) => !surface.values.includes(name));
    if (missing.length > 0) short.push(`${surface.where} is missing ${missing.join(', ')}`);
  }
  if (short.length > 0) throw new Error(short.join('; '));

  return `${surfaces.length} pickers: ${surfaces.map((surface) => surface.where).join(', ')}`;
});
// Each of these providers is one table entry: the request goes to the vendor's own
// endpoint with a bearer key and an OpenAI-shaped stream body. Checked per provider,
// because a wrong endpoint or model name is only visible one vendor at a time.
const HOSTED_PROVIDERS = Object.freeze([
  { provider: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  { provider: 'moonshot', endpoint: 'https://api.moonshot.ai/v1/chat/completions', model: 'kimi-k3' },
  { provider: 'zai', endpoint: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-5.3' },
]);

for (const hosted of HOSTED_PROVIDERS) {
  await checkAsync(`providers/chat.js sends a ${hosted.provider} key to that vendor`, async () => {
    await freshStoreRoot();
    const key = `sk-selftest-${hosted.provider}000111`;
    const savedKey = await secrets.setKey(hosted.provider, key);
    if (!savedKey.ok) throw new Error(savedKey.error.message);
    const settings = await store.saveSettings({ provider: hosted.provider });
    if (!settings.ok) throw new Error(settings.error.message);

    // No model is saved, so the vendor's own default has to be chosen for us.
    const target = chat.resolveChatTarget(settings.data);
    if (target.provider !== hosted.provider) throw new Error(`resolved as ${target.provider}`);
    if (target.model !== hosted.model) throw new Error(`defaulted to ${target.model}`);

    // The store's defaults carry gpt-4o. Switching the provider must not carry that
    // name along, or the next send asks this vendor for an OpenAI model.
    const carried = chat.resolveChatTarget({ provider: hosted.provider, model: 'gpt-4o' });
    if (carried.model !== hosted.model) throw new Error(`gpt-4o was carried as ${carried.model}`);
    const kept = chat.resolveChatTarget({ provider: hosted.provider, model: hosted.model });
    if (kept.model !== hosted.model) throw new Error(`its own model was dropped: ${kept.model}`);

    const thread = await store.createThread({ title: hosted.provider });
    if (!thread.ok) throw new Error(thread.error.message);
    const appended = await store.appendMessage(thread.data.id, { role: 'user', content: 'Say hi.' });
    if (!appended.ok) throw new Error(appended.error.message);

    let request = null;
    const fetchImpl = async (url, init) => {
      request = { url, init };
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    };

    const result = await chat.sendChatMessage(thread.data.id, { emit: () => {}, fetchImpl });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    if (result.data.provider !== hosted.provider) throw new Error(`answered as ${result.data.provider}`);
    if (result.data.message.content !== 'Hi') throw new Error(`saved "${result.data.message.content}"`);

    if (request.url !== hosted.endpoint) throw new Error(`requested ${request.url}`);
    if (request.init.headers.authorization !== `Bearer ${key}`) {
      throw new Error('the key was not sent as a bearer token');
    }
    const body = JSON.parse(request.init.body);
    if (body.model !== hosted.model) throw new Error(`asked for ${body.model}`);
    if (body.stream !== true) throw new Error('the request did not ask for a stream');

    // A key stored for one vendor must not be reported as another's.
    for (const other of secrets.PROVIDERS) {
      if (other !== hosted.provider && secrets.hasKey(other)) {
        throw new Error(`the ${hosted.provider} key was stored for ${other}`);
      }
    }

    return `${request.url} with ${body.model}`;
  });
}

await checkAsync('providers/chat.js reports a stopped reply as stopped and saves nothing', async () => {
  await freshStoreRoot();
  const saved = await secrets.setKey('openai', 'sk-selftest-chat000333');
  if (!saved.ok) throw new Error(saved.error.message);

  const thread = await store.createThread({ title: 'Stop me' });
  if (!thread.ok) throw new Error(thread.error.message);
  const appended = await store.appendMessage(thread.data.id, {
    role: 'user',
    content: 'Write a long letter.',
  });
  if (!appended.ok) throw new Error(appended.error.message);

  // A provider that holds the request open until its signal aborts, which is what the
  // shell's Stop button does. The reply must surface as CHAT_STOPPED: not a timeout,
  // and not a network fault the person would be told to retry.
  const controller = new AbortController();
  let requestSignal = null;
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init.signal;
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });

  const pending = chat.sendChatMessage(thread.data.id, {
    signal: controller.signal,
    fetchImpl,
  });
  // Let the send reach the fetch before Stop is pressed. The thread and the key are
  // read from disk first, so wait for the request itself rather than for a fixed
  // moment: on a loaded machine that read can outlast a short timer, and Stop pressed
  // before the request is sent is a different case (nothing goes out at all) from the
  // one this checks.
  const requestDeadline = Date.now() + 5000;
  while (requestSignal === null && Date.now() < requestDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (requestSignal === null) throw new Error('the request was never sent, so there was nothing to stop');
  controller.abort();
  const result = await pending;

  if (result.ok) throw new Error('a stopped reply came back as a success');
  if (result.error.code !== 'CHAT_STOPPED') {
    throw new Error(`the stop reported ${result.error.code}: ${result.error.message}`);
  }

  const threads = await store.listThreads();
  const onDisk = threads.data.find((entry) => entry.id === thread.data.id);
  if (onDisk.messages.length !== 1) throw new Error('a stopped reply was written to chats.json');
  if (!(requestSignal instanceof AbortSignal)) throw new Error('the request went out with no signal');

  return 'CHAT_STOPPED, chats.json untouched';
});

await checkAsync('providers/chat.js reports an unreachable provider and keeps the thread intact', async () => {
  await freshStoreRoot();
  const saved = await secrets.setKey('openai', 'sk-selftest-chat000222');
  if (!saved.ok) throw new Error(saved.error.message);

  const thread = await store.createThread({});
  if (!thread.ok) throw new Error(thread.error.message);
  await store.appendMessage(thread.data.id, { role: 'user', content: 'Summarise this.' });

  const result = await chat.sendChatMessage(thread.data.id, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  if (result.ok) throw new Error('an unreachable provider was reported as success');
  if (result.error.code !== 'CHAT_NETWORK_ERROR') throw new Error(`expected CHAT_NETWORK_ERROR, got ${result.error.code}`);
  if (result.error.message.includes('sk-selftest')) throw new Error('the failure carried the key');

  const threads = await store.listThreads();
  const onDisk = threads.data.find((entry) => entry.id === thread.data.id);
  if (onDisk.messages.length !== 1) throw new Error('a failed send still wrote a message');
  return result.error.message;
});

await checkAsync('providers/chat.js turns a rejected key into a Settings instruction', async () => {
  await freshStoreRoot();
  await secrets.setKey('openai', 'sk-selftest-chat000333');
  const thread = await store.createThread({});
  await store.appendMessage(thread.data.id, { role: 'user', content: 'Hello?' });

  const result = await chat.sendChatMessage(thread.data.id, {
    fetchImpl: async () => new Response('{"error":{"message":"sk-selftest-should-not-appear"}}', { status: 401 }),
  });

  if (result.ok) throw new Error('a 401 was reported as success');
  if (result.error.code !== 'CHAT_KEY_REJECTED') throw new Error(`expected CHAT_KEY_REJECTED, got ${result.error.code}`);
  if (result.error.message.includes('sk-selftest')) throw new Error('the provider error carried a key');
  return result.error.message;
});

// Conversation transcript (design node 0:1221). The page's numbers live in three
// files, so the check reads all three: the tokens the node binds, the rules that
// draw each part, and the copy on the empty state's four openings.
check('the Conversation transcript is drawn from node 0:1625', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const html = read('src/renderer/index.html');
  const composer = read('src/renderer/ui/composer.js');
  const chats = read('src/renderer/ui/chats.js');
  const steps = read('src/renderer/ui/steps.js');

  const ruleBody = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`${selector} is not in components.css`);
    const end = css.indexOf('}', start);
    if (end === -1) throw new Error(`${selector} is never closed`);
    return css.slice(start + selector.length, end);
  };
  const wants = (selector, declarations) => {
    const body = ruleBody(selector);
    for (const declaration of declarations) {
      if (!body.includes(declaration)) {
        throw new Error(`${selector} is missing ${declaration}`);
      }
    }
  };

  // The node's light values, and a dark counterpart for each so the page survives
  // the theme toggle.
  for (const declaration of [
    '--zuri-transcript-accent: #2f6bff',
    '--zuri-transcript-accent-soft: #eaf0ff',
    '--zuri-transcript-avatar: #6b4eff',
    '--zuri-transcript-card: #f7f8f9',
    '--zuri-transcript-fill: #f0f1f3',
    '--zuri-transcript-text-secondary: #6b7280',
    '--zuri-transcript-text-muted: #8e9196',
  ]) {
    if (!tokens.includes(declaration)) throw new Error(`tokens.css is missing ${declaration}`);
  }
  const tokenNames = [...tokens.matchAll(/--zuri-transcript-[a-z-]+(?=:)/g)].map((match) => match[0]);
  for (const name of tokenNames) {
    const uses = tokenNames.filter((other) => other === name).length;
    if (uses !== 2) throw new Error(`${name} is declared ${uses} times, it needs a light and a dark value`);
  }

  // Empty state: a 56 px mark on a 16 px radius, the four openings on 2 x 256
  // inside a 520 px grid.
  wants('.shell-empty-hero', ['max-width: 520px']);
  wants('.transcript-empty-mark', ['width: 56px', 'height: 56px', 'border-radius: 16px']);
  wants('.transcript-suggestions', [
    'grid-template-columns: repeat(2, minmax(0, 1fr))',
    'gap: var(--zuri-space-2)',
    'margin-top: var(--zuri-space-4)',
  ]);
  const openings = html.match(/data-suggestion="/g) ?? [];
  if (openings.length !== 4) throw new Error(`the empty state has ${openings.length} openings, the node has 4`);
  for (const copy of [
    'Which lines are over budget?',
    'Add a variance column to Budget.xlsx',
    'Schedule a Monday inbox brief',
    "Find last month's unpaid invoices",
  ]) {
    if (!html.includes(copy)) throw new Error(`the empty state is missing "${copy}"`);
  }

  // A turn (design node 0:1625): the reader's words on 14/22 inside a primary-soft
  // bubble with the node's 20 px corner and 16/18 padding, capped at 424 plus that
  // padding; Zuri's reply on 15/24 inside a surface-raised card holding the node's
  // 632 px measure, with the clock under the bubble it belongs to (0:1649).
  wants(".message[data-role='user'] .message-bubble", [
    'padding: 16px 18px',
    'border-radius: var(--zuri-transcript-bubble-radius)',
    'background: var(--zuri-transcript-bubble-user)',
  ]);
  wants(".message[data-role='assistant'] .message-bubble", [
    'padding: 18px 20px',
    'border-radius: var(--zuri-transcript-bubble-radius)',
    'background: var(--zuri-transcript-bubble)',
  ]);
  wants(".message[data-role='user'] .message-text", ['max-width: 424px', 'line-height: 22px']);
  wants(".message[data-role='assistant'] .message-text", [
    'width: 100%',
    'max-width: 632px',
    'line-height: 24px',
  ]);
  wants('.message-footnote', ['align-self: flex-start', 'font-size: 13px', 'line-height: 20px']);
  wants('.message-badge', ['height: 20px', 'border-radius: var(--zuri-radius-pill)']);

  // The header the node draws: the thread's line under its name (0:1644), the mode
  // badge beside them (0:1645) and the day label over the first turn (0:1648).
  wants('.transcript-header', ['border-bottom: 1px solid var(--zuri-surface-tertiary)']);
  wants('.transcript-title', ['font-size: 16px', 'font-weight: var(--zuri-font-weight-semibold)']);
  wants('.transcript-mode', [
    'height: 30px',
    'border-radius: var(--zuri-radius-pill)',
    'background: var(--zuri-transcript-chip-accent-soft)',
  ]);
  wants('.transcript-day', [
    'font-size: 11px',
    'letter-spacing: 0.06em',
    'text-transform: uppercase',
  ]);

  // The Act strip (0:1656): a surface-secondary card on the node's 12 px corner, a
  // caps title, then 22 px rows with the tool in mono, its line beside it and an
  // 80 x 22 caps chip on the right edge.
  wants('.step-list', [
    'gap: 12px',
    'padding: 12px 16px 16px',
    'border-radius: var(--zuri-transcript-strip-radius)',
    'background: var(--zuri-transcript-strip)',
  ]);
  wants('.step-list-title', ['font-size: 11px', 'letter-spacing: 0.06em', 'text-transform: uppercase']);
  wants('.step', ['grid-template-columns: 22px minmax(0, 1fr) 80px', 'min-height: 22px']);
  wants('.step-icon', ['width: 22px', 'height: 22px', 'border-radius: var(--zuri-radius-pill)']);
  wants('.step-tool', ['flex: 0 0 120px', 'font-family: var(--zuri-font-family-mono)']);
  wants('.step-status', ['width: 80px', 'height: 22px', 'text-transform: uppercase']);

  // The file-change card, the streaming row and the failure card.
  wants('.message-tool', [
    'max-width: 620px',
    'padding: var(--zuri-space-3)',
    'border-radius: var(--zuri-radius-card)',
  ]);
  wants('.message-streaming-caret', ['width: 2px', 'height: 22px']);
  wants('.message-streaming', ['display: inline-flex', 'align-items: flex-end']);
  wants('.message-error-card', [
    'max-width: 620px',
    'padding: var(--zuri-space-3)',
    'border-radius: var(--zuri-radius-card)',
  ]);
  wants('.transcript-skeleton', ['gap: var(--zuri-space-6)']);
  wants(".transcript-skeleton-turn[data-role='user']", ['width: fit-content']);
  wants(".transcript-skeleton-turn[data-role='assistant'] .transcript-skeleton-bar[data-size='short']", ['width: 380px']);
  wants('.transcript-skeleton-bar', ['height: 14px', 'border-radius: 4px']);

  // The parts the node names, built by the renderer.
  for (const pattern of [
    /MODE_LABELS = Object\.freeze\(\{ ask: 'Ask', act: 'Act', autopilot: 'Autopilot' \}\)/,
    /function createStreamingRow\(/,
    /function createToolBlock\(/,
    /function createAttachmentList\(/,
    /message-retry/,
  ]) {
    if (!pattern.test(composer)) throw new Error(`composer.js does not build ${pattern}`);
  }
  const chatsNeeds = [
    'function syncTranscriptMeta(',
    'no messages yet',
    'last reply ',
    'function dayLabel(',
    "className = 'transcript-day'",
    'const HELD_THREAD = Object.freeze(',
    "CHAT_STATES = Object.freeze(['active', 'empty', 'loading', 'streaming', 'error', 'long'",
  ];
  for (const needle of chatsNeeds) {
    if (!chats.includes(needle)) throw new Error(`chats.js is missing ${needle}`);
  }
  const stepsNeeds = [
    'function refreshTitle(',
    'Act steps ',
    "className = 'step-list-title'",
  ];
  for (const needle of stepsNeeds) {
    if (!steps.includes(needle)) throw new Error(`steps.js is missing ${needle}`);
  }

  return '56 px mark, 520 px openings, 20 px bubbles, 632 px reply measure, 22 px step rows, 2 x 22 caret, 24/8 px skeleton rhythm';
});

check('assistant responses format readable blocks without injecting markup', () => {
  const composer = read('src/renderer/ui/composer.js');
  const formatterStart = composer.indexOf('export function createMessageText');
  const formatterEnd = composer.indexOf('export function createMessageElement', formatterStart);
  if (formatterStart === -1 || formatterEnd === -1) {
    throw new Error('composer.js does not expose the assistant response formatter');
  }

  const formatter = composer.slice(formatterStart, formatterEnd);
  // Inline Markdown helpers sit immediately before createMessageText, so include
  // them in the safety boundary while keeping unrelated composer code out.
  const formattingSource = composer.slice(Math.max(0, formatterStart - 10000), formatterEnd);
  if (/innerHTML|outerHTML|insertAdjacentHTML/.test(formattingSource)) {
    throw new Error('assistant response formatting writes untrusted content as HTML');
  }
  if (!/textContent\s*=/.test(formattingSource)) {
    throw new Error('assistant response formatting does not insert text through textContent');
  }

  // A model commonly returns Markdown-like blocks. Keep the check semantic so a
  // future parser can use different helper names while still proving that blank
  // lines, fenced code, and list or heading markers receive their own structure.
  const blockSignals = [
    /split\([^)]*\\n/,
    /```|fenced|code fence/i,
    /heading|ordered|unordered|list|bullet/i,
  ];
  const missing = blockSignals.filter((pattern) => !pattern.test(formatter)).length;
  if (missing > 0) {
    throw new Error('assistant response formatter does not describe paragraph, code, and list or heading blocks');
  }

  return 'paragraphs, fenced code, and list or heading blocks use safe DOM text insertion';
});

check('the demo runner page (node 0:12711) ships its five frames at the drawn sizes', () => {
  const page = read('src/renderer/views/demo.html');
  const styles = read('src/renderer/views/demo.css');
  const module = read('src/renderer/views/demo.js');
  const tokens = read('src/renderer/styles/tokens.css');

  if (!/name="viewport"[^>]*viewport-fit=cover/.test(page)) {
    throw new Error('demo.html is missing the viewport-fit=cover viewport');
  }
  if (!/src="demo\.js"/.test(page) || !/type="module"/.test(page)) {
    throw new Error('demo.html does not load demo.js as a module');
  }

  // The node draws the runner five times; each frame is a section the module
  // shows one at a time, in this order.
  const frames = [...page.matchAll(/class="demo-state" data-state="([a-z]+)"/g)].map((match) => match[1]);
  const drawn = ['idle', 'running', 'pass', 'fail', 'restarting'];
  if (frames.join(',') !== drawn.join(',')) {
    throw new Error(`demo.html frames are ${frames.join(',') || 'none'}, expected ${drawn.join(',')}`);
  }
  if (!/export const DEMO_STATES = \['idle', 'running', 'pass', 'fail', 'restarting'\]/.test(module)) {
    throw new Error('demo.js does not list the five frames as DEMO_STATES');
  }
  if (!/export function applyState/.test(module) || !/export function stateFromSearch/.test(module)) {
    throw new Error('demo.js does not export applyState and stateFromSearch');
  }

  // The five assertions the strip, the checklist and the console all name.
  for (const step of [
    'Schedule a run',
    'Run completes',
    'Notification raised',
    'Follow-up reminder created',
    'Restart catch-up',
  ]) {
    if (!page.includes(step)) throw new Error(`demo.html is missing the check "${step}"`);
  }

  // What the frames after idle add on top of the shell: the running chip, the
  // all-pass and failing-check banners, and the restart prompt.
  for (const marker of ['demo-run-chip', 'demo-success-banner', 'demo-error-banner', 'demo-restart-card']) {
    if (!page.includes(`class="${marker}`)) throw new Error(`demo.html is missing the ${marker} the node draws`);
  }

  // The geometry the node binds: 248 px sidebar, 24 px main gutter, 12 px canvas
  // inset, 14 px cards, 12 px controls, 44 px live rows, the 20 / 16 / 13 / 12 /
  // 11 type ramp and the 0.66 px label tracking.
  for (const measured of [
    '--zuri-demo-sidebar-width: 248px',
    '--zuri-demo-gutter: 24px',
    '--zuri-demo-shell-padding: 12px',
    '--zuri-demo-radius-card: 14px',
    '--zuri-demo-radius-control: 12px',
    '--zuri-demo-live-row-height: 44px',
    '--zuri-demo-title-size: 20px',
    '--zuri-demo-heading-size: 16px',
    '--zuri-demo-small-size: 13px',
    '--zuri-demo-caption-size: 12px',
    '--zuri-demo-label-size: 11px',
    '--zuri-demo-label-tracking: 0.66px',
  ]) {
    if (!tokens.includes(measured)) throw new Error(`tokens.css is missing the node's ${measured}`);
  }

  // The page token block exists and the stylesheet takes every colour from it.
  if (!/^\.demo-page \{/m.test(tokens)) throw new Error('tokens.css has no .demo-page block');
  if (/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(styles)) throw new Error('demo.css holds a colour literal instead of a token');

  // Dark is the second palette on the same tokens, not a second stylesheet.
  if (!/:root\[data-theme="dark"\] \.demo-page \{/.test(tokens)) {
    throw new Error('tokens.css has no dark palette for the demo runner');
  }

  // Phone first: the sidebar becomes the fixed tab bar, so navigation stays on
  // screen while the page scrolls behind it.
  if (!/@media \(max-width: 768px\)/.test(styles)) throw new Error('demo.css has no phone breakpoint');
  if (!/\.demo-nav\s*\{[^}]*position: fixed/.test(styles)) {
    throw new Error('the phone layout does not keep the tab bar on screen');
  }

  return `${frames.length} frames, 248 px sidebar, 14 px cards, 5 checks`;
});

/* ------------------------------------------- reminder notification (0:11015) */

await checkAsync('the reminder toast matches open-pencil 0:11015', async () => {
  const toast = await import('../src/main/reminder-toast.js');

  const same = (label, actual, expected) => {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) throw new Error(`${label}: got ${left}, wanted ${right}`);
  };

  // Friday 15 May 2026, 9:45 AM: the moment the design prints on the toast.
  const now = new Date(2026, 4, 15, 9, 45, 0);
  const dueAt = now.toISOString();
  const once = { id: 'toast-once', title: 'Standup notes due', repeat: 'once', dueAt };
  const daily = { id: 'toast-daily', title: 'Standup notes due', repeat: 'daily', dueAt, timeOfDay: '09:45' };

  same('the clock is the design 12-hour form', toast.clockLabel(now), '9:45 AM');

  const first = toast.buildReminderToast(once, { now, firedToday: 1 });
  same('the one-off title', first.title, 'Standup notes due');
  same('the one-off sentence', first.sentence, 'Your 9:45 AM reminder: Standup notes due.');
  same('a one-off carries no chip line', first.context, '');
  same('a one-off body is its sentence', first.body, first.sentence);
  same('a one-off offers dismiss instead of snooze', first.actions.map((action) => action.text), [
    'Open reminders',
    'Dismiss',
  ]);

  const again = toast.buildReminderToast(daily, { now, firedToday: 3 });
  same('a repeat fire says so in the title', again.title, 'Standup notes due - again');
  same('a repeat fire says so in the sentence', again.sentence, 'This reminder fired again. Standup notes due.');
  same(
    'the two chips travel as one line under the sentence',
    again.body,
    `${again.sentence}\nRepeats daily - occurrence 3 today`,
  );
  same('a repeating reminder offers snooze', again.actions.map((action) => action.text), [
    'Snooze 10 min',
    'Open reminders',
  ]);

  // The design's third sample names the day, which is what a fire reached after Zuri
  // was closed reads as: the reminder is real, the day is not today.
  const friday = toast.buildReminderToast(
    {
      id: 'toast-friday',
      title: 'Send the client status deck',
      repeat: 'once',
      dueAt: new Date(2026, 4, 15, 17, 0).toISOString(),
    },
    { now: new Date(2026, 4, 16, 8, 0), firedToday: 1 },
  );
  same('a missed fire names its day', friday.sentence, 'Friday 5:00 PM reminder: Send the client status deck.');

  same(
    'the repeat chip counts in minutes',
    toast.repeatLabel({ repeat: 'interval', intervalMinutes: 30 }),
    'Repeats every 30 min',
  );

  return 'title, sentence, chip line and two buttons';
});

await checkAsync('a due reminder raises that toast and both buttons work', async () => {
  const root = await freshStoreRoot();
  const toast = await import('../src/main/reminder-toast.js');
  const reminders = await import('../src/main/reminders.js');

  // Stands in for Electron's Notification: it records exactly what the app would hand
  // Windows, and lets the check press the buttons the toast draws. No Electron process
  // is started, so nothing can block on a dialog.
  const raised = [];
  class FakeNotification {
    static isSupported() {
      return true;
    }

    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.shown = false;
      this.closed = false;
      raised.push(this);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
      return this;
    }

    show() {
      this.shown = true;
    }

    close() {
      this.closed = true;
    }

    press(event, ...args) {
      this.handlers.get(event)?.(...args);
    }
  }

  // Real clock, one minute ago: the toast's day and the notification it writes are then
  // the same day by construction, so "occurrence 2 today" is not a date accident.
  const started = new Date();
  const firstDue = new Date(started.getTime() - 60_000);
  const created = await store.createReminder(
    { title: 'Standup notes due', repeat: 'interval', intervalMinutes: 30, dueAt: firstDue.toISOString() },
    { root },
  );
  if (!created.ok) throw new Error(created.error.message);

  const opened = [];
  const notify = reminders.createSystemNotifier({
    Notification: FakeNotification,
    onOpen: () => opened.push('open'),
    onSnooze: (payload) => toast.snoozeReminder(payload.reminderId, { root }),
  });

  const tick = await reminders.tickReminders({ root, now: started, notify });
  if (!tick.ok) throw new Error(tick.error.message);
  if (raised.length !== 1) throw new Error(`${raised.length} notifications were raised, wanted 1`);
  if (raised[0].shown !== true) throw new Error('the toast was built but never shown');

  const shown = raised[0].options;
  const clock = toast.clockLabel(firstDue);
  if (shown.title !== 'Standup notes due') throw new Error(`the toast title is ${JSON.stringify(shown.title)}`);
  if (shown.body !== `Your ${clock} reminder: Standup notes due.\nRepeats every 30 min`) {
    throw new Error(`the toast body is ${JSON.stringify(shown.body)}`);
  }
  const buttons = shown.actions.map((action) => action.text);
  if (buttons.join(' | ') !== 'Snooze 10 min | Open reminders') {
    throw new Error(`the toast buttons are ${JSON.stringify(buttons)}`);
  }

  // Clicking the toast body is the design's primary action.
  raised[0].press('click');
  if (opened.length !== 1) throw new Error('clicking the toast did not open Zuri');

  // Snooze re-arms the reminder ten minutes out, which is sooner than the fire the tick
  // already wrote half an hour ahead, so the nearer moment wins.
  raised[0].press('action', { actionIndex: 0, selectionIndex: -1 }, 0);
  const snoozedTo = started.getTime() + 10 * 60_000;
  let snoozed = null;
  for (let attempt = 0; attempt < 200 && snoozed === null; attempt += 1) {
    const listed = await store.listReminders({ root });
    if (!listed.ok) throw new Error(listed.error.message);
    const reminder = listed.data.find((candidate) => candidate.id === created.data.id);
    const at = Date.parse(reminder?.dueAt ?? '');
    if (Number.isFinite(at) && Math.abs(at - snoozedTo) < 5_000) snoozed = reminder;
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (snoozed === null) throw new Error('snoozing did not move the next fire ten minutes out');

  // The second fire of the same day is the one that must not read as a duplicate.
  const rearmed = await store.recordReminderFire(
    created.data.id,
    { dueAt: new Date(Date.now() - 60_000).toISOString() },
    { root },
  );
  if (!rearmed.ok) throw new Error(rearmed.error.message);

  const second = await reminders.tickReminders({ root, now: new Date(), notify });
  if (!second.ok) throw new Error(second.error.message);
  if (raised.length !== 2) throw new Error('the second fire raised no toast');
  if (raised[1].options.title !== 'Standup notes due - again') {
    throw new Error(`the second toast title is ${JSON.stringify(raised[1].options.title)}`);
  }
  if (raised[1].options.body !== 'This reminder fired again. Standup notes due.\nRepeats every 30 min - occurrence 2 today') {
    throw new Error(`the second toast body is ${JSON.stringify(raised[1].options.body)}`);
  }

  raised[1].press('action', { actionIndex: 1, selectionIndex: -1 }, 1);
  if (opened.length !== 2) throw new Error('the Open reminders button did not open Zuri');

  return 'raised, clicked, snoozed and counted';
});

check('the tray menu is the one open-pencil draws (0:13564)', () => {
  const row = (template, id) => template.find((item) => item.id === id);
  const closed = trayMenu.trayMenuTemplate({ overlayOpen: false, remindersDue: 2 });
  const open = trayMenu.trayMenuTemplate({ overlayOpen: true, remindersDue: 2 });

  // Order and grouping are the design's: header, divider, three actions, divider, Quit.
  const rows = closed.map((item) => item.label ?? '(separator)');
  const drawn = ['Zuri', '2 reminders due', '(separator)', 'Open Zuri', 'New chat', 'Toggle overlay', '(separator)', 'Quit'];
  if (rows.join('|') !== drawn.join('|')) throw new Error(`the rows are ${JSON.stringify(rows)}`);

  // The header is the app name over its status, with the chip as the status row's
  // checked state: no menu item can draw a second line or a coloured pill.
  const header = closed.slice(0, 2);
  if (header.some((item) => item.enabled !== false)) throw new Error('the header rows are clickable');
  if (row(closed, trayMenu.TRAY_ITEM_IDS.status).checked !== true) throw new Error('the status row does not read On');

  // "New chat" and "Toggle overlay" carry the design's shortcut hints, shown only:
  // a tray menu is not a global shortcut, so it must not register one.
  const newChat = row(closed, trayMenu.TRAY_ITEM_IDS.newChat);
  if (newChat.label !== 'New chat' || newChat.accelerator !== 'Control+N') {
    throw new Error(`the New chat row is ${JSON.stringify(newChat)}`);
  }
  const overlayOff = row(closed, trayMenu.TRAY_ITEM_IDS.overlay);
  const overlayOn = row(open, trayMenu.TRAY_ITEM_IDS.overlay);
  if (overlayOff.label !== 'Toggle overlay' || overlayOff.checked !== false) {
    throw new Error(`the closed overlay row is ${JSON.stringify(overlayOff)}`);
  }
  if (overlayOn.label !== 'Hide overlay' || overlayOn.checked !== true) {
    throw new Error(`the open overlay row is ${JSON.stringify(overlayOn)}`);
  }
  if (overlayOff.accelerator !== 'Super+Space') throw new Error('the overlay row lost its Win+Space hint');
  if (newChat.registerAccelerator !== false || overlayOff.registerAccelerator !== false) {
    throw new Error('a display-only hint would register a global shortcut');
  }

  // Quit is the last row, below the second divider, where the design draws it.
  if (closed.at(-1).id !== trayMenu.TRAY_ITEM_IDS.quit) throw new Error('Quit is not the last row');
  if (closed.at(-2).type !== 'separator') throw new Error('Quit is not under its own divider');

  // The status line: the overlay wins while it is showing, otherwise the count.
  if (row(open, trayMenu.TRAY_ITEM_IDS.status).label !== 'Overlay showing') {
    throw new Error('an open overlay is not reported in the header');
  }
  if (trayMenu.statusText({ remindersDue: 1 }) !== '1 reminder due') throw new Error('one reminder is not singular');
  if (trayMenu.statusText({ remindersDue: 0 }) !== 'No reminders due') throw new Error('an empty count reads wrong');
  if (trayMenu.TRAY_TOOLTIP !== 'Zuri') throw new Error(`the tooltip is ${JSON.stringify(trayMenu.TRAY_TOOLTIP)}`);

  return 'header, three actions and Quit in the design order';
});

check('the balloon says where Zuri went and when the next reminder is due (0:13684)', () => {
  const now = new Date('2026-03-01T09:00:00.000Z');
  const balloon = trayMenu.backgroundBalloon({ nextReminderAt: '2026-03-01T09:15:00.000Z', now });

  if (balloon.title !== 'Zuri is running in the background') throw new Error(`the title is ${JSON.stringify(balloon.title)}`);
  if (balloon.content !== 'Right-click the tray icon to open the menu.') {
    throw new Error(`the body is ${JSON.stringify(balloon.content)}`);
  }
  if (balloon.next !== 'Next reminder in 15 min') throw new Error(`the wait is ${JSON.stringify(balloon.next)}`);
  if (trayMenu.balloonContent(balloon) !== 'Right-click the tray icon to open the menu.\nNext reminder in 15 min') {
    throw new Error('the balloon text does not carry both lines');
  }

  // A machine with nothing scheduled keeps the two drawn lines and prints no blank third.
  const quiet = trayMenu.backgroundBalloon({ nextReminderAt: null, now });
  if (quiet.next !== '') throw new Error('a missing reminder still produced a wait line');
  if (trayMenu.balloonContent(quiet) !== 'Right-click the tray icon to open the menu.') {
    throw new Error('the balloon gained an empty line');
  }

  // The soonest reading date wins, and anything unreadable is skipped rather than thrown.
  const soonest = trayMenu.earliestDueAt([
    { dueAt: '2026-03-01T11:00:00.000Z' },
    { dueAt: 'not a date' },
    { dueAt: '2026-03-01T09:30:00.000Z' },
    {},
  ]);
  if (soonest !== '2026-03-01T09:30:00.000Z') throw new Error(`the soonest reminder is ${JSON.stringify(soonest)}`);
  if (trayMenu.earliestDueAt([]) !== null) throw new Error('an empty list named a reminder');

  return 'title, body and the next reminder line';
});

check('main raises the tray, its menu and the hide-into-it close', () => {
  const main = read('src/main/main.js');
  const needed = [
    "from './tray-menu.js'",
    'new Tray(',
    'tray.setToolTip(TRAY_TOOLTIP)',
    'tray.setContextMenu(Menu.buildFromTemplate(',
    'tray.displayBalloon(',
    "tray.on('click', openZuriFromTray)",
    'createTray();',
    "app.on('before-quit'",
    'window.hide();',
  ];
  for (const needle of needed) {
    if (!main.includes(needle)) throw new Error(`main.js never calls ${needle}`);
  }

  // Every row that does something must have a handler, or the menu draws a dead click.
  for (const id of ['open', 'newChat', 'overlay', 'quit']) {
    if (!main.includes(`TRAY_ITEM_IDS.${id}`)) throw new Error(`no handler for the ${id} row`);
  }

  // The page answers the tray's New chat by pressing its own control, so the two
  // cannot drift apart.
  const app = read('src/renderer/app.js');
  if (!app.includes("change?.action === 'new-chat'")) throw new Error('the page ignores the tray New chat');

  return 'icon, tooltip, menu, balloon and close-to-tray';
});

check('main imports every helper its tray rows call', () => {
  const main = read('src/main/main.js');

  // A named import that is missing does not fail until the row is clicked, so the
  // names each tray path uses are compared with the module's import list.
  const namesFrom = (source, specifier) => {
    const end = source.indexOf(`from '${specifier}'`);
    if (end < 0) return [];
    const start = source.lastIndexOf('import', end);
    return source
      .slice(start, end)
      .replace(/import\s*\{?/, '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '' && name !== '}');
  };

  const overlayNames = namesFrom(main, './overlay.js');
  for (const helper of ['isOverlayOpen', 'openOverlay', 'hideOverlay', 'closeOverlay']) {
    if (!overlayNames.includes(helper)) throw new Error(`main.js uses ${helper} without importing it`);
  }

  const trayNames = namesFrom(main, './tray-menu.js');
  for (const name of ['TRAY_ITEM_IDS', 'TRAY_TOOLTIP', 'backgroundBalloon', 'balloonContent', 'earliestDueAt', 'trayMenuTemplate']) {
    if (!trayNames.includes(name)) throw new Error(`main.js never imports ${name}`);
  }

  return `${overlayNames.length} overlay helpers, ${trayNames.length} tray helpers`;
});

check('the Mode selector (Ask / Act / Autopilot) is drawn from node 0:3485', () => {
  // The control is drawn in the shared sheet rather than on a page, because the
  // composer's pill and the card's specimen page have to be the same control; the
  // page holds the placement and nothing else.
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const want = (body, checks, what) => {
    const gone = checks.filter(([, pattern]) => !pattern.test(body)).map(([name]) => name);
    if (gone.length > 0) throw new Error(`the ${what} is missing ${gone.join(', ')}`);
  };

  // Closed (0:3598, chip 0:3599): a 28 px pill track with a 3 px inset, and chips on
  // the same pill radius, sitting flush against each other.
  want(
    ruleBody('.composer-modes'),
    [
      ["the node's 28 px track", /height:\s*28px/],
      ['the 3 px inset', /padding:\s*3px/],
      ['the radius-full track corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
      ['chips flush in the track', /gap:\s*0/],
    ],
    'mode track',
  );

  want(
    ruleBody('.composer-mode'),
    [
      ["the node's 22 px chip", /height:\s*22px/],
      ['the radius-full chip corner', /border-radius:\s*var\(--zuri-radius-pill\)/],
      ['the 14 px label', /font-size:\s*var\(--zuri-font-size-label-md\)/],
      ['the 20 px label line height', /line-height:\s*var\(--zuri-line-height-label-md\)/],
      ['the color/text-subtle resting label', /color:\s*var\(--zuri-text-subtle\)/],
      ['the pressed chip the width the node draws', /padding:\s*0 16px/],
    ],
    'mode chip',
  );

  const pressed = ruleBody(".composer-mode[aria-pressed='true']");
  want(
    pressed,
    [
      ['the color/primary-soft fill', /background:\s*var\(--zuri-primary-soft\)/],
      ['the soft foreground label', /color:\s*var\(--zuri-primary-soft-foreground\)/],
    ],
    'mode in use',
  );
  // The node writes the pressed label at the regular weight and draws no shadow under
  // the chip: bolding or lifting it would be a redesign of the track.
  if (/font-weight:|box-shadow:/.test(pressed)) {
    throw new Error('the mode in use is bolder or shadowed, which node 0:3599 does not draw');
  }

  // Open (0:3566): 360 wide on radius-xl, which tokens.json spells 20, carrying the
  // node's own drop shadow above a 12 px top inset.
  want(
    ruleBody('.mode-menu'),
    [
      ["the node's 360 px panel, capped by the window", /width:\s*min\(360px, calc\(100vw - 16px\)\)/],
      ['the radius-xl corner', /border-radius:\s*var\(--zuri-mode-menu-radius\)/],
      ['the radius-xl value tokens.json gives', /--zuri-mode-menu-radius:\s*20px/],
      ['the color/surface fill', /background:\s*var\(--zuri-surface\)/],
      ['the node drop shadow', /box-shadow:\s*0 16px 40px rgba\(15, 23, 42, 0\.08\)/],
      ['the 12 px top inset and 10 px foot', /padding:\s*12px 0 10px/],
    ],
    'mode panel',
  );

  want(
    ruleBody('.mode-menu-eyebrow'),
    [
      ['the 11 px MODE eyebrow', /font-size:\s*var\(--zuri-font-size-label-caps\)/],
      ['the 16 px eyebrow line', /line-height:\s*var\(--zuri-line-height-label-caps\)/],
      ['the semibold weight the node sets', /font-weight:\s*var\(--zuri-font-weight-semibold\)/],
      ['the 0.06em tracking the node sets at 11 px', /letter-spacing:\s*var\(--zuri-tracking-label-caps\)/],
      ['the color/text-subtle ink', /color:\s*var\(--zuri-text-subtle\)/],
    ],
    'panel eyebrow',
  );

  want(
    ruleBody('.mode-menu-hint'),
    [
      ['the 13 px promise line', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
      ['the 20 px promise height', /line-height:\s*var\(--zuri-line-height-body-sm\)/],
      ['the color/text-subtle ink', /color:\s*var\(--zuri-text-subtle\)/],
    ],
    'panel hint',
  );

  want(
    ruleBody('.mode-menu-rule'),
    [
      ['the 1 px hairline', /height:\s*1px/],
      ['the color/surface-tertiary line', /background:\s*var\(--zuri-surface-tertiary\)/],
    ],
    'panel rule',
  );

  // One 64 px row per mode: the 44 px tile, the label 14 px after it, and the tick
  // disc 18 px in from the panel's right edge.
  want(
    ruleBody('.mode-menu-row'),
    [
      ["the node's 64 px row", /min-height:\s*64px/],
      ['the tile and tick columns', /grid-template-columns:\s*44px minmax\(0, 1fr\) 20px/],
      ['the 14 px gap after the tile', /gap:\s*14px/],
      ['the 10 px inset and 18 px clear of the tick', /padding:\s*10px 18px 10px 10px/],
      ['the radius/field row corner', /border-radius:\s*var\(--zuri-radius-field\)/],
      ['rows inset 8 px in the panel', /margin:\s*0 8px/],
      ['no fill of its own at rest', /background:\s*transparent/],
    ],
    'mode row',
  );

  want(
    ruleBody('.mode-menu-tile'),
    [
      ['the 44 px tile', /width:\s*44px/],
      ['the 44 px tile height', /height:\s*44px/],
      ['the radius/field tile corner', /border-radius:\s*var\(--zuri-radius-field\)/],
      ['the color/surface-secondary tile fill', /background:\s*var\(--zuri-surface-secondary\)/],
      ['the color/text-subtle glyph', /color:\s*var\(--zuri-text-subtle\)/],
    ],
    'mode tile',
  );

  want(
    ruleBody(".mode-menu-row[aria-checked='true']"),
    [['the color/primary-soft selected fill', /background:\s*var\(--zuri-primary-soft\)/]],
    'selected row',
  );

  want(
    ruleBody(".mode-menu-row[aria-checked='true'] .mode-menu-tile"),
    [
      ['the color/primary selected tile', /background:\s*var\(--zuri-accent\)/],
      ['the white glyph on the accent', /color:\s*var\(--zuri-text-on-accent\)/],
    ],
    'selected tile',
  );

  // The pair of labels is one rule written over two lines, and the sheet is read
  // with its own line endings, so the rule is found by its first selector and cut
  // at the closing brace rather than matched line for line.
  const selectedLabelAt = css.indexOf(".mode-menu-row[aria-checked='true'] .mode-menu-name,");
  if (selectedLabelAt === -1) throw new Error('the selected row never recolours its name');
  const selectedLabel = css.slice(selectedLabelAt, css.indexOf('}', selectedLabelAt));
  want(
    selectedLabel,
    [['the soft foreground on the selected name and line', /color:\s*var\(--zuri-primary-soft-foreground\)/]],
    'selected row label',
  );

  // The hovered row (0:3581) takes the sunken fill and lifts its tile to the surface
  // colour; the node draws both, and drawing only one loses the lift.
  const hoverRow = /\.mode-menu-row\[aria-checked='false'\]:hover,\s*\.mode-menu-row\[aria-checked='false'\]:focus-visible \{\s*background: var\(--zuri-surface-secondary\);/;
  if (!hoverRow.test(css)) {
    throw new Error('the hovered row is not filled with the color/surface-secondary token');
  }
  const hoverTile = /\.mode-menu-row\[aria-checked='false'\]:hover \.mode-menu-tile,\s*\.mode-menu-row\[aria-checked='false'\]:focus-visible \.mode-menu-tile \{\s*background: var\(--zuri-surface\);/;
  if (!hoverTile.test(css)) {
    throw new Error('the hovered row does not lift its tile to the surface colour');
  }

  want(
    ruleBody('.mode-menu-check'),
    [
      ['the 20 px tick disc', /width:\s*20px/],
      ['the 20 px disc height', /height:\s*20px/],
      ['the radius-full disc', /border-radius:\s*var\(--zuri-radius-pill\)/],
      ['the color/primary disc fill', /background:\s*var\(--zuri-accent\)/],
      ['the white tick on the disc', /color:\s*var\(--zuri-text-on-accent\)/],
    ],
    'selected tick',
  );
  // Only the mode in use carries the disc; the node leaves the other rows' edge empty.
  if (!/\.mode-menu-row\[aria-checked='false'\] \.mode-menu-check \{\s*visibility: hidden;/.test(css)) {
    throw new Error('the tick is drawn on rows that are not the mode in use');
  }

  want(
    ruleBody('.mode-menu-footer'),
    [
      ['the 13 px reminder', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
      ['the 16 px inset the caption shares', /margin:\s*0 16px/],
      ['the color/text-subtle ink', /color:\s*var\(--zuri-text-subtle\)/],
    ],
    'panel footer',
  );

  // Locked (0:3603): the whole selector is drawn at 40%, and the panel cannot open.
  if (!/\.composer-modes\[data-locked='true'\] \{\s*opacity: 0\.4;/.test(css)) {
    throw new Error("the locked selector is not drawn at the node's 40%");
  }
  const selectorModule = read('src/renderer/ui/modeSelector.js');
  if (!/group\.dataset\.locked = String\(Boolean\(next\)\)/.test(selectorModule)) {
    throw new Error('the selector never marks itself locked');
  }
  const menuModule = read('src/renderer/ui/modeMenu.js');
  if (!/function open\(anchor\) \{\s*if \(disabled\) return;/.test(menuModule)) {
    throw new Error('the panel still opens while the selector is locked');
  }

  // The panel's rows are the node's own words, and the panel opens from the chip that
  // is already in use rather than from a second control the node does not draw.
  for (const line of [
    'Reads files, changes nothing',
    'Edits Office files, asks first',
    'Scheduled runs and follow-ups',
  ]) {
    if (!selectorModule.includes(line)) throw new Error(`the panel never says "${line}"`);
  }
  if (!/menu\.toggle\(button\)/.test(selectorModule)) {
    throw new Error('the chip in use does not open the panel');
  }

  // The composer uses this control, and locks it with the input while a reply streams.
  const composer = read('src/renderer/ui/composer.js');
  if (!/import \{ createModeSelector, MODES \} from '\.\/modeSelector\.js'/.test(composer)) {
    throw new Error("the composer does not mount the mode selector's module");
  }
  if (!/modes\.setDisabled\(sending\)/.test(composer)) {
    throw new Error('the mode selector is not locked while a reply streams');
  }

  // The specimen page draws all three states and shares the app's sheet, so the page
  // cannot show a second version of the control.
  const page = read('src/renderer/views/mode-selector.html');
  for (const id of ['ms-well-closed', 'ms-well-open', 'ms-well-locked']) {
    if (!page.includes(`id="${id}"`)) throw new Error(`the specimen page does not draw ${id}`);
  }
  if (!page.includes('../styles/components.css')) {
    throw new Error('the specimen page does not load the sheet the app draws');
  }

  return '28 px track, 22 px chips, 360 px panel on radius 20, 64 px rows, 44 px tiles, locked at 40%';
});

check('the installer screen is drawn from node 0:15574', () => {
  const html = read('src/renderer/views/installer.html');
  const css = read('src/renderer/views/installer.css');
  const js = read('src/renderer/views/installer.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:15574 draws the window five times - welcome, choose install location,
  // installing, finish and a directory that cannot be used - so the page carries
  // all five frames and no other state name: a frame missing here is a screen a
  // reader reaches through ?state= and lands on nothing.
  const frames = ['welcome', 'directory', 'installing', 'finish', 'refused'];
  const declared = [...html.matchAll(/<section\s+class="installer"\s+data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['welcome', 'directory', 'installing', 'finish', 'refused']")) {
    throw new Error('installer.js does not list the five states');
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('installer.js does not publish its states');

  // The node's own copy in every frame, so none of them can rot into a
  // placeholder: the step chips, the three feature rows, the directory field and
  // its available-folder line, the progress block, the finish block and the
  // refused folder's alert.
  const copy = [
    'STEP 1 OF 2',
    'Welcome to Zuri Desktop',
    'Chat with your assistant, grounded in your own files.',
    'Zuri clicks, types and edits your open Office documents.',
    'Scheduled tasks with reminders, notifications and follow-ups.',
    'STEP 2 OF 2',
    'Choose install location',
    'INSTALL DIRECTORY',
    'Folder is available &middot; 244 MB needed, 12.4 GB free',
    'Create a desktop shortcut',
    'IN PROGRESS',
    'Installing Zuri',
    'Extracting app.asar',
    'Step 2 of 3 &middot; 38 MB of 56 MB',
    'Preparing installation',
    'Copying application files',
    'Creating shortcuts',
    'INSTALLED',
    'Zuri is ready to use',
    'Installed successfully',
    'Launch Zuri when installation finishes',
    'Open the Zuri install folder',
    'That folder cannot be used',
    'Access is denied. This folder is read-only for your account.',
    'Version 1.4.0',
    'Cancel',
    'Next',
    'Back',
    'Install',
    'Browse',
    'Open folder',
    'Finish',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`installer.html is missing "${text}"`);
  }

  // The frames' own drawing: the INSTALLED chip and the tick tile are the one
  // pair in the success colours, and the refused field is the only danger border.
  if (!/class="step-chip step-chip--done"/.test(html)) {
    throw new Error('the finish frame does not draw the INSTALLED chip');
  }
  if (!/class="field field--refused"/.test(html)) {
    throw new Error('the refused frame does not draw its danger field');
  }

  // The window's numbers are the node's: 640 x 460 on radius 20, a 176 px rail
  // and a 400 px content column, its blocks 24, 36 and 44 tall.
  const pageStart = tokens.indexOf('.installer-page {');
  if (pageStart === -1) throw new Error('tokens.css has no .installer-page block');
  const pageTokens = tokens.slice(pageStart, tokens.indexOf('\n}', pageStart));
  for (const rule of [
    '--zuri-installer-width: 640px;',
    '--zuri-installer-height: 460px;',
    '--zuri-installer-radius: 20px;',
    '--zuri-installer-rail-width: 176px;',
    '--zuri-installer-pad-side: 32px;',
    '--zuri-installer-pad-top: 36px;',
    '--zuri-installer-chip-height: 24px;',
    '--zuri-installer-title-size: 28px;',
    '--zuri-installer-body-width: 392px;',
    '--zuri-installer-field-height: 44px;',
    '--zuri-installer-button-height: 36px;',
  ]) {
    if (!pageTokens.includes(rule.replace(/;$/, ''))) throw new Error(`tokens.css is missing ${rule}`);
  }

  // One page-scoped palette in two themes, and no literal colour in the page
  // sheet, so a colour changed in open-pencil is one edit in tokens.css.
  const palette = [
    ['--zuri-installer-surface', '#FFFFFF', '#18181B'], // color/surface, the window
    ['--zuri-installer-surface-secondary', '#F4F4F5', '#27272A'], // the brand rail
    ['--zuri-installer-text', '#11181C', '#ECEDEE'], // color/text
    ['--zuri-installer-primary', '#006FEE', '#006FEE'], // color/primary
    ['--zuri-installer-success', '#17C964', '#17C964'], // color/success
    ['--zuri-installer-danger', '#F31260', '#F31260'], // color/danger
  ];
  const lightBlock = tokens.slice(tokens.indexOf(':root[data-theme="light"] .installer-page {'));
  const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"] .installer-page {'));
  for (const [name, light, dark] of palette) {
    if (!lightBlock.slice(0, lightBlock.indexOf('}')).includes(`${name}: ${light}`)) {
      throw new Error(`${name} is not ${light} in the light block`);
    }
    if (!darkBlock.slice(0, darkBlock.indexOf('}')).includes(`${name}: ${dark}`)) {
      throw new Error(`${name} is not ${dark} in the dark block`);
    }
  }
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) {
    throw new Error(`installer.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  }

  // A phone keeps the same drawing in one column, its actions pinned to the foot
  // and clear of the home indicator, and nothing scrolls sideways.
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/.test(html)) {
    throw new Error('installer.html has no phone viewport');
  }
  if (!/min-height: 100dvh/.test(css)) throw new Error('installer.css sizes the page in dvh');
  if (!/env\(safe-area-inset-bottom\)/.test(css)) {
    throw new Error('the phone footer does not clear the home indicator');
  }
  if (!/@media \(max-width: 767px\)[\s\S]*?\.panel-footer \{[^}]*position: sticky/.test(css)) {
    throw new Error('the phone footer is not pinned to the foot of the screen');
  }
  if (!/\.installer \{[^}]*width: var\(--zuri-installer-width\)/.test(css)) {
    throw new Error('the window does not take its width from the node');
  }

  return 'five 640 x 460 frames, 176 px rail, 400 px column, 24/28/36/44 px blocks, one page-scoped palette';
});

check('a second launch focuses the window already open and draws no second one (0:13705)', () => {
  // State 02: the window was minimised into the taskbar, so it leaves it first, then
  // shows, then takes focus. The order is what makes the focus land on a real window.
  const minimisedCalls = [];
  const minimised = {
    isMinimized: () => {
      minimisedCalls.push('isMinimized');
      return true;
    },
    restore: () => minimisedCalls.push('restore'),
    show: () => minimisedCalls.push('show'),
    focus: () => minimisedCalls.push('focus'),
  };
  if (secondLaunch.bringToFront(minimised) !== true) throw new Error('a minimised window was not brought forward');
  if (minimisedCalls.join(' ') !== 'isMinimized restore show focus') {
    throw new Error('a minimised window is handled as ' + minimisedCalls.join(' '));
  }

  // State 01: a window that is only behind another one is shown and focused, and is
  // not restored again, which would bounce a window that was never minimised.
  const openCalls = [];
  const open = {
    isMinimized: () => false,
    restore: () => openCalls.push('restore'),
    show: () => openCalls.push('show'),
    focus: () => openCalls.push('focus'),
  };
  if (secondLaunch.bringToFront(open) !== true) throw new Error('the open window was not brought forward');
  if (openCalls.join(' ') !== 'show focus') throw new Error('the open window runs ' + openCalls.join(' '));

  // State 03: a window the app has already torn down, or one that is missing, reports
  // that there was nothing to bring forward instead of throwing into a launch that is
  // only there to hand its request over.
  const destroyed = {
    isDestroyed: () => true,
    isMinimized: () => {
      throw new Error('a destroyed window was asked whether it is minimised');
    },
    restore: () => {
      throw new Error('a destroyed window was restored');
    },
    show: () => {
      throw new Error('a destroyed window was shown');
    },
    focus: () => {
      throw new Error('a destroyed window was focused');
    },
  };
  if (secondLaunch.bringToFront(destroyed) !== false) throw new Error('a destroyed window reported itself brought forward');
  if (secondLaunch.bringToFront(null) !== false) throw new Error('a missing window reported itself brought forward');

  // State 04: the second process takes the lock, hands over and leaves, so only the
  // instance that holds the lock ever builds a window.
  const main = read('src/main/main.js');
  if (!main.includes('app.requestSingleInstanceLock()')) {
    throw new Error('main never asks for the single-instance lock');
  }
  if (!main.includes('if (!ownsSingleInstance) app.quit();')) {
    throw new Error('a launch that did not get the lock does not leave');
  }
  // The lock is only worth taking in the real app: a check script boots main.js as an
  // Electron app of its own, and locking it out would fail the checks whenever Zuri is
  // open. This is the same test the taskbar shortcut uses.
  if (!main.includes('ownsSingleInstance = runsAsApp() ?')) {
    throw new Error('the lock is taken even by a check script');
  }

  // The body of one top-level function, ended by its first closing brace: neither of
  // the two read here holds a nested block.
  const bodyOf = (name) => {
    const begins = main.indexOf(name);
    if (begins === -1) throw new Error('main.js has no ' + name);
    const closes = main.indexOf('}', begins);
    if (closes === -1) throw new Error(name + ' is never closed');
    return main.slice(begins, closes);
  };

  const runs = bodyOf('function runsAsApp()');
  if (!runs.includes('app.getAppPath()')) throw new Error('runsAsApp never reads the app path');

  const handover = bodyOf("app.on('second-instance'");
  if (!handover.includes('bringMainWindowForward()')) {
    throw new Error('the second launch does not bring the open window forward');
  }
  if (handover.includes('createMainWindow(')) throw new Error('the second launch builds another window');

  const forward = bodyOf('function bringMainWindowForward()');
  if (!forward.includes('bringToFront(window)')) throw new Error('the window is not brought to the front');
  if (!forward.includes('overlay.html')) {
    throw new Error('the overlay is a candidate, so a second launch would focus it');
  }
  if (forward.includes('reload(') || forward.includes('loadFile(')) {
    throw new Error('bringing the window forward rebuilds the page instead of keeping the thread');
  }

  // The losing launch returns before anything is registered or drawn.
  const readyAt = main.indexOf('app.whenReady()');
  if (readyAt === -1) throw new Error('main never waits for the app to be ready');
  const readyHead = main.slice(readyAt, readyAt + 400);
  const guard = readyHead.indexOf('if (!ownsSingleInstance) return;');
  if (guard === -1) throw new Error('the launch that lost the lock still builds a window');
  const registers = readyHead.indexOf('registerIpc();');
  if (registers !== -1 && guard > registers) throw new Error('the guard arrives after the channels are registered');

  return 'restored then shown then focused; overlay left as it is; the second process hands over and quits';
});
registerInternalOnlyCanvasCheck({ check, read });
registerPageInventoryCheck({ check, read });
registerNotFoundCheck({ check, read });
registerZzProbeCheck({ check, read });
// The Office file read receipt page is drawn from design node 0:5069: one
// 1200 x 800 window whose 720 px thread column holds a 720 x 408 receipt card,
// plus the same card reading, unreadable and capped.
check('office file read receipt page matches node 0:5069', () => {
  const html = read('src/renderer/views/office-file-read-receipt.html');
  const css = read('src/renderer/views/office-file-read-receipt.css');
  const js = read('src/renderer/views/office-file-read-receipt.js');

  // The node's copy, frame by frame. Entities are checked as written so the
  // assertion does not depend on how this file is encoded.
  const copy = [
    'Search chats and files',
    'Act mode &middot; 2 steps &middot; read 14:32',
    'Open the vendor invoices sheet and read the totals before I send it back.',
    'file.read',
    'Read the whole workbook - totals included.',
    'Q3-vendor-invoices.xlsx',
    'read by file.read &middot; Excel workbook &middot; 84 KB &middot; 0.4 s',
    'READ OK',
    '4,182',
    '612',
    '38',
    'ROWS &middot; 8 COLUMNS',
    'READABLE',
    'Read in full - 4,182 of a 120,000 character budget, so no text was cut off.',
    'Reveal in Explorer',
    'Copy path',
    'shell.showItemInFolder',
    // Frame 02, the read still running.
    'STATE &middot; READING FILE',
    // Frame 03, a path that cannot be opened.
    'STATE &middot; PATH UNREADABLE',
    'THAT PATH CANNOT BE OPENED',
    'ENOENT: no such file or directory, open',
    'MISSING',
    'WHAT TO TRY',
    'Choose another file',
    'Retry read',
    // Frame 04, capped at the character budget.
    'STATE &middot; READ TRUNCATED',
    'Q3-sales-ledger.xlsx',
    'CHARACTERS &middot; CAPPED',
    '18,204',
    '9,140',
    'ROWS IN FILE',
  ];
  const missing = copy.filter((text) => !html.includes(text));
  if (missing.length > 0) throw new Error(`the page is missing: ${missing.join(' | ')}`);

  // The success card's own drawing: a success chip, a readable path and the
  // three stat tiles the node labels.
  if (!/class="status-chip status-chip--ok">READ OK</.test(html)) {
    throw new Error('the read frame does not draw the READ OK chip');
  }
  if (!/Q3-vendor-invoices\.xlsx/.test(html) || !/C:.Users.Ava.Documents.Invoices/.test(html)) {
    throw new Error('the read frame does not draw the workbook path');
  }

  // The node's numbers, as the page's own tokens.
  const numbers = [
    '--zrf-topbar-height: 48px;',
    '--zrf-sidebar-width: 260px;',
    '--zrf-column-width: 720px;',
    '--zrf-composer-height: 80px;',
    '--zrf-card-radius: 20px;',
    '--zrf-card-pad: 20px;',
    '--zrf-badge-size: 44px;',
    '--zrf-stat-height: 64px;',
    '--zrf-path-height: 44px;',
    '--zrf-note-height: 52px;',
    '--zrf-button-height: 36px;',
  ];
  const wrongNumbers = numbers.filter((line) => !css.includes(line));
  if (wrongNumbers.length > 0) throw new Error(`the page sheet is missing: ${wrongNumbers.join(', ')}`);

  // One page-scoped palette in both themes, taken from tokens.json.
  const lightStart = css.indexOf(":root,\n:root[data-theme='light'] .receipt-page {");
  const darkStart = css.indexOf(":root[data-theme='dark'] .receipt-page {");
  if (lightStart === -1 || darkStart === -1) throw new Error('the page has no two-theme palette');
  const light = css.slice(lightStart, css.indexOf('}', lightStart));
  const dark = css.slice(darkStart, css.indexOf('}', darkStart));
  for (const [name, lightValue, darkValue] of [
    ['--zrf-page', '#ffffff', '#000000'],
    ['--zrf-canvas', '#fafafa', '#0a0a0b'],
    ['--zrf-surface', '#ffffff', '#18181b'],
    ['--zrf-sunken', '#f4f4f5', '#27272a'],
    ['--zrf-text', '#11181c', '#ecedee'],
    ['--zrf-primary-soft', '#e6f1fe', '#001731'],
  ]) {
    if (!light.includes(`${name}: ${lightValue};`)) throw new Error(`${name} is not ${lightValue} in the light block`);
    if (!dark.includes(`${name}: ${darkValue};`)) throw new Error(`${name} is not ${darkValue} in the dark block`);
  }

  // Four frames, one markup tree: the body's data-state picks which parts draw.
  for (const state of ['read', 'reading', 'unreadable', 'truncated']) {
    if (!css.includes(`body[data-state='${state}']`)) throw new Error(`no rule for the ${state} frame`);
  }
  if (!js.includes("const STATES = ['read', 'reading', 'unreadable', 'truncated'];")) {
    throw new Error('the view does not name the four frames');
  }
  if (!/get\('state'\)/.test(js)) throw new Error('the view ignores ?state=');
  if (!/localStorage\.getItem\('zuri-theme'\)/.test(js)) throw new Error('the view does not remember the theme');

  // A phone keeps the same drawing in one column, the receipt above a composer
  // that clears the tab bar, and nothing scrolls sideways.
  if (!/content="width=device-width, initial-scale=1, viewport-fit=cover"/.test(html)) {
    throw new Error('the page has no phone viewport');
  }
  if (!/height: 100dvh/.test(css)) throw new Error('the page is sized in dvh');
  if (!/env\(safe-area-inset-bottom\)/.test(css)) {
    throw new Error('the phone tab bar does not clear the home indicator');
  }
  if (!/@media \(max-width: 767px\)[\s\S]*?\.tabbar \{[^}]*position: fixed/.test(css)) {
    throw new Error('the phone tab bar is not pinned to the screen');
  }
  if (!/@media \(prefers-reduced-motion: reduce\)/.test(css)) {
    throw new Error('the spinner and skeletons ignore reduced motion');
  }

  return 'four frames, 720 x 408 card on radius 20, 44 px head, 64 px stats, 680 px rows, one page-scoped palette';
});

// The composer input states page is a drawing of design page 0:3242: eight 560 px state
// cards plus the 640 x 680 column the pill lives in, one 528 px pill per card on radius
// 24, and a pill whose height is 62 px of chrome plus 22 px per line - 84, 150, 238 and
// 116 for one line, four lines, the eight-line cap and the attach chip. The page has no
// behaviour of its own, so reading the numbers back is the only way to notice drift.
check('the composer input states page is drawn from node 0:3242', () => {
  const page = read('src/renderer/views/composer-input-states.html');
  const sheet = read('src/renderer/views/composer-input-states.css');

  const states = [
    '01 · ONE LINE',
    '02 · FOUR LINES',
    '03 · EIGHT LINES · SCROLL',
    '04 · DISABLED WHILE STREAMING',
    '05 · MISSING KEY',
    '06 · MODE - ACT',
    '07 · MODE - AUTOPILOT',
    '08 · ATTACH CHIP PRESENT',
  ];
  for (const state of states) {
    if (!page.includes(state)) throw new Error(`the page is missing the ${state} card`);
  }

  const pills = page.split('class="cis-pill').length - 1;
  if (pills !== 8) throw new Error(`the page draws ${pills} pills, not the node's 8`);

  // The pill cannot outgrow the card's 16 px inset, or every number below moves.
  if (!/\.cis-pill \{[^}]*max-width: 528px/.test(sheet)) {
    throw new Error('the pill is not the node\'s 528 px wide');
  }
  if (!/\.cis-card \{[^}]*padding: 14px 16px 16px/.test(sheet)) {
    throw new Error('the card lost its 14 / 16 / 16 inset');
  }

  const sizes = [
    ['the pill\'s 14 / 22 text', /\.cis-text \{[^}]*font-size: 14px[^}]*line-height: 22px/],
    ['the 34 px send button', /\.cis-send \{[^}]*width: 34px[^}]*height: 34px/],
    ['the 28 px mode track on 176 px', /\.cis-modes \{[^}]*width: 176px[^}]*height: 28px/],
    ['the 84 x 28 model chip', /\.cis-model \{[^}]*width: 84px[^}]*height: 28px/],
    ['the 136 x 28 context chip', /\.cis-context \{[^}]*width: 136px[^}]*height: 28px/],
    ['the eight-line 176 px cap', /\.cis-text--capped \{[^}]*height: 176px/],
    ['the 640 x 680 column', /\.cis-chat \{[^}]*max-width: 640px[^}]*height: 680px/],
    ['the pill\'s 24 px corners', /\.cis-pill \{[^}]*border-radius: 24px/],
    ['the card\'s 20 px corners', /\.cis-card \{[^}]*border-radius: 20px/],
    ['the banner\'s 16 px corners', /\.cis-banner \{[^}]*border-radius: 16px/],
  ];
  for (const [label, pattern] of sizes) {
    if (!pattern.test(sheet)) throw new Error(`${label} is missing from the sheet`);
  }

  // The theme is the only thing the module does, and the visual check opens both.
  if (!page.includes('data-theme="light"')) throw new Error('the page has no starting theme');
  const script = read('src/renderer/views/composer-input-states.js');
  if (!script.includes("get('theme')")) throw new Error('the module ignores ?theme=');

  return '8 state cards and the column, at the node\'s own numbers, in both themes';
});

registerSearchResultsPanelCheck({ check, read });
check('the web research answer page is drawn from node 0:5525', () => {
  const page = read('src/renderer/views/web-research-answer.html');
  const sheet = read('src/renderer/views/web-research-answer.css');

  // Frame 0:5526 is the answer at rest; the states column (0:5702) draws the other
  // five, and this one tree paints them from ?state=.
  const states = ['answer', 'searching', 'streaming', 'empty', 'failed', 'saved'];
  for (const state of states) {
    if (!page.includes(`data-wra-state="${state}"`)) {
      throw new Error(`the page is missing the ${state} block`);
    }
  }

  // The window the node draws: 1200 x 900, a 48 px bar, a 260 px sidebar, and the
  // 699 px column on a 16 px gap with a 96 px composer area under it.
  const sizes = [
    ['the 48 px top bar', /\.wra-topbar \{[^}]*height: 48px/],
    ['the 224 x 32 search pill', /\.wra-search \{[^}]*width: 224px[^}]*height: 32px/],
    ['the 260 px sidebar', /\.wra-sidebar \{[^}]*width: 260px/],
    ['the 236 x 36 new-chat button', /\.wra-new-chat \{[^}]*height: 36px/],
    ['the 236 x 44 profile row', /\.wra-profile \{[^}]*height: 44px/],
    ['the 56 px chat header', /\.wra-chat-header \{[^}]*height: 56px/],
    ['the 699 px answer column', /\.wra-conversation \{[^}]*max-width: 699px/],
    ['the 16 px column gap', /\.wra-state \{[^}]*gap: 16px/],
    ['the 520 px question bubble', /\.wra-bubble \{[^}]*width: 520px/],
    ['the bubble\'s 20 px corners', /\.wra-bubble \{[^}]*border-radius: 20px/],
    ['the 22 px answer header', /\.wra-answer-header \{[^}]*height: 22px/],
    ['the 20 px sources badge', /\.wra-badge \{[^}]*height: 20px/],
    ['the source list on radius 20', /\.wra-sources \{[^}]*border-radius: 20px/],
    ['the 52 px source row', /\.wra-source \{[^}]*height: 52px/],
    ['the 24 px source number', /\.wra-source-number \{[^}]*width: 24px[^}]*height: 24px/],
    ['the 72 x 28 open button', /\.wra-source-open \{[^}]*width: 72px[^}]*height: 28px/],
    ['the 36 px action row', /\.wra-actions \{[^}]*height: 36px/],
    ['the 699 x 56 composer', /\.wra-composer \{[^}]*max-width: 699px[^}]*height: 56px/],
    ['the composer\'s 24 px corners', /\.wra-composer \{[^}]*border-radius: 24px/],
    ['the 32 px send button', /\.wra-send \{[^}]*width: 32px[^}]*height: 32px/],
  ];
  for (const [label, pattern] of sizes) {
    if (!pattern.test(sheet)) throw new Error(`${label} is missing from the sheet`);
  }

  // The four rows of state 01, and the numbers each of the other states is drawn at.
  const rows = page.split('class="wra-source"').length - 1;
  if (rows !== 4) throw new Error(`the answer lists ${rows} sources, not the node's 4`);

  const stateSizes = [
    ['the 44 px skeleton row', /\.wra-skeleton-row \{[^}]*height: 44px/],
    ['the 4 px progress track', /\.wra-progress-track \{[^}]*height: 4px/],
    ['the 62% progress fill', /\.wra-progress-fill \{[^}]*width: 62%/],
    ['the 40 px empty disc', /\.wra-empty-icon \{[^}]*width: 40px[^}]*height: 40px/],
    ['the 68 px danger callout', /\.wra-callout \{[^}]*height: 68px/],
    ['the 40 px failed row', /\.wra-failed-row \{[^}]*height: 40px/],
    ['the 66 px success toast', /\.wra-toast \{[^}]*min-height: 66px/],
  ];
  for (const [label, pattern] of stateSizes) {
    if (!pattern.test(sheet)) throw new Error(`${label} is missing from the sheet`);
  }

  // The app fills the window and nothing scrolls sideways: the page is 100dvh tall,
  // and below 768 px the sidebar's destinations are the fixed tab bar, which reserves
  // its own height plus the safe area so the composer stays clear of it.
  if (!/\.wra-page \{[^}]*min-height: 100dvh/.test(sheet)) {
    throw new Error('the page does not fill the window height');
  }
  if (!sheet.includes('@media (max-width: 767px)')) throw new Error('the sheet has no phone layout');
  if (!/\.wra-tabbar \{[^}]*display: flex[^}]*position: fixed[^}]*bottom: 0/.test(sheet)) {
    throw new Error('the phone layout does not pin the tab bar to the bottom');
  }
  if (!/\.wra-page \{[^}]*padding-bottom: calc\(56px \+ env\(safe-area-inset-bottom\)\)/.test(sheet)) {
    throw new Error('the phone layout does not clear the tab bar and the safe area');
  }
  const tabs = (page.match(/class="wra-tab(?: wra-tab--active)?"/g) || []).length;
  if (tabs !== 4) throw new Error(`the tab bar draws ${tabs} destinations, not 4`);

  // The theme and the block are the module's whole job, and the visual check opens
  // both themes and every state.
  if (!page.includes('data-theme="light"')) throw new Error('the page has no starting theme');
  const script = read('src/renderer/views/web-research-answer.js');
  if (!script.includes("get('theme')")) throw new Error('the module ignores ?theme=');
  if (!script.includes("get('state')")) throw new Error('the module ignores ?state=');

  return '1200x900: 48 top bar, 260 sidebar, 699 column on a 16 gap, 520 bubble, four 52 source rows on radius 20, 96 composer, and the searching, streaming, empty, failed and saved blocks, light and dark, plus the 390 tab bar';
});

registerErrorStateCheck({ check, read });
registerAskModeReplyCheck({ check, read });
registerChatWorkspaceCheck({ check, read });
registerFloatingOverlayCheck({ check, read });
registerExcludedScreensCheck({ check, read });
registerButtonSolidPrimarySmCheck({ check, read });
registerCardFileCheck({ check, read });
registerInputSearchCheck({ check, read });
registerInputSelectCheck({ check, read });
// Input / Text Field is the open-pencil component 0:44: a 320 x 40 box on radius 12, a
// 16 x 16 glyph 12 px in, and the value 8 px after it on its 256 px box.
registerInputTextFieldCheck({ check, read });
registerActionIconGroupCheck({ check, read });
// Toast / Success is the open-pencil component 0:425: a 432 x 40 strip on radius
// 12, 12 px padding, a 16 px #10A37F check at 1.33, 13 over 16 white, a 14 px
// close at 1.17, and the close box held at the trailing edge the node's parts make.
registerToastSuccessCheck({ check, read });

registerCaughtUpToastCheck({ check, read });
registerActModeProposalCheck({ check, read });
registerProvidersCheck({ check, read });
registerSettingsAppearanceCheck({ check, read });
registerComposerPromptCheck({ check, read });
import { registerCardBaseCheck } from './card-base.check.js';
registerCardBaseCheck({ check, read });
// Control / Radio On is the open-pencil component 0:390: a 20 x 20 ring with a
// 2 px stroke drawn inside, ink #0D0D0D, and its 14 over 17 label 10 px later.
registerControlRadioOnCheck({ check, read });
// Clean up before the summary so a leftover temp folder cannot outlive the run.
for (const directory of tempRoots) {
  fs.rmSync(directory, { recursive: true, force: true });
}
// The Act confirmation dialog (design node 0:4813): the five frames, the card's
// numbers, the gate that holds a destructive call until Confirm or Cancel, and the
// reason a refused app or URL shows.
import { registerActConfirmationDialogCheck } from './act-confirmation-dialog.check.js';
await registerActConfirmationDialogCheck({ check, checkAsync, read });
// The Delete confirmation dialog (design node 0:14247): one card asks before a task,
// a reminder, an automation or an agent is removed, and its Delete stays down until
// the write lands. The gate is driven with a stub DOM, so "asks first" and "disabled
// in flight" are pressed rather than read.
import { registerDeleteConfirmationDialogCheck } from './delete-confirmation-dialog.check.js';
await registerDeleteConfirmationDialogCheck({ check, checkAsync, read });
// The Automations view: creating, editing and deleting a schedule from the page it
// is listed on. The store half runs against a throwaway directory and the view half
// presses the form, the row's Edit and its Delete with a stub DOM.
import { registerAutomationsViewCheck } from './automations-view.check.js';
await registerAutomationsViewCheck({ check, checkAsync, read });
// Navigation / Mode Tab is the open-pencil component 0:104843 (at rest) with its
// twin 0:104839 (the tab in use): a 220 x 36 row on cornerRadius 12, a 16 px icon
// 12 px in and its 14 over 20 label 8 px later, subtle ink at rest and the surface
// fill in use.
import { registerModeTabCheck } from './mode-tab.check.js';
registerModeTabCheck({ check, read });
// Navigation / Mode Tab Autopilot is the open-pencil component 0:104847, the third
// row of the Mode Switcher: the same 220 x 36 rest row, drawn with the repeat glyph
// as three stroked paths at the node's 1.3333 stroke inside the 16 px frame.
import { registerModeTabAutopilotCheck } from './mode-tab-autopilot.check.js';
registerModeTabAutopilotCheck({ check, read });
// Message / User is the open-pencil component 0:366 (drawn as "Msg User",
// 0:367): a 656 x 68 row holding a 300 x 68 bubble on cornerRadius 18 whose
// text is inset 16 by 12 on 15 over 22, then 12 px and a 44 x 44 avatar on 999.
import { registerMessageUserCheck } from './message-user.check.js';
registerMessageUserCheck({ check, read });
// Navigation / Breadcrumb is the open-pencil component 0:208: one 40 px trail
// row, its labels 14 over 20 at y 12, a 14 x 14 chevron 10 px after the parent
// and 8 px before the page in view, stroked at the node's 1.1667.
import { registerBreadcrumbCheck } from './breadcrumb.check.js';
registerBreadcrumbCheck({ check, read });
// Navigation / Nav Item is the open-pencil component 0:104862, the nav row at
// rest, with its twin 0:104855, the row in use: a 44 px row on cornerRadius 12,
// an 18 x 18 icon 12 px in at a 1.5 stroke and its 14 over 20 label 12 px after
// that, on the subtle ink at rest and the text tone in use.
import { registerNavItemCheck } from './nav-item.check.js';
registerNavItemCheck({ check, read });
// Control / Checkbox On is the open-pencil component 0:433: a 20 x 20 box on
// cornerRadius 4 filled #0D0D0D, its 13 x 13 check frame 4 px in, stroked #FFFFFF
// at 1.0833 on the node's own path.
registerControlCheckboxOnCheck({ check, read });
// Navigation / Mode Tab Active is the open-pencil component 0:104839: the same 220 x 36
// row as 0:104843 with the surface fill bound and the text tone for its ink, so the
// state is a colour step on one drawing and no other number moves.
import { registerModeTabActiveCheck } from './mode-tab-active.check.js';
registerModeTabActiveCheck({ check, read });
// Navigation / Nav Item Active is the open-pencil node 0:494 ("Nav / Tasks"), the
// row drawn in the primary nav: 75 x 36 on cornerRadius 8, a 15 x 15 icon 8 px in
// at a 1.25 stroke, its 13 over 16 label at x 31, surface-secondary on text-subtle
// at rest and surface-tertiary on the text tone at weight 500 in use.
import { registerNavItemActiveCheck } from './nav-item-active.check.js';
registerNavItemActiveCheck({ check, read });
// Navigation / Nav Item History is the open-pencil component 0:175: the 228 x 44
// nav row on cornerRadius 12 that opens the activity history, its 18 x 18 glyph
// frame 0:176 stroked at 1.5 and its label 0:179 at x 42 on a 14 / 20 line, on the
// subtle ink and truncated ENDING at one line.
import { registerNavItemHistoryCheck } from './nav-item-history.check.js';
registerNavItemHistoryCheck({ check, read });
// Navigation / Nav Item Files is the open-pencil component 0:170 (glyph frame 0:171,
// paths 0:172 and 0:173, label 0:174 "Office files"): the same 228 x 44 row on
// cornerRadius 12, drawn with the spreadsheet glyph, its label truncating at the
// node's 174 px, text-subtle on no fill at rest.
import { registerNavItemFilesCheck } from './nav-item-files.check.js';
registerNavItemFilesCheck({ check, read });
// Overlay / Compact is the open-pencil component 0:249: a 320 x 68 bar on
// cornerRadius 20, filled on variable glass-surface and stroked 1 px inside on
// glass-border, a 44 x 44 ring at the 12 px inset holding a 20 x 20 glyph stroked
// at 1.6667, the 184 px text block 12 px later (title 14 / 17 at weight 500 over
// meta 12 / 15 at weight 400, both one line ENDING), and a 44 x 44 stop on its
// 12 px corner with a 16 x 16 glyph at 1.3333, 12 px from the right edge.
import { registerOverlayCompactCheck } from './overlay-compact.check.js';
registerOverlayCompactCheck({ check, read });
// State / Loading is the open-pencil component 0:279: a 320 x 240 card on
// cornerRadius 20 holding a 44 px spinner (0:280, its glyph 0:282 at 1.6667),
// the title 14 / 20, the step 13 in a 15 px box, and a 200 x 4 track filled
// 100 px, on surface-secondary in both collections.
import { registerStateLoadingCheck } from './state-loading.check.js';
registerStateLoadingCheck({ check, read });
// State / Skeleton Row is the open-pencil component 0:296: a 320 x 159 block on cornerRadius 20 filled on
// surface-secondary with a 13 / 15 caption on text-subtle, then two 280 x 40 rows of a 40 x 40 disc beside a
// wide 228 x 12 pill and a narrow one at 140 and 120, all three on radius 999 and surface-tertiary.
import { registerSkeletonRowCheck } from './skeleton-row.check.js';
registerSkeletonRowCheck({ check, read });
// Navigation / Top Bar is the open-pencil component 0:189, the bar that heads a
// surface: 1052 x 56 on color/surface with a radius-lg 14 corner and 20 px insets,
// a 16/24 semibold title, a spacer, two 44 px radius 12 controls 6 px apart, then a
// 96 x 36 primary action. The component's own rules are checked above; this check
// keeps the specimen page (views/top-bar.html) measuring that drawing instead of
// restating it.
import { registerNavTopBarCheck } from './nav-top-bar.check.js';
registerNavTopBarCheck({ check, read });
// State / Empty is the open-pencil component 0:271: a 320 x 240 card on
// cornerRadius 20 on the surface-secondary fill, a 48 px surface circle holding a
// 22 px calendar-plus stroked at 1.8333, a 16 / 24 title, a 14 / 22 body over 272
// and a 111 x 36 action on cornerRadius 12 with its 14 / 20 label 16 px in.
import { registerStateEmptyCheck } from './state-empty.check.js';
registerStateEmptyCheck({ check, read });
// Navigation / Sidebar is the open-pencil component 0:129: the whole 260 x 560
// column on cornerRadius 20, its brand row 0:130, mode switcher 0:141, nav
// section 0:156 and account row 0:180, every child inset 16 and the blocks 24
// apart, composed from the mode rows and nav rows this project already draws.
import { registerNavSidebarCheck } from './nav-sidebar.check.js';
registerNavSidebarCheck({ check, read });
// Input / Text Field Error is the open-pencil component 0:67: the plain field's 320 x 40
// box with its 1 px stroke on color/danger, a 14 / 22 value wrapping on its 256 px box,
// and 8 px under it a 320 x 20 error line on 13 / 20 in color/danger-soft-foreground.
import { registerInputTextFieldErrorCheck } from './input-text-field-error.check.js';
registerInputTextFieldErrorCheck({ check, read });
// The agent picker in the composer is the open-pencil design page 0:9468 with its three
// frames: 01 the picker open over a 640 x 688 chat slice (0:9469), 02 the picker with no
// agents (0:9530) and 03 the picker locked while a reply streams (0:9554). The picker is
// a 360 x 368 card on cornerRadius 20 with 64 px rows 8 px in from its edges, and the
// composer under it is a 592 x 104 pill on radius 24.
import { registerAgentPickerCheck } from './agent-picker.check.js';
registerAgentPickerCheck({ check, read });
// State / Error is the open-pencil component 0:287: a 320 x 240 card on cornerRadius 20 filled
// on the danger-soft token, a 48 px surface disc around the node's 22 px circle-alert mark, a
// 16 / 24 semibold title, a 14 / 22 body over a 272 px measure, and a 69 x 36 surface action on
// cornerRadius 12 with its 14 / 20 label 16 px in. The card is drawn once, in
// styles/components.css, because the chat column already mounts it; this check keeps that sheet
// on the node's numbers and the specimen page (views/state-error.html) on the drawing.
import { registerStateErrorCheck } from './state-error.check.js';
registerStateErrorCheck({ check, read });
// Right context panel is the design page 0:10776: the 320 x 752 column (0:10786) on
// cornerRadius 24 over three cards 288 wide on cornerRadius 20 - 286 / 180 / 144 tall -
// with a 36 header and a 12 / 16 hint, then the five further states it draws, the last
// of which is a 56 px rail.
import { registerRightContextPanelCheck } from './right-context-panel.check.js';
registerRightContextPanelCheck({ check, read });
// Navigation / Tab Row is the open-pencil component 0:200: one 1052 x 44 row on
// cornerRadius 14 filled on the surface variable, three 98 x 44 tabs 24 px apart,
// each label on a 14 over 20 line 14 px down, and the tab in use carrying a 2 px
// primary rule (0:203, 59 x 2 at (20, 32)) under its label. The component's own
// rules are checked above; this check keeps the specimen page (views/tab-row.html)
// measuring that drawing instead of restating it.
import { registerTabRowCheck } from './tab-row.check.js';
registerTabRowCheck({ check, read });
// Card / Stat is the open-pencil component 0:97: a 320 x 140 card on cornerRadius
// 20 (bound radius-xl), filled surface-secondary and stroked 1 px inside on
// border-subtle, a 20 px inset leaving a 280 px column, the caps label 0:98 at
// y 20 on an 11 / 16 line at weight 600 with 0.66 px tracking, the value 0:99 at
// y 44 on a 28 / 36 line at weight 600 with -0.56 px, and the delta row 0:100 at
// y 96: a 14 x 14 glyph at y 3, its two paths 0:102 and 0:103 stroked 0.875 in
// success, with the movement 0:104 8 px later on a 13 / 20 line.
import { registerCardStatCheck } from './card-stat.check.js';
registerCardStatCheck({ check, read });
// Zuri AI Brand is the brand page: the card names open-pencil node 0:91810, which the
// design file no longer holds, so the page is measured from the brand rows it does
// carry - 0:130 the 228 x 44 sidebar brand row (44 px mark on cornerRadius 12, glyph 18
// inset 13, the name 12 px after it at 16 / 24 over 13 / 20), 0:469 / 0:470 the shell's
// 32 px mark on cornerRadius 10, and the 64 px icon tile on cornerRadius 20 - plus the
// design file's colour collection for the palette.
import { registerZuriAiBrandCheck } from './zuri-ai-brand.check.js';
registerZuriAiBrandCheck({ check, read });
// The Autopilot live run view is the open-pencil design page 0:12447: the run drawn
// once in full (01, 1200 x 800, 248 px sidebar beside a 912 px main column) and five
// 640 px panels for the other states of the same run, reached at /automations/run/:id.
import { registerLiveRunCheck } from './live-run.check.js';
registerLiveRunCheck({ check, read });
// The Design System sheet is the open-pencil page 0:3, frame "Design System /
// Foundation" (0:4): 1440 x 3148, 32 of padding and 32 between nine blocks 1376
// wide on cornerRadius 16. Eight of the nine carry an index pill (01 / 08 to
// 08 / 08) at 21 tall on the full radius; the masthead (0:316) carries none and
// is the one block on radius 20. Every block is 24 + 28 header + 16 + row + 24,
// and the rows sit on three tracks only: 224 in Buttons, 336 in Inputs, Cards and
// States, 448 in Controls. The check reads those numbers out of the page's own
// --ds-* block rather than restating them.
import { registerDesignSystemCheck } from './design-system.check.js';
registerDesignSystemCheck({ check, read });
// Menu / Item is the open-pencil component 0:396: a 15 x 15 glyph at a 1.25 stroke,
// drawn in row 0:395 (432 x 32 on cornerRadius 8, the glyph 10 px in, a 10 px gap
// and a 13 over 16 label 12 px off the end) inside the menu surface 0:394 (432 x
// 108 on cornerRadius 12). The row rules live in styles/components.css; this check
// keeps them and the specimen page (views/menu-item.html) on that drawing.
import { registerMenuItemCheck } from './menu-item.check.js';
registerMenuItemCheck({ check, read });
// The Act step list as a turn in the chat workspace (ui/actStepList.js): the strip
// draws only for a turn sent in Act, keeps the five states on its rows, asks Confirm
// on a destructive call, and carries Cancel all, which stops the rest of the run.
import { registerActModeStepListCheck } from './act-mode-step-list-binding.check.js';
await registerActModeStepListCheck({ check, checkAsync, read });
// Control / Switch On is the open-pencil component 0:386, drawn in the design
// system's controls block (0:373): a 44 x 24 trough on cornerRadius 999 filled
// #0D0D0D, a 20 x 20 white knob inset 2 px running 20 px to the trailing edge,
// and a 14 over 17 label 12 px after the trough.
import { registerControlSwitchOnCheck } from './control-switch-on.check.js';
registerControlSwitchOnCheck({ check, read });

// The Task dashboard page (card page-task-dashboard): /tasks is the drawn tasks
// screen, its filters split on done, and every row carries due, priority and
// status. The surface is views/tasks.js, drawn by the page and the shell alike.
import { registerTaskDashboardPageCheck } from './page-task-dashboard.check.js';
registerTaskDashboardPageCheck({ check, read });

// The Context panel (card context-panel): the one surface showing four stores at
// once - active tasks, next reminders, automation progress and the files Act
// saved. ui/contextPanel.js fills every card from the `window.zuri` bridge, one
// `state:changed` push re-reads all of them, and the column's single toggle hides
// the body rather than emptying it.
import { registerContextPanelCheck } from './context-panel.check.js';
await registerContextPanelCheck({ check, checkAsync, read });

// The scheduler (card scheduler-runs): one tick every thirty seconds takes the
// automations that are due and runs each through the same tool layer Act uses -
// a row in runs.json before the first step and another when the last one ends,
// the result saved in the workspace, a notification in the bell, and a follow-up
// reminder whenever a result needs attention.
import { registerSchedulerRunsCheck } from './scheduler-runs.check.js';
await registerSchedulerRunsCheck({ check, checkAsync, read });

// The launch catch-up (card catch-up-runs): a schedule whose last run is a whole
// cadence behind the clock is replayed once before the first tick, the run writes its
// own lastRunAt so a second launch runs nothing, and the count reaches the renderer as
// the "Caught up N runs" toast over the composer.
import { registerCatchUpRunsCheck } from './catch-up-runs.check.js';
await registerCatchUpRunsCheck({ check, checkAsync, read });

// Packaging (card package-windows-build): the `build` block in package.json is the
// boundary of what `npm run dist` ships, and the store and workspace must keep
// resolving through app.getPath('userData') so the installed app writes to
// %APPDATA%\\Zuri rather than beside the exe.
import { registerWindowsBuildCheck } from './windows-build.check.js';
registerWindowsBuildCheck({ check, read, exists });
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
