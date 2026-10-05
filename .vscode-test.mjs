// Extension-host tests with @vscode/test-cli (ADR-0002, decision 7, second level).
// One configuration per package that has integration tests. Tests run from the bundle the build writes, because
// the extension host loads JavaScript; how test files are bundled is set when the first package needs them.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const packagesDir = path.join(import.meta.dirname, 'packages');

export const configs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(packagesDir, e.name, 'test', 'integration')))
  .map((e) => ({
    label: e.name,
    extensionDevelopmentPath: path.join(packagesDir, e.name),
    files: path.join(packagesDir, e.name, 'dist', 'test', 'integration', '**', '*.test.js'),
  }));

export default defineConfig(configs);
