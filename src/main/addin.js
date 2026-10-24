/**
 * Microsoft Word add-in support. Zuri serves a small task pane over HTTPS on this
 * computer only (Word refuses plain-HTTP add-ins), and registers a manifest for the
 * current Windows user so Word lists the add-in. Nothing here needs administrator
 * rights: the certificate goes into the user's own store and the manifest into the
 * user's own registry hive. The pane asks Zuri for text; Zuri forwards it to the
 * configured AI provider, so the API key never reaches Word.
 */

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADDIN_PORT = 38475;
const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer';
const REGISTRY_VALUE = 'ZuriWordAddin';
const CERT_FRIENDLY_NAME = 'Zuri Word add-in';
const BODY_LIMIT = 400_000;
const ADDIN_ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'addin');
const ICON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'zuri-icon.png');

const STATIC_FILES = Object.freeze({
  '/taskpane.html': { file: 'taskpane.html', type: 'text/html; charset=utf-8' },
  '/taskpane.js': { file: 'taskpane.js', type: 'text/javascript; charset=utf-8' },
  '/taskpane.css': { file: 'taskpane.css', type: 'text/css; charset=utf-8' },
});

/** Where the certificate, secret and manifest live, under Zuri's own data folder. */
export function addinPaths(dataRoot) {
  const dir = path.join(dataRoot, 'word-addin');
  return {
    dir,
    pfx: path.join(dir, 'localhost.pfx'),
    cer: path.join(dir, 'localhost.cer'),
    state: path.join(dir, 'state.json'),
    manifest: path.join(dir, 'manifest.xml'),
  };
}

/** @param {string} text @returns {string} */
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The Office add-in manifest. A fixed id keeps a reinstall from creating a second
 * entry in Word's list.
 * @param {{ id: string, port: number }} options
 * @returns {string}
 */
export function buildManifest({ id, port }) {
  const origin = `https://localhost:${port}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xsi:type="TaskPaneApp">
  <Id>${escapeXml(id)}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Zuri</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Zuri"/>
  <Description DefaultValue="Ask Zuri to write, rewrite or summarise text in your document."/>
  <IconUrl DefaultValue="${origin}/icon.png"/>
  <HighResolutionIconUrl DefaultValue="${origin}/icon.png"/>
  <AppDomains>
    <AppDomain>${origin}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document"/>
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="${origin}/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
`;
}

/** Constant-time string comparison, so the token check leaks nothing through timing. */
function sameSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Run a fixed PowerShell script. Values are passed through the environment, never
 * spliced into the script text, so a path can never become a command.
 * @param {string} script @param {Record<string, string>} env
 * @returns {Promise<void>}
 */
function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `PowerShell exited with ${code}`))));
  });
}

