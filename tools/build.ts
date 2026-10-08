/**
 * @fileoverview build: bundles each package's entry point with esbuild (ADR-0002, decision 3).
 *
 *     node tools/build.ts                  every package in packages/
 *     node tools/build.ts remote-ssh ...   the named package folders
 *
 * A package without an entry point is skipped. Each `src/helpers/<name>.ts` of a package is bundled on its own into
 * `dist/helpers/<name>.js`: a helper script that runs outside the editor, so nothing in it may import `vscode`. Types
 * are checked by `pnpm typecheck`, not here.
 */

import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {NODE_TARGET} from './editor-floor.ts';
import {checkStringTables} from './string-tables.ts';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
} from './repository.ts';

/** Where a package keeps its entry point; the manifest's `main` points at BUNDLE_PATH once the design adds it. */
const ENTRY_PATH = 'src/extension.ts';

/** Where a package's bundle goes. */
const BUNDLE_PATH = 'dist/extension.js';

/** Where a package keeps its helper scripts' entry points, and where their bundles go. */
const HELPERS_PATH = 'src/helpers';

const HELPER_BUNDLES_PATH = 'dist/helpers';

/** The helper entry points of a package, sorted. */
function helperEntries(directory: string): string[] {
  const folder = path.join(directory, HELPERS_PATH);
  return existsSync(folder)
    ? readdirSync(folder)
        .filter(name => name.endsWith('.ts'))
        .sort()
        .map(name => path.join(folder, name))
    : [];
}

/**
 * Bundles the entry point of each named package folder under `<root>/packages`, or of every folder when `folders`
 * is empty, and returns one line per folder saying what happened. Throws for a folder that does not exist.
 */
export async function buildPackages(
  root: string,
  folders: string[],
): Promise<string[]> {
  const selected = folders.length > 0 ? folders : packageFolders(root);
  const outcomes: string[] = [];
  for (const folder of selected) {
    const directory = path.join(root, 'packages', folder);
    if (!existsSync(directory)) {
      throw new Error(`no package folder packages/${folder}`);
    }
    const stringProblems = checkStringTables(root, folder);
    if (stringProblems.length > 0) {
      throw new Error(`${folder}: ${stringProblems.join('; ')}`);
    }
    const entry = path.join(directory, ENTRY_PATH);
    if (!existsSync(entry)) {
      outcomes.push(`${folder}: no ${ENTRY_PATH}, skipped`);
      continue;
    }
    await build({
      entryPoints: [entry],
      outfile: path.join(directory, BUNDLE_PATH),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: NODE_TARGET,
      external: ['vscode'],
      sourcemap: true,
      logLevel: 'warning',
    });
    outcomes.push(`${folder}: ${BUNDLE_PATH}`);
    const helpers = helperEntries(directory);
    if (helpers.length > 0) {
      await build({
        entryPoints: helpers,
        outdir: path.join(directory, HELPER_BUNDLES_PATH),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        sourcemap: true,
        logLevel: 'warning',
      });
      outcomes.push(
        `${folder}: ${helpers.map(entry => `${HELPER_BUNDLES_PATH}/${path.basename(entry, '.ts')}.js`).join(', ')}`,
      );
    }
  }
  return outcomes;
}

if (isMainModule(import.meta.url)) {
  try {
    const outcomes = await buildPackages(
      REPOSITORY_ROOT,
      process.argv.slice(2),
    );
    for (const outcome of outcomes) {
      console.log(`build: ${outcome}`);
    }
  } catch (error) {
    console.error(`build: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
