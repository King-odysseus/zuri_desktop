/** Node-only checks for the React renderer and main-process contracts. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const pendingChecks = [];

// A check may be sync or async; async ones are awaited before the final verdict.
function check(name, run) {
  const report = (detail) => console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  const fail = (error) => {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  };
  try {
    const outcome = run();
    if (outcome && typeof outcome.then === 'function') pendingChecks.push(outcome.then(report, fail));
    else report(outcome);
  } catch (error) {
    fail(error);
  }
}

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const packageJson = JSON.parse(read('package.json'));

check('React build output exists', async () => {
  const missingNow = () => ['dist-react/index.html', 'dist-react/assets'].filter((entry) => !exists(entry));
  // `npm test` builds first, but vite clears the output folder before it writes
  // anything, so a second build in the same checkout empties it for the length of
  // that build. Waiting tells "never built" apart from "being built right now";
  // an output that is already there is accepted on the first look, with no wait.
  let missing = missingNow();
  for (let waited = 0; missing.length > 0 && waited < 40000; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    missing = missingNow();
  }
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
  return 'dist-react';
});

check('the app package points at the React main process', () => {
  if (packageJson.main !== 'src/main/bootstrap.js') throw new Error(`main is ${packageJson.main}`);
  if (!exists('src/main/bootstrap.js')) throw new Error('bootstrap.js is missing');
  if (!read('src/main/bootstrap.js').includes("await import('./main.js')")) {
    throw new Error('bootstrap does not load the main process');
  }
  if (!packageJson.build?.files?.includes('dist-react/**/*')) {
    throw new Error('electron-builder does not package dist-react');
  }
  const runtimeResources = packageJson.build?.extraResources ?? [];
  for (const required of ['node_modules/es-abstract-get', 'node_modules/es-errors']) {
    if (!runtimeResources.some((entry) => entry?.from === required && entry?.to === required)) {
      throw new Error(`missing packaged runtime resource ${required}`);
    }
  }
  return packageJson.main;
});

check('the Windows app identity uses the Zuri icon', () => {
  const source = read('src/main/main.js');
  if (!exists('src/main/assets/zuri-icon.ico') || !exists('src/main/assets/zuri-icon.png')) {
    throw new Error('Zuri icon assets are missing');
  }
  for (const required of ["if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId(APP_USER_MODEL_ID)", "if (process.platform !== 'win32' || !app.isPackaged) return", "const WINDOWS_SHELL_ICON = app.isPackaged ? process.execPath : ICO_ENTRY", "icon: process.platform === 'win32' ? ICO_ENTRY : ICON_ENTRY", "window.setIcon(ICO_ENTRY)", "window.setAppDetails({", "appIconPath: WINDOWS_SHELL_ICON", "shell.readShortcutLink(staleElectronLink)", "path.basename(details.target ?? '').toLowerCase() === 'electron.exe'", "unlinkSync(staleElectronLink)", "shell.writeShortcutLink", "app.getPath('desktop')"]) {
    if (!source.includes(required)) throw new Error(`missing ${required}`);
  }
  if (!source.includes("const APP_USER_MODEL_ID = 'com.zuri.desktop.Zuri'")) {
    throw new Error('the installed app does not have its isolated production identity');
  }
  if (source.includes('const isSourceRun')) throw new Error('source launches can still rewrite installed shortcuts');
  if (packageJson.build?.win?.icon !== 'src/main/assets/zuri-icon.ico') {
    throw new Error('Windows packaging does not use zuri-icon.ico');
  }
  return 'Zuri icon assets and taskbar identity are configured';
});

check('Android wears the same Zuri mark as the desktop and web', () => {
  // The phone was the one surface still shipping the stock Capacitor art: a grey
  // cross on a white plate and a blue cross on the splash. Nothing checked it, so
  // it drifted. These assertions read files only (no image decoding), which is
  // enough to catch the artwork being replaced by the template again.
  const res = 'android/app/src/main/res';
  const missing = [];
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      if (!exists(`${res}/mipmap-${density}/${name}`)) missing.push(`mipmap-${density}/${name}`);
    }
  }
  // Only the folders Capacitor draws a splash for; drawable-v24 held icon vectors, not a splash.
  const splashFolders = fs.readdirSync(path.join(root, res)).filter((entry) => /^drawable(-(land|port)-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi))?$/.test(entry));
  for (const folder of splashFolders) {
    if (!exists(`${res}/${folder}/splash.png`)) missing.push(`${folder}/splash.png`);
  }
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);

  const plate = read(`${res}/values/ic_launcher_background.xml`);
  if (!/#0D1B3A/i.test(plate)) throw new Error('the adaptive icon plate is not the brand navy');

  const theme = read(`${res}/values/colors.xml`);
  for (const name of ['colorPrimary', 'colorPrimaryDark', 'colorAccent']) {
    if (!new RegExp(`name="${name}"`).test(theme)) throw new Error(`the Android theme does not define ${name}`);
  }
  if (!/#0D1B3A/i.test(theme)) throw new Error('the Android theme is not the brand navy');

  // The Capacitor template's teal, and the white X it drew, must not come back.
  for (const file of fs.readdirSync(path.join(root, res), { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.xml')) continue;
    const body = read(`${res}/${file.split(path.sep).join('/')}`);
    if (/#26A69A/i.test(body)) throw new Error(`${file} still carries the Capacitor teal`);
  }
  return 'launcher, adaptive and splash art plus theme colours';
});

check('main loads the React entry without a legacy fallback', () => {
  const source = read('src/main/main.js');
  if (!source.includes("path.join(moduleDir, '..', '..', 'dist-react', 'index.html')")) {
    throw new Error('main.js does not load dist-react/index.html');
  }
  if (source.includes("'renderer', 'index.html'")) throw new Error('legacy renderer fallback remains');
});

check('the renderer entry has no Node globals', () => {
  const source = read('src/renderer-react/App.jsx');
  if (/\b(require|process|__dirname)\b/.test(source)) throw new Error('Node global found in App.jsx');
});

check('the bridge remains isolated', () => {
  const source = read('src/main/main.js');
  for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'loadFile(RENDERER_ENTRY)']) {
    if (!source.includes(setting)) throw new Error(`missing ${setting}`);
  }
});

check('the native desktop chrome follows the saved theme', () => {
  const source = read('src/main/main.js');
  for (const required of ['nativeTheme', 'applyNativeTheme(saved.data?.theme)', 'nativeTheme.themeSource']) {
    if (!source.includes(required)) throw new Error(`missing ${required}`);
  }
  return 'native title bar and menu theme are synchronized';
});

check('dates, times and numbers are HeroUI fields, never the browser picker', () => {
  // The browser's own date, time and number pickers ignore the page's palette:
  // a white calendar drops onto the navy theme. Both surfaces therefore go
  // through their shared date, time and number controls instead.
  const nativePicker = /type="(?:date|time|datetime-local|number)"/;
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.jsx?$/.test(entry.name)) sources.push(next);
    }
  };
  walk('src/renderer-react');
  walk('web/src');
  const offenders = sources.filter((file) => nativePicker.test(read(file)));
  if (offenders.length > 0) throw new Error(`native date, time or number input in ${offenders.join(', ')}`);
  for (const ui of ['src/renderer-react/ui.jsx', 'web/src/components/ui.jsx']) {
    const source = read(ui);
    for (const component of ['DateField', 'TimeField', 'NumberField']) {
      if (!source.includes(`export function ${component}`)) throw new Error(`${ui} does not export ${component}`);
    }
  }
  return `${sources.length} files use the shared fields`;
});

check('the prompt enhancer rewrites the message as well as offering additions', () => {
  // Both halves are the point of the button: better wording in the box, and the
  // details the message left open. A surface that drew only the list looked like the
  // button did nothing, which is what a person reported.
  const web = read('web/src/views/ChatView.jsx');
  const desktop = read('src/renderer-react/ChatPanel.jsx');
  for (const [name, source, setter] of [
    ['web', web, 'setDraft(text)'],
    ['desktop', desktop, 'setDraft(improved)'],
  ]) {
    if (!source.includes(setter)) throw new Error(`the ${name} composer never takes the rewritten prompt`);
    if (!source.includes('setEnhanceSuggestions(')) throw new Error(`the ${name} composer never shows the additions`);
    if (!source.includes('Add to your prompt')) throw new Error(`the ${name} composer has no heading for the additions`);
  }
  return 'both surfaces put the rewrite in the box and the additions beside it';
});

check('the prompt enhancer reply is read as a rewrite and a list, never as an answer', () => {
  return import(pathToFileURL(path.join(root, 'server', 'src', 'prompts.js')).href).then(({ readEnhancerReply }) => {
    const reply = readEnhancerReply([
      'PROMPT:',
      'Write a five slide proposal for a small business owner.',
      'SUGGESTIONS:',
      '- By when: the date you need it.',
      '- Tone: plain and direct.',
    ].join('\n'));
    if (reply.shaped !== true) throw new Error('a reply in the asked shape is not recognised');
    if (reply.prompt !== 'Write a five slide proposal for a small business owner.') {
      throw new Error('the rewrite was not read out of the first block');
    }
    if (reply.suggestions.length !== 2) throw new Error('the additions were not read out of the second block');
    // Prose before the blocks is what a model writes when it answers instead, and it
    // must never be glued onto the message the person sends.
    const chatty = readEnhancerReply('Sure, here is a better prompt.\nPROMPT:\nRewrite this.\nSUGGESTIONS:');
    if (chatty.prompt !== 'Rewrite this.') throw new Error('the opening line leaked into the rewritten prompt');
    const unshaped = readEnhancerReply('Here is a proposal for your business.');
    if (unshaped.shaped !== false || unshaped.prompt !== '') throw new Error('an answer was read as a rewritten prompt');
    return 'the rewrite and the additions are read apart, and an answer is refused';
  });
});

