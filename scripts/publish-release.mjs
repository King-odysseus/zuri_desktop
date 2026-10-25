#!/usr/bin/env node
/**
 * Publish the desktop installers the website links to.
 *
 * The site reads the newest release of the public `King-odysseus/zuri-releases`
 * repository, so publishing is the whole deploy for a new build: no server
 * upload, no config change. This script makes the asset names and the tag
 * consistent, because the version printed on the page is parsed from them.
 *
 * Usage: npm run dist && npm run release:publish
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(repoRoot, 'release');
const repo = process.env.ZURI_RELEASE_REPO ?? 'King-odysseus/zuri-releases';

/** @param {string} command @param {string[]} args */
function run(command, args) {
  // No shell: with one, a title like "Zuri Desktop 0.2.2" is split into separate
  // words and gh rejects the command. Passing argv directly keeps each argument whole.
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    console.error(`${command} is not installed. Install the GitHub CLI, then run: gh auth login`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const version = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

const built = await readdir(releaseDir).catch(() => []);
// Only installers are published. electron-builder also writes a .blockmap and a
// latest.yml for its updater; those are not something a visitor downloads.
const installers = [];
for (const name of built) {
  if (!/\.(exe|dmg|apk)$/i.test(name)) continue;
  const info = await stat(path.join(releaseDir, name));
  installers.push({ name, path: path.join(releaseDir, name), size: info.size });
}

if (installers.length === 0) {
  console.error('No installer in release/. Run `npm run dist` (or `npm run dist:mac`) first.');
  process.exit(1);
}

console.log(`Publishing ${tag} to ${repo}:`);
for (const installer of installers) console.log(`  ${installer.name} (${Math.round(installer.size / 1024 / 1024)} MB)`);

// A release whose tag exists is reused with --clobber, so re-running after a
// rebuild replaces the asset instead of failing or piling up duplicates.
const exists = spawnSync('gh', ['release', 'view', tag, '--repo', repo], {
  cwd: repoRoot,
  stdio: 'ignore',
  // argv goes straight to gh, so no shell can re-split the title's spaces
}).status === 0;

if (exists) {
  run('gh', ['release', 'upload', tag, ...installers.map((installer) => installer.path), '--repo', repo, '--clobber']);
} else {
  run('gh', [
    'release', 'create', tag,
    '--repo', repo,
    '--title', `Zuri Desktop ${version}`,
    '--notes', `Zuri desktop ${version}. Downloads: https://zuricloud-production.up.railway.app`,
    ...installers.map((installer) => installer.path),
  ]);
}

console.log(`\nPublished. The site lists it within ten minutes (the server caches the list).`);
for (const installer of installers) {
  console.log(`  https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(installer.name)}`);
}
