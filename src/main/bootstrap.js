import { existsSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

// electron-builder can nest this small dependency under call-bind even though
// get-intrinsic resolves it from the app-level module path at runtime.
const packagedDependencyPath = path.join(
  process.resourcesPath,
  'app.asar',
  'node_modules',
  'call-bind',
  'node_modules',
);

if (existsSync(packagedDependencyPath)) {
  process.env.NODE_PATH = [packagedDependencyPath, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

await import('./main.js');
