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

check('React build output exists', () => {
  const missing = ['dist-react/index.html', 'dist-react/assets'].filter((entry) => !exists(entry));
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

check('the sidebar refreshes after chat history changes', () => {
  const source = read('src/renderer-react/Sidebar.jsx');
  for (const required of ["window.zuri?.state?.onChanged?.", "change?.area === 'chats'", 'stopListening?.()']) {
    if (!source.includes(required)) throw new Error(`missing ${required}`);
  }
  return 'Recents follows clear and delete events';
});

// A prompt is worth copying as much as a reply, so the user branch keeps its own copy button.
check('own prompts carry a copy action, not only replies', () => {
  const source = read('src/renderer-react/ChatPanel.jsx');
  const userAt = source.indexOf("message.role === 'user'");
  const replyAt = source.indexOf('<FormattedMessage');
  if (userAt === -1) throw new Error('the transcript has no user branch');
  if (replyAt === -1 || replyAt < userAt) throw new Error('the assistant branch no longer follows the user branch');
  // Slice the user branch alone, so a control that only lives in the reply branch fails this.
  const promptBranch = source.slice(userAt, replyAt);
  for (const required of ['aria-label="Copy message"', 'copyMessage(message, index)']) {
    if (!promptBranch.includes(required)) throw new Error(`the user branch is missing ${required}`);
  }
  for (const required of ['aria-label="Copy reply"', 'That message could not be copied to the clipboard.']) {
    if (!source.includes(required)) throw new Error(`missing ${required}`);
  }
  return 'prompts and replies both copy through one path';
});

const { splitDsml, answerStylePolicy, chatSystemPrompt, ZURI_IDENTITY_PROMPT, resolveChatTarget } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);

// The desktop app showed supplier ids (gpt-4o-mini) while the product sells Zuri
// names, so the picker now offers the catalogue. Each row still stores the real
// supplier id, which makes "does this id belong to this provider?" a real risk:
// chat.js silently swaps a foreign id for the provider's default, so a wrong row
// would answer with a different model than its Zuri name promises.
check('every Zuri model in the desktop picker answers with the id it names', () => {
  const source = read('src/renderer-react/SettingsView.jsx');
  const rows = [...source.matchAll(/\{ provider: '([a-z]+)', model: '([^']+)', name: '(Zuri [^']+)'/g)].map((match) => ({
    provider: match[1],
    model: match[2],
    name: match[3],
  }));
  if (rows.length !== 6) throw new Error(`the picker lists ${rows.length} Zuri models, expected 6`);
  for (const row of rows) {
    const target = resolveChatTarget({ provider: row.provider, model: row.model });
    if (target.provider !== row.provider || target.model !== row.model) {
      throw new Error(`${row.name} would really answer as ${target.provider}/${target.model}`);
    }
  }
  if (source.includes('gpt-4o-mini')) throw new Error('a supplier model id is still offered by name');
  return `${rows.length} Zuri names, each on its own provider`;
});

check('DSML tool markup is hidden from the reply and read as tool calls', () => {
  const markup =
    'Let me look.<｜DSML｜function_calls><｜DSML｜invoke name="webSearch">' +
    '<｜DSML｜parameter name="query" string="true">terms</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>';
  const { visible, calls } = splitDsml(markup);
  if (visible !== 'Let me look.') throw new Error(`visible text was "${visible}"`);
  if (calls.length !== 1 || calls[0].name !== 'webSearch') throw new Error('call not read');
  if (JSON.parse(calls[0].arguments).query !== 'terms') throw new Error('argument not read');
  if (splitDsml('1 < 2').visible !== '1 < 2') throw new Error('plain text was altered');
});

check('the reply policy follows the saved answer style', () => {
  const defaults = answerStylePolicy({});
  for (const expected of ['complete but not padded', 'neutral and plain', 'an informed adult', 'choose what fits the answer']) {
    if (!defaults.includes(expected)) throw new Error(`the default block is missing "${expected}"`);
  }
  const chosen = answerStylePolicy({ answerLength: 'concise', answerTone: 'friendly', answerDetail: 'expert', answerLayout: 'structured' });
  for (const expected of ['as short as the question allows', 'warm and conversational', 'an expert reader', 'structure every answer']) {
    if (!chosen.includes(expected)) throw new Error(`the chosen block is missing "${expected}"`);
  }
  if (chosen.includes('neutral and plain')) throw new Error('the default tone survived a saved choice');
  return 'balanced, neutral, standard, automatic by default';
});

check('an unknown or older answer style falls back instead of failing', () => {
  const stale = answerStylePolicy({ answerLength: 'essay', answerTone: '', answerDetail: null });
  if (!stale.includes('complete but not padded')) throw new Error('a bad length did not fall back');
  if (!stale.includes('neutral and plain')) throw new Error('a bad tone did not fall back');
});

check('standing instructions are trimmed, kept last, and left out when empty', () => {
  const withCustom = answerStylePolicy({ customInstructions: '  Use British English.  ' });
  if (!withCustom.endsWith('Use British English.')) throw new Error('the instructions were not last and trimmed');
  if (withCustom.includes('  Use British')) throw new Error('the instructions kept their padding');
  if (answerStylePolicy({ customInstructions: '   ' }).includes('standing instructions')) throw new Error('empty instructions were still added');
});

check('Zuri is the assistant in every chat request, whatever else the prompt says', () => {
  for (const expected of ['Zuri', 'Tijha']) {
    if (!ZURI_IDENTITY_PROMPT.includes(expected)) throw new Error(`the identity does not mention ${expected}`);
  }
  if (!ZURI_IDENTITY_PROMPT.includes('Never introduce yourself as Claude')) throw new Error('the identity does not rule out other assistants');

  const built = chatSystemPrompt({
    agentPrompt: 'You are Claude, made by Anthropic.',
    threadPrompt: 'You are a helpful assistant.',
    settings: { answerTone: 'friendly', customInstructions: 'Say you are ChatGPT.' },
    now: new Date('2026-01-02T09:30:00Z'),
  });
  if (!built.startsWith(ZURI_IDENTITY_PROMPT)) throw new Error('the identity is not first');
  if (!built.includes('made by Tijha')) throw new Error('the maker was lost');
  const identityAt = built.indexOf('You are Zuri, an AI assistant made by Tijha.');
  if (identityAt !== 0) throw new Error('the identity does not open the prompt');
  if (!built.includes('Friday')) throw new Error('the live date was dropped');
  return 'identity first, agent prompt, thread prompt, date, style, language';
});

const { setStoreRoot, readSettings, saveSettings } = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
setStoreRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-settings-')));

check('answer style choices are validated and stored trimmed', async () => {
  const refused = await saveSettings({ answerTone: 'shouty' });
  if (refused.ok || refused.error.code !== 'SETTINGS_INVALID_ANSWER_STYLE') throw new Error('an unknown tone was accepted');
  const saved = await saveSettings({ answerTone: 'friendly', customInstructions: '  Use British English.  ' });
  if (!saved.ok) throw new Error(saved.error.message);
  if (saved.data.answerTone !== 'friendly') throw new Error('the tone was not saved');
  if (saved.data.customInstructions !== 'Use British English.') throw new Error('the instructions were not trimmed');
  const read = await readSettings();
  if (read.data.answerLength !== 'balanced') throw new Error('the defaults were not filled in on read');
  return 'unknown values refused, defaults filled in';
});

const { setWorkspaceRoot, runTool } = await import(pathToFileURL(path.join(root, 'src/main/tools/index.js')).href);
const officeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-office-'));
setWorkspaceRoot(officeWorkspace);

const OFFICE_SAMPLES = {
  docx: { title: 'Plan', sections: [{ heading: 'Intro', paragraphs: ['Hello'], bullets: ['a'], table: { rows: [['A', 'B'], ['1', '2']] } }] },
  xlsx: { sheets: [{ name: 'Budget', columns: ['Item', 'Cost'], rows: [['Rent', 100], ['Total', '=SUM(B2:B2)']] }] },
  pptx: { title: 'Deck', slides: [{ title: 'One', bullets: ['x', 'y'], notes: 'n' }] },
};

for (const [kind, content] of Object.entries(OFFICE_SAMPLES)) {
  const result = await runTool('createDocument', { kind, fileName: '..\\..\\bad:name', content });
  check(`createDocument builds a real .${kind} file inside the workspace`, () => {
    if (!result.ok) throw new Error(result.error.message);
    const relative = path.relative(officeWorkspace, result.data.path);
    if (relative.startsWith('..') || path.dirname(relative) !== 'documents') throw new Error(`saved outside documents/: ${relative}`);
    if (!result.data.name.endsWith(`.${kind}`)) throw new Error(`unexpected name ${result.data.name}`);
    // Every Office file is a ZIP, which always starts with "PK".
    if (fs.readFileSync(result.data.path).subarray(0, 2).toString() !== 'PK') throw new Error('not a ZIP container');
    return result.data.name;
  });
}

const duplicate = await runTool('createDocument', { kind: 'docx', fileName: 'bad-name', content: OFFICE_SAMPLES.docx });
check('createDocument never overwrites an existing file', () => {
  if (!duplicate.ok) throw new Error(duplicate.error.message);
  if (duplicate.data.name === 'bad-name.docx' || !duplicate.data.name.includes('(2)')) throw new Error(`reused ${duplicate.data.name}`);
});

const emptyDoc = await runTool('createDocument', { kind: 'docx', content: {} });
const badKind = await runTool('createDocument', { kind: 'exe', content: {} });
const stringContent = await runTool('createDocument', { kind: 'pptx', content: JSON.stringify(OFFICE_SAMPLES.pptx) });
check('createDocument rejects empty content and unknown kinds, and accepts JSON text content', () => {
  if (emptyDoc.ok || emptyDoc.error.code !== 'TOOL_INVALID_ARGUMENT') throw new Error('empty content was accepted');
  if (badKind.ok || badKind.error.code !== 'TOOL_INVALID_ARGUMENT') throw new Error('unknown kind was accepted');
  if (!stringContent.ok) throw new Error(stringContent.error.message);
});

const { registerChosenFile } = await import(pathToFileURL(path.join(root, 'src/main/tools/index.js')).href);
const madeDocx = await runTool('createDocument', { kind: 'docx', fileName: 'edit-me', content: OFFICE_SAMPLES.docx });
const madeXlsx = await runTool('createDocument', { kind: 'xlsx', fileName: 'edit-me', content: OFFICE_SAMPLES.xlsx });
const madePptx = await runTool('createDocument', { kind: 'pptx', fileName: 'edit-me', content: OFFICE_SAMPLES.pptx });
const originalDocxBytes = fs.readFileSync(madeDocx.data.path);
const editedDocx = await runTool('editDocument', { path: madeDocx.data.path, edits: [{ find: 'Hello', replace: 'Goodbye & <more>' }] });
const editedXlsx = await runTool('editDocument', { path: madeXlsx.data.path, edits: [{ sheet: 'Budget', cell: 'B2', value: 250 }, { sheet: 'Budget', appendRow: ['Tax', 25] }] });
const editedPptx = await runTool('editDocument', { path: madePptx.data.path, edits: [{ find: 'One', replace: 'First slide' }] });

const readBack = async (result) => {
  const parser = await import('officeparser');
  return (await parser.parseOffice(result.data.path)).toText();
};

check('editDocument changes a Word file text in a new copy and leaves the original alone', async () => {
  if (!editedDocx.ok) throw new Error(editedDocx.error.message);
  if (!editedDocx.data.name.includes('-edited')) throw new Error(`copy was named ${editedDocx.data.name}`);
  if (!fs.readFileSync(madeDocx.data.path).equals(originalDocxBytes)) throw new Error('the original file was modified');
  const text = await readBack(editedDocx);
  if (!text.includes('Goodbye & <more>') || text.includes('Hello')) throw new Error(`text was "${text}"`);
});

check('editDocument sets Excel cells and appends rows', async () => {
  if (!editedXlsx.ok) throw new Error(editedXlsx.error.message);
  const text = await readBack(editedXlsx);
  if (!text.includes('250') || !text.includes('Tax')) throw new Error(`text was "${text}"`);
});

check('editDocument changes PowerPoint slide text', async () => {
  if (!editedPptx.ok) throw new Error(editedPptx.error.message);
  if (!(await readBack(editedPptx)).includes('First slide')) throw new Error('slide text was not changed');
});

const outsideFile = path.join(os.tmpdir(), `zuri-outside-${process.pid}.docx`);
fs.copyFileSync(madeDocx.data.path, outsideFile);
const refusedOutside = await runTool('editDocument', { path: outsideFile, edits: [{ find: 'Hello', replace: 'x' }] });
registerChosenFile(outsideFile);
const allowedOutside = await runTool('editDocument', { path: outsideFile, edits: [{ find: 'Hello', replace: 'x' }] });
const nothingMatched = await runTool('editDocument', { path: madeDocx.data.path, edits: [{ find: 'not in the file', replace: 'x' }] });
fs.rmSync(outsideFile, { force: true });

check('editDocument only touches files in the workspace or ones the person picked, and reports misses', () => {
  if (refusedOutside.ok || refusedOutside.error.code !== 'TOOL_PATH_NOT_CHOSEN') throw new Error('an unpicked outside file was accepted');
  if (!allowedOutside.ok) throw new Error(allowedOutside.error.message);
  if (nothingMatched.ok || nothingMatched.error.code !== 'TOOL_NOTHING_CHANGED') throw new Error('a no-op edit was reported as success');
});

check('readFile reads Word text and Excel cells with addresses', async () => {
  const word = await runTool('readFile', { path: madeDocx.data.path });
  const sheet = await runTool('readFile', { path: madeXlsx.data.path });
  if (!word.ok || !word.data.text.includes('Hello')) throw new Error('Word text was not read');
  if (!sheet.ok || !sheet.data.text.includes('B2=100')) throw new Error(`cells were "${sheet.data?.text}"`);
});

check('legacy design checks are no longer part of the test graph', () => {
  const checks = fs.readdirSync(path.join(root, 'scripts')).filter((name) => name.endsWith('.check.js'));
  if (checks.length > 0) throw new Error(`${checks.length} design check scripts remain`);
});

/* ---------------------------------------------------------------------------
   Provider tool support

   Anthropic speaks a different tool dialect from the OpenAI-style providers:
   input_schema going out, tool_use blocks coming back, and results returned as
   tool_result content in the next user turn. A fake stream proves the
   translation, with no network and no key.
   ------------------------------------------------------------------------ */

const { setKey } = await import(pathToFileURL(path.join(root, 'src/main/secrets.js')).href);
const { runPrompt } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);

await setKey('anthropic', 'sk-ant-selftest-placeholder');
await saveSettings({ provider: 'anthropic', model: 'claude-3-5-haiku-latest' });

/** Turn a list of Anthropic stream events into the response the reader expects. */
const sseResponse = (events) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const anthropicBodies = [];
const anthropicFetch = async (url, init) => {
  anthropicBodies.push(JSON.parse(init.body));
  if (anthropicBodies.length === 1) {
    return sseResponse([
      { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me look.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'readFile', input: {} } },
      // Split across two frames, the way a real stream delivers it.
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"invoices-2026.docx"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_stop' },
    ]);
  }
  return sseResponse([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here is your answer.' } },
    { type: 'message_stop' },
  ]);
};