check('a radio is only ever drawn inside a group', () => {
  // HeroUI's Radio reads its selected value from the RadioGroup above it. Drawn on
  // its own it has no group to read, the page throws "Cannot read properties of
  // null (reading 'isDisabled')" while mounting, and the whole window goes blank.
  // That is exactly how the Settings page broke, so every file that draws a Radio
  // has to draw the group too.
  const files = ['src/renderer-react/SettingsView.jsx', 'src/renderer-react/AgeGateView.jsx'];
  for (const file of files) {
    const source = read(file);
    const drawsRadio = /<Radio[\s>]/.test(source);
    if (!drawsRadio) continue;
    if (!/<RadioGroup[\s>]/.test(source)) {
      throw new Error(`${file} draws a Radio with no RadioGroup, which blanks the window`);
    }
    if (!source.includes('RadioGroup') || !/import\s*\{[^}]*RadioGroup/.test(source)) {
      throw new Error(`${file} draws a RadioGroup without importing it`);
    }
  }
  return 'every Radio sits inside a RadioGroup, so none of them can blank a page';
});

check('the account screens are one bright layout', () => {
  // Sign-in, registration and the age question are the first thing anyone sees, and
  // the web account page they have to match is bright. The saved theme is not known
  // when the first of them paints, so the shell declares the light tokens itself for
  // that subtree: a dark choice on this machine must not turn these screens navy.
  const layout = read('src/renderer-react/AuthLayout.jsx');
  if (!layout.includes('data-theme="light"')) {
    throw new Error('the account shell does not declare the light tokens, so a saved dark theme would paint it dark');
  }
  for (const file of ['src/renderer-react/SignInView.jsx', 'src/renderer-react/SignUpView.jsx', 'src/renderer-react/AgeGateView.jsx']) {
    if (!/import AuthLayout from '\.\/AuthLayout\.jsx'/.test(read(file))) {
      throw new Error(`${file} does not use the one shared account layout`);
    }
  }
  // The age answer has to register. HeroUI's Radio draws here without a role or an
  // input, so Continue stayed disabled however the row was clicked; the two choices
  // are native radios in a named fieldset instead.
  const age = read('src/renderer-react/AgeGateView.jsx');
  if (/<Radio[\s>]/.test(age)) {
    throw new Error('the age question draws HeroUI Radios again, which do not register the answer');
  }
  if (!age.includes('<fieldset') || !age.includes('type="radio"')) {
    throw new Error('the age question is not a fieldset of real radio buttons');
  }
  if (!read('src/renderer-react/app.css').includes('.zuri-auth-page')) {
    throw new Error('the account shell has no styles of its own, so it cannot match the web card');
  }
  return 'sign-in, registration and the age question share one bright layout';
});

check('the colour scheme is one switch on every surface', () => {
  // Light and dark are one on-off question, so each place that asks it draws one
  // switch. Two radio circles stacked into a column of dots on a narrow window,
  // which is what the settings page did, and a bare icon button hid which way the
  // setting was. The two state colours are named here too: HeroUI paints the off
  // track from its own token, and this theme set that to almost the page colour,
  // so a switch read as an empty pill in light mode.
  const desktop = read('src/renderer-react/SettingsView.jsx');
  if (!/function ThemeSwitch\(/.test(desktop)) throw new Error('the desktop theme control is not the switch');
  if (/<Choice label="(Light|Dark)"/.test(desktop)) throw new Error('the desktop asks light-or-dark with radios again');

  for (const file of ['web/src/components/TopBar.jsx', 'web/src/views/SettingsView.jsx']) {
    const source = read(file);
    if (!/<Switch/.test(source)) throw new Error(`${file} no longer draws the theme switch`);
    if (/label=\{theme === 'dark' \? 'Switch to light/.test(source)) {
      throw new Error(`${file} is a theme button again, not a switch`);
    }
  }

  for (const [file, ink] of [['web/src/styles.css', '--text'], ['src/renderer-react/app.css', '--foreground']]) {
    const css = read(file);
    if (!css.includes('--switch-control-bg-checked: var(--brand-blue)')) {
      throw new Error(`${file} does not give the switch a colour when it is on`);
    }
    if (!css.includes(`var(${ink}) 32%`)) {
      throw new Error(`${file} does not give the switch a visible track when it is off`);
    }
  }
  // The desktop sidebar carries no theme control: the switch lives in Settings.
  const sidebar = read('src/renderer-react/Sidebar.jsx');
  if (/Dark mode|Light mode|AccountMenuSwitchRow/.test(sidebar)) {
    throw new Error('the desktop sidebar holds a theme control again');
  }

  return 'one switch per surface, with a track that reads in both positions and both schemes';
});

check('an allowance bar is the shared HeroUI one, not a hand-drawn box', () => {
  // A width on an empty div announces nothing to a screen reader. HeroUI's
  // ProgressBar carries role and aria-valuenow, so every allowance reading goes
  // through the one wrapper in components/ui.jsx.
  const overview = read('web/src/views/OverviewView.jsx');
  if (/role="progressbar"/.test(overview)) {
    throw new Error('the overview draws its own progressbar again');
  }
  if (!/<UsageBar/.test(overview)) {
    throw new Error('the overview no longer uses the shared allowance bar');
  }
  return 'the overview allowance reads through the shared HeroUI bar';
});

check('the send button is a circle and an addition is a pill', () => {
  // A general button radius once caught the send button and squared it off, and a
  // zero radius on the additions left them as bare rows. Both are named here so a
  // wider rule cannot quietly reshape them again.
  const web = read('web/src/styles.css');
  const chat = read('web/src/views/ChatView.jsx');
  const send = /\.chat-composer \.chat-send \{([^}]*)\}/.exec(web)?.[1] ?? '';
  if (!send.includes('border-radius: 999px')) throw new Error('the web send button is no longer a circle');
  const suggestion = /\.chat-suggestion \{([^}]*)\}/.exec(web)?.[1] ?? '';
  if (!suggestion.includes('border-radius: 9999px')) throw new Error('a suggested addition is not a pill');
  // The desktop carries the pill on the element itself.
  const panel = read('src/renderer-react/ChatPanel.jsx');
  if (!panel.includes('zuri-suggestion flex w-auto max-w-full')) throw new Error('the desktop addition is not a pill sized to its own words');
  if (!/rounded-full/.test(panel)) throw new Error('the desktop addition is no longer rounded');
  return 'the send button is a circle and suggested additions are pills on both surfaces';
});

check('a search field is one box, never a field inside a box', () => {
  // The pill draws the box; the field inside it must draw nothing at all, or the
  // search reads as one box inside another. Read as plain text so a stylesheet
  // change cannot turn into a broken pattern here.
  const pairs = [
    ['web/src/styles.css', '.conversation-search .input'],
    ['src/renderer-react/app.css', '.zuri-settings-search .input'],
  ];
  for (const [sheet, marker] of pairs) {
    const css = read(sheet);
    const at = css.indexOf(marker);
    if (at === -1) throw new Error(sheet + ' no longer flattens its search field');
    const body = css.slice(at, css.indexOf('}', at));
    for (const declaration of ['background: transparent', 'box-shadow: none', 'border-radius: 0']) {
      if (!body.includes(declaration)) throw new Error(sheet + ' lets the inner search field draw itself again');
    }
  }
  return 'both search fields are see-through inside a single pill';
});

check('an empty composer is one line, and no row looks selected until it is', () => {
  const chat = read('web/src/views/ChatView.jsx');
  const desktop = read('src/renderer-react/ChatPanel.jsx');
  // scrollHeight already covers the field's own padding. Adding it again made an
  // empty box 18px taller than one line, which read as two lines of empty space.
  if (/scrollHeight \+ padding/.test(chat)) throw new Error('the web composer counts its padding twice again');
  if (/scrollHeight \+ padding/.test(desktop)) throw new Error('the desktop composer counts its padding twice again');
  if (!chat.includes('const measured = node.scrollHeight;')) throw new Error('the web composer no longer measures the field as it is');
  // New chat is an action. A permanent fill made it look like the current chat.
  const css = read('src/renderer-react/app.css');
  const at = css.indexOf('.zuri-sidebar-panel .zuri-new-chat {');
  const rule = at === -1 ? '' : css.slice(at, css.indexOf('}', at));
  if (/background: var\(--brand-blue-soft\)/.test(rule)) {
    throw new Error('the New chat row is filled again, so it reads as the selected chat');
  }
  return 'the empty composer is one line and New chat is not permanently filled';
});

check('the saved-chat column names itself and opens the chat history', () => {
  const chat = read('web/src/views/ChatView.jsx');
  const app = read('web/src/App.jsx');
  const history = read('web/src/views/HistoryView.jsx');
  if (!chat.includes('chat-recents-head')) throw new Error('the list has no heading of its own');
  if (!chat.includes('onOpenHistory')) throw new Error('the heading has no way through to the history');
  if (!app.includes("'history'")) throw new Error('the history screen has no address of its own');
  // The screen exists to hold what Recents does not: the archived chats, with the
  // means to restore or delete them.
  if (!history.includes('fetchConversations(') || !/true\s*\)/.test(history)) throw new Error('the history does not ask for the archived chats');
  if (!history.includes('deleteConversation') || !history.includes('setConversationFlags')) {
    throw new Error('the history cannot delete or restore a chat');
  }
  return 'the column carries a Recents heading, a history control and a screen behind it';
});

