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
  return packageJson.main;
});

check('the Windows app identity uses the Zuri icon', () => {
  const source = read('src/main/main.js');
  if (!exists('src/main/assets/zuri-icon.ico') || !exists('src/main/assets/zuri-icon.png')) {
    throw new Error('Zuri icon assets are missing');
  }
  for (const required of ["app.setAppUserModelId(APP_USER_MODEL_ID)", "icon: process.platform === 'win32' ? ICO_ENTRY : ICON_ENTRY", "shell.writeShortcutLink"]) {
    if (!source.includes(required)) throw new Error(`missing ${required}`);
  }
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

const { splitDsml } = await import(pathToFileURL(path.join(root, 'src/main/providers/chat.js')).href);

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

await Promise.all(pendingChecks);
console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