const anthropicRun = await runPrompt({ prompt: 'Read my invoices file' }, { fetchImpl: anthropicFetch });

check('an Anthropic model is offered tools in its own shape, not an empty list', () => {
  if (!anthropicRun.ok) throw new Error(anthropicRun.error.message);
  const body = anthropicBodies[0];
  if (!Array.isArray(body.tools) || body.tools.length === 0) throw new Error('no tools were sent');
  const read = body.tools.find((tool) => tool.name === 'readFile');
  if (!read) throw new Error('readFile was not offered');
  if (read.function !== undefined) throw new Error('the OpenAI wrapper was sent to Anthropic');
  if (typeof read.input_schema?.properties?.path !== 'object') throw new Error('input_schema was not built');
  // The free tools travel without web search being switched on.
  for (const name of ['summarizeDocument', 'createDocument', 'editDocument']) {
    if (!body.tools.some((tool) => tool.name === name)) throw new Error(`${name} was not offered`);
  }
  if (body.tools.some((tool) => tool.name === 'writeFile')) throw new Error('a confirmation-gated tool was offered');
});

check('an Anthropic tool_use is answered with a tool_result in the next user turn', () => {
  const body = anthropicBodies[1];
  if (!body) throw new Error('the model was never asked a second time');
  const assistant = body.messages.at(-2);
  const results = body.messages.at(-1);
  const use = Array.isArray(assistant?.content) ? assistant.content.find((block) => block.type === 'tool_use') : null;
  if (!use) throw new Error('the assistant turn carried no tool_use block');
  if (use.id !== 'toolu_1' || use.name !== 'readFile') throw new Error(`tool_use was ${use.id}/${use.name}`);
  if (use.input?.path !== 'invoices-2026.docx') throw new Error(`arguments were ${JSON.stringify(use.input)}`);
  const result = Array.isArray(results?.content) ? results.content.find((block) => block.type === 'tool_result') : null;
  if (!result) throw new Error('no tool_result was sent back');
  if (result.tool_use_id !== 'toolu_1') throw new Error(`tool_result answered ${result.tool_use_id}`);
  if (assistant.role !== 'assistant' || results.role !== 'user') throw new Error('the turns were in the wrong order');
  if (!anthropicRun.data.text.includes('Here is your answer.')) throw new Error(`text was "${anthropicRun.data.text}"`);
});