check('the chat takes the whole window and only the transcript scrolls', () => {
  const dashboard = read('web/src/views/Dashboard.jsx');
  const styles = read('web/src/styles.css');
  const topBar = read('web/src/components/TopBar.jsx');
  if (!dashboard.includes("isChat ? ' is-chat' : ''")) throw new Error('the chat view does not mark the shell');
  if (!/if \(signedIn\) return null;/.test(topBar)) throw new Error('the public bar still takes space above the signed-in shell');
  // The shell is as tall as the window and the chat content fills whatever is left
  // of it. A fixed 100dvh on the content ignored anything above the app, so the
  // height comes from the shell instead.
  if (!/\.app \{[^}]*min-height: 100dvh;/.test(styles)) throw new Error('the signed-in shell is not as tall as the window');
  if (!/\.app-main\.is-chat \.app-content \{[^}]*height: 100%;/.test(styles)) {
    throw new Error('the chat does not fill the signed-in window');
  }
  if (!/\.chat-transcript \{[^}]*overflow-y: auto;/.test(styles)) throw new Error('the transcript does not scroll on its own');
  if (!/\.chat-composer-wrap \{[^}]*flex: 0 0 auto;/.test(styles)) throw new Error('the composer is not pinned under the transcript');
  return 'full-height chat, scrolling transcript, fixed composer';
});

check('the model beside Send is a menu anchored to its own chip', () => {
  const source = read('web/src/views/ChatView.jsx');
  if (!source.includes('role="menu" aria-label="Choose a model"')) {
    throw new Error('the model is not offered as a menu');
  }
  // The chip carries its own list: a floating panel measured the shrunken phone
  // chip and left its corner short of the button it belongs to.
  if (!/\.chat-model-menu \{[^}]*position: absolute;[^}]*right: 0;/.test(read('web/src/styles.css'))) throw new Error('the model menu is not anchored to its chip');
  if (!source.includes('setModel(entry.code);')) throw new Error('a model cannot be picked');
  if (!source.includes('setModel(data.model)')) throw new Error('a chat does not reopen on its own model');
  return 'chip-anchored menu, per-chat model restored on open';
});

