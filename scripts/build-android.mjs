import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const apiBaseUrl = String(process.env.VITE_API_BASE_URL ?? 'https://zuricloud-production.up.railway.app').replace(/\/+$/, '');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
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

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const gradlePath = process.platform === 'win32' ? `android\\${gradle}` : `android/${gradle}`;
if (!existsSync(gradlePath)) {
  console.error('Android platform is missing its Gradle wrapper. Run npx cap add android first.');
  process.exit(1);
}
run(gradlePath, ['assembleDebug']);
