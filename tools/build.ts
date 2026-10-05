// build: bundle each package's entry point with esbuild (ADR-0002, decision 3).
//
//   node tools/build.ts                  every package in packages/
//   node tools/build.ts remote-ssh ...   the named package folders
//
// A package without an entry point is skipped. Types are not checked here; that is `pnpm typecheck`.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

// The Node.js version of the oldest editor version we support. That editor version is open until the
// specifications are read (ADR-0002, "Open until the specifications are read"); the design sets this constant.
export const NODE_TARGET = 'node22';

// Where a package keeps its entry point and where its bundle goes. The manifest's `main` points at OUTFILE once
// the design adds manifests.
export const ENTRY = 'src/extension.ts';
export const OUTFILE = 'dist/extension.js';

const root = path.join(import.meta.dirname, '..');
const packagesDir = path.join(root, 'packages');

const folders =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(packagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

for (const folder of folders) {
  const dir = path.join(packagesDir, folder);
  if (!existsSync(dir)) {
    console.error(`build: no package folder packages/${folder}`);
    process.exit(1);
  }
  const entry = path.join(dir, ENTRY);
  if (!existsSync(entry)) {
    console.log(`build: ${folder}: no ${ENTRY}, skipped`);
    continue;
  }
  await build({
    entryPoints: [entry],
    outfile: path.join(dir, OUTFILE),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'warning',
  });
  console.log(`build: ${folder}: ${OUTFILE}`);
}