/* ---------------------------------------------------------------------------
   Automations ask the model

   Before this change the prompt was turned into one web search or one page
   fetch by looking at its text, so a question needing judgement ran a search.
   ------------------------------------------------------------------------ */

const { runSchedule } = await import(pathToFileURL(path.join(root, 'src/main/scheduler.js')).href);
const { createAutomation } = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);

const schedulerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-scheduler-'));
let savedMarkdown = '';
// Saved through the store, so the run's own bookkeeping (the row, the advance of
// nextRunAt) works against a real automation rather than a made-up object.
const savedAutomation = await createAutomation(
  {
    prompt: 'Summarise my invoices and tell me which are overdue',
    mode: 'autopilot',
    cadence: { type: 'daily', timeOfDay: '09:00' },
    allowedTools: ['webSearch', 'readFile'],
  },
  { root: schedulerRoot },
);
if (!savedAutomation.ok) throw new Error(savedAutomation.error.message);

const ranAnAutomation = await runSchedule(
  savedAutomation.data,
  {
    root: schedulerRoot,
    notify: () => true,
    runPrompt: async (request) => {
      if (!Array.isArray(request.allowedTools)) throw new Error('the allow-list did not reach the model');
      return { ok: true, data: { text: 'Two invoices are overdue.', provider: 'anthropic', model: 'claude-3-5-haiku-latest' } };
    },
    runStep: async (name, args) => {
      // Only the result write may happen; a tool call here would mean the old
      // heuristic still ran the prompt instead of the model.
      if (name !== 'writeFile') throw new Error(`the automation ran ${name}`);
      savedMarkdown = args.content;
      return { ok: true, data: { relative: args.path } };
    },
  },
);

