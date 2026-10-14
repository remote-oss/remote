/**
 * @fileoverview build: bundles each package's entry point with esbuild (ADR-0002, decision 3).
 *
 *     node tools/build.ts                  every package in packages/
 *     node tools/build.ts remote-ssh ...   the named package folders
 *
 * A package without an entry point is skipped. A package may ship files of a dependency unchanged (`COPIED_FILES`). Each `src/programs/<name>.ts` of a package is bundled on its own into
 * `dist/<name>.js`: a program that runs outside the editor, so nothing in it may import `vscode`. Types are checked
 * by `pnpm typecheck`, not here. A package's `src/web-extension.ts` is bundled for the web extension host into
 * `dist/web/extension.js`; nothing in it may import a `node:` module.
 */

import {copyFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
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

/** Where a package keeps the entry point for the web extension host, and where its bundle goes. */
const WEB_ENTRY_PATH = 'src/web-extension.ts';

const WEB_BUNDLE_PATH = 'dist/web/extension.js';

/** Files a package ships unchanged from a dependency: the dependency, the files by relative path, and where they go. */
export interface CopiedFiles {
  from: string;
  files: readonly string[];
  into: string;
}

/** The packages that ship files of a dependency byte for byte, which esbuild never bundles or touches. */
export const COPIED_FILES: Readonly<Record<string, CopiedFiles>> = {
  'remote-containers': {
    from: '@devcontainers/cli',
    files: [
      'devcontainer.js',
      'dist/spec-node/devContainersSpecCLI.js',
      'scripts/updateUID.Dockerfile',
      'LICENSE.txt',
      'ThirdPartyNotices.txt',
    ],
    into: 'dist/devcontainers-cli',
  },
};

/** Where a package keeps the entry points of its programs, and where their bundles go. */
const PROGRAMS_PATH = 'src/programs';

const PROGRAM_BUNDLES_PATH = 'dist';

/** The program entry points of a package, sorted. */
function programEntries(directory: string): string[] {
  const folder = path.join(directory, PROGRAMS_PATH);
  return existsSync(folder)
    ? readdirSync(folder)
        .filter(name => name.endsWith('.ts'))
        .sort()
        .map(name => path.join(folder, name))
    : [];
}

/** Copies the files of a dependency into the package, byte for byte, and says so; a missing file fails, naming it. */
function copyShipped(
  directory: string,
  folder: string,
  shipped: CopiedFiles,
): string {
  const source = path.dirname(
    createRequire(path.join(directory, 'package.json')).resolve(
      `${shipped.from}/package.json`,
    ),
  );
  for (const file of shipped.files) {
    const from = path.join(source, file);
    if (!existsSync(from)) {
      throw new Error(`${folder}: ${shipped.from} has no file ${file}`);
    }
    const target = path.join(directory, shipped.into, file);
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(from, target);
  }
  return `${folder}: ${shipped.into}`;
}

/**
 * Bundles the entry point of each named package folder under `<root>/packages`, or of every folder when `folders`
 * is empty, and returns one line per folder saying what happened. Throws for a folder that does not exist.
 */
export async function buildPackages(
  root: string,
  folders: string[],
  copied: Readonly<Record<string, CopiedFiles>> = COPIED_FILES,
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
    const webEntry = path.join(directory, WEB_ENTRY_PATH);
    if (existsSync(webEntry)) {
      await build({
        entryPoints: [webEntry],
        outfile: path.join(directory, WEB_BUNDLE_PATH),
        bundle: true,
        platform: 'browser',
        format: 'cjs',
        target: 'es2022',
        external: ['vscode'],
        sourcemap: true,
        logLevel: 'warning',
      });
      outcomes.push(`${folder}: ${WEB_BUNDLE_PATH}`);
    }
    const programs = programEntries(directory);
    if (programs.length > 0) {
      await build({
        entryPoints: programs,
        outdir: path.join(directory, PROGRAM_BUNDLES_PATH),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        sourcemap: true,
        logLevel: 'warning',
      });
      outcomes.push(
        `${folder}: ${programs.map(entry => `${PROGRAM_BUNDLES_PATH}/${path.basename(entry, '.ts')}.js`).join(', ')}`,
      );
    }
    const shipped = copied[folder];
    if (shipped !== undefined) {
      outcomes.push(copyShipped(directory, folder, shipped));
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
