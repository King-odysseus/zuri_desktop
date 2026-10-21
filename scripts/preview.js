/**
 * Browser preview for the renderer.
 *
 * The renderer is plain static HTML/CSS/JS with no build step (decisions.md 1),
 * so it can be served straight from src/renderer. Electron has no dev server and
 * prints no address, which leaves a browser-based visual check with nothing to
 * open; this gives it a local URL. Node's built-in http module only, because a
 * dependency for a static file listing is not worth the install weight.
 *
 *   node scripts/preview.js            serve the renderer, print the URL
 *   node scripts/preview.js --electron serve, print the URL, then start Electron
 *
 * The bridge (window.zuri) does not exist in a browser, so views that call it
 * degrade instead of breaking; the shell and the token layer need no bridge.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER_ROOT = path.join(root, 'src', 'renderer');
const DEFAULT_PORT = 5173;

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.woff2', 'font/woff2'],
]);

/**
 * Map a request path to a file inside the renderer folder.
 * "../" and absolute paths must not escape the folder, so the resolved path is
 * checked against the root rather than trusted from the URL.
 * @param {string} requestPath
 * @returns {string | null} absolute file path, or null when it escapes the root
 */
function resolveRequestPath(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(RENDERER_ROOT, relative);
  const prefix = RENDERER_ROOT + path.sep;
  return filePath === RENDERER_ROOT || filePath.startsWith(prefix) ? filePath : null;
}

/** @param {import('node:http').ServerResponse} response @param {number} status */
function sendStatus(response, status) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(status === 403 ? 'Forbidden' : 'Not found');
}

/**
 * A page route from pages.md, for example "onboarding": the views folder holds one
 * file per page (decisions.md 14).
 *
 * A nested route names the screen it ends on, as pages.md draws them:
 * "/automations/runs" is the run result view. The full path is tried first, so a
 * nested folder of views would win, then the last segment, so one view can sit
 * under the parent route it belongs to without a folder of its own.
 * @param {string} route
 * @returns {string | null} the view file, or null when there is no such view
 */
function viewFileFor(route) {
  const segments = route.split('/').filter(Boolean);
  // Every segment is checked, not just the whole string: the segments become a
  // path, so one ".." would otherwise reach outside the views folder.
  if (segments.length === 0 || segments.some((segment) => !/^[a-z0-9-]+$/.test(segment))) return null;
  const last = segments[segments.length - 1];
  const candidates = [path.join(RENDERER_ROOT, 'views', ...segments), path.join(RENDERER_ROOT, 'views', last)];
  for (const candidate of candidates) {
    const viewFile = `${candidate}.html`;
    if (existsSync(viewFile)) return viewFile;
  }
  return null;
}

/**
 * Send a view at its own route, so the address bar shows /onboarding rather than
 * /views/onboarding.html. The view is written for the views folder (it links
 * "onboarding.css" and "../styles/tokens.css"), so a <base> element is injected to
 * keep those links resolving from /views/ now that the document itself is not there.
 * Without it the page would arrive unstyled at the route's address.
 * @param {import('node:http').ServerResponse} response
 * @param {string} viewFile
 */
async function sendView(response, viewFile) {
  const html = await readFile(viewFile, 'utf8');
  const body = html.replace(/<head>/i, '<head><base href="/views/" />');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

const requestListener = async (request, response) => {
  const viewFile = viewFileFor((request.url ?? '/').split('?')[0].replace(/^\/+|\/+$/g, ''));
  if (viewFile) {
    try {
      await sendView(response, viewFile);
    } catch {
      sendStatus(response, 404);
    }
    return;
  }

  const filePath = resolveRequestPath(request.url ?? '/');
  if (!filePath) {
    sendStatus(response, 403);
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
    // No caching: a reload must show the file as it is on disk.
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    sendStatus(response, 404);
  }
};

/**
 * Start the preview server and print its URL.
 * A busy default port falls back to any free port, so two checkouts can preview
 * at the same time without one of them failing to start.
 * @param {number} [port]
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export function startPreviewServer(port = Number(process.env.PREVIEW_PORT ?? DEFAULT_PORT)) {
  return new Promise((resolve, reject) => {
    const server = createServer(requestListener);

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && port !== 0) {
        resolve(startPreviewServer(0));
        return;
      }
      reject(error);
    });

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${actualPort}/` });
    });
  });
}

/** The running Electron process, so a stop can close the window it opened. */
let electronChild = null;

/** Start Electron against src/main/main.js with DevTools on, and resolve on exit. */
function startElectron() {
  return new Promise((resolve, reject) => {
    // The electron package's default export is the path of its executable.
    import('electron')
      .then(({ default: electronPath }) => {
        electronChild = spawn(electronPath, [root], {
          stdio: 'inherit',
          env: { ...process.env, ZURI_DEVTOOLS: '1' },
        });
        electronChild.on('error', reject);
        electronChild.on('exit', (code) => resolve(code ?? 0));
      })
      .catch(reject);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const withElectron = process.argv.includes('--electron');

  const { server, url } = await startPreviewServer();
  // One line, ready to match: this is the address a browser check waits for.
  console.log(`Zuri preview: ${url}`);

  // Closing the desktop window ends the preview too, so `npm run dev` leaves
  // nothing listening behind; a Ctrl+C closes both from the other direction.
  let stopping = false;
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    if (electronChild && electronChild.exitCode === null) electronChild.kill();
    await new Promise((resolve) => server.close(resolve));
    process.exit(code);
  }

  // SIGBREAK is the second Windows interrupt, so it is handled alongside the Unix pair.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(signal, () => {
      stop(0);
    });
  }

  if (withElectron) {
    const code = await startElectron();
    await stop(code);
  }
}