// The composer menus were aligned twice and drifted back both times: every row is a
// HeroUI Button, and the button base centres what it holds, so a row only looked
// left-aligned when its label happened to stretch to fill the row. That is how four
// rows sat centred and three sat left in the same menu. The label column is held by
// CSS rather than by each row's markup, so this check pins the rule itself.
check('every composer menu row sits on one gutter', () => {
  const desktopCss = read('src/renderer-react/app.css');
  if (!/\.zuri-composer-menu \.button\s*\{[^}]*justify-content:\s*flex-start/.test(desktopCss)) {
    throw new Error('desktop menu rows fall back to the button base, which centres them');
  }
  // The base shaves 2px off each side of a glyph, which moves that row's own label off
  // the column the iconless rows use.
  if (!/\.zuri-add-menu \.button > svg\s*\{[^}]*margin-inline:\s*0/.test(desktopCss)) {
    throw new Error('the add menu glyph is shaved, so icon-led labels leave the label column');
  }
  if (read('src/renderer-react/ChatPanel.jsx').split('w-4 shrink-0').length - 1 < 2) {
    throw new Error('a desktop row with no glyph starts a glyph width left of the others');
  }

  const webCss = read('web/src/styles.css');
  if (!/\.chat-menu-row,\s*\.chat-menu-back\s*\{[^}]*justify-content:\s*flex-start/.test(webCss)) {
    throw new Error('web menu rows fall back to the button base, which centres them');
  }
  // A row with no glyph keeps an empty slot of the same width, or it starts one glyph
  // left of the rows that carry one.
  if (!/\.chat-menu-slot\s*\{/.test(webCss)) throw new Error('the web menu has no empty glyph slot');
  if (read('web/src/views/ChatView.jsx').split('chat-menu-slot').length - 1 < 4) {
    throw new Error('a web row with no glyph starts a glyph width left of the others');
  }

  return 'menu rows share one glyph column and one label column';
});

check('conversation search is capped and encoded before it reaches the server', () => {
  const api = read('web/src/lib/api.js');
  const control = read('web/src/components/ConversationSearch.jsx');
  if (!/export async function fetchConversations\(query = ''/.test(api)) throw new Error('conversation fetch does not accept a search query');
  if (!api.includes('slice(0, 120)')) throw new Error('conversation search has no length cap');
  if (!api.includes('encodeURIComponent(trimmed)')) throw new Error('conversation search is not URL encoded');
  if (!control.includes('aria-label="Search conversations"')) throw new Error('search control is not labelled');
  if (!control.includes('Clear conversation search')) throw new Error('search control has no clear action');
  return 'bounded, encoded server search with an accessible clearable control';
});

/*
 * The sidebar lost three things when the chat moved onto HeroUI, and each one was
 * invisible to the type checker: HeroUI's button carries a fixed height, so the
 * column of name and time inside it shrank the name to zero and every row showed
 * only its age; the input drew its own rounded focus ring inside the styled field,
 * so the search looked like a box within a box; and the Recents heading with its
 * history button was gone, leaving no way to reach a chat that had been archived.
 * Each assertion below pins the thing that was missing, not the markup around it.
 */
check('a chat row keeps its name and its last words, and the search is one field', () => {
  const css = read('web/src/styles.css');
  const chat = read('web/src/views/ChatView.jsx');
  const app = read('web/src/App.jsx');
  const dashboard = read('web/src/views/Dashboard.jsx');

  // A row must be free to grow past HeroUI's fixed button height, or the name is
  // the part that gives way.
  const rowHeight = /\.chat-recent-open\s*\{([^}]*)\}/g;
  const heights = Array.from(css.matchAll(rowHeight), (match) => match[1]);
  if (!heights.some((block) => /height:\s*auto/.test(block))) {
    throw new Error('the chat row still takes HeroUI\'s fixed height, which collapses the name');
  }

  // The name and the quote are the two things a person reads; the row must draw both.
  if (!chat.includes('className="chat-recent-title"')) throw new Error('the row has no name');
  if (!chat.includes('function previewOf(')) throw new Error('the row has no quote of the last message');
  if (!chat.includes('className="chat-recent-snippet"')) throw new Error('the quote is not drawn in the row');

  // One rounded box: the field draws the box and the input inside it draws nothing.
  const field = /\.conversation-search \.input,\s*\.conversation-search input\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  if (!/box-shadow:\s*none/.test(field)) throw new Error('the search input draws its own box inside the field');
  if (!/border-radius:\s*0/.test(field)) throw new Error('the search input keeps its own rounded corners inside the field');
  if (!/\.conversation-search:focus-within/.test(css)) throw new Error('the search field has no focus ring of its own');

  // Recents needs a heading and a way into the chats it no longer lists.
  if (!chat.includes('chat-recents-head')) throw new Error('the Recents heading is missing');
  if (!chat.includes('label="Chat history"')) throw new Error('the history button is missing from Recents');
  if (!chat.includes('onOpenHistory')) throw new Error('the history button goes nowhere');
  if (!/const VIEWS = \[[^\]]*'history'/.test(app)) throw new Error('the app has no history section to open');
  if (!dashboard.includes('<HistoryView')) throw new Error('the history section is not drawn');

  return 'name and quote on every row, one search field, Recents heading and a working history button';
});

check('web chat prompts can be edited and the latest reply regenerated', () => {
  const view = read('web/src/views/ChatView.jsx');
  if (!view.includes('Edit and send again')) throw new Error('web prompts have no edit action');
  if (!view.includes('Regenerate reply')) throw new Error('latest replies have no regenerate action');
  if (!view.includes('send(message.content)')) throw new Error('regenerate does not replay the latest prompt');
  return 'prompt edit and latest-reply regeneration controls are wired';
});

// The browser chat shipped for weeks without the row of one-press rewrites the
// desktop shows, because the four labels lived inside ChatPanel.jsx where the web
// view could not see them. Asserting the imports is what keeps the list shared;
// asserting the map call is what keeps the row on the page.
check('both chats draw the one-press rewrites from the one shared list', () => {
  const chat = read('web/src/views/ChatView.jsx');
  const panel = read('src/renderer-react/ChatPanel.jsx');
  const shared = read('src/renderer-react/answerAdjustments.js');

  const imports = /import\s*\{\s*QUICK_ADJUSTMENTS\s*\}\s*from\s*['"][^'"]*answerAdjustments\.js['"]/;
  if (!imports.test(chat)) throw new Error('the web chat does not import QUICK_ADJUSTMENTS from answerAdjustments.js');
  if (!imports.test(panel)) throw new Error('the desktop panel does not import QUICK_ADJUSTMENTS from answerAdjustments.js');

  // A second copy of the labels is the drift this check exists to catch: whichever
  // surface keeps its own array can lose a rewrite without the other noticing.
  for (const [name, source] of [['ChatView.jsx', chat], ['ChatPanel.jsx', panel]]) {
    if (/const\s+QUICK_ADJUSTMENTS\s*=/.test(source)) throw new Error(name + ' still declares its own QUICK_ADJUSTMENTS');
  }

  // The shared module is the only place the four rewrites are named.
  if (!/export\s+const\s+QUICK_ADJUSTMENTS\s*=/.test(shared)) {
    throw new Error('answerAdjustments.js does not export QUICK_ADJUSTMENTS');
  }
  for (const label of ['Shorter', 'More detail', 'Explain simply', 'As a table']) {
    if (!new RegExp("label:\\s*['\"]" + label + "['\"]").test(shared)) {
      throw new Error('the shared list has no ' + label + ' rewrite');
    }
  }

  // The web row is drawn from that list, and a press sends the rewrite as a prompt
  // rather than editing the reply, so the earlier answer stays to compare against.
  if (!/QUICK_ADJUSTMENTS\s*\.\s*map\s*\(/.test(chat)) throw new Error('the web chat does not draw the rewrites from the shared list');
  if (!/className=\{?['"]chat-quick-adjust['"]/.test(chat)) throw new Error('the web chat draws the rewrites without the chat-quick-adjust class');
  if (!/send\(\s*adjustment\.text\s*,\s*\{\s*rewrite:\s*true\s*\}\s*\)/.test(chat)) throw new Error('pressing a rewrite does not send its own text');
  if (!/QUICK_ADJUSTMENTS\s*\.\s*map\s*\(/.test(panel)) throw new Error('the desktop panel no longer draws the rewrites');

  // Newest reply only, and not while one is being written: a rewrite offered
  // mid-stream would send a second request over the first.
  const rowAt = chat.search(/QUICK_ADJUSTMENTS\s*\.\s*map\s*\(/);
  const condition = chat.slice(Math.max(0, rowAt - 240), rowAt);
  if (!/index\s*===\s*lastAnswerIndex/.test(condition)) {
    throw new Error('the web chat offers the rewrites under an older reply too');
  }
  if (!/!\s*streaming/.test(condition)) throw new Error('the web chat offers a rewrite while a reply is still streaming');

  return 'four rewrites from one shared list, newest reply only, on both surfaces';


});

check('Android chat drafts persist locally and clear on send', () => {
  const view = read('web/src/views/ChatView.jsx');
  const drafts = read('web/src/lib/drafts.js');
  if (!view.includes("useState(() => readChatDraft())")) throw new Error('the composer does not restore a draft');
  if (!view.includes('saveChatDraft(draft)')) throw new Error('draft changes are not persisted');
  if (!view.includes('clearChatDraft()')) throw new Error('the draft is not cleared after an action');
  for (const required of ['localStorage.getItem', 'localStorage.setItem', 'localStorage.removeItem']) {
    if (!drafts.includes(required)) throw new Error(`draft storage is missing ${required}`);
  }
  return 'unsent text survives reloads without blocking private browsing';
});

check('web chat messages can use the Android share sheet', () => {
  const view = read('web/src/views/ChatView.jsx');
  const share = read('web/src/lib/share.js');
  if (!view.includes("import { shareText } from '../lib/share.js'")) throw new Error('the chat has no share helper');
  if (!view.includes('label="Share message"')) throw new Error('messages have no share action');
  if (!share.includes('navigator.share')) throw new Error('the share helper does not use the platform share sheet');
  if (!view.includes('the message was copied')) throw new Error('share fallback is not explained');
  return 'Android share sheet with a copy fallback';
});

check('a chat continued in the browser refreshes the desktop without a restart', () => {
  const main = read('src/main/main.js');
  if (!main.includes("(Number(result.data?.appended) || 0) > 0) announceState({ area: 'chats' })")) {
    throw new Error('pulled messages do not announce a change');
  }
  // Announcing is only half of it: the transcript on screen has to re-read too, or
  // the turns someone just wrote in the browser stay invisible in an open chat.
  const panel = read('src/renderer-react/ChatPanel.jsx');
  if (!panel.includes("change?.area !== 'chats' || threadId === '' || replying")) {
    throw new Error('the open transcript does not listen for pulled messages');
  }
  if (!panel.includes('thread.messages.length > previous.length ? thread.messages : previous')) {
    throw new Error('a refresh could drop a reply that is still being written');
  }
  return 'background sync announces, and the open transcript re-reads';
});

check('a chat started in the browser is taken on, and a delete or clear is not undone', () => {
  const sync = read('src/main/chat-sync.js');
  // The sweep is driven by chats.json, so only a list of the account can reach a chat that
  // has no thread here. Without this call the browser's chats never arrive at all.
  if (!sync.includes('await adoptConversations(cap, totals)')) throw new Error('the sweep never asks the account what it holds');
  if (!sync.includes("await call(conversationPath(''))")) throw new Error('the account is never listed');
  // Deleting is best effort against the account, so the id has to be kept here or the next
  // sweep adopts the chat straight back.
  if (!sync.includes('deletedCloudIds')) throw new Error('a deleted chat is not remembered, so the next sweep would adopt it back');

  // Clearing chats empties chats.json, which is where the links live. The cloud ids are
  // read first so the account copies go too, instead of being adopted back.
  const main = read('src/main/main.js');
  if (!main.includes('const cloudIds = (listed?.ok === true ? listed.data : [])')) throw new Error('clearing chats leaves the account copies to be adopted back');
  return 'the account is listed, and deletes and clears are remembered';
});

check('the account menu closes on Escape and names itself for screen readers', () => {
  const dashboard = read('web/src/views/Dashboard.jsx');
  if (!dashboard.includes("event.key !== 'Escape'")) throw new Error('Escape does not close the account menu');
  if (!dashboard.includes('role="menu"')) throw new Error('the account menu has no menu role');
  if (!dashboard.includes('aria-haspopup')) throw new Error('the account button does not announce a popup');
  return 'Escape closes the menu and it is announced as a menu';
});

check('the web chat is built from HeroUI components and one icon family', () => {
  const chat = read('web/src/views/ChatView.jsx');
  const dashboard = read('web/src/views/Dashboard.jsx');
  const ui = read('web/src/components/ui.jsx');

  // Icons come from one family, defined once and re-exported by the web module, so
  // the desktop window and the browser cannot drift apart. Lucide is only the
  // drawing engine inside that family and must not be imported anywhere else.
  const family = read('src/renderer-react/Icons.jsx');
  if (!family.includes("from 'lucide-react'")) throw new Error('the icon family is not drawn on the shared grid');
  const shared = read('web/src/components/Icons.jsx');
  if (!shared.includes('renderer-react/Icons.jsx')) throw new Error('the web icon module does not re-export the family');
  for (const page of ['web/src/views/ChatView.jsx', 'web/src/views/OverviewView.jsx', 'web/src/views/Landing.jsx', 'web/src/components/ConversationSearch.jsx']) {
    if (read(page).includes("from 'lucide-react'")) throw new Error(page + ' draws icons from the package directly');
  }

  // Every icon control goes through the one wrapper, so a raw button with an icon
  // cannot creep back in beside the components.
  if (!ui.includes('export function IconButton(')) throw new Error('there is no shared IconButton');
  if (!ui.includes('aria-label={label}')) throw new Error('the icon button is unnamed for screen readers');
  for (const [name, source] of [['chat', chat], ['shell', dashboard]]) {
    const raw = (source.match(/<button[\s>]/g) ?? []).length;
    // Every control is a HeroUI component now, so no page may draw a plain button:
    // the shared wrapper is the only way in.
    if (raw > 0) throw new Error(`${name} still draws ${raw} raw buttons instead of the shared Button`);
  }

  // The composer is a HeroUI textarea, so a piece of Flowbite cannot creep back in;
  if (!chat.includes('TextArea') || !chat.includes("from '@heroui/react'")) throw new Error('the composer is not a HeroUI textarea');
  if (!chat.includes('chat-model-menu')) throw new Error('the model menu is not anchored to its chip');

  return 'HeroUI controls, one icon family, one copy path';
});

check('the reply house style is the same in the server and the app', async () => {
  // The rule is written twice because Railway uploads server/ on its own, so a
  // shared module would never reach it. The corpus below is the contract: both
  // copies must answer identically, or a reply reads one way in the account and
  // another way on the device.
  const server = await import(pathToFileURL(path.join(root, 'server/src/text.js')).href);
  const app = await import(pathToFileURL(path.join(root, 'src/renderer-react/formatting.js')).href);

  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  const corpus = [
    `a ${em} b`,
    `a${em}b`,
    `2024${en}2026`,
    `10 ${em} 20`,
    `before \`code ${em} here\` after ${em} word`,
    '```\nconst s = "a ' + em + ' b";\n```\nplain ' + en + ' text',
    'no dashes here',
    '',
    `- list item ${em} with a dash`,
    `| a | b |\n| --- | --- |\n| 1 ${en} 2 | 3 |`,
  ];
  for (const sample of corpus) {
    if (server.plainDashes(sample) !== app.plainDashes(sample)) {
      throw new Error(`the two copies disagree about: ${JSON.stringify(sample)}`);
    }
  }

  // And the rule itself must hold: a typographic dash may survive only inside
  // code, where it is the program's own text.
  const prose = server.plainDashes(`one ${em} two and 4 ${en} 5`);
  if (/[\u2013\u2014]/.test(prose)) throw new Error('a dash survived the rewrite');
  if (!prose.includes('4-5')) throw new Error('a numeric range lost its shape');

  // Every conversation carries the instruction exactly once.
  const ruled = server.withFormattingRules([{ role: 'user', content: 'hi' }]);
  if (ruled.length !== 2 || ruled[0].role !== 'system') throw new Error('the house style is not sent');
  if (server.withFormattingRules(ruled).length !== 2) throw new Error('the house style is sent twice');

  // Both sides must actually use it, or the rule only holds in the test.
  if (!read('src/renderer-react/FormattedMessage.jsx').includes('plainDashes(')) {
    throw new Error('the reply renderer does not apply the house style');
  }
  const route = read('server/src/app.js');
  if (!route.includes('withFormattingRules(')) throw new Error('the chat route does not send the house style');
  if (!route.includes('plainDashes(')) throw new Error('the chat route does not rewrite the reply');

  return 'one rule, two copies that agree, applied on both sides';
});

check('the Office pane is a composer, not a form', () => {
  const pane = read('src/addin/taskpane.html');
  for (const required of ['id="prompt"', 'id="thread"', 'id="send"', 'id="stop"', 'id="context-text"', 'ops.js']) {
    if (!pane.includes(required)) throw new Error(`the pane has no ${required}`);
  }
  // The old screen was three boxes and one button: an answer was copied by hand and
  // the conversation was lost the moment the pane closed.
  for (const gone of ['id="answer"', 'id="context"', 'id="ask"']) {
    if (pane.includes(gone)) throw new Error(`the pane still has the old ${gone} control`);
  }

  const script = read('src/addin/taskpane.js');
  for (const required of ["fetch('/api/chat'", 'state.messages.push', 'AbortController', 'applyOperations', 'readExcel', 'readWord', 'readPowerPoint']) {
    if (!script.includes(required)) throw new Error(`the pane script never uses ${required}`);
  }
  // A change must be reviewable: nothing reaches the file without an Apply press.
  if (!script.includes('Nothing changes until you press Apply')) throw new Error('a change is applied without asking');
  if (!script.includes("localStorage")) throw new Error('the conversation is not kept across a pane reload');
  return 'composer, streaming, review, and a kept conversation';
});

check('the Office pane waits to be told which app it is in', () => {
  const script = read('src/addin/taskpane.js');
  // Excel once showed a Word screen: when office.js was slow the pane assumed Word, then
  // ran Word's API against a workbook, so it hung on "Reading the file..." for ever.
  for (const source of ['_host_Info', 'Office.context.host', 'hostFromGlobals', 'detectHost']) {
    if (!script.includes(source)) throw new Error(`the pane never asks Office for the host (${source})`);
  }
  if (script.includes('|| COPY.Word')) throw new Error('the pane falls back to a Word screen');
  if (script.includes("state.host = 'Word';")) throw new Error('the pane assumes Word when Office is slow');
  if (!script.includes('Waiting for Office')) throw new Error('the pane has no state for an unnamed host');
  // A read that never settles left the chip reading "Reading the file..." all session.
  if (!script.includes('withDeadline(')) throw new Error('a file read can wait for ever');

  // A pane that cannot load office.js cannot know its host, which is how Excel ended up
  // with a Word screen: the canonical address loads first and the other one is a fallback.
  const page = read('src/addin/taskpane.html');
  if (!page.includes('appsforoffice.microsoft.com/lib/1/hosted/office.js')) {
    throw new Error('office.js is loaded only from an address that does not resolve everywhere');
  }
  if (!page.includes("typeof Office === 'undefined'")) throw new Error('office.js has no fallback address');
  return 'four sources for the host, none of them a guess, and a reachable office.js';
});

check('Word paragraph writes use portable built-in styles', () => {
  const script = read('src/addin/taskpane.js');
  if (!script.includes('applyWordStyle(anchor, paragraph.style)')) throw new Error('Word paragraph writes still assign raw style names');
  if (!script.includes('applyWordStyle(selection, operation.style)')) throw new Error('Word selection styles still assign raw style names');
  if (!script.includes('paragraph.styleBuiltIn = builtIn')) throw new Error('Word paragraph styles are not assigned through styleBuiltIn');
  if (!script.includes("heading1: 'Heading1'")) throw new Error('Heading 1 is not mapped to Word BuiltInStyleName');
  return 'invalid display names cannot cancel the whole Word write';
});

check('the Office pane wears the same clothes as the app and the phone build', () => {
  const css = read('src/addin/taskpane.css');

  // The pane once had its own small scale of 8-10px corners and a hairline round every
  // control, so a panel docked in Word looked like a different product from the app.
  for (const token of ['--radius-md: 12px', '--radius-lg: 14px', '--radius-xl: 20px', '--radius-2xl: 28px', '--radius-pill: 999px']) {
    if (!css.includes(token)) throw new Error(`the pane is missing the app's radius token ${token}`);
  }

  /** Every declaration body written for one selector, including a grouped rule. */
  const rule = (selector) => {
    const bodies = [];
    for (const chunk of css.split('}')) {
      const open = chunk.lastIndexOf('{');
      if (open === -1) continue;
      const selectors = chunk.slice(0, open).split(',').map((part) => part.trim().split('\n').pop().trim());
      if (selectors.includes(selector)) bodies.push(chunk.slice(open + 1));
    }
    if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
    return bodies.join('\n');
  };

  // Anything you press is a pill, and a pill is a fill: no hairline outline.
  for (const selector of ['.send', '.stop', '.enhance', '.ghost', '.apply', '.edits-select', '.enhance-chip']) {
    const body = rule(selector);
    if (!body.includes('border-radius: var(--radius-pill)')) throw new Error(`${selector} is not a pill`);
    if (/border:\s*1px/.test(body)) throw new Error(`${selector} still draws a hairline outline`);
  }

  // Surfaces are rounded fills, and the composer is the app's 28px box.
  for (const selector of ['.composer-box', '.ops', '.ops-open', '.suggestion', '.ghost']) {
    const body = rule(selector);
    if (/border:\s*1px/.test(body)) throw new Error(`${selector} draws a hairline border`);
  }
  if (!rule('.composer-box').includes('border-radius: var(--radius-2xl)')) {
    throw new Error('the composer is not the app\u2019s 28px box');
  }

  // A thumb needs a bigger target than a mouse.
  if (!css.includes('@media (pointer: coarse)')) throw new Error('the pane ignores touch screens');
  const lastCoarse = css.lastIndexOf('@media (pointer: coarse)');
  if (css.indexOf('min-height: 44px', lastCoarse) === -1) throw new Error('touch targets are not thumb-sized');
  // The spreadsheet grid keeps its cell lines: that is data, not a card.
  if (!rule('.ops-preview td').includes('border: 1px solid var(--line)')) {
    throw new Error('the spreadsheet preview lost its cell grid');
  }
  return 'pill controls, rounded fill-only cards, a 28px composer, 44px touch targets';
});

check('the Office pane can improve a prompt in Excel, Word and PowerPoint alike', () => {
  const page = read('src/addin/taskpane.html');
  const script = read('src/addin/taskpane.js');
  const server = read('src/main/addin.js');
  const main = read('src/main/main.js');
  const css = read('src/addin/taskpane.css');

  if (!page.includes('id="enhance"')) throw new Error('the pane has no Improve button');
  if (!script.includes("fetch('/api/enhance'")) throw new Error('the pane never asks for an improved prompt');
  if (!script.includes('function enhancePrompt(')) throw new Error('the pane has no enhancer');
  // One page serves all three apps, so any host branch here would give Word or
  // PowerPoint a different enhancer from Excel.
  if (/enhancePrompt[\s\S]{0,400}state\.host ===/.test(script)) {
    throw new Error('the enhancer behaves differently depending on the Office app');
  }
  if (!server.includes("route === '/api/enhance'")) throw new Error('the local add-in server has no enhancer route');
  if (!server.includes('enhance({ prompt, host:')) throw new Error('the route never calls the enhancer');
  if (!main.includes('(request) => handlePromptsEnhance(request)')) throw new Error('the app does not hand the pane its enhancer');
  if (!css.includes('.enhance-chip')) throw new Error('the suggestions have no style');
  // A rewrite replaces the draft, so it must be undoable and must never be sent.
  if (!script.includes("pane.enhance.textContent = 'Undo'")) throw new Error('an improved prompt cannot be undone');
  return 'Improve, undo and suggestions, the same in Excel, Word and PowerPoint';
});

check('the Office pane turns live file context into smart starter prompts', async () => {
  const page = read('src/addin/taskpane.html');
  const script = read('src/addin/taskpane.js');
  const server = read('src/main/addin.js');
  const intelligence = read('src/addin/intelligence.js');
  if (!page.includes('intelligence.js')) throw new Error('the pane does not load its intelligence layer');
  if (!script.includes('paintSmartSuggestions(context)')) throw new Error('the pane never refreshes context-aware suggestions');
  if (!server.includes("'/intelligence.js'")) throw new Error('the add-in server does not serve the intelligence layer');

  const vm = await import('node:vm');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(intelligence, sandbox);
  const smart = sandbox.module.exports;
  const excel = smart.getSmartSuggestions('Excel', [
    'Workbook sheets: Budget, Summary.',
    'Existing formulas:',
    'Excel tables on this sheet: BudgetTable A1:F30.',
    '',
    'Selected cells (B2:C4):',
    'Revenue',
  ].join('\\n'));
  if (!excel.some((item) => /formulas/i.test(item)) || !excel.some((item) => /totals across/i.test(item))) {
    throw new Error('Excel suggestions do not use formulas and workbook structure');
  }

  const word = smart.getSmartSuggestions('Word', 'The document has 14 paragraphs.\\n[Heading 1] Summary\\n\\nSelected text:\\nA short paragraph.');
  if (!word.some((item) => /selected text/i.test(item)) || !word.some((item) => /outline/i.test(item))) {
    throw new Error('Word suggestions do not use selection and document length');
  }

  const powerpoint = smart.getSmartSuggestions('PowerPoint', 'The deck has 6 slides.\\nSlide 2: (no text)\\nSelected text:\\nA title');
  if (!powerpoint.some((item) => /slide titles/i.test(item)) || !powerpoint.some((item) => /no readable text/i.test(item))) {
    throw new Error('PowerPoint suggestions do not use slide structure');
  }
  return 'Excel, Word and PowerPoint starter prompts are based on the current file';
});

check('the Office pane shows thinking before the first streamed token', () => {
  const script = read('src/addin/taskpane.js');
  const css = read('src/addin/taskpane.css');
  if (!script.includes("paintAssistant(body, message);")) throw new Error('the empty assistant row is not painted immediately');
  // An empty reply splits into one blank text segment rather than none, so counting
  // segments drew an empty row: the row has to be judged by what it actually painted.
  if (!script.includes('if (painted === 0)')) throw new Error('an empty reply paints a blank row again');
  if (!script.includes('function waitingRow(')) throw new Error('the pane has no thinking state');
  if (!css.includes('.streaming .bubble::after')) throw new Error('the streaming typing indicator is missing');
  if (!script.includes('setConnection(')) throw new Error('the pane never says whether it is connected');
  if (!css.includes('.conn-dot')) throw new Error('the pane has no connection dot');
  return 'a moving thinking row, a live cursor while text streams, and a connection dot';
});

check('the Office pane says where it is in words, not only with dots', () => {
  const script = read('src/addin/taskpane.js');
  const css = read('src/addin/taskpane.css');
  const page = read('src/addin/taskpane.html');
  // The status line under the composer is easy to miss, so it also fills the row.
  if (!script.includes('state.pendingNote = message')) throw new Error('the status line never reaches the reply row');
  if (!css.includes('.waiting-dots')) throw new Error('the thinking state has nothing that moves');
  if (!css.includes('.waiting-note')) throw new Error('the thinking state cannot show the step it is on');
  if (!page.includes('id="conn-dot"')) throw new Error('the header has no connection dot');
  for (const kind of ['waiting', 'busy', 'ready', 'error']) {
    if (!css.includes(`.conn-dot.is-${kind}`)) throw new Error(`the connection dot has no ${kind} state`);
  }
  if (!css.includes('prefers-reduced-motion')) throw new Error('the dots ignore a request for less motion');
  return 'four connection states, a moving row, and the step named in words';
});

check('the admin area is for admins, with a switch to the user view and back', () => {
  const dashboard = read('web/src/views/Dashboard.jsx');
  const admin = read('web/src/views/AdminView.jsx');
  if (!dashboard.includes("view === 'admin' && (isAdmin ? <AdminView /> : <NoAccess")) throw new Error('the admin view is not gated by the account');
  if (!dashboard.includes('This area is for admins')) throw new Error('a non-admin who opens /admin gets no explanation');
  if (!dashboard.includes('Switch to user view')) throw new Error('admins have no way back to the user view');
  if (!dashboard.includes('Switch to admin view')) throw new Error('admins have no way into the admin view');
  if (!admin.includes('Your sign-in has expired')) throw new Error('expired admin sessions have no recovery message');
  if (!admin.includes('This account is not marked as a Zuri administrator')) throw new Error('non-admin refusals have no recovery message');
  return 'the API remains authoritative, with a visible recovery path';
});

check('a change block is checked before it can reach a file', async () => {
  const vm = await import('node:vm');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(read('src/addin/ops.js'), sandbox);
  const ops = sandbox.ZuriOps;

  const good = [
    'I will do two things.',
    '',
    '\u0060\u0060\u0060zuri',
    JSON.stringify({
      summary: 'Fill the Remaining column',
      operations: [
        { op: 'setFormulas', range: 'e3:e4', formulas: [['=C3-D3']] },
        { op: 'setNumberFormat', range: 'E3:E4', format: '0.00' },
      ],
    }),
    '\u0060\u0060\u0060',
    '',
    'Then the format.',
  ].join('\n');

  const segments = ops.splitReply(good);
  if (segments.map((part) => part.type).join(',') !== 'text,ops,text') {
    throw new Error('the reply was not split into prose, change and prose: ' + segments.map((part) => part.type).join(','));
  }
  const plan = segments[1].result;
  if (plan.ok !== true || plan.operations.length !== 2) throw new Error('a good change block was refused');
  if (plan.operations[0].range !== 'E3:E4') throw new Error('the range was not normalised');
  if (!ops.describeOperation(plan.operations[0]).includes('E3:E4')) throw new Error('a change cannot be described');

  const refused = [
    ['an invented operation', '{"operations":[{"op":"deleteSheet","range":"A1"}]}'],
    ['a backwards range', '{"operations":[{"op":"setValues","range":"F9:A1","values":[[1]]}]}'],
    ['a formula with no equals sign', '{"operations":[{"op":"setFormulas","range":"A1:A2","formulas":[["C1-D1"]]}]}'],
    ['broken JSON', '{"operations":[{"op":"clear"'],
    ['an empty plan', '{"operations":[]}'],
    ['an unknown style of grid', '{"operations":[{"op":"setValues","range":"A1:A2","values":"nope"}]}'],
    ['a chart of a kind Excel has no name for', '{"operations":[{"op":"addChart","range":"A1:B4","chartType":"donut"}]}'],
    ['a chart placed on a range', '{"operations":[{"op":"addChart","range":"A1:B4","at":"D1:E2"}]}'],
  ];
  for (const [label, raw] of refused) {
    const outcome = ops.parseBlock(raw);
    if (outcome.ok !== false) throw new Error(`${label} was accepted`);
    if (typeof outcome.error !== 'string' || outcome.error === '') throw new Error(`${label} gave no reason`);
  }

  // A block still being written must never be shown as ready to apply.
  const streaming = ops.splitReply('Working on it\n\n\u0060\u0060\u0060zuri\n{"summary":"x"');
  if (streaming[streaming.length - 1].type !== 'ops-open') throw new Error('a half-written change looks finished');

  // A sample JSON object in an answer is code, not a change.
  const sample = ops.splitReply('\u0060\u0060\u0060json\n{"hello":"world"}\n\u0060\u0060\u0060');
  if (sample.some((part) => part.type === 'ops')) throw new Error('an ordinary JSON snippet became a change');

  // A chart with no place given is put clear of its own data.
  const chart = ops.parseBlock('{"operations":[{"op":"addChart","range":"A1:B4","chartType":"line","title":"Sales"}]}');
  if (chart.ok !== true || chart.operations[0].at !== 'D1') throw new Error('a chart is not placed beside its data');
  if (!ops.describeOperation(chart.operations[0]).includes('line chart')) throw new Error('a chart cannot be described');

  // Short rows are padded, so Office is never handed a ragged grid.
  const padded = ops.parseBlock('{"operations":[{"op":"setValues","range":"A1:B2","values":[[1],[2,3]]}]}');
  if (padded.ok !== true || padded.operations[0].grid[0].length !== 2) throw new Error('a short row was not padded');

  const exact = ops.parseBlock('{"operations":[{"op":"setValues","range":"A1:B2","values":[[1,2],[3,4]]}]}');
  if (exact.ok !== true || exact.operations[0].rangeRows !== 2 || exact.operations[0].rangeColumns !== 2) throw new Error('a valid grid did not retain the range shape');

  return `${Object.keys(ops.OPERATIONS).length} operations, bad input refused with a reason`;
});

check('Excel add-in applies values, formulas and formatting through the Office batch API', async () => {
  const vm = await import('node:vm');
  const source = read('src/addin/taskpane.js');
  const start = source.indexOf('  function applyExcel(operations) {');
  const end = source.indexOf('  function applyWord(operations) {', start);
  if (start < 0 || end < 0) throw new Error('Excel applier not found');
  const ranges = new Map();
  const makeSheet = (name) => ({
    name,
    getRange(address) {
      const key = `${name}!${address}`;
      if (!ranges.has(key)) ranges.set(key, { format: { font: {}, fill: {} } });
      return ranges.get(key);
    },
  });
  const sheets = new Map([['Dashboard', makeSheet('Dashboard')], ['Monthly', makeSheet('Monthly')]]);
  const sheet = sheets.get('Dashboard');
  const context = {
    workbook: {
      worksheets: {
        getActiveWorksheet: () => sheet,
        getItem: (name) => {
          if (!sheets.has(name)) throw new Error(`There is no sheet called "${name}".`);
          return sheets.get(name);
        },
      },
    },
    sync: async () => {},
  };
  const sandbox = {
    Excel: { run(...args) {
      if (args.length !== 1 || typeof args[0] !== 'function') throw new Error('Invalid Office batch arguments');
      return Promise.resolve().then(() => args[0](context));
    } },
    hostFor: () => 'excel',
    ZuriOps: { describeOperation: (operation) => operation.op },
    officeMessage: (error, fallback) => error?.message || fallback,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  const operations = [
    { op: 'setValues', sheet: 'Dashboard', range: 'A1', grid: [['Budget']], rangeRows: 1, rangeColumns: 1 },
    { op: 'setFormulas', sheet: 'Dashboard', range: 'B1', grid: [['=1+2']], rangeRows: 1, rangeColumns: 1 },
    { op: 'format', sheet: 'Dashboard', range: 'A1', bold: true, fill: '#1F2A44' },
    { op: 'setNumberFormat', sheet: 'Dashboard', range: 'B1', format: '0.00', rangeRows: 1, rangeColumns: 1 },
    { op: 'columnWidth', sheet: 'Dashboard', range: 'C1', width: 14 },
    { op: 'columnWidth', sheet: 'Dashboard', range: 'D1', width: 0 },
    { op: 'setValues', sheet: 'Monthly', range: 'A1', grid: [['September']], rangeRows: 1, rangeColumns: 1 },
  ];
  await sandbox.applyExcel(operations);
  if (ranges.get('Dashboard!A1').values[0][0] !== 'Budget') throw new Error('value not written');
  if (ranges.get('Dashboard!B1').formulas[0][0] !== '=1+2') throw new Error('formula not written');
  if (!ranges.get('Dashboard!A1').format.font.bold || ranges.get('Dashboard!A1').format.fill.color !== '#1F2A44') throw new Error('formatting not applied');
  if (ranges.get('Dashboard!B1').numberFormat[0][0] !== '0.00') throw new Error('number format not applied');
  if (ranges.get('Dashboard!C1').format.columnWidth < 70) throw new Error('a 14-character column would be too narrow');
  if (ranges.get('Dashboard!D1').format.columnWidth !== 0) throw new Error('zero column width was not preserved');
  if (ranges.get('Monthly!A1').values[0][0] !== 'September') throw new Error('named sheet value was written to the active sheet');
  return 'single-argument batch, named-sheet values, formulas and formatting';
});

check('Word and PowerPoint add-in edits use portable, single-argument Office batches', async () => {
  const vm = await import('node:vm');
  const source = read('src/addin/taskpane.js');

  const paragraphs = [];
  const replacements = [];
  const body = {
    insertParagraph(text) {
      const paragraph = { text, styleBuiltIn: '' };
      paragraphs.push(paragraph);
      return paragraph;
    },
    insertTable() {},
    insertHtml() {},
    search() {
      return {
        items: [{ insertText(text) { replacements.push(text); } }],
        load() {},
      };
    },
  };
  const selection = {
    styleBuiltIn: '',
    insertText() {},
    insertParagraph() {},
  };
  const wordContext = {
    document: { body, getSelection: () => selection },
    sync: async () => {},
  };
  const wordSandbox = {
    Word: { run(...args) {
      if (args.length !== 1 || typeof args[0] !== 'function') throw new Error('Invalid Word batch arguments');
      return Promise.resolve().then(() => args[0](wordContext));
    } },
    hostFor: () => 'word',
    ZuriOps: { describeOperation: (operation) => operation.op, markdownToHtml: (markdown) => markdown },
    officeMessage: (error, fallback) => error?.message || fallback,
  };
  vm.createContext(wordSandbox);
  const wordStart = source.indexOf('  function applyWord(operations) {');
  const powerPointStart = source.indexOf('  function applyPowerPoint(operations) {', wordStart);
  if (wordStart < 0 || powerPointStart < 0) throw new Error('Word applier not found');
  vm.runInContext(source.slice(wordStart, powerPointStart), wordSandbox);
  await wordSandbox.applyWord([
    { op: 'insertParagraphs', paragraphs: [{ text: 'Heading', style: 'Heading 1' }] },
    { op: 'replaceAll', find: 'old', replace: 'new' },
  ]);
  if (paragraphs[0]?.styleBuiltIn !== 'Heading1') throw new Error('Word heading was not assigned through styleBuiltIn');
  if (replacements[0] !== 'new') throw new Error('Word replace-all did not update a match');

  const font = {};
  const titlePlaceholder = { name: 'Title 4', fill: { setSolidColor() {} }, textFrame: { textRange: { font } } };
  const slide = { shapes: { items: [titlePlaceholder], load() {} } };
  const powerPointContext = {
    presentation: { slides: { getItemAt: () => slide, add: () => slide } },
    sync: async () => {},
  };
  const powerPointSandbox = {
    PowerPoint: { run(...args) {
      if (args.length !== 1 || typeof args[0] !== 'function') throw new Error('Invalid PowerPoint batch arguments');
      return Promise.resolve().then(() => args[0](powerPointContext));
    } },
    Office: { context: { requirements: { isSetSupported: () => true } } },
    supported: () => true,
    hostFor: () => 'powerpoint',
    ZuriOps: { describeOperation: (operation) => operation.op },
    officeMessage: (error, fallback) => error?.message || fallback,
    setStatus() {},
  };
  vm.createContext(powerPointSandbox);
  const placeTableStart = source.indexOf('  function placeTable(', powerPointStart);
  if (placeTableStart < 0) throw new Error('PowerPoint applier not found');
  vm.runInContext(source.slice(powerPointStart, placeTableStart), powerPointSandbox);
  await powerPointSandbox.applyPowerPoint([{ op: 'styleShape', slide: 5, shape: 'Title 1', color: '#123456', size: 30, bold: true }]);
  if (font.color !== '#123456' || font.size !== 30 || font.bold !== true) {
    throw new Error('PowerPoint title fallback did not style the available title placeholder');
  }
  return 'Word styles and replacements, plus PowerPoint title fallback, survive Office batch validation';
});

check('Excel context gives multi-tab plans the workbook map they need', () => {
  const source = read('src/addin/taskpane.js');
  const readStart = source.indexOf('  function readExcel() {');
  const legacyStart = source.indexOf('  function readExcelActiveLegacy() {', readStart);
  if (readStart < 0 || legacyStart < 0) throw new Error('workbook-wide Excel reader is missing');
  const reader = source.slice(readStart, legacyStart);
  for (const required of [
    'worksheets.load(\'items/name\')',
    'sheets.items.map(function (sheet)',
    'getUsedRangeOrNullObject(true)',
    'every non-empty sheet',
    'exact sheet name before the !',
  ]) {
    if (!reader.includes(required)) throw new Error(`the workbook reader is missing ${required}`);
  }
  return 'all non-empty worksheets are described with exact names and bounded previews';
});

check('every operation Zuri can be asked for has a handler', async () => {
  const vm = await import('node:vm');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(read('src/addin/ops.js'), sandbox);
  const names = Object.keys(sandbox.ZuriOps.OPERATIONS);

  const chat = read('src/main/providers/chat.js');
  const pane = read('src/addin/taskpane.js');

  for (const name of names) {
    if (!chat.includes('"op":"' + name + '"')) throw new Error(`the model is never told about ${name}`);
    if (!pane.includes("'" + name + "'")) throw new Error(`the pane cannot carry out ${name}`);
  }
  if (!chat.includes('export async function chatForAddin')) throw new Error('the add-in has no chat route');
  if (chat.includes('askForAddin')) throw new Error('the one-shot add-in route is still here');
  if (!chat.includes('C3-D3')) throw new Error('the contract has no worked formula example');

  const addin = read('src/main/addin.js');
  if (!addin.includes("route === '/api/chat'")) throw new Error('the pane has nothing to post to');
  if (addin.includes("'/api/ask'")) throw new Error('the one-shot route is still served');
  if (!addin.includes('text/event-stream')) throw new Error('the reply is not streamed');
  if (!addin.includes("'/ops.js'")) throw new Error("the pane has no parser to serve");

  return `${names.length} operations, each with a handler and a line in the contract`;
});

check('the installer carries the Office pane', () => {
  if (!packageJson.build?.files?.includes('src/addin/**/*')) {
    throw new Error('electron-builder does not package src/addin');
  }
  for (const name of ['taskpane.html', 'taskpane.js', 'taskpane.css', 'ops.js', 'intelligence.js']) {
    if (!exists('src/addin/' + name)) throw new Error('src/addin/' + name + ' is missing');
  }
  return 'src/addin is packaged';
});

check('a chat can be filed into a project from its row menu', () => {
  const chat = read('web/src/views/ChatView.jsx');
  for (const required of [
    'setConversationProject',
    'fetchProjects',
    'projectPickerFor',
    'Move to project',
    'Take out of its project',
  ]) {
    if (!chat.includes(required)) throw new Error(`the row menu never offers ${required}`);
  }

  // The project list is a second view inside the same menu, so the menu must keep the
  // row it belongs to rather than opening a dialog over the conversation.
  if (!chat.includes('chat-row-menu-projects')) throw new Error('the project list is not drawn inside the row menu');
  if (!chat.includes('menuitemradio')) throw new Error('the current project cannot be shown as chosen');

  // Inside a project the list is that project's own, so a chat filed elsewhere has to
  // leave it; filed from the whole history the row simply records where it belongs.
  if (!chat.includes('nowInThisProject')) throw new Error('a chat moved to another project would stay on this screen');

  const css = read('web/src/styles.css');
  for (const selector of ['.chat-row-menu-projects', '.chat-menu-note', '.chat-menu-label']) {
    if (!css.includes(selector)) throw new Error(`${selector} has no style`);
  }
  if (!/\.chat-row-menu-projects\s*\{[^}]*max-height/s.test(css)) {
    throw new Error('a long project list would run off the screen');
  }

  // The screen a chat is filed into has to exist, with instructions, files and chats.
  const project = read('web/src/views/ProjectsView.jsx');
  for (const required of ['Instructions', 'Add a file', 'Chats in this project', 'New chat in this project', 'Delete project']) {
    if (!project.includes(required)) throw new Error(`the project screen has no ${required}`);
  }

  return 'row menu files a chat, project screen holds instructions, files and chats';
});

// The palette was flattened once before: one grey ended up carrying every token, so
// the page and the app both read as a wireframe with no brand colour in them, and
// nobody noticed for weeks because nothing checked the colours. These assertions
// pin the two brand colours to their hex values, keep the panel beside the page
// navy, and make sure the status colours cannot be collapsed into one another, in
// both stylesheets that paint a Zuri surface.
check('brand palette keeps navy and the light blue', () => {
  // The two brand colours are read out of the light theme block itself, because
  // that is the theme a first visit lands on; the rest only has to exist in the file.
  const BRAND_TOKENS = ['--brand-navy', '--brand-blue'];
  const PALETTE_TOKENS = [
    ...BRAND_TOKENS,
    '--brand-blue-soft',
    '--brand-blue-ink',
    '--success',
    '--success-soft',
    '--success-line',
    '--warning',
    '--warning-soft',
    '--warning-line',
    '--danger',
    '--danger-soft',
    '--danger-line',
    '--info',
    '--info-soft',
    '--info-line',
  ];
  // Green, amber, red: a person has to tell these apart before reading a word.
  const STATUS_TOKENS = ['--success', '--warning', '--danger'];

  // The `\s*:` after the name is what keeps --brand-navy from matching
  // --brand-navy-hover, and --info from matching --info-soft.
  const declares = (source, token) => new RegExp(`(?:^|[\\s;])${token}\\s*:`).test(source);

  // One rule's body, found by the selector that opens it. The tokens sit directly
  // in the rule and no rule here nests another, so the first closing brace ends it.
  const blockOf = (source, selector) => {
    const match = new RegExp(selector).exec(source);
    if (!match) return '';
    const open = source.indexOf('{', match.index);
    const close = open < 0 ? -1 : source.indexOf('}', open);
    return close < 0 ? '' : source.slice(open + 1, close);
  };

  // A token's value inside a block, or '' when the block never sets it.
  const valueOf = (block, token) => {
    const match = new RegExp(`(?:^|[\\s;])${token}\\s*:\\s*([^;]*);`).exec(block);
    return match ? match[1].trim() : '';
  };

  // Status inks are written as var(--brand-blue-ink) in places, so comparing raw
  // text would compare a name against a hex value. Follow the reference, with a
  // depth guard so a token that pointed at itself could not loop forever.
  const colourOf = (block, token, depth = 0) => {
    const value = valueOf(block, token);
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
    if (!reference || depth >= 4) return value;
    return colourOf(block, reference[1], depth + 1);
  };

  const sheets = [
    // A first visit lands on :root; :root[data-theme="dark"] only overrides it. The lookahead picks the :root that holds the palette: a stylesheet may open another :root block earlier (the HeroUI token mapping does), and reading that one reports the palette as missing when it sits further down.
    { file: 'web/src/styles.css', selector: ':root\\s*\\{(?=[^}]*--brand-navy\\s*:)' },
    // The desktop app names both of its themes.
    { file: 'src/renderer-react/app.css', selector: '\\[data-theme="light"\\]\\s*\\{(?=[^}]*--brand-navy\\s*:)' },
  ].map(({ file, selector }) => {
    const source = read(file);
    return { file, source, light: blockOf(source, selector) };
  });

  for (const { file, source, light } of sheets) {
    if (!light) throw new Error(`${file} no longer has a light theme block, so its colours cannot be read`);
    // A HeroUI control is styled by the package's own stylesheet, not by utilities
    // alone. Without this import every control on the surface renders as bare text:
    // no fill, no edge, and no calendar panel when a date field is opened. That is
    // silent, so it is checked here rather than left to be noticed on screen.
    if (!/@import\s+["']@heroui\/styles["']/.test(source)) {
      throw new Error(`${file} no longer imports @heroui/styles, so its HeroUI controls would render unstyled`);
    }
    for (const token of BRAND_TOKENS) {
      if (!declares(light, token)) throw new Error(`${file} no longer sets ${token} in its light theme`);
    }
    for (const token of PALETTE_TOKENS) {
      if (!declares(source, token)) {
        throw new Error(`${file} has lost ${token}, so the shared palette is no longer complete`);
      }
    }
  }

  // Pinned by value, not only by name: a name pointed at the wrong grey still
  // resolves and still paints, which is how the page went colourless before.
  const web = sheets[0];
  const navy = colourOf(web.light, '--brand-navy');
  const blue = colourOf(web.light, '--brand-blue');
  if (navy.toLowerCase() !== '#0d1b3a') {
    throw new Error(`web/src/styles.css sets --brand-navy to ${navy || 'nothing'}; it must stay #0d1b3a or every navy surface drifts off brand`);
  }
  if (blue.toLowerCase() !== '#2f6fed') {
    throw new Error(`web/src/styles.css sets --brand-blue to ${blue || 'nothing'}; it must stay #2f6fed or the links and live marks lose the brand colour`);
  }
  // They are a pair on purpose: a dark plate and a light accent. Set to one colour,
  // the page has two names for the same paint and reads as grey again.
  if (navy.toLowerCase() === blue.toLowerCase()) {
    throw new Error(`web/src/styles.css paints --brand-navy and --brand-blue the same colour (${navy}); the navy has to stay dark and the light blue light`);
  }

  // The panel beside the page is a light surface carrying navy ink. The navy is
  // spent on the logo and the primary control, so a navy panel is the opposite
  // mistake: it doubles the brand colour into the background and the page reads as
  // one dark slab. A literal white or the surface token is fine; what must not
  // happen is the panel taking the brand navy.
  const navSurface = valueOf(web.light, '--nav-surface');
  if (!navSurface) {
    throw new Error('web/src/styles.css no longer sets --nav-surface, so the panel beside the page has no surface colour of its own');
  }
  if (/var\(\s*--brand-navy\s*\)/i.test(navSurface)) {
    throw new Error(`web/src/styles.css sets --nav-surface to ${navSurface}; the panel beside the page must stay a light surface with navy ink on it, not the brand navy itself`);
  }
  // And it has to actually be light, so a future edit cannot trade one dark panel
  // for another without the check noticing.
  const navSurfaceColour = colourOf(web.light, '--nav-surface').toLowerCase();
  if (navSurfaceColour === navy.toLowerCase()) {
    throw new Error(`web/src/styles.css paints --nav-surface the same navy as --brand-navy (${navSurfaceColour}); the panel must stay light`);
  }
  if (/^#[0-9a-f]{6}$/i.test(navSurfaceColour)) {
    const channels = [1, 3, 5].map((at) => parseInt(navSurfaceColour.slice(at, at + 2), 16));
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    if (luminance < 200) {
      throw new Error(`web/src/styles.css sets --nav-surface to ${navSurfaceColour}, which is too dark for the panel beside the page; it should read as white with navy ink on it`);
    }
  }


  // One refusal must never wear a confirmation's colour, so the three inks of the
  // status family have to resolve to three different hex values in both files.
  const statusReport = (file, light) => {
    const painted = new Map();
    for (const token of STATUS_TOKENS) {
      const hex = colourOf(light, token);
      if (!/^#[0-9a-f]{3,8}$/i.test(hex)) {
        throw new Error(`${file} sets ${token} to ${hex || 'nothing'} in its light theme, which is not a hex colour`);
      }
      const key = hex.toLowerCase();
      if (painted.has(key)) {
        throw new Error(`${file} paints ${token} the same as ${painted.get(key)} (${hex}); success, warning and danger each need their own colour or a refusal reads as a confirmation`);
      }
      painted.set(key, token);
    }
  }

  // The three inks of the status family are compared once for each stylesheet, so a
  // colour that is distinct in one file cannot hide as the same colour in the other.
  sheets.forEach(({ file, light }) => {
    statusReport(file, light);
});
});

// A HeroUI control is assembled from named parts (<Select.Trigger>, <Switch.Thumb>).
// A part that does not exist on that version resolves to undefined, and React
// error 130 then unmounts the tree: the window goes blank with no message on
// screen. That is how Settings died when the switch used a part Switch lacks.
check('every HeroUI compound part a UI module references exists', async () => {
  const heroui = await import('@heroui/react');
  const modules = ['web/src/components/ui.jsx', 'src/renderer-react/ui.jsx'];
  const aliases = {
    HeroSwitch: 'Switch', HeroSelect: 'Select', HeroRadio: 'Radio',
    HeroCheckbox: 'Checkbox', HeroChip: 'Chip', HeroInput: 'Input',
  };
  for (const file of modules) {
    const source = read(file);
    for (const match of source.matchAll(/<([A-Z][A-Za-z]*?)[.]([A-Z][A-Za-z]*)/g)) {
      const root = aliases[match[1]] ?? match[1];
      const part = match[2];
      const component = heroui[root];
      if (!component || typeof component !== 'object' && typeof component !== 'function') continue;
      if (!(part in component)) {
        throw new Error(file + ' renders <' + match[1] + '.' + part + '>, but ' + root + '.' + part + ' does not exist in this HeroUI version; React would blank the window');
      }
    }
  }
});

await Promise.all(pendingChecks);
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
