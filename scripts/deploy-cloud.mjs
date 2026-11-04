#!/usr/bin/env node
/**
 * Deploy the Zuri Cloud server to Railway.
 *
 * `railway up` from the repo root uploads the whole desktop app, so the service
 * builds the Electron package and crashes on startup with "electron ." (the
 * live site then answers 502). The CLI also resolves a PATH argument against
 * the git index and fails with "prefix not found" here. Uploading from a scratch
 * folder outside the repo is the one path that consistently ships `server/`:
 * the Dockerfile in that folder is then the build definition and the start
 * command is `node src/server.js`.
 *
 * Usage: npm run cloud:deploy
 *
 * The desktop installers are not part of this upload: they are published as
 * assets of the public King-odysseus/zuri-releases repository, which the server
 * reads at runtime (see server/src/downloads.js). Keeping 140 MB out of the image
 * is what makes a deploy finish quickly.
 */
import { cp, mkdtemp, rm, readdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');

// Overridable so the script is not tied to one Railway project.
const projectId = process.env.RAILWAY_PROJECT_ID ?? '862406dd-b090-43e6-88ed-28ff61d215fc';
const service = process.env.RAILWAY_SERVICE ?? 'ZuriCloud';
const environment = process.env.RAILWAY_ENVIRONMENT ?? 'production';

/** Run a command and fail loudly, since a silent failure here leaves the site down. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

async function copyServer(scratch) {
  // node_modules is rebuilt inside the image by `npm ci`, and copying it would
  // upload hundreds of megabytes of Windows binaries into a Linux build.
  await cp(serverDir, scratch, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('node_modules'),
  });
  // The Office builders are the desktop app's own module. The image holds only server/,
  // so the one copy is placed beside the server's code for the upload.
  await copyFile(path.join(repoRoot, 'src', 'main', 'office.js'), path.join(scratch, 'src', 'office.js'));
}

async function main() {
  console.log('Building the React dashboard...');
  run('npm', ['run', 'web:build'], repoRoot);

  // The bundle the server serves comes from server/public, so an empty folder
  // here means the upload would ship the previous build and look successful.
  const assets = await readdir(path.join(serverDir, 'public', 'assets')).catch(() => []);
  if (assets.length === 0) {
    console.error('server/public/assets is empty: the web build did not run, so nothing was deployed.');
    process.exit(1);
  }

  const scratch = await mkdtemp(path.join(tmpdir(), 'zuri-cloud-'));
  try {
    await copyServer(scratch);
    console.log(`Uploading ${scratch} to ${service} (${environment})...`);
    run('railway', ['up', '-p', projectId, '-s', service, '-e', environment, '-c'], scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  console.log('Deploy finished. Check the live site before calling it done.');
}

await main();
