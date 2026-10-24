import { existsSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

// electron-builder can nest this small dependency under call-bind even though
// get-intrinsic resolves it from the app-level module path at runtime.
const packagedDependencyPaths = [
  path.join(process.resourcesPath, 'node_modules'),
  path.join(
    process.resourcesPath,
    'app.asar',
    'node_modules',
    'call-bind',
    'node_modules',
  ),
].filter((dependencyPath) => existsSync(dependencyPath));

if (packagedDependencyPaths.length > 0) {
  process.env.NODE_PATH = [...packagedDependencyPaths, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

await import('./main.js');