/** @param {string[]} args @returns {Promise<{ code: number, out: string }>} */
function runReg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('reg.exe', args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const CREATE_CERT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(5) -FriendlyName '${CERT_FRIENDLY_NAME}' -KeyExportPolicy Exportable`,
  '$secret = ConvertTo-SecureString -String $env:ZURI_PFX_PASSWORD -AsPlainText -Force',
  'Export-PfxCertificate -Cert $cert -FilePath $env:ZURI_PFX_PATH -Password $secret | Out-Null',
  'Export-Certificate -Cert $cert -FilePath $env:ZURI_CER_PATH | Out-Null',
  "Import-Certificate -FilePath $env:ZURI_CER_PATH -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null",
].join('\n');

const REMOVE_CERT_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  `foreach ($store in 'Root', 'My') { Get-ChildItem "Cert:\\CurrentUser\\$store" | Where-Object { $_.FriendlyName -eq '${CERT_FRIENDLY_NAME}' } | Remove-Item }`,
].join('\n');

/** @param {ReturnType<typeof addinPaths>} paths */
async function readState(paths) {
  try {
    return JSON.parse(await fs.readFile(paths.state, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Create the localhost certificate once, trust it for this Windows user, and keep the
 * export password beside it. Windows shows its own "install this certificate?" prompt
 * the first time; that is the person agreeing to trust Zuri's local page.
 * @param {ReturnType<typeof addinPaths>} paths
 */
async function ensureCertificate(paths) {
  const existing = await readState(paths);
  const hasFiles = await fs.access(paths.pfx).then(() => true, () => false);
  if (existing?.passphrase && hasFiles) return existing;

  await fs.mkdir(paths.dir, { recursive: true });
  const passphrase = randomBytes(24).toString('hex');
  await runPowerShell(CREATE_CERT_SCRIPT, { ZURI_PFX_PASSWORD: passphrase, ZURI_PFX_PATH: paths.pfx, ZURI_CER_PATH: paths.cer });
  const state = { passphrase, manifestId: existing?.manifestId ?? randomUUID() };
  await fs.writeFile(paths.state, JSON.stringify(state), 'utf8');
  return state;
}

/** @type {{ server: https.Server, token: string } | null} */
let running = null;

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {number} port
 */
function hostIsLocal(request, port) {
  const host = String(request.headers.host ?? '').toLowerCase();
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} body */
function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

/** @param {import('node:http').IncomingMessage} request @returns {Promise<any>} */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad json'));
      }
    });
    request.once('error', reject);
  });
}

/**
 * Serve the task pane and answer its requests. Bound to 127.0.0.1 so nothing else on
 * the network can reach it; the page carries a per-run token and every API call must
 * send it back, so a web page open in a browser cannot borrow the AI key.
 * @param {{
 *   pfx: Buffer,
 *   passphrase: string,
 *   port?: number,
 *   ask: (request: { prompt: string, context: string }) => Promise<{ ok: boolean, data?: { text: string }, error?: { message: string } }>
 * }} options
 * @returns {Promise<{ port: number, token: string }>}
 */
export async function startAddinServer({ pfx, passphrase, port = ADDIN_PORT, ask }) {
  if (running) return { port, token: running.token };
  const token = randomBytes(24).toString('hex');

  const server = https.createServer({ pfx, passphrase }, async (request, response) => {
    try {
      if (!hostIsLocal(request, port)) return sendJson(response, 403, { ok: false, error: { message: 'Not allowed.' } });
      const route = new URL(request.url ?? '/', `https://localhost:${port}`).pathname;

      if (request.method === 'GET' && route === '/icon.png') {
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
        return response.end(await fs.readFile(ICON_PATH));
      }

      const asset = request.method === 'GET' ? STATIC_FILES[route] : undefined;
      if (asset) {
        const text = (await fs.readFile(path.join(ADDIN_ASSETS, asset.file), 'utf8')).replaceAll('__ZURI_TOKEN__', token);
        response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
        return response.end(text);
      }

      if (request.method === 'POST' && route === '/api/ask') {
        if (!sameSecret(request.headers['x-zuri-token'] ?? '', token)) {
          return sendJson(response, 401, { ok: false, error: { message: 'Reopen the Zuri pane in Word and try again.' } });
        }
        const body = await readJsonBody(request);
        const answer = await ask({ prompt: String(body?.prompt ?? ''), context: String(body?.context ?? '') });
        return sendJson(response, answer.ok ? 200 : 400, answer);
      }

      return sendJson(response, 404, { ok: false, error: { message: 'Not found.' } });
    } catch (error) {
      console.error('[zuri:addin]', error?.message ?? error);
      return sendJson(response, 500, { ok: false, error: { message: 'Zuri could not answer that. Try again.' } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(error?.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use, so the Word add-in cannot start.`) : error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  running = { server, token };
  return { port, token };
}

/** @returns {Promise<void>} */
export async function stopAddinServer() {
  if (!running) return;
  const { server } = running;
  running = null;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/**
 * Whether the add-in is registered with Word and whether its page is being served.
 * @param {string} dataRoot
 */
export async function addinStatus(dataRoot) {
  if (process.platform !== 'win32') return { supported: false, installed: false, running: false };
  const paths = addinPaths(dataRoot);
  const manifestExists = await fs.access(paths.manifest).then(() => true, () => false);
  const registered = manifestExists ? (await runReg(['query', REGISTRY_KEY, '/v', REGISTRY_VALUE])).code === 0 : false;
  return { supported: true, installed: registered, running: running !== null };
}

/**
 * Create the certificate, write the manifest, start the page and register it with Word
 * for this Windows user.
 * @param {string} dataRoot
 * @param {(request: { prompt: string, context: string }) => Promise<any>} ask
 */
export async function installAddin(dataRoot, ask) {
  if (process.platform !== 'win32') throw new Error('The Word add-in is only available on Windows.');
  const paths = addinPaths(dataRoot);
  const state = await ensureCertificate(paths);

  await startAddinServer({ pfx: await fs.readFile(paths.pfx), passphrase: state.passphrase, ask });
  await fs.writeFile(paths.manifest, buildManifest({ id: state.manifestId, port: ADDIN_PORT }), 'utf8');
  const added = await runReg(['add', REGISTRY_KEY, '/v', REGISTRY_VALUE, '/t', 'REG_SZ', '/d', paths.manifest, '/f']);
  if (added.code !== 0) throw new Error('Windows would not let Zuri register the add-in for Word.');
}

/**
 * Start the page again after a restart, when the add-in was installed before.
 * @param {string} dataRoot
 * @param {(request: { prompt: string, context: string }) => Promise<any>} ask
 */
export async function resumeAddin(dataRoot, ask) {
  if (process.platform !== 'win32') return;
  const paths = addinPaths(dataRoot);
  const state = await readState(paths);
  if (!state?.passphrase) return;
  await startAddinServer({ pfx: await fs.readFile(paths.pfx), passphrase: state.passphrase, ask });
}

/**
 * Unregister the add-in, stop the page and take the certificate out of the user's store.
 * @param {string} dataRoot
 */
export async function removeAddin(dataRoot) {
  const paths = addinPaths(dataRoot);
  await stopAddinServer();
  if (process.platform === 'win32') {
    await runReg(['delete', REGISTRY_KEY, '/v', REGISTRY_VALUE, '/f']);
    await runPowerShell(REMOVE_CERT_SCRIPT).catch((error) => console.error('[zuri:addin] certificate cleanup', error?.message ?? error));
  }
  await fs.rm(paths.dir, { recursive: true, force: true });
}
