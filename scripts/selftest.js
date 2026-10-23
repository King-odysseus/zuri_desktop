/** Node-only checks for the React renderer and main-process contracts. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(name, run) {
  try {
    const detail = run();
    console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
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
  if (packageJson.main !== 'src/main/main.js') throw new Error(`main is ${packageJson.main}`);
  if (!packageJson.build?.files?.includes('dist-react/**/*')) {
    throw new Error('electron-builder does not package dist-react');
  }
  return packageJson.main;
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

check('legacy design checks are no longer part of the test graph', () => {
  const checks = fs.readdirSync(path.join(root, 'scripts')).filter((name) => name.endsWith('.check.js'));
  if (checks.length > 0) throw new Error(`${checks.length} design check scripts remain`);
});

console.log(failures === 0 ? 'PASS selftest' : `FAIL selftest: ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
