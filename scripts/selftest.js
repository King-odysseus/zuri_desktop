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

  // One toggle per column, pointed at the column it controls.
  const withoutToggle = ['sidebar', 'chat', 'context-panel'].filter(
    (name) => !html.includes(`aria-controls="${name}"`),
  );
  if (withoutToggle.length > 0) throw new Error(`no collapse toggle for ${withoutToggle.join(', ')}`);

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

check('ui/shell.js owns the collapse state and the 1000px breakpoint', () => {
  const source = read('src/renderer/ui/shell.js');
  if (!/export function setColumnCollapsed/.test(source)) {
    throw new Error('shell.js does not export setColumnCollapsed');
  }
  if (!/CONTEXT_PANEL_BREAKPOINT\s*=\s*1000/.test(source)) {
    throw new Error('shell.js does not keep the context panel breakpoint at 1000px');
  }
  if (/addEventListener\('resize'/.test(source)) {
    throw new Error('shell.js listens for resize, so a resize would overwrite the user\'s choice');
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
  if (!/replaceChildren\(createLoadingSkeleton\(/.test(chats)) {
    throw new Error('the thread list never shows the block');
  }
  // The block has to go up before the read is awaited, or the panel stays blank
  // until the data lands and the skeleton is never seen.
  const shownAt = chats.indexOf('showSidebarSkeleton();');
  const readAt = chats.indexOf('await call(() => api.list())');
  if (shownAt === -1 || readAt === -1 || shownAt > readAt) {
    throw new Error('the thread list does not show the block while the read is in flight');
  }

  return '320x159 card, caption and two 40 px rows, pills 228/140 then 228/120, shown while chats load';
});

check('the Card / Default is drawn from node 0:54', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 320 x 132 card on 16 px padding and an 8 px rhythm, filled
  // color/surface and outlined 1 px color/border on radius/card. Each value is the
  // token the node binds, so a change in the design moves the card with it.
  const card = ruleBody('.card');
  const cardChecks = [
    ['the 320 px node width', /max-width:\s*320px/],
    ['the 16 px node padding', /padding:\s*var\(--zuri-space-4\)/],
    ['the 8 px rhythm as the spacing token', /gap:\s*var\(--zuri-space-2\)/],
    ['the color/surface fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/border outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
    ['the radius/card corner', /border-radius:\s*var\(--zuri-radius-card\)/],
  ];
  const cardMissing = cardChecks.filter(([, pattern]) => !pattern.test(card)).map(([label]) => label);
  if (cardMissing.length > 0) throw new Error(`the card is missing ${cardMissing.join(', ')}`);

  // The node draws no shadow, so the 1 px outline is the whole edge.
  if (/box-shadow/.test(card)) throw new Error('the card draws a shadow the node does not have');

  // 132 px is the node's sample copy, not a frame: a fixed height would clip the
  // longer bodies the card is meant to hold.
  if (/(?:^|[\s;])height:/.test(card)) throw new Error('the card fixes the node\'s sample height');

  // Every design value has to come from the token layer, or a node change would
  // leave the card on the old colour or corner.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(card)) {
    throw new Error('the card rule holds a literal colour instead of a token');
  }

  // Title: the node's 16/24 medium step on color/text.
  const title = ruleBody('.card-title');
  const titleChecks = [
    ['the 16 px title size', /font-size:\s*var\(--zuri-font-size-heading-sm\)/],
    ['the 24 px title line height', /line-height:\s*var\(--zuri-line-height-heading-sm\)/],
    ['the medium title weight', /font-weight:\s*var\(--zuri-font-weight-medium\)/],
    ['the color/text title colour', /color:\s*var\(--zuri-text-primary\)/],
  ];
  const titleMissing = titleChecks.filter(([, pattern]) => !pattern.test(title)).map(([label]) => label);
  if (titleMissing.length > 0) throw new Error(`the title is missing ${titleMissing.join(', ')}`);

  // Body: the node's 14/22 regular step on color/text, filling the 288 px measure
  // the 16 px padding leaves rather than a width of its own.
  const body = ruleBody('.card-text');
  const bodyChecks = [
    ['the 14 px body size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the 22 px body line height', /line-height:\s*var\(--zuri-line-height-body-md\)/],
    ['the regular body weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/text body colour', /color:\s*var\(--zuri-text-primary\)/],
    ['the full measure', /width:\s*100%/],
  ];
  const bodyMissing = bodyChecks.filter(([, pattern]) => !pattern.test(body)).map(([label]) => label);
  if (bodyMissing.length > 0) throw new Error(`the body is missing ${bodyMissing.join(', ')}`);

  // Meta: the node's 12/16 regular step on color/muted, one step back from the body.
  const meta = ruleBody('.card-meta');
  const metaChecks = [
    ['the 12 px meta size', /font-size:\s*var\(--zuri-font-size-caption\)/],
    ['the 16 px meta line height', /line-height:\s*var\(--zuri-line-height-caption\)/],
    ['the regular meta weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/muted meta colour', /color:\s*var\(--zuri-text-muted\)/],
  ];
  const metaMissing = metaChecks.filter(([, pattern]) => !pattern.test(meta)).map(([label]) => label);
  if (metaMissing.length > 0) throw new Error(`the meta line is missing ${metaMissing.join(', ')}`);

  return '320 px card, 16 px padding on an 8 px rhythm, radius 10, 16/24 title, 14/22 body, 12/16 muted meta';
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

  // The node's Title, Body and Meta are the same type steps as Card / Default's, so
  // they reuse those classes. A second set would be a copy that drifts.
  const duplicates = ['card-raised-title', 'card-raised-text', 'card-raised-meta'].filter((name) =>
    css.includes(`.${name} {`),
  );
  if (duplicates.length > 0) {
    throw new Error(`the raised card copies ${duplicates.join(', ')} instead of reusing the card classes`);
  }

  return '320 px card, 16 px padding on an 8 px rhythm, radius 10, color/raised fill, 1 px hairline outline, node drop shadow';
});

check('the Button / Danger is drawn from node 0:12', () => {
  const css = read('src/renderer/styles/components.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 72 x 32 on color/background and radius/row, with a 13 px regular
  // label on color/danger and 16 px of side padding. Its 72 px width is the label
  // plus that padding, so the rule states the padding and lets the label size it.
  const button = ruleBody('.btn-danger');
  const buttonChecks = [
    ['the 32 px node height', /height:\s*32px/],
    ['16 px of side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/danger label', /color:\s*var\(--zuri-danger\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
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

  const disabled = ruleBody('.btn-danger:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error('disabled is not the guide\'s 40% opacity');

  // Drawn once, consumed by the app: the Settings view's destructive action is it.
  if (!/class="btn-danger"/.test(html)) throw new Error('the Settings view does not use the button');
  if (!/<button[^>]*class="btn-danger"[^>]*id="provider-key-remove"/.test(html)) {
    throw new Error('the button is not on the Remove key control');
  }

  return '32 px tall, 16 px padding, radius 8, surface fill, danger label at 13 px';
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

check('the Button / Secondary is drawn from node 0:8', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 75 x 32 on color/background and radius/row, outlined 1 px
  // color/border, with a 13 px regular "Cancel" label on color/text inset 16 px
  // from the sides. Its 75 px width is that label (43 px) plus the padding, so the
  // rule states the padding and lets the label size the button.
  const button = ruleBody('.btn-secondary');
  const buttonChecks = [
    ['the 32 px node height', /height:\s*32px/],
    ['the 16 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-4\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/text label', /color:\s*var\(--zuri-text-primary\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the secondary button is missing ${buttonMissing.join(', ')}`);

  // This is the family's one outlined variant: 1 px of color/border. The outline
  // has to stay that weight and that token, or the control either loses the edge
  // the node draws or grows a second, stronger one.
  if (!/border:\s*1px solid var\(--zuri-border-hairline\)/.test(button)) {
    throw new Error('the secondary button is not the node\'s 1 px color/border outline');
  }

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the secondary button rule holds a literal colour instead of a token');
  }

  // Hover is the guide's subtle surface darken plus an edge that strengthens; the
  // label is already the primary text step, so it does not move. Focus and
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

  return '32 px tall, 16 px padding, radius 8, surface fill, 1 px hairline outline, primary label at 13 px';
});

check('the Button / Small is drawn from node 0:16', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is 79 x 28 on color/background and radius/row, outlined 1 px
  // color/border, with a 13 px regular "Add task" label on color/text inset 12 px
  // from the sides. Its 79 px width is that label (55 px) plus the padding, so the
  // rule states the padding and lets the label size the button.
  const button = ruleBody('.btn-small');
  const buttonChecks = [
    ['the 28 px node height', /height:\s*28px/],
    ['the 12 px side padding as the spacing token', /padding:\s*0 var\(--zuri-space-3\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/text label', /color:\s*var\(--zuri-text-primary\)/],
    ['the 13 px label size', /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the regular label weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
  ];
  const buttonMissing = buttonChecks.filter(([, pattern]) => !pattern.test(button)).map(([label]) => label);
  if (buttonMissing.length > 0) throw new Error(`the small button is missing ${buttonMissing.join(', ')}`);

  // The node draws one 1 px color/border outline on the inside edge. The outline
  // has to stay that weight and that token, or the control loses the edge the node
  // draws or grows a second, stronger one.
  if (!/border:\s*1px solid var\(--zuri-border-hairline\)/.test(button)) {
    throw new Error("the small button is not the node's 1 px color/border outline");
  }

  // Every value has to come from the token layer, or a theme swap would leave the
  // control on one theme's colour.
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(button)) {
    throw new Error('the small button rule holds a literal colour instead of a token');
  }

  // Hover is the guide's subtle surface darken plus an edge that strengthens; the
  // label is already the primary text step, so it does not move. Focus and
  // disabled follow the rest of the family.
  const hover = ruleBody('.btn-small:hover:not(:disabled)');
  if (!/background:\s*var\(--zuri-surface-sunken\)/.test(hover)) {
    throw new Error("hover is not the guide's subtle surface darken");
  }
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(hover)) {
    throw new Error('the outline does not strengthen on hover');
  }
  // The label must not move: match a standalone `color:` only, since the outline's
  // `border-color:` shares the prefix.
  if (/(?:^|[\s;])color:/.test(hover)) throw new Error('the small button moves its label on hover');

  const focus = ruleBody('.btn-small:focus-visible');
  if (!/outline:\s*2px solid var\(--zuri-accent\)/.test(focus)) {
    throw new Error('focus is not the accent outline');
  }

  const disabled = ruleBody('.btn-small:disabled');
  if (!/opacity:\s*0\.4/.test(disabled)) throw new Error("disabled is not the guide's 40% opacity");

  return '28 px tall, 12 px padding, radius 8, surface fill, 1 px hairline outline, primary label at 13 px';
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

check('the Input / Text is drawn from node 0:23', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is a 320 px column at an 8 px gap: a 13/18 medium label on color/muted
  // over a 320 x 36 field. The field binds color/background, color/border and
  // radius/row, insets its 14/22 text 12 px from the sides, and its placeholder is
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
    ['the 36 px node height', /height:\s*36px/],
    ['the 12 px text inset as the spacing token', /padding:\s*0 var\(--zuri-space-3\)/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/border outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
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
  // strengthen the edge, keyboard focus adds the ring, disabled dims.
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(ruleBody('.field-input:hover:not(:disabled)'))) {
    throw new Error('the field does not strengthen its edge on hover');
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

  return '320 px stack, 36 px field, radius 8, surface fill, 1 px hairline, muted label at 13/18';
});

check('the Input / Textarea is drawn from node 0:27', () => {
  const css = read('src/renderer/styles/components.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is Input / Text (0:23) with one property changed: the Field is 320 x
  // 88 instead of 320 x 36, so the value can wrap. It binds the same three values
  // (color/background, color/border, radius/row) and keeps the 14/22 value in
  // color/text, but insets it 12 px on all four sides instead of centring one row.
  const textarea = ruleBody('.field-textarea');
  const checks = [
    ['the 12 px inset on every side as the spacing token', /padding:\s*var\(--zuri-space-3\)/],
    ["the node's 88 px resting height", /min-height:\s*88px/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/border edge', /border:\s*1px solid var\(--zuri-border-hairline\)/],
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
  // family: hover and caret-focus strengthen the edge, keyboard focus rings, and a
  // disabled field dims to the family's 40%.
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(ruleBody('.field-textarea:hover:not(:disabled)'))) {
    throw new Error('the textarea does not strengthen its edge on hover');
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

  return '320 px stack, 88 px field, radius 8, surface fill, 1 px hairline, 12 px inset, 14/22 value';
});

check('the Select / Default is drawn from node 0:37', () => {
  const css = read('src/renderer/styles/components.css');
  const html = read('src/renderer/views/settings.html');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // The node is Input / Text (0:23) with a chevron and a narrower column: a
  // 13/18 medium Label on color/muted over a 280 x 36 Field, a 14/22 Value on
  // color/text inset 12 px, and a 16 x 16 Icon / chevron-down on color/muted.
  if (!/max-width:\s*280px/.test(ruleBody('.select'))) {
    throw new Error("the select column is not the node's 280 px");
  }

  const field = ruleBody('.select-field');
  const fieldChecks = [
    ['the node\'s 36 px field height', /height:\s*36px/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['the color/background fill', /background:\s*var\(--zuri-surface\)/],
    ['the color/border outline', /border:\s*1px solid var\(--zuri-border-hairline\)/],
  ];
  const fieldMissing = fieldChecks.filter(([, pattern]) => !pattern.test(field)).map(([name]) => name);
  if (fieldMissing.length > 0) throw new Error(`the select field is missing ${fieldMissing.join(', ')}`);

  const control = ruleBody('.select-control');
  const controlChecks = [
    ['the color/text value', /color:\s*var\(--zuri-text-primary\)/],
    ['the 14 px value size', /font-size:\s*var\(--zuri-font-size-body-md\)/],
    ['the 22 px value line height', /line-height:\s*var\(--zuri-line-height-body-md\)/],
    ['the 12 px value inset as the spacing token', /0 var\(--zuri-space-3\);/],
    ['the browser arrow the node does not draw', /appearance:\s*none/],
  ];
  const controlMissing = controlChecks.filter(([, pattern]) => !pattern.test(control)).map(([name]) => name);
  if (controlMissing.length > 0) throw new Error(`the select control is missing ${controlMissing.join(', ')}`);

  // The chevron is the node's own shape: three points on a 16 px grid, stroked at
  // 1.33 - the node's 2 on the 24 grid, scaled to the icon's 16.
  const svg = html.slice(html.indexOf('class="select-icon"'));
  if (!/viewBox="0 0 16 16"/.test(svg.slice(0, 400))) throw new Error('the chevron is not on the 16 px grid');
  if (!/d="M4 6l4 4 4-4"/.test(svg)) throw new Error("the chevron is not the node's path");
  if (!/stroke-width="1\.33"/.test(svg)) throw new Error("the chevron is not the node's 1.33 stroke");

  // The icon is color/muted and anchored on the edge: the node binds that one
  // colour, and an edge-anchored chevron is what its screen instance (0:1067)
  // draws, as well as the only one that holds still while the value changes.
  const icon = ruleBody('.select-icon');
  const iconChecks = [
    ['the color/muted chevron', /color:\s*var\(--zuri-text-muted\)/],
    ['the 12 px inset from the edge', /right:\s*var\(--zuri-space-3\)/],
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
  // focus strengthen the edge on the box, the keyboard ring is the accent one,
  // and a disabled select dims the whole component rather than its text alone.
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(ruleBody('.select-field:hover'))) {
    throw new Error('the select does not strengthen its edge on hover');
  }
  if (!/border-color:\s*var\(--zuri-border-strong\)/.test(ruleBody('.select-field:focus-within'))) {
    throw new Error('the select does not strengthen its edge while focused');
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

  return '280 px column, 36 px field, radius 8, surface fill, 1 px hairline, 14/22 value, muted 16 px chevron';
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

check('the Nav / Panel Header is drawn from node 0:73', () => {
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

  // Node 0:73 is a 280 x 20 strip of two texts and nothing else: no fill, stroke,
  // radius, shadow or auto layout. "Label" is 13/18 medium, "Count" is 12/16
  // regular, and both sit on the one #8E9196 grey.
  const header = ruleBody('.nav-panel-header');
  const box = [
    ['a row of the two texts', /display:\s*flex/],
    ['the level pair of texts', /align-items:\s*center/],
    ['the 20 px row height', /height:\s*20px/],
    ["the node's 280 px column width as a fill", /width:\s*100%/],
  ];
  const boxMissing = box.filter(([, pattern]) => !pattern.test(header)).map(([label]) => label);
  if (boxMissing.length > 0) throw new Error(`the panel header is missing ${boxMissing.join(', ')}`);

  // The node paints no box of its own, so a fill, outline, shadow or corner here
  // would be an addition rather than a match.
  if (/background:|border:(?!-radius)|box-shadow:|border-radius:/.test(header)) {
    throw new Error('the panel header draws a box the node does not have');
  }

  // Count starts at the label's right edge, so the row leaves no space between them.
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
  const labelChecks = [
    ["the node's 13 px label size", /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ["the node's 18 px label line height", /line-height:\s*var\(--zuri-line-height-panel-header\)/],
    ['the medium weight', /font-weight:\s*var\(--zuri-font-weight-medium\)/],
    ["the node's grey", /color:\s*var\(--zuri-text-panel-header\)/],
  ];
  const labelMissing = labelChecks.filter(([, pattern]) => !pattern.test(label)).map(([text]) => text);
  if (labelMissing.length > 0) throw new Error(`the panel header label is missing ${labelMissing.join(', ')}`);

  const count = ruleBody('.nav-panel-header-count');
  const countChecks = [
    ["the node's 12 px count size", /font-size:\s*var\(--zuri-font-size-caption\)/],
    ["the node's 16 px count line height", /line-height:\s*var\(--zuri-line-height-caption\)/],
    ['the regular weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ["the node's grey", /color:\s*var\(--zuri-text-panel-header\)/],
  ];
  const countMissing = countChecks.filter(([, pattern]) => !pattern.test(count)).map(([text]) => text);
  if (countMissing.length > 0) throw new Error(`the panel header count is missing ${countMissing.join(', ')}`);

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

  // One node change, one edit: the grey and the 18 px label line height are token
  // values, so changing them in open-pencil is what moves this component.
  const expected = [
    ['--zuri-text-panel-header', '#8e9196'],
    ['--zuri-line-height-panel-header', '18px'],
  ];
  for (const [name, value] of expected) {
    const values = tokenValues(name);
    if (values.length < 2) {
      throw new Error(`tokens.css declares ${name} ${values.length} time(s), not once per theme`);
    }
    const off = values.find((actual) => actual !== value);
    if (off) throw new Error(`${name} is ${off}, not the node's ${value}`);
  }

  return '20 px row, 13/18 medium label and 12/16 regular count on the node grey, no box, no gap';
});

check('the Nav / Sidebar Row is drawn from node 0:63', () => {
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

  // The current design row is "Nav / Chats" (node 0:484): a 236 x 36 box on
  // radius/row. Its 20 px icon sits at x 8 and its label 8 px after it, which is
  // centring plus one 8 px step, not padding of its own. Unselected rows carry no
  // fill of their own - they sit on the panel's surface - and only the selected
  // twin paints color/active. The earlier 32 px / color/background row this check
  // was written against no longer exists in the document.
  const row = ruleBody('.nav-sidebar-row');
  const box = [
    ['the two children on one line', /display:\s*flex/],
    ['the 36 px row height', /height:\s*36px/],
    ['the radius/row corner', /border-radius:\s*var\(--zuri-radius-row\)/],
    ['no fill on the unselected row', /background:\s*transparent/],
    ["the node's 8 px icon inset and gap", /padding:\s*0 var\(--zuri-space-2\)/],
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

  // Node 0:63 is the default row; the selected twin 0:67 is what carries the
  // color/active fill, so the base rule must not paint it.
  if (/--zuri-active|color\/active/.test(row)) {
    throw new Error('the default sidebar row paints the Active node fill');
  }

  // The node draws the default state only, so a hover or focus paint here would
  // be a state the design does not have.
  if (/\.nav-sidebar-row[\w-]*:(?:hover|focus|active)/.test(css)) {
    throw new Error('the sidebar row has a state the node does not draw');
  }

  // The 20 px glyph is the node's color/muted child, so its colour sits on the
  // icon element rather than on the row.
  const icon = ruleBody('.nav-sidebar-row-icon');
  const iconChecks = [
    ["the node's 20 px icon box", /width:\s*20px/],
    ["the node's 20 px icon height", /height:\s*20px/],
    ['the color/muted glyph', /color:\s*var\(--zuri-text-muted\)/],
  ];
  const iconMissing = iconChecks.filter(([, pattern]) => !pattern.test(icon)).map(([label]) => label);
  if (iconMissing.length > 0) throw new Error(`the sidebar row icon is missing ${iconMissing.join(', ')}`);

  // The label is the node's color/text child at 13/18 regular.
  const label = ruleBody('.nav-sidebar-row-label');
  const labelChecks = [
    ["the node's 13 px label size", /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ["the node's 18 px label line height", /line-height:\s*var\(--zuri-line-height-nav-row\)/],
    ['the regular weight', /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['the color/text label colour', /color:\s*var\(--zuri-text-primary\)/],
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

  // One node change, one edit: the 18 px label line height is a token value, so
  // changing it in open-pencil is what moves this component.
  const values = tokenValues('--zuri-line-height-nav-row');
  if (values.length < 2) {
    throw new Error(`tokens.css declares --zuri-line-height-nav-row ${values.length} time(s), not once per theme`);
  }
  const off = values.find((actual) => actual !== '18px');
  if (off) throw new Error(`--zuri-line-height-nav-row is ${off}, not the node's 18px`);

  return '236 fill x 32, radius row, surface fill, 20 px muted icon at 8 px, 13/18 regular label 8 px after it';
});

check('the Nav / Sidebar Row Active is drawn from node 0:67', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`components.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  const themeBlock = (selector) => {
    const at = tokens.indexOf(selector);
    if (at === -1) throw new Error(`tokens.css has no ${selector} block`);
    const open = tokens.indexOf('{', at);
    let depth = 0;
    for (let index = open; index < tokens.length; index += 1) {
      if (tokens[index] === '{') depth += 1;
      if (tokens[index] === '}') depth -= 1;
      if (depth === 0) return tokens.slice(open + 1, index);
    }
    throw new Error(`the ${selector} block is not closed`);
  };

  const themeValue = (selector) => {
    const match = themeBlock(selector).match(/--zuri-surface-active:\s*([^;]+);/);
    if (!match) throw new Error(`${selector} has no --zuri-surface-active`);
    return match[1].trim();
  };

  // Node 0:67 is node 0:63's box - 236 x 32, radius/row, an 8 px icon inset on a
  // 20 px color/muted glyph and a 13/18 regular label - with one change: the fill
  // is color/active instead of color/background. The variant therefore paints the
  // fill and inherits every measurement, so the two rules cannot drift apart.
  const active = ruleBody(".nav-sidebar-row[aria-current='page']");
  if (!/background:\s*var\(--zuri-surface-active\)/.test(active)) {
    throw new Error('the active sidebar row is not filled with the color/active token');
  }

  // A second copy of the geometry or the type would be a place for a node change
  // to go unapplied, and a second fill would be a state the node does not draw.
  const copied = [
    ['height', /(?:^|[\s;])height:/],
    ['width', /(?:^|[\s;])width:/],
    ['padding', /(?:^|[\s;])padding/],
    ['gap', /(?:^|[\s;])gap:/],
    ['display', /(?:^|[\s;])display:/],
    ['border-radius', /border-radius:/],
    ['font', /(?:^|[\s;])font/],
    ['color', /(?:^|[\s;])color:/],
    ['border', /border:/],
    ['shadow', /box-shadow:/],
  ]
    .filter(([, pattern]) => pattern.test(active))
    .map(([label]) => label);
  if (copied.length > 0) {
    throw new Error(`the active sidebar row restates ${copied.join(', ')} instead of inheriting the base row`);
  }

  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(active)) {
    throw new Error('the active sidebar row holds a literal colour instead of a token');
  }

  // color/active exists in both of the design's colour collections: the node's own
  // fill is the light value, and the dark collection holds the dark twin. A theme
  // left on the other value would put the selected row's light grey on a dark shell.
  const expected = {
    ':root[data-theme="dark"]': '#262a2f',
    ':root[data-theme="light"]': '#e6e8eb',
  };
  for (const [selector, value] of Object.entries(expected)) {
    const actual = themeValue(selector);
    if (actual !== value) {
      throw new Error(`--zuri-surface-active in ${selector} is ${actual}, not the design's ${value}`);
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

  return 'the same row, filled with color/active when aria-current="page"; no geometry or type of its own';
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
  // the next reader can see where the numbers came from. The bar is the window-wide
  // row (0:132) and comes first, then the body holds the sidebar and the workspace
  // with the centre and the rail.
  const regions = ['class="top-bar"', 'id="sidebar"', 'class="workspace"', 'id="chat"', 'id="context-panel"'].map((needle) => markup.indexOf(needle));
  if (regions.includes(-1)) throw new Error('index.html is missing one of the shell regions the node draws');
  if (regions.join(',') !== [...regions].sort((left, right) => left - right).join(',')) {
    throw new Error('the shell regions are not in the node order: bar, then sidebar and workspace (centre and rail)');
  }
  if (!markup.includes('design node 0:131')) throw new Error('index.html does not name node 0:131 as its source');

  return '52 px bar over 260 / 860 / 320, insets and gaps as tokens, every theme value declared';
});

check('the First-run welcome page is drawn from node 0:1008', () => {
  const css = read('src/renderer/views/onboarding.css');
  const markup = read('src/renderer/views/onboarding.html');
  const script = read('src/renderer/views/onboarding.js');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`onboarding.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:1008 draws three frames of one 1440 x 900 window: 0:1009 empty, 0:1079
  // saving, 0:1151 rejected key. Each frame is a 48 px title bar over a 620 wide card
  // at (410, 84), 28 px top and 32 px side padding. The numbers below are the node's;
  // the CSS reads them from the token layer so a node change is one token edit, not a
  // second copy of the picture.
  const card = ruleBody('.onboarding-card');
  const main = ruleBody('.onboarding-main');
  const titlebar = ruleBody('.onboarding-titlebar');
  const drawn = [
    ["the node's 36 px gap under the title bar (48 + 36 = 84)", main, /padding:\s*36px var\(--zuri-space-6\) 60px/],
    ["the node's 620 px card", card, /width:\s*620px/],
    ["the node's 28 px top / 32 px side card padding", card, /padding:\s*28px var\(--zuri-space-8\)/],
    ['radius/card on the setup card', card, /border-radius:\s*var\(--zuri-radius-lg\)/],
    ['one 12 px gap inside the card', card, /gap:\s*var\(--zuri-space-3\)/],
    ["the node's 0 8 24 raised shadow", card, /box-shadow:\s*var\(--zuri-shadow-raised\)/],
    ["the node's 48 px title bar", titlebar, /height:\s*48px/],
    ["the node's 16 px left inset", titlebar, /padding-left:\s*var\(--zuri-space-4\)/],
    ['the title bar hairline', titlebar, /border-bottom:\s*1px solid var\(--zuri-onboarding-border\)/],
  ];
  const missing = drawn.filter(([, source, pattern]) => !pattern.test(source)).map(([name]) => name);
  if (missing.length > 0) throw new Error(`the page is missing ${missing.join(', ')}`);

  const copy = ruleBody('.onboarding-copy');
  const title = ruleBody('.onboarding-title');
  const form = ruleBody('.onboarding-form');
  const providers = ruleBody('.onboarding-providers');
  const label = ruleBody('.onboarding-providers-label');
  const row = ruleBody('.provider-row');
  const selected = ruleBody('.provider-row:has(.provider-input:checked)');
  const radio = ruleBody('.provider-radio');
  const radioOn = ruleBody('.provider-input:checked + .provider-radio');
  const dot = ruleBody('.provider-input:checked + .provider-radio::after');
  const name = ruleBody('.provider-name');
  const hint = ruleBody('.provider-hint');
  const field = ruleBody('.onboarding-field');
  const head = ruleBody('.field-head');
  const fieldLabel = ruleBody('.field-label');
  const link = ruleBody('.field-link');
  const control = ruleBody('.field-control');
  const reveal = ruleBody('.field-reveal');
  const help = ruleBody('.field-help');
  const select = ruleBody('.field-select');
  const selectControl = ruleBody('.field-select-control');
  const selectIcon = ruleBody('.field-select-icon');
  const privacy = ruleBody('.privacy-note');
  const privacyIcon = ruleBody('.privacy-icon');
  const privacyText = ruleBody('.privacy-text');
  const save = ruleBody('.save-button');
  const saveOff = ruleBody('.save-button:disabled');
  const saveSaving = ruleBody('.onboarding-card[data-state="loading"] .save-button:disabled');
  const skip = ruleBody('.skip-note');

  // Node 0:1025 Setup top: an 88 px welcome block, 12 px, then the provider list.
  // Node 0:1030 Provider list: an 18 px label, 8 px, then four 52 px rows 8 px apart.
  const pieces = [
    ['the 8 px title/subtitle gap', copy, /gap:\s*var\(--zuri-space-2\)/],
    ["the node's 28 px title", title, /font-size:\s*var\(--zuri-font-size-display-lg\)/],
    ["the node's 36 px title line", title, /line-height:\s*var\(--zuri-line-height-display-lg\)/],
    ['a regular-weight title', title, /font-weight:\s*var\(--zuri-font-weight-regular\)/],
    ['one 12 px gap between the form blocks', form, /gap:\s*var\(--zuri-space-3\)/],
    ['an 8 px gap in the provider list', providers, /gap:\s*var\(--zuri-space-2\)/],
    ["the node's 13 px provider label", label, /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['a medium-weight provider label', label, /font-weight:\s*var\(--zuri-font-weight-medium\)/],
    ["the node's 52 px provider row", row, /height:\s*52px/],
    ["the node's 11 px row inset plus the 1 px border", row, /padding:\s*0 11px/],
    ["the node's 12 px radio-to-text gap", row, /gap:\s*var\(--zuri-space-3\)/],
    ['radius/card on the provider row', row, /border-radius:\s*var\(--zuri-radius-md\)/],
    ['the selected row tint', selected, /background:\s*var\(--zuri-onboarding-accent-tint\)/],
    ['the selected row accent border', selected, /border-color:\s*var\(--zuri-onboarding-accent\)/],
    ["the node's 16 px radio", radio, /width:\s*16px/],
    ['a sunken radio fill', radio, /background:\s*var\(--zuri-onboarding-fill-sunken\)/],
    ['the radio accent when chosen', radioOn, /background:\s*var\(--zuri-onboarding-accent\)/],
    ["the node's 6 px radio dot", dot, /width:\s*6px/],
    ["the node's 20 px provider name line", name, /line-height:\s*var\(--zuri-line-height-label-md\)/],
    ["the node's 12/16 provider hint", hint, /font-size:\s*var\(--zuri-font-size-caption\)/],
    ['the node\'s hint colour', hint, /color:\s*var\(--zuri-onboarding-text-muted\)/],
    ['an 8 px gap inside each field', field, /gap:\s*var\(--zuri-space-2\)/],
    ["the node's 18 px label row", head, /height:\s*18px/],
    ["the node's 13 px field label", fieldLabel, /font-size:\s*var\(--zuri-font-size-body-sm\)/],
    ['the accent on the docs link', link, /color:\s*var\(--zuri-onboarding-accent\)/],
    ["the node's 48 px API-key field", control, /height:\s*48px/],
    ['an 8 px field radius', control, /border-radius:\s*var\(--zuri-radius-sm\)/],
    ["the node's 12 px text inset (11 px plus the border)", control, /padding:\s*1px 3px 1px 11px/],
    ["the node's 44 px reveal button", reveal, /width:\s*44px/],
    ['radius/row on the reveal button', reveal, /border-radius:\s*var\(--zuri-onboarding-radius-control\)/],
    ["the node's 12/16 help line", help, /font-size:\s*var\(--zuri-font-size-caption\)/],
    ["the node's 42 px model select", select, /height:\s*42px/],
    ["the node's 40 px chevron room", selectControl, /padding:\s*0 40px 0 11px/],
    ["the node's 12 px chevron inset", selectIcon, /right:\s*12px/],
    ["the node's 56 px privacy note", privacy, /min-height:\s*56px/],
    ['a sunken privacy fill', privacy, /background:\s*var\(--zuri-onboarding-fill-sunken\)/],
    ['an 8 px privacy radius', privacy, /border-radius:\s*var\(--zuri-radius-sm\)/],
    ["the node's 16 px shield", privacyIcon, /width:\s*16px/],
    ['the green shield', privacyIcon, /color:\s*var\(--zuri-onboarding-success\)/],
    ["the node's 12/16 privacy text", privacyText, /font-size:\s*var\(--zuri-font-size-caption\)/],
    ["the node's 44 px save button", save, /height:\s*44px/],
    ['an 8 px save radius', save, /border-radius:\s*var\(--zuri-radius-sm\)/],
    ['the live save fill', save, /background:\s*var\(--zuri-onboarding-accent\)/],
    ['the disabled save fill', saveOff, /background:\s*var\(--zuri-onboarding-fill\)/],
    ['the muted disabled save label', saveOff, /color:\s*var\(--zuri-onboarding-text-muted\)/],
    ['a saving button that keeps the accent fill', saveSaving, /background:\s*var\(--zuri-onboarding-accent\)/],
    ['a saving button that keeps the white label', saveSaving, /color:\s*var\(--zuri-onboarding-surface\)/],
    ["the node's 12/16 skip note", skip, /font-size:\s*var\(--zuri-font-size-caption\)/],
    ['a centred skip note', skip, /text-align:\s*center/],
  ];
  const missingPieces = pieces.filter(([, source, pattern]) => !pattern.test(source)).map(([piece]) => piece);
  if (missingPieces.length > 0) throw new Error(`the page is missing ${missingPieces.join(', ')}`);

  // The two washes behind the card (node 0:1009): 720 square in the accent at 6% and
  // 640 square in the purple at 5%, both at the node's offsets.
  const glow = ruleBody('.onboarding-glow');
  const glowAccent = ruleBody('.onboarding-glow-accent');
  const glowSecondary = ruleBody('.onboarding-glow-secondary');
  const washes = [
    ['the 120 px wash blur', glow, /filter:\s*blur\(120px\)/],
    ["the node's -160/-200 accent wash", glowAccent, /top:\s*-200px/],
    ['the accent wash width', glowAccent, /width:\s*720px/],
    ['the accent wash at 6%', glowAccent, /opacity:\s*0\.06/],
    ["the node's -180/-220 purple wash", glowSecondary, /right:\s*-180px/],
    ['the purple wash height', glowSecondary, /height:\s*640px/],
    ['the purple wash at 5%', glowSecondary, /opacity:\s*0\.05/],
  ];
  const missingWashes = washes.filter(([, source, pattern]) => !pattern.test(source)).map(([wash]) => wash);
  if (missingWashes.length > 0) throw new Error(`the page is missing ${missingWashes.join(', ')}`);

  // The node's three states are one card with a data-state attribute, so only one can
  // be on screen and the other two still ship in the same file.
  if (!markup.includes('data-state="empty"')) throw new Error('the card has no empty state');
  if (!/ONBOARDING_STATES\s*=\s*\['empty', 'loading', 'error'/.test(script)) {
    throw new Error('onboarding.js does not name the node states empty, loading, error');
  }
  if (!ruleBody('.onboarding-card[data-state="loading"] .save-spinner').includes('display: block')) {
    throw new Error('the saving state draws no spinner (node 0:1079)');
  }
  // Node 0:1079 draws the provider list and the model field at half strength while the
  // key is being checked.
  if (!/\[data-state="loading"\] \.onboarding-providers[^}]*opacity:\s*0\.5/.test(css)) {
    throw new Error('the saving state does not fade the provider list');
  }
  if (!/\[data-state="loading"\] \.onboarding-field-model[^}]*opacity:\s*0\.5/.test(css)) {
    throw new Error('the saving state does not fade the model field');
  }
  if (!/Saving\\u2026/.test(script)) throw new Error('the saving button does not read "Saving..." as the node draws it');
  if (!/Verifying the key with one test call to/.test(script)) {
    throw new Error('the saving help line does not use the node 0:1079 wording');
  }
  if (!ruleBody('.onboarding-card[data-state="error"] .field-control').includes('var(--zuri-onboarding-danger)')) {
    throw new Error('the rejected state does not turn the field outline red (node 0:1151)');
  }
  if (!ruleBody('.onboarding-card[data-state="error"] .field-help').includes('var(--zuri-onboarding-danger)')) {
    throw new Error('the rejected state does not turn the help line red (node 0:1151)');
  }

  // The five drawn sentences and the four provider rows, word for word. A node edit
  // that changes the copy has to land here rather than only in one of the two files
  // the markup and the script both spell out.
  const plain = markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&hellip;/g, '\u2026')
    .replace(/\s+/g, ' ')
    .trim();
  const nodeCopy = [
    ['the title', 'Welcome to Zuri'],
    ['the subtitle', 'Connect a provider to begin. Your key stays with the main process \u2014 never in this window, never sent to a Zuri server.'],
    ['the provider label', 'Provider'],
    ['the Anthropic row', 'Anthropic claude-sonnet-4 \u00b7 recommended'],
    ['the OpenAI row', 'OpenAI gpt-4o mini \u00b7 fastest'],
    ['the Google row', 'Google gemini-2.5-flash \u00b7 long context'],
    ['the Local row', 'Local (Ollama) no key needed \u00b7 runs on this PC'],
    ['the key label', 'Anthropic API key'],
    ['the docs link', 'Where do I find it?'],
    ['the entry help line', 'Paste a key to continue. Zuri checks it with one test call before saving.'],
    ['the model label', 'Default model'],
    ['the privacy note', 'Stored encrypted in Windows Credential Manager by the main process. Nothing is sent to a Zuri server.'],
    ['the save label', 'Save key'],
    ['the skip note', 'You can change providers later in Settings.'],
  ];
  const missingCopy = nodeCopy.filter(([, sentence]) => !plain.includes(sentence)).map(([part]) => part);
  if (missingCopy.length > 0) throw new Error(`the page does not draw the node's ${missingCopy.join(', ')}`);
  if (/style="/.test(markup)) throw new Error('the page carries an inline style instead of a token rule');

  // Nothing in the page rules is a literal colour: the node's palette lives in one
  // page-scoped token block, so a colour change in open-pencil changes a value here,
  // not a scatter of hex codes.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`onboarding.css holds literal colours: ${[...new Set(literals)].join(', ')}`);

  const start = tokens.indexOf('.onboarding-page {');
  if (start === -1) throw new Error('tokens.css has no page-scoped onboarding block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  if (!tokens.includes('First-run setup page (design node 0:1008)')) {
    throw new Error('the onboarding token block does not name node 0:1008');
  }
  const palette = [
    ['--zuri-onboarding-canvas', '#f7f8f9'],
    ['--zuri-onboarding-surface', '#ffffff'],
    ['--zuri-onboarding-border', '#e8eaed'],
    ['--zuri-onboarding-border-strong', '#cbd2da'],
    ['--zuri-onboarding-text', '#1f2328'],
    ['--zuri-onboarding-text-secondary', '#6b7280'],
    ['--zuri-onboarding-text-muted', '#8e9196'],
    ['--zuri-onboarding-accent', '#2f6bff'],
    ['--zuri-onboarding-accent-tint', '#f5f8ff'],
    ['--zuri-onboarding-fill', '#f0f1f3'],
    ['--zuri-onboarding-fill-sunken', '#f7f8f9'],
    ['--zuri-onboarding-danger', '#d14343'],
    ['--zuri-onboarding-success', '#1f9d6b'],
    ['--zuri-onboarding-glow-accent', '#2f6bff'],
    ['--zuri-onboarding-glow-secondary', '#6b4eff'],
  ];
  const wrong = palette.filter(([token, value]) => !new RegExp(`${token}:\\s*${value};`).test(pageTokens));
  if (wrong.length > 0) throw new Error(`the onboarding palette differs from node 0:1009: ${wrong.map(([token]) => token).join(', ')}`);

  // The radii the node's card and controls are drawn with (design tokens.json Mode 1).
  const radii = [
    ['--zuri-radius-sm', '8px'],
    ['--zuri-radius-md', '10px'],
    ['--zuri-radius-lg', '12px'],
  ];
  for (const [token, value] of radii) {
    const declared = tokens.match(new RegExp(`${token}:\\s*([^;]+);`));
    if (!declared) throw new Error(`tokens.css has no ${token}`);
    if (declared[1].trim() !== value) throw new Error(`${token} is ${declared[1].trim()}, the design tokens say ${value}`);
  }
  // The node's radio uses radius/pill 999: any value that rounds past half its 16 px
  // box draws the same circle, and the layer's own 9999 px is one of those.
  const pill = tokens.match(/--zuri-radius-pill:\s*(\d+)px;/);
  if (!pill) throw new Error('tokens.css has no --zuri-radius-pill');
  if (Number(pill[1]) < 999) throw new Error(`--zuri-radius-pill is ${pill[1]}px, the design tokens say 999`);

  return '620 x 756 card at (410, 84), four 52 px rows, 48/42 px fields, three drawn states, node copy and palette';
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

check('the Automations list page is drawn from node 0:7686', () => {
  const html = read('src/renderer/views/automations.html');
  const css = read('src/renderer/views/automations.css');
  const js = read('src/renderer/views/automations.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:7686 draws the same list six times, so the page must carry every frame
  // and no other state name: a frame that is missing is a screen a user can reach
  // through ?state= and land on a blank page. The fifth frame is named
  // "disabled (run in flight)" in the node, which is why the name is disabled.
  const frames = ['main', 'empty', 'loading', 'error', 'disabled', 'caught-up'];
  for (const frame of frames) {
    if (!html.includes(`data-state="${frame}"`)) throw new Error(`automations.html has no ${frame} frame`);
  }
  const declared = [...html.matchAll(/<section class="automations-state" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.sort().join(',') !== [...frames].sort().join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ')}`);
  }
  if (!js.includes("'caught-up']") || !js.includes('AUTOMATIONS_STATES')) {
    throw new Error('automations.js does not list the six states');
  }

  // The six rows of the main frame, in the node's order, with the node's schedules.
  const rows = [
    ['Morning inbox triage', 'Daily &middot; 08:00', 'Today 08:00', 'took 1m 12s', 'Next today 09:15'],
    ['Weekly expenses in Excel', 'Weekly &middot; Mon 09:30', 'Mon 09:30', 'took 38s', 'Next Mon 09:30'],
    ['Daily standup notes', 'Weekdays &middot; 09:15', 'Today 09:15', 'took 51s', 'Caught up'],
    ['Invoice follow-ups', 'Weekdays &middot; 16:00', 'Yesterday 16:00', 'took 22s', 'Next today 16:00'],
    ['Friday report pack', 'Weekly &middot; Fri 17:00', 'Fri 17:00', 'took 2m 04s', 'Paused by you'],
    ['Meeting notes cleanup', 'Daily &middot; 18:30', 'Never run', 'paused before first run', 'Paused by you'],
  ];
  const mainFrame = html.slice(html.indexOf('data-state="main"'), html.indexOf('data-state="empty"'));
  let cursor = -1;
  for (const [name, schedule, lastRun, duration, status] of rows) {
    const at = mainFrame.indexOf(`>${name}<`, cursor + 1);
    if (at === -1) throw new Error(`the main frame has no row called ${name}`);
    if (at < cursor) throw new Error(`${name} is out of the node's order`);
    cursor = at;
    const row = mainFrame.slice(at, mainFrame.indexOf('</article>', at));
    for (const copy of [schedule, lastRun, duration, status]) {
      if (!row.includes(copy)) throw new Error(`${name} is missing "${copy}"`);
    }
    if (!row.includes('type="checkbox"') || !row.includes('role="switch"')) {
      throw new Error(`${name} has no switch`);
    }
  }
  // Four enabled and two paused is what the footer and the filter counts claim.
  if ((mainFrame.match(/data-enabled="enabled"/g) ?? []).length !== 4) {
    throw new Error('the main frame does not mark four rows enabled');
  }
  if ((mainFrame.match(/data-enabled="paused"/g) ?? []).length !== 2) {
    throw new Error('the main frame does not mark two rows paused');
  }
  const footer = '6 automations &middot; 4 enabled &middot; next run today at 16:00';
  if (!mainFrame.includes(footer)) throw new Error('the card footer does not summarise six rows');

  // Column labels in the node's order, upper-cased by CSS as the node draws them.
  const headLabels = [...html.matchAll(/class="automations-head-cell[^"]*">([A-Za-z ]+)</g)].map((m) => m[1]);
  if (headLabels.slice(0, 5).join(',') !== 'Automation,Schedule,Last run,Status,History') {
    throw new Error(`the table header reads ${headLabels.join(', ')}`);
  }

  // The copy of the five other frames, so none of them can rot into a placeholder.
  const frameCopy = [
    'No automations yet',
    'Create your first automation',
    'Schedules are stored in your user data folder and survive restarts.',
    'Reading schedules from your user data folder',
    "Zuri couldn't read your schedule file",
    'Try again',
    'Reveal file in Explorer',
    '%APPDATA%\\Zuri\\schedules.json',
    'Automations stay hidden until the schedule file loads.',
    'Morning inbox triage is running now',
    'Stop',
    'Dismiss',
    '3 more automations are locked while this run is in flight.',
    'one missed run ran once',
    'ran once, not twice',
    'Today 09:04',
    'missed 08:00 &middot; ran once',
    'Zuri was asleep at 08:00, so it caught up once',
  ];
  for (const copy of frameCopy) {
    if (!html.includes(copy)) throw new Error(`automations.html is missing "${copy}"`);
  }

  // The node's palette is one page-scoped token block, and the page rules hold no
  // literal colour, so a colour changed in open-pencil is a single value edit.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`automations.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  const label = 'Automations list page (design node 0:7686)';
  if (!tokens.includes(label)) throw new Error('tokens.css has no automations page block naming node 0:7686');
  const start = tokens.indexOf('.automations-page {');
  if (start === -1) throw new Error('tokens.css has no .automations-page block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  const palette = [
    ['--zuri-automations-canvas', '#f7f8f9'], // color/surface
    ['--zuri-automations-surface', '#ffffff'], // color/inverse
    ['--zuri-automations-sunken', '#f0f1f3'], // color/sunken
    ['--zuri-automations-active', '#e6e8eb'], // color/active
    ['--zuri-automations-border-strong', '#d5d8dc'], // color/border-strong
    ['--zuri-automations-text', '#1f2328'], // color/text
    ['--zuri-automations-text-secondary', '#6b7280'], // color/subtle
    ['--zuri-automations-text-muted', '#8e9196'], // color/muted
    ['--zuri-automations-primary', '#2f6bff'], // color/primary
    ['--zuri-automations-accent', '#6b4eff'], // color/accent
    ['--zuri-automations-success', '#1f9d6b'], // color/success
    ['--zuri-automations-danger', '#d14343'], // color/danger
  ];
  for (const [token, value] of palette) {
    if (!new RegExp(`${token}:\\s*${value};`).test(pageTokens)) {
      throw new Error(`${token} is not the value node 0:7686 binds`);
    }
  }
  // Row, header and top bar heights, and the six column tracks taken from the
  // node's x positions (16 / 532 / 782 / 1018 / 1204 / 1300).
  for (const metric of [
    '--zuri-automations-row-height: 72px',
    '--zuri-automations-head-height: 38px',
    '--zuri-automations-topbar-height: 52px',
    '--zuri-automations-grid: 516fr 250fr 236fr 186fr 96fr 44px',
  ]) {
    if (!pageTokens.includes(metric)) throw new Error(`the automations page block has no ${metric}`);
  }
  if (!/grid-template-columns:\s*var\(--zuri-automations-grid\)/.test(css)) {
    throw new Error('the row grid does not use the node column tracks');
  }

  // The measurements the node fixes inside a row and a banner. A chip that hugs its
  // text, a HISTORY label that stops at the link track, or a button other than the
  // node's 84 x 28 all read as a different drawing, so each is pinned here.
  const layout = [
    [/\.automations-schedule \{[^}]*\bwidth: 176px;/, 'the schedule chip is not the node\'s 176 px wide'],
    [/\.automations-schedule \{[^}]*\bheight: 26px;/, 'the schedule chip is not the node\'s 26 px tall'],
    [/\.automations-schedule \{[^}]*\bpadding: 0 10px;/, 'the schedule chip clock is not 10 px in'],
    [/\.automations-schedule \{[^}]*\bgap: 6px;/, 'the schedule chip label is not 6 px from its clock'],
    [/\.automations-head-cell-history \{[^}]*grid-column: 5 \/ -1;/, 'HISTORY does not reach the card\'s inner edge'],
    [/\.automations-alert \{[^}]*grid-template-columns: 20px minmax\(0, 1fr\);/, 'the alert does not set its glyph column'],
    [/\.automations-alert-actions \{[^}]*grid-column: 1 \/ -1;/, 'the alert actions do not start under the glyph'],
    [/\.automations-quiet-button-compact \{[^}]*height: 28px;/, 'banner actions are not the node\'s 28 px tall'],
    [/\.automations-quiet-button-compact \{[^}]*min-width: 84px;/, 'banner actions are not the node\'s 84 px wide'],
    [/\.automations-quiet-button-wide \{[^}]*min-width: 190px;/, 'Reveal file in Explorer is not the node\'s 190 px'],
    [/\.automations-row-caught \.automations-schedule \{[^}]*background: var\(--zuri-automations-surface\);/, 'the caught-up chip is not white'],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('automations.html allows inline script or style');
  if (!/<script type="module" src="automations\.js"><\/script>/.test(html)) {
    throw new Error('automations.html does not load its module');
  }

  return 'six drawn frames, six rows on the node column tracks, 176 x 26 chips, 72 px rows, 38 px header, 84 x 28 banner actions, node copy, one page-scoped palette';
});

check('the run result / history page is drawn from node 0:8574', () => {
  const html = read('src/renderer/views/runs.html');
  const css = read('src/renderer/views/runs.css');
  const js = read('src/renderer/views/runs.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:8574 draws the run page six times, so all six frames must be in the
  // document: a name reachable through ?state= that has no frame is a blank page.
  const frames = ['main', 'empty', 'loading', 'error', 'blocked', 'accepted'];
  for (const frame of frames) {
    if (!html.includes(`data-state="${frame}"`)) throw new Error(`runs.html has no ${frame} frame`);
  }
  const declared = [...html.matchAll(/<section class="runs-state" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.sort().join(',') !== [...frames].sort().join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ')}`);
  }
  if (!js.includes("'accepted']") || !js.includes('RUNS_STATES')) {
    throw new Error('runs.js does not list the six states');
  }

  // The header of each frame: badge label and meta line, in the node's words.
  const headers = [
    ['main', 'Completed', 'triggered by Daily schedule'],
    ['empty', 'Not run yet', 'first run has not happened yet'],
    ['loading', 'Running', 'streaming result'],
    ['error', 'Failed', 'Outlook was not open'],
    ['blocked', 'Blocked', '3 actions needed approval'],
    ['accepted', 'Completed', 'reminder created'],
  ];
  for (const [frame, badge, meta] of headers) {
    const start = html.indexOf(`data-state="${frame}"`);
    const end = html.indexOf('</section>', start);
    const body = html.slice(start, end);
    if (!body.includes(badge)) throw new Error(`the ${frame} frame has no ${badge} badge`);
    if (!body.includes(meta)) throw new Error(`the ${frame} frame's meta line is missing "${meta}"`);
  }

  // The panel copy the node fixes, so no frame can rot into a placeholder.
  const copy = [
    'Inbox triaged &mdash; 42 messages reviewed',
    'What changed',
    '6 replies drafted and saved to Drafts &mdash; nothing sent',
    'invoice-2026',
    'Zuri did not send anything. Drafts wait in Outlook until you press Send.',
    'Output logged to runs/2026-10-18T08-00.jsonl',
    'Want Zuri to follow up on this?',
    'Create reminder',
    'Create task',
    'Not now',
    'Why blocked',
    'No runs yet',
    'Run it now to test',
    'Next scheduled run: tomorrow at 08:00',
    'No history to show',
    'Runs are kept for 30 days once they happen.',
    'Streaming&hellip;',
    '412 tokens &middot; 6s in',
    'This run failed &mdash; Outlook was not open',
    'Run again now',
    'What Zuri managed before it stopped',
    'The next scheduled run is tomorrow at 08:00. Nothing is retried automatically.',
    'Send mail to billing@northwind.co',
    'Edit C:\\Invoices\\Q4.xlsx cells D14:F40',
    'Overwrite the master contract template.docx',
    'Let Zuri do this next time?',
    'Allow all',
    'Blocked attempts are logged with the reason shown above.',
    'Reminder created for today at 12:00',
    'View reminder',
    'Undo',
    'Runs older than 30 days are removed',
    'Caught up after sleep &middot; ran once',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`runs.html is missing "${text}"`);
  }
  // Seven history entries in the frames that have a full history, six in the
  // blocked frame and two skeletons in the live one, as the node draws them.
  const railOf = (frame) => {
    const start = html.indexOf(`data-state="${frame}"`);
    return html.slice(start, html.indexOf('</section>', start));
  };
  const entryCount = (frame) => (railOf(frame).match(/class="runs-entry[ "]/g) ?? []).length;
  for (const frame of ['main', 'error', 'accepted']) {
    if (entryCount(frame) !== 7) throw new Error(`the ${frame} frame's rail has ${entryCount(frame)} entries, not the node's 7`);
  }
  if (entryCount('blocked') !== 6) throw new Error("the blocked frame's rail is not the node's 6 entries");
  if (entryCount('loading') !== 6) {
    throw new Error("the live frame's rail is not the node's 4 entries plus 2 skeletons");
  }
  if ((railOf('loading').match(/runs-entry-skeleton/g) ?? []).length !== 2) {
    throw new Error('the live frame is missing its two skeleton entries');
  }

  // One page-scoped palette, no literal colour in the page rules: a colour the
  // node changes is then a single value edit in tokens.css.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`runs.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  if (!tokens.includes('Automation run result / history page (design node 0:8574)')) {
    throw new Error('tokens.css has no run result page block naming node 0:8574');
  }
  const start = tokens.indexOf('.runs-page {');
  if (start === -1) throw new Error('tokens.css has no .runs-page block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  const palette = [
    ['--zuri-runs-canvas', '#f7f8f9'],
    ['--zuri-runs-surface', '#ffffff'],
    ['--zuri-runs-sunken', '#f0f1f3'],
    ['--zuri-runs-hairline', '#edeef0'],
    ['--zuri-runs-border', '#e8eaed'],
    ['--zuri-runs-text', '#1f2328'],
    ['--zuri-runs-text-secondary', '#6b7280'],
    ['--zuri-runs-text-muted', '#8e9196'],
    ['--zuri-runs-primary', '#2f6bff'],
    ['--zuri-runs-primary-soft', '#eaf0ff'],
    ['--zuri-runs-accent', '#6b4eff'],
    ['--zuri-runs-success', '#1f9d6b'],
    ['--zuri-runs-success-soft', '#e9f6f0'],
    ['--zuri-runs-success-text', '#166534'],
    ['--zuri-runs-warning', '#c7861f'],
    ['--zuri-runs-danger', '#d14343'],
  ];
  for (const [token, value] of palette) {
    if (!new RegExp(`${token}:\\s*${value};`).test(pageTokens)) {
      throw new Error(`${token} is not the value node 0:8574 binds`);
    }
  }

  // The page frame the node fixes: 52 top bar, 24 gutter top, 40 side gutter,
  // 900 + 32 + 428 grid, 12 card radius, 64 entry rows, 48 card header.
  for (const metric of [
    '--zuri-runs-topbar-height: 52px',
    '--zuri-runs-gutter: 40px',
    '--zuri-runs-gutter-top: 24px',
    '--zuri-runs-grid-gap: 32px',
    '--zuri-runs-grid-top: 24px',
    '--zuri-runs-card-gap: 16px',
    '--zuri-runs-column-min: 676px',
    '--zuri-runs-column-blocked-min: 694px',
    '--zuri-runs-result-min: 430px',
    '--zuri-runs-failed-min: 380px',
    '--zuri-runs-blocked-min: 470px',
    '--zuri-runs-result-size: 14px',
    '--zuri-runs-tight-leading: 16px',
    '--zuri-runs-radius-card: var(--zuri-radius-lg)',
    '--zuri-runs-radius-panel: var(--zuri-radius-md)',
    '--zuri-runs-radius-row: var(--zuri-radius-row)',
    '--zuri-runs-radius-pill: var(--zuri-radius-pill)',
    '--zuri-runs-title-size: 28px',
    '--zuri-runs-title-leading: 36px',
  ]) {
    if (!pageTokens.includes(metric)) throw new Error(`the run result page block has no ${metric}`);
  }

  const layout = [
    [/\.runs-grid \{[^}]*grid-template-columns: minmax\(0, 900px\) minmax\(0, 428px\);/, 'the grid is not the node\'s 900 + 428 columns'],
    [/\.runs-grid \{[^}]*margin-top: var\(--zuri-runs-grid-top\);/, 'the grid does not start 24 px under the run header'],
    [/\.runs-card-head \{[^}]*height: 48px;/, 'the card header is not the node\'s 48 px'],
    [/\.runs-entry \{[^}]*height: 64px;/, 'a history entry is not the node\'s 64 px tall'],
    [/\.runs-entry-status \{[^}]*line-height: var\(--zuri-runs-tight-leading\);/, 'the entry status line is not the node\'s 16 px leading'],
    [/\.runs-timeline \{[^}]*padding: 12px 0 0;/, 'the timeline does not start 12 px under the rail header'],
    [/\.runs-badge \{[^}]*\bleft: 330px;/, 'the status badge does not sit at the node\'s x 330'],
    [/\.runs-rerun \{[^}]*\bheight: 38px;/, 'Run again is not the node\'s 38 px tall'],
    [/\.runs-note \{[^}]*min-height: 56px;/, 'the note block is not the node\'s 56 px'],
    [/\.runs-alert \{[^}]*min-height: 104px;/, 'the failed statement is not the node\'s 104 px'],
    [/\.runs-alert-retry \{[^}]*margin: 2px 0 0 -32px;/, 'the retry button does not hang off the icon column'],
    [/\.runs-empty-card \{[^}]*min-height: 430px;/, 'the empty card is not the node\'s 430 px'],
    [/\.runs-rail-card-full \{[^}]*min-height: 676px;/, 'the full history rail is not the node\'s 676 px'],
    [/\.runs-rail-empty \{[^}]*justify-content: flex-end;/, 'the empty rail block is not anchored to the card foot'],
    [/\.runs-blocked-item \{[^}]*min-height: 72px;/, 'a blocked action row is not the node\'s 72 px'],
    [/\.runs-offer-actions \{[^}]*margin-top: 18px;/, 'the offer buttons are not the node\'s 18 px under the copy'],
    [/\.runs-answer \{[^}]*padding-bottom: 0;/, 'the accepted card does not run its actions to the bottom edge'],
    [/\.runs-md-list \{[^}]*padding-left: 20px;/, 'the result bullets are not indented the node\'s 20 px'],
    [/\.runs-blocked-head \{[^}]*padding: 25px var\(--zuri-space-6\) 0 46px;/, 'the blocked strip head is not the node\'s 25 px top inset'],
    [/\.runs-blocked-count \{[^}]*left: 164px;/, 'the blocked strip count does not sit at the node\'s 164 px'],
    [/\.runs-state\[data-state='main'\] \.runs-column > \.runs-card:first-child,[\s\S]*?min-height: var\(--zuri-runs-result-min\);/, 'the result card is not held to the node\'s 430 px'],
    [/\.runs-state\[data-state='error'\] \.runs-column > \.runs-card:first-child \{[^}]*min-height: var\(--zuri-runs-failed-min\);/, 'the failed card is not held to the node\'s 380 px'],
    [/\.runs-state\[data-state='blocked'\] \.runs-column > \.runs-card:first-child \{[^}]*min-height: var\(--zuri-runs-blocked-min\);/, 'the blocked card is not held to the node\'s 470 px'],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('runs.html allows inline script or style');
  if (!/<script type="module" src="runs\.js"><\/script>/.test(html)) {
    throw new Error('runs.html does not load its module');
  }
  // The automations list reaches this page from every row's History link.
  if (!read('src/renderer/views/automations.html').includes('href="runs.html"')) {
    throw new Error('no automation row links to the run result page');
  }

  return 'six drawn frames, node copy, 900 + 428 columns, 64 px entries, 676 px rail, 430/380/470 px cards, one page-scoped palette';
});

check('the Quick assistant overlay page is drawn from node 0:9961', () => {
  const html = read('src/renderer/views/overlay.html');
  const css = read('src/renderer/views/overlay.css');
  const js = read('src/renderer/views/overlay.js');
  const tokens = read('src/renderer/styles/tokens.css');

  // Node 0:9961 draws the floating window four times, so the page carries every
  // frame and no other state name: a frame that is missing is a screen a user can
  // reach through ?state= and land on nothing. The node names them empty,
  // loading, error and closed, in that order.
  const frames = ['empty', 'loading', 'error', 'closed'];
  const declared = [...html.matchAll(/<section class="overlay-state" data-state="([\w-]+)"/g)].map((m) => m[1]);
  if (declared.join(',') !== frames.join(',')) {
    throw new Error(`the page's frames are ${declared.join(', ') || 'none'}`);
  }
  if (!js.includes("['empty', 'loading', 'error', 'closed']") || !js.includes('OVERLAY_STATES')) {
    throw new Error('overlay.js does not list the four states');
  }
  if (!js.includes('window.__KAI_STATES__')) throw new Error('overlay.js does not publish its states');

  // The node draws this window in the dark collection only, and an overlay that
  // followed the app theme would be a different drawing, so the page pins dark.
  if (!/<html lang="en" data-theme="dark">/.test(html)) throw new Error('overlay.html does not pin the dark theme');

  // The copy of all four frames, so none of them can rot into a placeholder.
  const copy = [
    'Zuri quick ask',
    'Ask anything — it stays on top',
    'Esc closes the window and focus returns to Excel',
    'Streaming…',
    'Three lines are over in Budget.xlsx: Travel (£4,120), Software',
    '(£980) and Contractors (£2,300) — £7,400 in total.',
    'Follow up…',
    'No API key for OpenAI',
    "The quick window can't reach a provider. Add a key in Settings, then ask again.",
    'Open provider setup',
    'Retry your question…',
    'Esc closes the window · errors stay in this window',
    'Window closed · focus returned to Excel',
    'Excel has focus',
    'Q4 Budget — Excel',
    'The user was editing this workbook when the shortcut fired.',
  ];
  for (const text of copy) {
    if (!html.includes(text)) throw new Error(`overlay.html is missing "${text}"`);
  }
  // The closed frame hands focus back to the app behind, which the node draws as
  // a focus ring plus "focused" in that window's own title bar.
  if (!html.includes('overlay-app-focus') || !html.includes(' · focused')) {
    throw new Error('the closed frame does not mark the app window as focused');
  }
  if (!/\[data-state="closed"\] \.overlay-app::after \{[^}]*display: block;/.test(css)) {
    throw new Error('the closed frame does not draw the app window focus ring');
  }
  // The node's ghosted mark is a bare rounded square: at the group's 35% opacity
  // no glyph survives, so drawing one would add an element the node does not have.
  if (!/<span class="overlay-ghost-mark"><\/span>/.test(html)) {
    throw new Error('the ghosted mark draws a glyph the node does not');
  }

  // The node's palette is one page-scoped token block, and the page rules hold no
  // literal colour, so a colour changed in open-pencil is a single value edit.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`overlay.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  const label = 'Quick assistant overlay (design node 0:9961)';
  if (!tokens.includes(label)) throw new Error('tokens.css has no overlay page block naming node 0:9961');
  const start = tokens.indexOf('.overlay-page {');
  if (start === -1) throw new Error('tokens.css has no .overlay-page block');
  const pageTokens = tokens.slice(start, tokens.indexOf('\n}', start));
  const palette = [
    ['--zuri-overlay-scene', '#0e1012'], // color/background
    ['--zuri-overlay-taskbar', '#0f1319'], // the taskbar strip
    ['--zuri-overlay-window', '#16181b'], // color/surface
    ['--zuri-overlay-card', 'rgba(22, 24, 27, 0.9)'], // color/surface at 90%
    ['--zuri-overlay-titlebar', '#1d2024'], // color/raised
    ['--zuri-overlay-raised', '#1f2226'], // color/raised
    ['--zuri-overlay-close', '#1f2224'], // the empty frame's close control
    ['--zuri-overlay-hairline', '#262a2f'], // color/active
    ['--zuri-overlay-card-border', '#ffffff'], // the window's 1 px outline
    ['--zuri-overlay-text', '#edeff2'], // color/text
    ['--zuri-overlay-text-secondary', '#c7ccd1'], // color/subtle
    ['--zuri-overlay-text-muted', '#adb4bb'], // color/subtle
    ['--zuri-overlay-text-subtle', '#8a9099'], // color/subtle
    ['--zuri-overlay-glyph', '#9aa0a6'], // color/muted
    ['--zuri-overlay-primary', '#5b8cff'], // color/primary
    ['--zuri-overlay-primary-soft', '#7aa2ff'], // the streaming chip glyph
    ['--zuri-overlay-danger', '#f06a6a'], // color/danger
    ['--zuri-overlay-glow-accent', '#5b8cff'], // glow/left
    ['--zuri-overlay-glow-secondary', '#7e63ff'], // glow/right
  ];
  for (const [token, value] of palette) {
    if (!pageTokens.includes(`${token}: ${value};`)) {
      throw new Error(`${token} is not the value node 0:9961 binds`);
    }
  }

  // The measurements the node fixes: a 520 px window at (460, 140), the four
  // frame heights, the 44/56 px title row, the 496 x 44 prompt field and the
  // scenery the window floats over. A window or field that drifts reads as a
  // different drawing, so each is pinned here.
  const layout = [
    [/\.overlay-window \{[^}]*\bleft: 460px;/, 'the window is not at the node\'s x of 460'],
    [/\.overlay-window \{[^}]*\btop: 140px;/, 'the window is not at the node\'s y of 140'],
    [/\.overlay-window \{[^}]*\bwidth: 520px;/, 'the window is not the node\'s 520 px wide'],
    [/\[data-state="empty"\] \.overlay-window,[\s\S]{0,120}height: 148px;/, 'the empty window is not the node\'s 148 px tall'],
    [/\[data-state="loading"\] \.overlay-window \{[^}]*height: 180px;/, 'the loading window is not the node\'s 180 px tall'],
    [/\[data-state="error"\] \.overlay-window \{[^}]*height: 224px;/, 'the error window is not the node\'s 224 px tall'],
    [/\.overlay-title-row \{[^}]*height: 44px;/, 'the title row is not the node\'s 44 px tall'],
    [/\.overlay-title-row,[\s\S]{0,220}height: 56px;/, 'the tall title row is not the node\'s 56 px tall'],
    [/\.overlay-field \{[^}]*width: 496px;/, 'the prompt field is not the node\'s 496 px wide'],
    [/\.overlay-field \{[^}]*height: 44px;/, 'the prompt field is not the node\'s 44 px tall'],
    [/\[data-state="empty"\] \.overlay-field \{\s*top: 56px;/, 'the empty prompt field is not 56 px down'],
    [/\[data-state="loading"\] \.overlay-field \{\s*top: 124px;/, 'the loading prompt field is not 124 px down'],
    [/\[data-state="error"\] \.overlay-field \{\s*top: 140px;/, 'the error prompt field is not 140 px down'],
    [/\.overlay-answer-card \{[^}]*left: 12px;[\s\S]{0,80}?top: 56px;/, 'the error block does not start where the node draws it'],
    [/\.overlay-answer-card \{[^}]*width: 496px;/, 'the error block is not the node\'s 496 px wide'],
    [/\.overlay-answer-card \{[^}]*height: 76px;/, 'the error block is not the node\'s 76 px tall'],
    [/\.overlay-caret \{[^}]*left: 148px;[\s\S]{0,40}?top: 40px;/, 'the streaming caret is not at the node\'s (148, 40)'],
    [/\.overlay-window-ghost \{[^}]*width: 520px;/, 'the ghosted window is not the node\'s 520 px wide'],
    [/\.overlay-window-ghost \{[^}]*height: 100px;/, 'the ghosted window is not the node\'s 100 px tall'],
    [/\.overlay-app \{[^}]*left: 120px;\s*top: 90px;/, 'the app window is not at the node\'s (120, 90)'],
    [/\.overlay-app \{[^}]*width: 960px;\s*height: 164px;/, 'the app window is not the node\'s 960 x 164'],
    [/\.overlay-taskbar \{[^}]*height: 48px;/, 'the taskbar is not the node\'s 48 px tall'],
    [/\.overlay-focus-pill \{[^}]*left: 64px;\s*top: 810px;/, 'the focus pill is not at the node\'s (64, 810)'],
    [/\.overlay-focus-pill \{[^}]*width: 150px;\s*height: 24px;/, 'the focus pill is not the node\'s 150 x 24'],
  ];
  for (const [pattern, message] of layout) {
    if (!pattern.test(css)) throw new Error(message);
  }

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('overlay.html allows inline script or style');
  if (!/<script type="module" src="overlay\.js"><\/script>/.test(html)) {
    throw new Error('overlay.html does not load its module');
  }

  return 'four drawn frames, 520 px window at (460, 140), 148/180/224 px heights, 44/56 px title row, 496 x 44 prompt field, 496 x 76 error block, 520 x 100 ghost, plain ghost mark, caret at (148, 40), node copy, one page-scoped palette';
});

check('the Error / not-found view is drawn from node 0:11074', () => {
  const html = read('src/renderer/views/404.html');
  const css = read('src/renderer/views/404.css');
  const js = read('src/renderer/views/404.js');
  const tokens = read('src/renderer/styles/tokens.css');

  const ruleBody = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`404.css has no ${selector} rule`);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  // Node 0:11074 draws four frames: the view that failed to load (its default),
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

  // The node draws this window in the light collection only, and a page that
  // followed the app theme would be a drawing the node does not contain.
  if (!/<html lang="en" data-theme="light">/.test(html)) throw new Error('404.html does not pin the light theme');

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
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
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

  // A page that allowed inline script or style would undercut the token layer.
  if (/'unsafe-inline'/.test(html)) throw new Error('404.html allows inline script or style');
  if (!/<script type="module" src="404\.js"><\/script>/.test(html)) {
    throw new Error('404.html does not load its module');
  }

  // The node's palette is one page-scoped token block, so a colour changed in
  // open-pencil is a single value edit. The page rules hold no literal colour.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
  if (literals !== null) throw new Error(`404.css holds literal colours: ${[...new Set(literals)].join(', ')}`);
  const label = 'Error / not-found view (design node 0:11074)';
  if (!tokens.includes(label)) throw new Error('tokens.css has no error page block naming node 0:11074');
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
      throw new Error(`${token} is not the value node 0:11074 binds`);
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
      throw new Error(`${token} is not the measurement node 0:11074 draws`);
    }
  }

  return 'three desktop frames over one shell, 600 x 340 panel at 150 px, 44 px disc, 40 px actions, 48 px strip, 260 / 320 side rails, 390 px frame, node copy, one page-scoped palette';
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

  // The five frames the node draws, plus loading, error and disabled, which the
  // screen check opens by name with ?state=. Every name needs a branch, or the
  // check lands on a page that looks like a different frame.
  const frames = ['pass', 'fail', 'running', 'idle', 'loading', 'error', 'disabled'];
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
  // Let the send reach the fetch before Stop is pressed.
  await new Promise((resolve) => setTimeout(resolve, 20));
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
check('the Conversation transcript is drawn from node 0:1221', () => {
  const css = read('src/renderer/styles/components.css');
  const tokens = read('src/renderer/styles/tokens.css');
  const html = read('src/renderer/index.html');
  const composer = read('src/renderer/ui/composer.js');
  const chats = read('src/renderer/ui/chats.js');

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

  // A turn: reader bubble on a 10 px radius and 12 px padding, capped at the widest
  // the node draws it (420 on the one-line Ask turn, 460 on the Act turn beside its
  // file chip, so 460 is the cap); reply text on the node's 620 px measure, 20 px
  // mode badge.
  wants(".message[data-role='user'] .message-text", [
    'max-width: 460px',
    'padding: var(--zuri-space-3)',
    'border-radius: var(--zuri-radius-card)',
  ]);
  wants(".message[data-role='assistant'] .message-text", ['width: 100%', 'max-width: 620px']);
  wants('.message-badge', ['height: 20px', 'border-radius: var(--zuri-radius-pill)']);

  // The file-change card, the streaming row and the failure card.
  wants('.message-tool', [
    'max-width: 620px',
    'padding: var(--zuri-space-3)',
    'border-radius: var(--zuri-radius-card)',
  ]);
  wants('.message-streaming-caret', ['width: 2px', 'height: 16px']);
  wants('.message-streaming', ['height: 16px']);
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
  for (const pattern of [/function syncTranscriptMeta\(/, /No messages yet/, /· streaming/, /· reply failed/]) {
    if (!pattern.test(chats)) throw new Error(`chats.js is missing ${pattern}`);
  }

  return '56 px mark, 520 px openings, 460/620 measures, 16 px streaming row, 2 x 16 caret, 24/8 px skeleton rhythm';
});

check('the demo runner page (node 0:14959) ships its five frames and its palette', () => {
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

  // The scenario's five checks, plus the restart banner the last frame draws.
  for (const step of [
    'Schedule a run one minute out',
    'Let the schedule fire',
    'Post the finished notification',
    'Add the follow-up reminder',
    'Restart and catch up',
  ]) {
    if (!page.includes(step)) throw new Error(`demo.html is missing the step "${step}"`);
  }
  if (!/class="demo-banner"/.test(page)) throw new Error('demo.html is missing the restart banner');

  // The page token block exists and the stylesheet takes every colour from it.
  if (!/^\.demo-page \{/m.test(tokens)) throw new Error('tokens.css has no .demo-page block');
  if (/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(styles)) throw new Error('demo.css holds a colour literal instead of a token');

  // Phone first: the tab strip stays on screen and the page never scrolls sideways.
  if (!/@media \(max-width: 720px\)/.test(styles)) throw new Error('demo.css has no phone breakpoint');
  if (!/\.demo-nav\s*\{[^}]*order: 3/.test(styles)) {
    throw new Error('the phone layout does not keep the tab strip on screen');
  }

  return `${frames.length} frames, 5 steps, tokens only`;
});

// Clean up before the summary so a leftover temp folder cannot outlive the run.
for (const directory of tempRoots) {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