check('an automation asks the model instead of guessing a tool from the prompt', () => {
  if (!ranAnAutomation.ok) throw new Error(ranAnAutomation.error.message);
  if (ranAnAutomation.data.run.status !== 'completed') throw new Error(`status was ${ranAnAutomation.data.run.status}`);
  if (ranAnAutomation.data.run.stepsTotal !== 1) throw new Error(`steps total was ${ranAnAutomation.data.run.stepsTotal}`);
  if (!savedMarkdown.includes('## Answer')) throw new Error('the result file has no answer section');
  if (!savedMarkdown.includes('Two invoices are overdue.')) throw new Error('the model answer was not saved');
});

let offlineMarkdown = '';
const offlineAutomation = await createAutomation(
  {
    prompt: 'Check https://example.com/jobs for new roles',
    mode: 'autopilot',
    cadence: { type: 'daily', timeOfDay: '09:00' },
  },
  { root: schedulerRoot },
);
if (!offlineAutomation.ok) throw new Error(offlineAutomation.error.message);

const ranWithoutModel = await runSchedule(
  offlineAutomation.data,
  {
    root: schedulerRoot,
    notify: () => true,
    runStep: async (name, args) => {
      if (name === 'writeFile') offlineMarkdown = args.content;
      return { ok: true, data: { relative: `${name}.txt` } };
    },
  },
);

