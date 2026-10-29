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

check('saved chats can be renamed without losing the continue action', () => {
  const history = read('src/renderer-react/HistoryView.jsx');
  const main = read('src/main/main.js');
  const preload = read('src/main/preload.js');
  for (const required of ['window.zuri?.chats?.rename?.', 'Rename chat', 'Continue chat']) {
    if (!history.includes(required)) throw new Error(`history is missing ${required}`);
  }
  if (!main.includes("['zuri:chats:rename', handleChatRename]")) throw new Error('main rename handler is missing');
  if (!preload.includes("'zuri:chats:rename'")) throw new Error('preload rename channel is missing');
  return 'rename is validated in the store and exposed through the guarded bridge';
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
  // The catalogue lives in its own module now, because the composer's model chip
  // offers the same six names and a second copy would drift away from this one.
  const source = read('src/renderer-react/zuriModels.js');
  if (!read('src/renderer-react/SettingsView.jsx').includes("from './zuriModels.js'")) {
    throw new Error('the Settings picker stopped offering the shared catalogue');
  }
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

check('the prompt tells Zuri about the web tools it was handed, and only when it has them', () => {
  const withTools = chatSystemPrompt({ now: new Date('2026-01-02T09:30:00Z'), webTools: true });
  if (!withTools.includes('webSearch')) throw new Error('the prompt does not mention the search tool it was given');
  if (withTools.includes('cannot see live websites')) throw new Error('the prompt still denies a capability the person switched on');
  if (!withTools.includes('Friday')) throw new Error('the live date was dropped');

  const withoutTools = chatSystemPrompt({ now: new Date('2026-01-02T09:30:00Z') });
  if (!withoutTools.includes('cannot see live websites')) throw new Error('a reply with no web tool still claims it can browse');
  return 'the web line follows the tools actually offered';
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

// First run is a sign-in, not a developer setup screen. The card has to offer the
// Zuri account and must not ask for a provider key; a key belongs in Settings, for
// the person who would rather pay a provider directly.
check('launch shows the Zuri sign-in, not a provider key or a server address', () => {
  const source = read('src/renderer-react/SignInView.jsx');
  for (const required of ['GoogleSignInButton', 'CloudAuthForm', 'Sign in to Zuri']) {
    if (!source.includes(required)) throw new Error('missing ' + required);
  }
  for (const forbidden of ['API key', 'onboarding-provider', 'providerLabel', 'Cloud server URL', 'cloudUrl']) {
    if (source.includes(forbidden)) throw new Error('the card still asks for ' + forbidden);
  }
  // The payload that closes setup carries no key either, which is what the
  // main-process check below then proves it accepts.
  if (!source.includes('api?.onboarding?.complete?.({')) {
    throw new Error('setup still sends a provider key');
  }
  return 'one sign-in screen; the name comes from the account';
});

check('setup completes without a provider key', async () => {
  const { getStoreRoot } = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  const onboarding = await import(pathToFileURL(path.join(root, 'src/main/onboarding.js')).href);
  // Its own folder, then the caller's folder back, so this check cannot leave the
  // shared settings used by the checks around it pointing somewhere else.
  const previousRoot = getStoreRoot();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-onboarding-'));
  try {
    setStoreRoot(scratch);
    const saved = await onboarding.runOnboardingSetup({ name: 'Ada', theme: 'dark' });
    if (saved.ok !== true) throw new Error(saved.error?.message ?? 'setup was refused');
    if (saved.data.hasKey !== false) throw new Error('a key was reported without one being given');
    const stored = await readSettings();
    if (stored.data.name !== 'Ada') throw new Error('the name was not stored');
    return 'name and theme saved, no key needed';
  } finally {
    setStoreRoot(previousRoot);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
// Chat is answered from the Zuri plan now, so the app has to hand the send path an
// account route, and a signed-out window must be told to sign in rather than
// quietly falling back to a key nobody was asked for.
check('chat answers through the Zuri account, not a saved key', () => {
  const main = read('src/main/main.js');
  if (!main.includes('cloudReply: (request) => cloudChatReply(request)')) {
    throw new Error('the window chat send has no account route');
  }
  if (!main.includes("cloudRequest('/api/chat'")) throw new Error('nothing calls the cloud chat route');
  if (!main.includes('readChatStream')) throw new Error('the app never reads the streamed reply');
  const chat = read('src/main/providers/chat.js');
  if (!chat.includes("if (typeof options.cloudReply === 'function')")) {
    throw new Error('the send path ignores the account route');
  }
  return 'sent with the session, no key read';
});

check('the account request names a Zuri model and carries the identity', async () => {
  const { replyThroughAccount } = await import(pathToFileURL(path.join(root, 'src/main/providers/cloud-chat.js')).href);
  const sent = [];
  const deltas = [];
  const conversation = {
    system: 'You are Zuri, an AI assistant made by Tijha.',
    turns: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Who are you?' },
    ],
  };
  const result = await replyThroughAccount({
    conversation,
    // A settings file written before the switch still holds the supplier id.
    settings: { model: 'deepseek-flash' },
    postChat: async (body) => {
      sent.push(body);
      return { ok: true, data: { content: 'I am Zuri.', model: 'zuri-flash', modelName: 'Zuri Flash' } };
    },
    emit: (event) => deltas.push(event),
  });
  if (!result.ok) throw new Error(result.error.message);
  if (sent.length !== 1) throw new Error('expected one request, sent ' + sent.length);
  if (sent[0].model !== 'zuri-flash') throw new Error('model was ' + sent[0].model);
  if (sent[0].messages[0].role !== 'system') throw new Error('the identity is not first');
  if (!sent[0].messages[0].content.includes('made by Tijha')) throw new Error('the identity was dropped');
  if (sent[0].messages.at(-1).content !== 'Who are you?') throw new Error('the question was not last');
  if (sent[0].stream !== true) throw new Error('the request does not ask to stream');
  // Not streaming, so the whole answer is handed over once rather than in pieces.
  if (deltas.length !== 1 || deltas[0].delta !== 'I am Zuri.') throw new Error('an unstreamed reply was not emitted once');
  // A Zuri code already saved must pass straight through untouched.
  const again = await replyThroughAccount({
    conversation,
    settings: { model: 'zuri-elite' },
    postChat: async (body) => {
      sent.push(body);
      return { ok: true, data: { content: 'ok' } };
    },
  });
  if (!again.ok || sent.at(-1).model !== 'zuri-elite') throw new Error('a Zuri code was not passed through');

  // A streaming server hands each piece to postChat, and those pieces are what the
  // transcript shows: they must arrive in order and must not be repeated by the
  // final content in done.
  const pieces = [];
  const streamed = await replyThroughAccount({
    conversation,
    settings: { model: 'zuri-flash' },
    postChat: async (body, options) => {
      for (const piece of ['I am ', 'Zu', 'ri.']) options.onDelta(piece);
      return { ok: true, data: { content: 'I am Zuri.', model: 'zuri-flash' } };
    },
    emit: (event) => pieces.push(event.delta),
  });
  if (!streamed.ok) throw new Error('a streamed reply was refused');
  if (pieces.join('') !== 'I am Zuri.') throw new Error('deltas were ' + JSON.stringify(pieces));
  if (streamed.data.content !== 'I am Zuri.') throw new Error('the saved content was lost');
  return 'identity first, legacy id translated, deltas in order';
});
// The window turns event frames into the text it shows, so the parser is fed real
// frames here: what it must never do is drop a delta because a frame happened to
// arrive in two network chunks, or present a broken reply as a finished one.
check('the streamed reply is read frame by frame, even across a split chunk', async () => {
  const { readChatStream } = await import(pathToFileURL(path.join(root, 'src/main/providers/sse.js')).href);

  /** Build the response a server would send, from the exact chunks given. */
  const respond = (chunks) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };

  // The first frame is deliberately cut in half at "te|xt", which is what happens
  // whenever a network packet boundary lands mid-frame.
  const split = [
    'data: {"type":"delta","te',
    'xt":"Hi "}\n\ndata: {"type":"delta","text":"there"}\n\n',
    'data: {"type":"done","data":{"content":"Hi there","model":"zuri-flash"}}\n\n',
  ];
  const seen = [];
  const finished = await readChatStream(respond(split), (text) => seen.push(text));
  if (!finished.ok) throw new Error('a good stream was refused: ' + finished.error.message);
  if (seen.join('') !== 'Hi there') throw new Error('deltas were ' + JSON.stringify(seen));
  if (finished.data.content !== 'Hi there') throw new Error('the done frame was not read');

  // A reply that stops without a done frame is not a finished reply, even though
  // text arrived. Saying so is what stops half an answer looking complete.
  const cut = await readChatStream(respond(['data: {"type":"delta","text":"Half"}\n\n']), () => {});
  if (cut.ok !== false || cut.error.code !== 'CHAT_STREAM_ENDED') throw new Error('a truncated reply was treated as finished');

  // A failure after text arrived is still a failure: the request was not charged.
  const refused = await readChatStream(
    respond([
      'data: {"type":"delta","text":"Starting"}\n\n',
      'data: {"type":"error","error":{"code":"PROVIDER_REQUEST_FAILED","message":"The AI provider rejected the request."}}\n\n',
    ]),
    () => {},
  );
  if (refused.ok !== false || refused.error.code !== 'PROVIDER_REQUEST_FAILED') throw new Error('an error frame was ignored');

  return 'deltas in order, split frame survived, truncation and errors refused';
});
// The composer's web search toggle has to mean something on the account route. The
// search runs in the app because the cloud route has no tool loop, so what it is
// told, and what it will not invent, is checked here.
check('web search puts live results in front of the model, and cites them', async () => {
  const { cloudMessages, lastQuestion, webSearchContext } = await import(pathToFileURL(path.join(root, 'src/main/providers/cloud-chat.js')).href);

  const results = [
    { title: 'Naira rate today', url: 'https://example.com/rate', snippet: 'One dollar is 1,550 naira.' },
    { title: 'Central bank notice', url: 'https://example.com/cbn' },
    // A result with no URL cannot be cited, so it must not be numbered.
    { title: 'No link', snippet: 'orphan' },
  ];
  const context = webSearchContext('what is the dollar rate?', results);
  if (!context.includes('what is the dollar rate?')) throw new Error('the question was lost');
  if (!context.includes('1. Naira rate today')) throw new Error('results are not numbered');
  if (!context.includes('https://example.com/rate')) throw new Error('the URL is missing');
  if (context.includes('orphan')) throw new Error('a result with no URL was offered as a citation');
  // The rule that matters: no invented source.
  if (!context.includes('never invent a source')) throw new Error('the no-invented-sources rule is missing');

  // Nothing found is said plainly, not filled in from memory.
  const empty = webSearchContext('anything', []);
  if (!empty.includes('could not find')) throw new Error('an empty search is not reported honestly');

  // The question is the newest user turn, and an inlined attachment is not part of it.
  const conversation = {
    system: 'You are Zuri, an AI assistant made by Tijha.',
    turns: [
      { role: 'user', content: 'older question' },
      { role: 'assistant', content: 'an answer' },
      { role: 'user', content: 'what is the dollar rate?\n\nAttached file: notes.txt (path: notes.txt)\n\nsecret file body' },
    ],
  };
  const question = lastQuestion(conversation);
  if (question !== 'what is the dollar rate?') throw new Error('the search query was ' + question);
  if (question.includes('secret file body')) throw new Error('the attachment body was searched for');

  // Identity first, then the search instruction, then the conversation.
  const messages = cloudMessages(conversation, 'SEARCH RESULTS');
  if (messages[0].role !== 'system' || !messages[0].content.includes('made by Tijha')) {
    throw new Error('the identity is not first');
  }
  if (messages[1].role !== 'system' || messages[1].content !== 'SEARCH RESULTS') {
    throw new Error('the search results are not the second thing read');
  }
  // The whole turn travels, attachment included; it is the newest question only for
  // the purpose of choosing what to search for.
  if (!messages.at(-1).content.startsWith('what is the dollar rate?')) throw new Error('the question was not last');

  // An attached file is already inlined into the message by the composer, so it
  // travels to the account route without any extra work. This pins that, because
  // "attachments are not sent" was the wrong assumption once made about this route.
  const withFile = cloudMessages({ turns: [{ role: 'user', content: 'summarise this\n\nAttached file: notes.txt\n\nthe body' }] });
  if (!withFile[0].content.includes('the body')) throw new Error('an attached file was dropped');

  return 'numbered results, no invented sources, attachment text travels';
});
// Act mode over the account: the model asks, the app runs the tool on this computer,
// the result goes back, and the answer finishes. The loop is what makes the account
// route as capable as the direct one.
check('a tool round over the account runs the tool locally and finishes the answer', async () => {
  const { cloudMessages } = await import(pathToFileURL(path.join(root, 'src/main/providers/cloud-chat.js')).href);

  // The app builds the wire conversation from the loop it is driving.
  const turns = [
    { role: 'user', content: 'Read my notes and summarise them' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'readFile', arguments: '{"path":"notes.txt"}' }] },
    { role: 'tool', toolCallId: 'call_1', content: '{"ok":true,"data":{"text":"the notes"}}' },
    { role: 'user', content: 'Answer now using what you read.' },
  ];
  const messages = cloudMessages({ system: 'You are Zuri, an AI assistant made by Tijha.', turns });

  if (messages[0].role !== 'system' || !messages[0].content.includes('made by Tijha')) {
    throw new Error('the identity is not first');
  }
  const call = messages.find((message) => Array.isArray(message.toolCalls));
  if (!call) throw new Error('the assistant call was dropped, so the supplier cannot see it');
  if (call.toolCalls[0].name !== 'readFile') throw new Error('the call lost its name');
  const result = messages.find((message) => message.role === 'tool');
  if (!result) throw new Error('the tool result was dropped');
  if (result.toolCallId !== 'call_1') throw new Error('the result does not name the call it answers');
  if (!result.content.includes('the notes')) throw new Error('the result body was lost');

  // An empty assistant turn with no calls is not worth sending, and would be refused
  // by the server if it were.
  const trimmed = cloudMessages({ turns: [{ role: 'assistant', content: '' }, { role: 'user', content: 'hi' }] });
  if (trimmed.length !== 1) throw new Error('an empty assistant turn was sent');

  // The loop is bounded, so a model that keeps asking cannot run for ever.
  const chat = read('src/main/providers/chat.js');
  if (!chat.includes('rounds < MAX_TOOL_ROUNDS')) throw new Error('the account loop is unbounded');
  if (!chat.includes('runTool(call.name, args')) throw new Error('the tools are not run on this computer');

  return 'call and result travel, loop is bounded, tools run locally';
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
const unconfirmedEdit = await runTool('editDocument', { path: madeDocx.data.path, edits: [{ find: 'Hello', replace: 'Nope' }] });
const editedDocx = await runTool('editDocument', { path: madeDocx.data.path, edits: [{ find: 'Hello', replace: 'Goodbye & <more>' }] }, { confirmed: true });
const editedXlsx = await runTool('editDocument', { path: madeXlsx.data.path, edits: [{ sheet: 'Budget', cell: 'B2', value: 250 }, { sheet: 'Budget', appendRow: ['Tax', 25] }] }, { confirmed: true });
const editedPptx = await runTool('editDocument', { path: madePptx.data.path, edits: [{ find: 'One', replace: 'First slide' }] }, { confirmed: true });

const readBack = async (result) => {
  const parser = await import('officeparser');
  return (await parser.parseOffice(result.data.path)).toText();
};

check('editDocument changes a Word file text in a new copy and leaves the original alone', async () => {
  if (unconfirmedEdit.ok || unconfirmedEdit.error.code !== 'TOOL_CONFIRMATION_REQUIRED') throw new Error('document edits ran without approval');
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
const unconfirmedOutside = await runTool('editDocument', { path: outsideFile, edits: [{ find: 'Hello', replace: 'x' }] });
const refusedOutside = await runTool('editDocument', { path: outsideFile, edits: [{ find: 'Hello', replace: 'x' }] }, { confirmed: true });
registerChosenFile(outsideFile);
const allowedOutside = await runTool('editDocument', { path: outsideFile, edits: [{ find: 'Hello', replace: 'x' }] }, { confirmed: true });
const nothingMatched = await runTool('editDocument', { path: madeDocx.data.path, edits: [{ find: 'not in the file', replace: 'x' }] }, { confirmed: true });
fs.rmSync(outsideFile, { force: true });

check('editDocument only touches files in the workspace or ones the person picked, and reports misses', () => {
  if (unconfirmedOutside.ok || unconfirmedOutside.error.code !== 'TOOL_CONFIRMATION_REQUIRED') throw new Error('document edit did not require approval');
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
  for (const name of ['summarizeDocument', 'createDocument']) {
    if (!body.tools.some((tool) => tool.name === name)) throw new Error(`${name} was not offered`);
  }
  // Nobody is there to approve a step in an unattended run, so none that needs it is offered.
  for (const name of ['writeFile', 'editDocument', 'openUrl', 'openApp']) {
    if (body.tools.some((tool) => tool.name === name)) throw new Error(`a confirmation-gated tool was offered: ${name}`);
  }
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

const askModeBodies = [];
const askModeRun = await runPrompt(
  { prompt: 'Tell me what is in my file', mode: 'ask', allowedTools: ['createDocument', 'readFile'] },
  {
    fetchImpl: async (url, init) => {
      askModeBodies.push(JSON.parse(init.body));
      return sseResponse([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
        { type: 'message_stop' },
      ]);
    },
  },
);

check('Ask mode cannot offer file-writing tools', () => {
  if (!askModeRun.ok) throw new Error(askModeRun.error.message);
  const names = (askModeBodies[0]?.tools ?? []).map((tool) => tool.name);
  if (names.includes('createDocument') || names.includes('editDocument')) throw new Error('Ask mode offered a writing tool');
  if (!names.includes('readFile')) throw new Error('Ask mode removed its read tool');
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

const previewAutomation = await createAutomation(
  {
    prompt: 'Preview a workspace report',
    mode: 'autopilot',
    dryRun: true,
    cadence: { type: 'once', at: new Date(Date.now() + 60_000).toISOString() },
  },
  { root: schedulerRoot },
);
if (!previewAutomation.ok) throw new Error(previewAutomation.error.message);
let attemptedPreviewStep = false;
const previewRun = await runSchedule(previewAutomation.data, {
  root: schedulerRoot,
  notify: () => true,
  plan: () => [{ name: 'writeFile', args: { path: 'preview.md', content: 'not written' } }],
  runStep: async () => {
    attemptedPreviewStep = true;
    return { ok: true, data: {} };
  },
});

check('autopilot dry-run previews steps without running or saving them', () => {
  if (!previewRun.ok || previewRun.data.run.status !== 'completed') throw new Error('preview run did not complete');
  if (attemptedPreviewStep) throw new Error('preview run executed a tool');
  if (previewRun.data.resultPath !== null) throw new Error('preview run wrote a result file');
});

let retryAttempts = 0;
const retryRun = await runSchedule(
  { id: 'retry-test', prompt: 'Retry one step', mode: 'autopilot', steps: [{ name: 'readFile', args: { path: 'x' } }] },
  {
    root: schedulerRoot,
    notify: () => true,
    retryDelayMs: 0,
    runStep: async (name, args) => {
      if (name === 'readFile') {
        retryAttempts += 1;
        if (retryAttempts < 2) return { ok: false, error: { code: 'TEMPORARY', message: 'try again' } };
      }
      return { ok: true, data: { relative: `${name}.txt` } };
    },
  },
);

check('autopilot retries a transient tool failure', () => {
  if (!retryRun.ok || retryRun.data.run.status !== 'completed') throw new Error('retry run did not complete');
  if (retryAttempts !== 2) throw new Error(`expected 2 attempts, got ${retryAttempts}`);
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

/* A frameless transparent window has no title bar, and Chromium's app-region drag does
   not move one on Windows, so the popup could not be moved at all until the header
   started reporting the pointer's travel and main moved the window. Five pieces have to
   agree for that to work: the window stays movable, the OS rectangle shadow stays off
   (it draws straight edges and square corners over the round CSS shadow), the header
   handles the press, the bridge carries the delta, and main answers it. */
check('the quick-ask popup can be dragged around the screen', () => {
  const overlay = read('src/main/overlay.js');
  if (!overlay.includes('hasShadow: false')) {
    throw new Error('overlay.js leaves the OS window shadow on, which paints straight edges and square corners behind the round card');
  }
  if (!overlay.includes('movable: true')) throw new Error('the overlay window is no longer movable');
  if (!overlay.includes('export function moveOverlayBy(')) throw new Error('overlay.js cannot move the card, so a drag does nothing');

  const panel = read('src/renderer-react/ChatPanel.jsx');
  for (const required of ['className="zuri-overlay-header"', 'onPointerDown={beginOverlayDrag}', 'function beginOverlayDrag(']) {
    if (!panel.includes(required)) throw new Error(`ChatPanel.jsx is missing ${required}`);
  }
  // The window buttons live in the same strip, so a press on one must not start a drag.
  if (!panel.includes("closest('.zuri-overlay-window-actions')")) {
    throw new Error('a press on the window buttons would start a drag instead of clicking');
  }
  if (!panel.includes('overlay?.moveBy?.({ dx, dy })')) throw new Error('the drag never reaches main');
  // Slice the actions container alone: a button that drifts outside it loses its clicks.
  // The class is also named in the drag handler, so slice from the markup element.
  const actionsAt = panel.indexOf('className="zuri-overlay-window-actions"');
  const actions = panel.slice(actionsAt, panel.indexOf('</div>', actionsAt));
  for (const required of ['aria-label="Open Zuri"', 'aria-label="Close"']) {
    if (!actions.includes(required)) throw new Error(`${required} sits outside the window actions box`);
  }

  if (!read('src/main/preload.js').includes("'zuri:overlay:move-by'")) {
    throw new Error('the bridge does not offer zuri:overlay:move-by, so the card cannot be dragged');
  }
  if (!read('src/main/main.js').includes("['zuri:overlay:move-by', handleOverlayMoveBy]")) {
    throw new Error('main does not answer zuri:overlay:move-by, so the card cannot be dragged');
  }
  const css = read('src/renderer-react/app.css');
  if (/-webkit-app-region:\s*drag/.test(css)) {
    throw new Error('a drag region is back in the stylesheet; it swallows the pointer events the drag handler needs, and it does not move a transparent window on Windows');
  }
  if (!/\.zuri-overlay-header\s*\{[^}]*cursor:\s*grab/.test(css)) {
    throw new Error('.zuri-overlay-header does not show a grab cursor, so nothing says the card can be dragged');
  }
  return 'header drag reaches main through zuri:overlay:move-by';
});
;

// A channel the preload bridge offers and main does not answer is a button that
// does nothing, and one main answers but nobody can reach is dead code. Both lists
// are written by hand, so they are compared here rather than at run time.
check('every preload channel has a main-process handler and the reverse', () => {
  const preload = read('src/main/preload.js');
  const start = preload.indexOf('const CHANNELS = Object.freeze([');
  const bridge = preload.slice(start, preload.indexOf(']);', start));
  const offered = new Set([...bridge.matchAll(/'(zuri:[a-z0-9:.-]+)'/g)].map((match) => match[1]));
  const handlers = new Set([...read('src/main/main.js').matchAll(/\['(zuri:[a-z0-9:.-]+)'/g)].map((match) => match[1]));
  if (offered.size === 0) throw new Error('no channels found in preload');
  const unreachable = [...offered].filter((channel) => !handlers.has(channel));
  const orphaned = [...handlers].filter((channel) => !offered.has(channel));
  if (unreachable.length > 0) throw new Error(`no handler for ${unreachable.join(', ')}`);
  if (orphaned.length > 0) throw new Error(`no bridge for ${orphaned.join(', ')}`);
  return `${offered.size} channels`;
});

// The desktop menu and the server catalogue quote the same three picture names at
// the same prices in two files that never import each other, so a change to one
// has to be a change to the other. This is the check that notices when it is not.
check('the picture ladder matches the server catalogue in names, quota and Naira price', async () => {
  const desktop = await import(pathToFileURL(path.join(root, 'src/main/providers/images.js')).href);
  const catalogue = await import(pathToFileURL(path.join(root, 'server/src/models.js')).href);
  const plans = await import(pathToFileURL(path.join(root, 'server/src/plans.js')).href);
  const starter = plans.PLANS.find((plan) => plan.code === 'starter');
  const server = catalogue.DEFAULT_MODELS.filter((model) => model.kind === 'image');
  if (server.length !== 3) throw new Error(`the server has ${server.length} picture models, expected 3`);
  if (desktop.IMAGE_MODELS.length !== server.length) throw new Error('the desktop offers a different number of picture models');
  for (const model of server) {
    const match = desktop.IMAGE_MODELS.find((entry) => entry.code === model.code);
    if (!match) throw new Error(`${model.code} is missing from the desktop ladder`);
    if (match.name !== model.name) throw new Error(`${model.code} is called ${match.name} on the desktop and ${model.name} on the server`);
    if (match.quotaTokens !== model.quotaTokensPerImage) throw new Error(`${model.code} burns ${match.quotaTokens} on the desktop and ${model.quotaTokensPerImage} on the server`);
    if (match.minPlan !== model.minPlan) throw new Error(`${model.code} starts at ${match.minPlan} on the desktop and ${model.minPlan} on the server`);
    // The desktop quotes whole naira in the menu ("About NGN 60"), while the server
    // derives the price from the plan rate, which now lands a fraction of a naira
    // short: Starter is NGN 2,499 to stay under Paystack's fee threshold, so a
    // picture costs 59.98 rather than 60. Comparing to the nearest naira still
    // catches a real change (a picture moving from 60 to 264), which is the drift
    // this check exists to find.
    const kobo = catalogue.imagePriceKobo(model, starter);
    if (Math.round(kobo / 100) !== Math.round(match.nairaPerImage)) throw new Error(`${model.code} sells at ${kobo / 100} Naira on the server and ${match.nairaPerImage} on the desktop`);
  }
  return server.map((model) => model.name).join(', ');
});


// A chat can be pinned to a model from the composer, so the send path has to honour
// that pick in one place and record it on the reply. Without the record, a reopened
// chat would fall back to Settings and quietly change model mid-conversation.
check('a chat is answered by the model picked for it, and the reply records it', async () => {
  const { getStoreRoot, setStoreRoot, createThread, appendMessage, readStore } = await import(
    pathToFileURL(path.join(root, 'src/main/store.js')).href,
  );
  const { sendChatMessage } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);
  // Its own folder, restored afterwards, so this check cannot leave the checks
  // around it reading a different store.
  const previousRoot = getStoreRoot();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-model-chip-'));
  try {
    setStoreRoot(scratch);
    const created = await createThread({ title: 'Model chip' });
    if (!created.ok) throw new Error('a chat could not be created');
    const threadId = created.data.id;
    await appendMessage(threadId, { role: 'user', content: 'Hello' });

    const asked = [];
    const picked = await sendChatMessage(threadId, {
      model: { provider: 'zai', model: 'glm-5.3' },
      cloudReply: async (request) => {
        asked.push(request.settings);
        return { ok: true, data: { content: 'Hello from Max', modelCode: 'zuri-max', modelName: 'Zuri Max' } };
      },
    });
    if (!picked.ok) throw new Error(picked.error?.message ?? 'the reply failed');
    if (asked.length !== 1) throw new Error(`expected one account request, got ${asked.length}`);
    if (asked[0].model !== 'glm-5.3') throw new Error(`the account was asked for ${asked[0].model}, not the picked model`);

    const thread = (await readStore('chats')).data.find((entry) => entry.id === threadId);
    const reply = thread.messages.at(-1);
    if (reply.role !== 'assistant') throw new Error('the reply was not saved');
    if (reply.model?.model !== 'glm-5.3') throw new Error('the reply did not record the model that wrote it');
    if (reply.model?.provider !== 'zai') throw new Error('the reply lost the provider that paid for it');

    // A pair whose id belongs to another provider would be swapped for a default by
    // resolveChatTarget, which would make the chip name a model that never answered.
    const fallback = [];
    const mismatched = await sendChatMessage(threadId, {
      model: { provider: 'openai', model: 'glm-5.3' },
      cloudReply: async (request) => {
        fallback.push(request.settings.model);
        return { ok: true, data: { content: 'ok' } };
      },
    });
    if (!mismatched.ok) throw new Error('a mismatched pair blocked the reply instead of being ignored');
    if (fallback[0] === 'glm-5.3') throw new Error('a model id was trusted on the wrong provider');
    return `picked model honoured, recorded, and a foreign id ignored`;
  } finally {
    setStoreRoot(previousRoot);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// A project is only a folder for chats: moving a chat in and out has to keep its
// messages, and deleting the project must hand its chats back rather than lose them.
check('chats move into a project and survive the project being deleted', async () => {
  const { createThread, appendMessage, readStore, listProjects, createProject, deleteProject, setThreadProject } =
    await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  // Its own folder passed to every call, never the shared store root: checks run
  // side by side, and moving the shared root would make them read each other's data.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-projects-'));
  const here = { root: scratch };
  try {
    const blank = await createProject({ name: '   ' }, here);
    if (blank.ok) throw new Error('a project with a blank name was accepted');

    const project = await createProject({ name: '  Launch   plan ', icon: 'nonsense' }, here);
    if (!project.ok) throw new Error('a project could not be created');
    if (project.data.name !== 'Launch plan') throw new Error(`the name was not tidied: ${project.data.name}`);
    if (project.data.icon !== 'folder') throw new Error('an unknown icon was stored instead of the default');

    const thread = (await createThread({ title: 'Plan' }, here)).data;
    await appendMessage(thread.id, { role: 'user', content: 'Hello' }, here);

    const missing = await setThreadProject(thread.id, 'no-such-project', here);
    if (missing.ok) throw new Error('a chat was moved into a project that does not exist');

    const moved = await setThreadProject(thread.id, project.data.id, here);
    if (!moved.ok || moved.data.projectId !== project.data.id) throw new Error('the chat was not filed in the project');

    const removed = await deleteProject(project.data.id, here);
    if (!removed.ok) throw new Error('the project could not be deleted');
    if ((await listProjects(here)).data.length !== 0) throw new Error('the deleted project is still listed');

    const kept = (await readStore('chats', here)).data.find((entry) => entry.id === thread.id);
    if (!kept || kept.messages.length !== 1) throw new Error('deleting the project lost the chat or its messages');
    if (kept.projectId !== undefined) throw new Error('the chat still points at the deleted project');
    return 'chats can be filed, and outlive their project';
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// Ask, Act and Autopilot decide which tools a message may use and which steps need a
// yes. These are pure decisions, so they are checked without any model or store.
check('modes decide which tools are offered and which steps need approval', async () => {
  const { toolsForMode, approveToolCall, normaliseChatMode } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);
  const gated = ['editDocument', 'writeFile', 'openUrl', 'openApp'];
  const names = (mode, web = false) => toolsForMode(mode, web).map((tool) => tool.name);

  if (normaliseChatMode('shout') !== 'ask' || normaliseChatMode(undefined) !== 'ask') throw new Error('an unknown mode did not fall back to Ask');
  for (const name of gated) {
    if (names('ask').includes(name)) throw new Error(`Ask offered ${name}`);
    if (!names('act').includes(name) || !names('autopilot').includes(name)) throw new Error(`${name} was not offered to Act and Autopilot`);
  }
  if (!names('ask').includes('createDocument') || !names('ask').includes('readFile')) throw new Error('Ask lost the tools that change nothing');
  if (names('ask').includes('webSearch') || !names('ask', true).includes('webSearch')) throw new Error('web search did not follow its switch');

  let asked = 0;
  const yes = async () => { asked += 1; return true; };
  const no = async () => { asked += 1; return false; };

  const read = await approveToolCall({ name: 'readFile', args: {}, mode: 'ask', requestApproval: yes });
  if (!read.run || asked !== 0) throw new Error('a reading tool was held up for approval');

  const inAsk = await approveToolCall({ name: 'writeFile', args: {}, mode: 'ask', requestApproval: yes });
  if (inAsk.run || asked !== 0) throw new Error('Ask let a risky step through, or asked about one');

  const allowed = await approveToolCall({ name: 'writeFile', args: { path: 'a.md' }, mode: 'act', requestApproval: yes });
  if (!allowed.run || !allowed.confirmed || asked !== 1) throw new Error('Act did not run a step the person approved');

  const refused = await approveToolCall({ name: 'writeFile', args: { path: 'a.md' }, mode: 'act', requestApproval: no });
  if (refused.run || !refused.reason) throw new Error('Act ran a step the person refused');

  const nobody = await approveToolCall({ name: 'openUrl', args: {}, mode: 'act' });
  if (nobody.run) throw new Error('a step ran with nobody to ask');

  const before = asked;
  const auto = await approveToolCall({ name: 'editDocument', args: {}, mode: 'autopilot', requestApproval: no });
  if (!auto.run || asked !== before) throw new Error('Autopilot asked about a copy-only edit');
  const overwrite = await approveToolCall({ name: 'writeFile', args: {}, mode: 'autopilot', requestApproval: no });
  if (overwrite.run || asked !== before + 1) throw new Error('Autopilot replaced a file without asking');
  return 'Ask never changes things, Act asks every time, Autopilot never overwrites unasked';
});

// Skills and project instructions only matter if they reach the model, and a skill must
// not be able to cost more than the limits promise.
check('skills and project instructions are saved with limits and reach the prompt', async () => {
  const store = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  const { skillsPolicy, projectPolicy, chatSystemPrompt: build } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-skills-'));
  const here = { root: scratch };
  try {
    if ((await store.createSkill({ name: ' ', instructions: 'x' }, here)).ok) throw new Error('a nameless skill was saved');
    if ((await store.createSkill({ name: 'x', instructions: '  ' }, here)).ok) throw new Error('an empty skill was saved');

    const made = [];
    for (let index = 0; index < 6; index += 1) {
      const created = await store.createSkill({ name: `Skill ${index}`, instructions: `Do thing ${index}` }, here);
      if (!created.ok) throw new Error(created.error.message);
      if (created.data.enabled !== false) throw new Error('a new skill started switched on');
      made.push(created.data);
    }
    for (const skill of made.slice(0, store.SKILL_MAX_ENABLED)) {
      const on = await store.updateSkill(skill.id, { enabled: true }, here);
      if (!on.ok) throw new Error(on.error.message);
    }
    const sixth = await store.updateSkill(made[5].id, { enabled: true }, here);
    if (sixth.ok || sixth.error.code !== 'SKILL_ENABLED_LIMIT') throw new Error('a sixth skill was switched on');

    const listed = (await store.listSkills(here)).data;
    if (listed.map((skill) => skill.name).join() !== made.map((skill) => skill.name).join()) throw new Error('the list order changed when skills were switched on');

    const policy = skillsPolicy(listed);
    if (!policy.includes('Do thing 0') || policy.includes('Do thing 5')) throw new Error('only switched-on skills belong in the prompt');
    if (skillsPolicy([{ name: 'a', instructions: 'b', enabled: false }]) !== '') throw new Error('an off skill reached the prompt');

    const project = (await store.createProject({ name: 'Maths', instructions: '  Answer as a patient tutor.  ' }, here)).data;
    if (project.instructions !== 'Answer as a patient tutor.') throw new Error('project instructions were not trimmed');
    const changed = await store.updateProject(project.id, { instructions: 'Use metric units.' }, here);
    if (changed.data.instructions !== 'Use metric units.' || changed.data.name !== 'Maths') throw new Error('editing instructions lost the name');
    if (!projectPolicy(changed.data).includes('Use metric units.')) throw new Error('project instructions did not reach the policy');

    const prompt = build({ projectPrompt: projectPolicy(changed.data), skillsPrompt: policy });
    if (!prompt.startsWith(ZURI_IDENTITY_PROMPT) || !prompt.includes('Use metric units.') || !prompt.includes('Do thing 0')) {
      throw new Error('the prompt is missing the identity, the project or the skills');
    }

    const removed = await store.deleteSkill(made[0].id, here);
    if (!removed.ok || (await store.listSkills(here)).data.length !== 5) throw new Error('a skill was not deleted');
    return 'five on at most, names and text required, instructions reach the prompt';
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

check('regenerate drops only a trailing reply and never the person\'s own message', async () => {
  const { createThread, appendMessage, removeTrailingReply, readStore } = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-regen-'));
  const here = { root: scratch };
  try {
    const thread = (await createThread({ title: 'Regen' }, here)).data;
    await appendMessage(thread.id, { role: 'user', content: 'Question' }, here);
    const onlyUser = await removeTrailingReply(thread.id, here);
    if (!onlyUser.ok || onlyUser.data.removed !== false) throw new Error('the person\'s own message was treated as a reply');
    await appendMessage(thread.id, { role: 'assistant', content: 'Answer' }, here);
    const dropped = await removeTrailingReply(thread.id, here);
    if (!dropped.ok || dropped.data.removed !== true) throw new Error('the reply was not removed');
    const kept = (await readStore('chats', here)).data.find((entry) => entry.id === thread.id);
    if (kept.messages.length !== 1 || kept.messages[0].role !== 'user') throw new Error('the wrong message was removed');
    return 'only a trailing reply goes';
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

check('editing a skill changes its words and leaves the on/off switch alone', async () => {
  const store = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-skill-edit-'));
  const here = { root: scratch };
  try {
    const made = (await store.createSkill({ name: 'Tone', instructions: 'Be brief.' }, here)).data;
    await store.updateSkill(made.id, { enabled: true }, here);
    const edited = await store.updateSkill(made.id, { name: 'Tone v2', instructions: 'Be brief and kind.' }, here);
    if (!edited.ok) throw new Error(edited.error.message);
    if (edited.data.enabled !== true) throw new Error('editing the words switched the skill off');
    if (edited.data.name !== 'Tone v2' || edited.data.instructions !== 'Be brief and kind.') throw new Error('the new words were not saved');
    const blanked = await store.updateSkill(made.id, { instructions: '   ' }, here);
    if (blanked.ok) throw new Error('a skill was saved with no instructions');
    return 'words change, switch stays, blanking is refused';
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// The first screen used to show example tasks and a calendar as if they were the
// person's own, and the bell had no action. Both are about trust, so they are pinned.
check('the opening screen and the bell show real data, not examples', () => {
  const chat = read('src/renderer-react/ChatPanel.jsx');
  for (const example of ['Writing sprint', 'Design review', 'Launch plan', '12 tasks this week', 'Meeting with AI client']) {
    if (chat.includes(example)) throw new Error(`example text is back on the opening screen: ${example}`);
  }
  if (chat.includes('WorkspaceOverview')) throw new Error('the dashboard cards are back on the opening screen');
  const sidebar = read('src/renderer-react/Sidebar.jsx');
  if (!sidebar.includes("{ key: 'reminders'") || !sidebar.includes("key === 'reminders' && dueReminders > 0")) throw new Error('the menu does not open Reminders or show how many are due');
  if (sidebar.includes('zuri-sidebar-rail')) throw new Error('the thin icon strip is back beside the sidebar');
  if (!sidebar.includes('reminders?.list')) throw new Error('the bell does not count real reminders');
  return 'no example text; bell opens Reminders with a real count';
});

// The whole path in one go, on the real send code with a stand-in account. It uses the
// shared store location, so the checks around it must be finished first and this one
// must finish before the next starts.
await Promise.all(pendingChecks);
check('a reply in Act mode builds files, asks before editing, and carries skills and project rules', async () => {
  const store = await import(pathToFileURL(path.join(root, 'src/main/store.js')).href);
  const { sendChatMessage } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);
  const previousRoot = store.getStoreRoot();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-act-'));
  try {
    store.setStoreRoot(scratch);
    const project = (await store.createProject({ name: 'Reports', instructions: 'Keep every report to one page.' })).data;
    const skill = (await store.createSkill({ name: 'Plain', instructions: 'Use plain English.' })).data;
    await store.updateSkill(skill.id, { enabled: true });
    const thread = (await store.createThread({ title: 'Act' })).data;
    await store.setThreadProject(thread.id, project.id);
    await store.appendMessage(thread.id, { role: 'user', content: 'Make a report, then fix a typo in my file.' });

    /** A stand-in account: each scripted round is what the model "says", and every request is kept. */
    const converse = (script) => {
      const requests = [];
      const cloudReply = async (request) => {
        requests.push({ system: request.conversation.system, tools: request.tools.map((tool) => tool.name), turns: JSON.parse(JSON.stringify(request.conversation.turns)) });
        return { ok: true, data: script[Math.min(requests.length - 1, script.length - 1)] };
      };
      return { requests, cloudReply };
    };
    const askedFor = [];

    // Act, approved: a file is built, then a copy of an existing file is edited after a yes.
    const approved = converse([
      { content: '', toolCalls: [{ id: 'c1', name: 'createDocument', arguments: JSON.stringify({ kind: 'docx', fileName: 'report', content: OFFICE_SAMPLES.docx }) }] },
      { content: '', toolCalls: [{ id: 'c2', name: 'editDocument', arguments: JSON.stringify({ path: madeDocx.data.path, edits: [{ find: 'Intro', replace: 'Summary' }] }) }] },
      { content: 'All done.', modelCode: 'zuri-flash' },
    ]);
    const first = await sendChatMessage(thread.id, {
      mode: 'act',
      cloudReply: approved.cloudReply,
      requestApproval: async (step) => { askedFor.push(step); return true; },
    });
    if (!first.ok) throw new Error(first.error?.message ?? 'the reply failed');
    const reply = first.data.thread.messages.at(-1);
    if (!Array.isArray(reply.files) || reply.files.length !== 2) throw new Error(`the reply carried ${reply.files?.length} files, expected the built one and the edited copy`);
    if (askedFor.length !== 1 || askedFor[0].name !== 'editDocument') throw new Error('only the edit should have needed a yes');
    const system = approved.requests[0].system;
    for (const expected of ['Keep every report to one page.', 'Use plain English.', 'Act mode']) {
      if (!system.includes(expected)) throw new Error(`the prompt is missing "${expected}"`);
    }
    if (!approved.requests[0].tools.includes('editDocument')) throw new Error('Act was not offered the edit tool');

    // Act, refused: the step does not run and the model is told so.
    await store.appendMessage(thread.id, { role: 'user', content: 'Edit it again.' });
    const refusedRun = converse([
      { content: '', toolCalls: [{ id: 'c3', name: 'editDocument', arguments: JSON.stringify({ path: madeDocx.data.path, edits: [{ find: 'Intro', replace: 'Nope' }] }) }] },
      { content: 'Understood, I left it alone.' },
    ]);
    const second = await sendChatMessage(thread.id, { mode: 'act', cloudReply: refusedRun.cloudReply, requestApproval: async () => false });
    if (!second.ok) throw new Error(second.error?.message ?? 'the second reply failed');
    // A reply with no files carries no `files` field at all, so absence is the pass.
    if ((second.data.thread.messages.at(-1).files ?? []).length !== 0) throw new Error('a refused edit still made a file');
    const told = refusedRun.requests[1].turns.at(-1)?.content ?? '';
    if (!told.includes('TOOL_DECLINED')) throw new Error('the model was not told the step was declined');

    // Ask: the risky tools are not even offered, so there is nothing to approve.
    await store.appendMessage(thread.id, { role: 'user', content: 'And in Ask mode?' });
    const asking = converse([{ content: 'Just an answer.' }]);
    const third = await sendChatMessage(thread.id, { mode: 'ask', cloudReply: asking.cloudReply });
    if (!third.ok) throw new Error(third.error?.message ?? 'the Ask reply failed');
    if (asking.requests[0].tools.some((name) => ['editDocument', 'writeFile', 'openUrl', 'openApp'].includes(name))) throw new Error('Ask was offered a risky tool');
    if (asking.requests[0].system.includes('Act mode')) throw new Error('Ask was told it is in Act mode');

    // Regenerate: the old reply is replaced, and the model never sees it as history.
    const countBefore = third.data.thread.messages.length;
    const again = converse([{ content: 'A fresh answer.' }]);
    const redone = await sendChatMessage(thread.id, { mode: 'ask', regenerate: true, cloudReply: again.cloudReply });
    if (!redone.ok) throw new Error(redone.error?.message ?? 'regenerate failed');
    if (redone.data.thread.messages.length !== countBefore) throw new Error('regenerating added a message instead of replacing one');
    if (JSON.stringify(again.requests[0].turns).includes('Just an answer.')) throw new Error('the model saw the reply it was replacing');
    if (redone.data.thread.messages.at(-1).content !== 'A fresh answer.') throw new Error('the new reply was not saved');
    return 'files saved with the reply, edit asked first, refusal reported, skills and project rules sent';
  } finally {
    store.setStoreRoot(previousRoot);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
await Promise.all(pendingChecks);

// The chip has to sit in the message row and offer the one catalogue, or a person
// has to leave the chat to change model, which is what this change removes.
check('the composer offers the model chip and sends the choice with the message', async () => {
  const panel = read('src/renderer-react/ChatPanel.jsx');
  const styles = read('src/renderer-react/app.css');
  const chipAt = panel.indexOf('aria-label={`Chat model: ');
  const boxAt = panel.indexOf('<ComposerTextarea');
  const sendAt = panel.indexOf('aria-label="Send"');
  if (chipAt === -1) throw new Error('the composer has no model chip');
  if (boxAt === -1 || sendAt === -1) throw new Error('the composer row could not be read');
  // The chip sits in the right-hand group, after the box and before Send, so the model
  // is within reach of the thumb that is about to send.
  if (chipAt < boxAt) throw new Error('the chip drifted back to the left of the message box');
  if (chipAt > sendAt) throw new Error('the chip is not beside Send');
  if (panel.includes('AgentIcon size={14}')) throw new Error('the robot icon is back in the chip');
  if (!/\.composer-textarea\s*\{[^}]*overflow-y:\s*hidden;/.test(styles)) {
    throw new Error('the composer textarea can draw an internal scrollbar');
  }
  for (const compactPart of ['zuri-chat-model-trigger', 'zuri-chat-model-label-full', 'zuri-chat-model-label-short']) {
    if (!panel.includes(compactPart)) throw new Error(`the narrow model control is missing ${compactPart}`);
  }
  // The chip is plain text plus a chevron, not a filled pill: a fourth rounded shape
  // in a row of round buttons read as another action rather than as the model name.
  const chipEnd = panel.indexOf('</button>', chipAt);
  const chipTag = chipEnd === -1 ? panel.slice(chipAt) : panel.slice(chipAt, chipEnd);
  for (const pill of ['rounded-full', 'bg-surface-secondary', 'border-border']) {
    if (chipTag.includes(pill)) throw new Error(`the chip is a filled pill again (${pill})`);
  }
  if (!chipTag.includes('ChevronDownIcon')) throw new Error('the chip has no chevron');
  for (const required of [
    "from './zuriModels.js'",
    '{ZURI_MODELS.map((entry) => (',
    'aria-checked={entry.name === chatModelLabel}',
    'setPickedModelId(entry.model)',
    'model: { provider: chatModel.provider, model: chatModel.model }',
    'setPickedModelId(modelOfMessages(thread.messages))',
  ]) {
    if (!panel.includes(required)) throw new Error(`ChatPanel.jsx is missing ${required}`);
  }
  if (panel.includes('gpt-4o-mini')) throw new Error('a supplier model id is offered by name');

  // The chip must never show a supplier id. An older settings file holds gpt-4o, and
  // the cloud answers an unknown id with Zuri Flash, so that is what the chip says.
  const { zuriModelName } = await import(pathToFileURL(path.join(root, 'src/renderer-react/zuriModels.js')).href);
  // The retired 'zuri-code' is still saved in some settings files and is spelled out
  // from the code itself by the fallback, so it must read as Zuri Core or the old name
  // returns through the chip.
  const names = [
    ['glm-5.3', 'Zuri Max'],
    ['gpt-6.1-sol', 'Zuri Core'],
    ['zuri-code', 'Zuri Core'],
    ['gpt-4o', 'Zuri Flash'],
    ['zuri-ultra', 'Zuri Ultra'],
    ['', ''],
  ];
  for (const [id, expected] of names) {
    const got = zuriModelName(id);
    if (got !== expected) throw new Error(`${JSON.stringify(id)} shows as "${got}", expected "${expected}"`);
  }
  return 'six Zuri names, sent with the message, restored per chat, never a supplier id';
});


// A reply has to say which model wrote it, and the caption has to come from what the
// reply stored. A caption that read the chip instead would relabel old answers the
// moment someone changed model.
check('a reply names the model that wrote it, read from the stored reply', () => {
  const panel = read('src/renderer-react/ChatPanel.jsx');
  for (const required of [
    'function modelLabelPositions(messages) {',
    'const modelLabels = useMemo(() => modelLabelPositions(messages), [messages]);',
    '{modelLabels[index] && (',
    '<span className="px-1 text-xs text-muted">{zuriModelName(message.model.model)}</span>',
  ]) {
    if (!panel.includes(required)) throw new Error(`ChatPanel.jsx is missing ${required}`);
  }
  if (panel.includes('zuriModelName(chatModelId)}</span>')) {
    throw new Error('the reply caption reads the chip instead of the stored reply');
  }

  // The rule the renderer applies: first reply names its model, and so does the first
  // reply after a switch, but a chat that never changes model is not captioned twice.
  const positions = (messages) => {
    let previous = '';
    return messages.map((message) => {
      if (message.role === 'user') return false;
      const used = typeof message?.model?.model === 'string' ? message.model.model : '';
      if (used === '') return false;
      const show = used !== previous;
      previous = used;
      return show;
    });
  };
  const same = positions([{ role: 'user' }, { role: 'assistant', model: { model: 'deepseek-flash' } }, { role: 'user' }, { role: 'assistant', model: { model: 'deepseek-flash' } }]);
  if (same.filter(Boolean).length !== 1) throw new Error('a chat that never changed model was captioned more than once');
  const switched = positions([{ role: 'assistant', model: { model: 'deepseek-flash' } }, { role: 'assistant', model: { model: 'glm-5.3' } }, { role: 'assistant', model: { model: 'glm-5.3' } }]);
  if (switched.filter(Boolean).length !== 2) throw new Error('a switch between models was not captioned');
  const legacy = positions([{ role: 'assistant' }]);
  if (legacy[0] !== false) throw new Error('a reply saved before models were recorded was captioned');
  return 'caption from the stored reply, once per model change, none on old replies';
});

/*
 * The browser chat is held to the desktop app it mirrors. These checks read the
 * source rather than the rendered page, because what they guard against is a
 * surface drifting back to its own markup: a reply drawn as raw text again, a
 * bottom tab bar reappearing on a phone, or the model chip losing its menu.
 */

check('the web chat draws replies with the desktop renderer, not its own markup', () => {
  const source = read('web/src/views/ChatView.jsx');
  if (!source.includes("from '../../../src/renderer-react/FormattedMessage.jsx'")) {
    throw new Error('the web chat does not use the shared reply renderer');
  }
  if (!source.includes("from '../../../src/renderer-react/clipboard.js'")) {
    throw new Error('the web chat uses its own clipboard call');
  }
  // A prompt stays text and a reply is rendered, but both come from this one file,
  // and neither is ever written into the page as HTML.
  if (!/<FormattedMessage content=\{message\.content\} \/>/.test(source)) {
    throw new Error('a stored reply is not rendered by FormattedMessage');
  }
  if (/dangerouslySetInnerHTML/.test(source)) throw new Error('the reply is injected as HTML');
  return 'shared renderer for replies, plain text for prompts';
});

check("a reply's headings keep more air above them than between two paragraphs", () => {
  const renderer = read('src/renderer-react/FormattedMessage.jsx');
  if (!renderer.includes('className="message-body leading-6"')) {
    throw new Error('the reply no longer names the block that carries its spacing');
  }
  // One uniform gap is what put every heading on top of the paragraph above it.
  if (renderer.includes('space-y-3')) {
    throw new Error('a uniform block gap is back, which crams each heading against the text above it');
  }
  const px = (value) => (value.endsWith('rem') ? Number.parseFloat(value) * 16 : Number.parseFloat(value));
  for (const file of ['src/renderer-react/app.css', 'web/src/styles.css']) {
    const css = read(file);
    const block = /\.message-body > \* \+ \* \{\s*margin-block-start: ([\d.]+(?:rem|px));/.exec(css);
    const above = /\.message-body > \* \+ h3 \{\s*margin-block-start: ([\d.]+(?:rem|px));/.exec(css);
    const below = /\.message-body > h3 \+ \* \{\s*margin-block-start: ([\d.]+(?:rem|px));/.exec(css);
    if (!block || !above || !below) throw new Error(`${file} is missing the reply's spacing rules`);
    if (px(above[1]) <= px(block[1])) throw new Error(`${file} gives a heading no more room than a paragraph`);
    if (px(above[1]) < 20) throw new Error(`${file} leaves only ${above[1]} above a heading`);
    if (px(below[1]) >= px(block[1])) throw new Error(`${file} does not tie a heading to the text under it`);
  }
  return 'wide gap above a heading, tight gap below, in both stylesheets';
});

check("both the person's prompts and Zuri's replies carry a copy action", () => {
  const source = read('web/src/views/ChatView.jsx');
  const copyAt = source.indexOf('className="chat-copy"');
  if (copyAt < 0) throw new Error('no copy action is drawn');
  // One button, placed after the role branch, is what makes it cover both roles.
  const roleBranch = source.indexOf('message.role === \'assistant\'');
  if (roleBranch < 0 || copyAt < roleBranch) throw new Error('the copy action sits inside one role only');
  if (!source.includes('copyMessage(message, index)')) throw new Error('the copy action does not copy the message');
  // The control is the shared Flowbite IconButton, which names itself through label.
  if (!source.includes("label={copiedIndex === index ? 'Copied'")) throw new Error('the copy action never confirms');
  return 'one copy path for prompts and replies';
});

check('the signed-in shell has no bottom tab bar', () => {
  for (const file of ['web/src/views/Dashboard.jsx', 'web/src/styles.css']) {
    if (/\btabbar\b/.test(read(file))) throw new Error(file + ' still draws a bottom bar');
  }
  const views = fs.readdirSync(path.join(root, 'web/src/views'));
  if (views.some((name) => /tabbar/i.test(name))) throw new Error('a tab bar component remains');
  return 'navigation is a sidebar, not a bottom bar';
});

check('a phone reaches the navigation through a drawer with a floating button and a scrim', () => {
  const dashboard = read('web/src/views/Dashboard.jsx');
  const styles = read('web/src/styles.css');
  for (const required of ['sidebar${navOpen ? ', 'className="nav-scrim"', 'onClick={onCloseNav}', 'className="nav-fab"']) {
    if (!dashboard.includes(required)) throw new Error('the shell is missing ' + required);
  }
  // The button floats over the page: it is not a bar row, and it is round.
  if (!/\.nav-fab \{[^}]*position: fixed;/.test(styles)) throw new Error('the menu button does not float');
  if (!/\.nav-fab \{[^}]*border-radius: 999px;/.test(styles)) throw new Error('the floating button is not round');
  // The closed drawer must be off-screen, and the open one must actually slide in.
  if (!/\.sidebar \{[^}]*transform: translateX\(-100%\);/.test(styles)) {
    throw new Error('the closed drawer still sits on the page');
  }
  if (!/\.sidebar\.is-open \{[^}]*transform: none;/.test(styles)) throw new Error('the drawer does not slide in');
  if (!/\.nav-scrim \{[^}]*position: fixed;/.test(styles)) throw new Error('the scrim does not cover the page');
  return 'floating button, slide-in sidebar and a scrim that closes it';
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

check('conversation search is capped and encoded before it reaches the server', () => {
  const api = read('web/src/lib/api.js');
  const control = read('web/src/components/ConversationSearch.jsx');
  if (!api.includes('fetchConversations(query = \'\')')) throw new Error('conversation fetch does not accept a search query');
  if (!api.includes('slice(0, 120)')) throw new Error('conversation search has no length cap');
  if (!api.includes('encodeURIComponent(trimmed)')) throw new Error('conversation search is not URL encoded');
  if (!control.includes('aria-label="Search conversations"')) throw new Error('search control is not labelled');
  if (!control.includes('Clear conversation search')) throw new Error('search control has no clear action');
  return 'bounded, encoded server search with an accessible clearable control';
});

check('web chat prompts can be edited and the latest reply regenerated', () => {
  const view = read('web/src/views/ChatView.jsx');
  if (!view.includes('Edit and send again')) throw new Error('web prompts have no edit action');
  if (!view.includes('Regenerate reply')) throw new Error('latest replies have no regenerate action');
  if (!view.includes('send(message.content)')) throw new Error('regenerate does not replay the latest prompt');
  return 'prompt edit and latest-reply regeneration controls are wired';
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

check('the navigation drawer closes on Escape and locks the page behind it', () => {
  const app = read('web/src/App.jsx');
  if (!app.includes("if (event.key === 'Escape') setNavOpen(false);")) throw new Error('Escape does not close the drawer');
  if (!app.includes("document.body.style.overflow = 'hidden'")) throw new Error('the page scrolls behind the open drawer');
  if (!app.includes('document.body.style.overflow = previousOverflow')) throw new Error('the scroll lock is never released');
  return 'Escape closes, the page behind is locked, and the lock is restored';
});

check('the web chat is built from Flowbite components and one icon family', () => {
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
    // The chat keeps two plain buttons: a conversation row is a list row with two
    // controls beside it, and the model chip is a text trigger for its list.
    // Everything else must be a component.
    const allowed = 2;
    if (raw > allowed) throw new Error(`${name} still draws ${raw} raw buttons`);
  }

  // The composer stays a Flowbite textarea; the model chip owns its list so the
  if (!chat.includes('Textarea')) throw new Error('the composer is not a Flowbite textarea');
  if (!chat.includes('chat-model-menu')) throw new Error('the model menu is not anchored to its chip');

  return 'Flowbite controls, one icon family, one copy path';
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

check('the admin route is reachable before the server checks the account', () => {
  const dashboard = read('web/src/views/Dashboard.jsx');
  const admin = read('web/src/views/AdminView.jsx');
  if (!dashboard.includes("{view === 'admin' && <AdminView />}") ) throw new Error('the admin view is still hidden behind client-side state');
  if (!dashboard.includes("isAdmin || view === 'admin'")) throw new Error('a deep-linked admin view cannot show its navigation');
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

  return `${Object.keys(ops.OPERATIONS).length} operations, bad input refused with a reason`;
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
  for (const name of ['taskpane.html', 'taskpane.js', 'taskpane.css', 'ops.js']) {
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

await Promise.all(pendingChecks);
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
