import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const androidDir = path.resolve('android');

const npmCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const apiBaseUrl = String(process.env.VITE_API_BASE_URL ?? 'https://zuricloud-production.up.railway.app').replace(/\/+$/, '');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Android bundles the cloud dashboard, so its API origin must be explicit. The
// normal web build keeps a relative origin and therefore remains same-origin.
run(npmCommand, ['vite', 'build', '--config', 'vite.web.config.mjs', '--mode', 'android'], {
  env: { VITE_ANDROID_BUILD: '1', VITE_API_BASE_URL: apiBaseUrl },
});
run(npmCommand, ['cap', 'sync', 'android']);

// The wrapper is called by its full path rather than by name. Windows only
// searches the current folder for an executable when that behaviour has not been
// switched off system-wide, and on a machine where it has, `gradlew.bat` in cwd
// is reported as "not recognized" even though the file is right there.
const gradleFile = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!existsSync(gradleFile)) {
  console.error('Android platform is missing its Gradle wrapper. Run npx cap add android first.');
  process.exit(1);
}
// Quoted because the folder this project sits in can contain a space.
const gradle = process.platform === 'win32' ? `"${gradleFile}"` : './gradlew';
run(gradle, ['assembleDebug'], { cwd: androidDir });
