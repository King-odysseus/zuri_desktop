/**
 * Rasterise the Zuri logo into the PNG that the Electron window points at.
 *
 * A BrowserWindow's `icon` takes a PNG (or ICO) path, never an SVG, so the one
 * hand-drawn logo in src/renderer/assets/zuri-logo.svg has to be turned into
 * pixels. Chromium is already here and renders the SVG exactly, so the window is
 * opened, the mark painted into it and the result captured: no image library and
 * no extra dependency.
 *
 * Run with `npm run icon` after changing the logo. The PNG is committed, so a
 * normal build never needs this.
 */

import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'src', 'renderer', 'assets', 'zuri-logo.svg');
const TARGET = path.join(root, 'src', 'main', 'assets', 'zuri-icon.png');

/** Windows downscales from the largest size it is given; 512 covers the taskbar and the alt-tab switcher. */
const SIZE = 512;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {  const svg = await fs.promises.readFile(SOURCE, 'utf8');

  // The SVG carries its own width and height (64), so the page fixes it at the
  // capture size and the viewBox keeps the shape square. The size is set in CSS
  // rather than taken from the window: a hidden transparent window is resized by
  // the OS, so the page is what decides how many pixels the mark covers. The
  // background stays transparent, because the tile is the icon, not the canvas
  // around it.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style></head><body>${svg}</body></html>`;

  const window = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true },
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // loadURL resolves on did-finish-load, which can land before the first paint.
    await wait(250);

    let image = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: SIZE,
      height: SIZE,
    });
    if (image.isEmpty()) throw new Error('the capture was empty, so the SVG did not paint');

    // capturePage returns device pixels, so a display at 150% yields 768 for a
    // 512 px box. Resizing to the target keeps the committed PNG the same on any
    // monitor instead of recording whatever scale the author happened to run at.
    const captured = image.getSize();
    if (captured.width !== SIZE || captured.height !== SIZE) {
      image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
    }

    await fs.promises.mkdir(path.dirname(TARGET), { recursive: true });
    await fs.promises.writeFile(TARGET, image.toPNG());
  } finally {
    window.destroy();
  }

  // Read it back the way Electron will, rather than trusting the bytes were written.
  const written = nativeImage.createFromPath(TARGET);
  if (written.isEmpty()) throw new Error(`${TARGET} is not an image Electron can load`);
  console.log(`wrote ${path.relative(root, TARGET)} at ${written.getSize().width}x${written.getSize().height}`);
  app.exit(0);
}).catch((error) => {
  // A generator that fails silently would leave a stale PNG in the tree looking fine.
  console.error(`FAIL icon: ${error.message}`);
  app.exit(1);
});