check('an automation with no model available still runs its single-call plan', () => {
  if (!ranWithoutModel.ok) throw new Error(ranWithoutModel.error.message);
  if (offlineMarkdown.includes('## Answer')) throw new Error('a model answer was invented');
  if (ranWithoutModel.data.run.stepsTotal !== 1) throw new Error('the plan was not kept');
  if (ranWithoutModel.data.run.status !== 'completed') throw new Error('the planned step did not run');
});

/* The overlay card's shadow is painted by CSS inside a transparent window, and CSS
   cannot draw outside the window: a shadow wider than the window's transparent
   margin is cut off, leaving a grey box with sharp corners around a round card.
   The window margin and the card's padding are meant to be the same number. */
check('the overlay window leaves room for the card shadow', () => {
  const margin = Number(read('src/main/overlay.js').match(/const MARGIN = (\d+);/)?.[1]);
  if (!Number.isFinite(margin)) throw new Error('overlay.js has no MARGIN');
  const css = read('src/renderer-react/app.css');
  const padding = Number(css.match(/\.zuri-overlay-root\s*\{[^}]*padding:\s*(\d+)px/)?.[1]);
  if (!Number.isFinite(padding)) throw new Error('.zuri-overlay-root has no pixel padding');
  if (padding !== margin) throw new Error(`card padding is ${padding}px but the window margin is ${margin}px`);
  const shadow = css.match(/\.zuri-overlay-panel\s*\{[^}]*box-shadow:\s*0 (\d+)px (\d+)px/);
  if (!shadow) throw new Error('.zuri-overlay-panel has no y-offset box shadow');
  const reach = Number(shadow[1]) + Number(shadow[2]);
  if (reach > margin) throw new Error(`the shadow reaches ${reach}px but the window margin is only ${margin}px`);
  return `margin ${margin}px, shadow reaches ${reach}px`;
});

await Promise.all(pendingChecks);
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
