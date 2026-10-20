/**
 * @fileoverview package-extensions: packages each bundled extension into a VSIX with `vsce package
 * --no-dependencies` (ADR-0002, decision 5) and fails when a VSIX would hold a `node_modules` file.
 *
 *     node tools/package-extensions.ts                  every extension whose bundle exists, and every code-less pack
 *     node tools/package-extensions.ts remote-ssh-edit  the named package folders
 *
 * Run `pnpm build` first. The VSIX files are written to `dist/` at the repository root.
 */

import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  isMainModule,
  messageOf,
  packageFolders,
  REPOSITORY_ROOT,
  resolveBinary,
} from './repository.ts';

/** Runs vsce with the arguments in a package folder and returns its standard output; throws when it fails. */
export type VsceRunner = (vsceArguments: string[], folder: string) => string;

interface Manifest {
  name?: string;
  version?: string;
  main?: string;
  extensionPack?: string[];
}

/** Whether a manifest is a code-less pack: it lists an `extensionPack` and has no `main`, so there is no bundle to build. */
function isCodeless(manifest: Manifest): boolean {
  return manifest.main === undefined && manifest.extensionPack !== undefined;
}

/** The manifest of package folder `folder`, or nothing when it has none. */
function manifestOf(root: string, folder: string): Manifest | undefined {
  const file = path.join(root, 'packages', folder, 'package.json');
  // A package.json is a JSON object; the fields read here are checked where they are used.
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest)
    : undefined;
}

function runVsce(vsceArguments: string[], folder: string): string {
  const result = spawnSync(
    process.execPath,
    [resolveBinary('@vscode/vsce/vsce'), ...vsceArguments],
    {cwd: folder, encoding: 'utf8'},
  );
  if (result.status !== 0) {
    throw new Error(
      `vsce ${vsceArguments[0] ?? ''} failed in ${folder}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Packages the named package folders under `<root>/packages`, or every folder whose manifest has a `main` that is
 * built or is a code-less pack, and returns one line per VSIX written. Throws for a folder that does not exist, an
 * unbuilt bundle, or a file list that holds `node_modules`.
 */
export function packageExtensions(
  root: string,
  folders: string[],
  vsce: VsceRunner = runVsce,
): string[] {
  const selected =
    folders.length > 0
      ? folders
      : packageFolders(root).filter(
          folder =>
            existsSync(path.join(root, 'packages', folder, 'dist')) ||
            isCodeless(manifestOf(root, folder) ?? {}),
        );
  const outcomes: string[] = [];
  for (const folder of selected) {
    const directory = path.join(root, 'packages', folder);
    if (!existsSync(path.join(directory, 'package.json'))) {
      throw new Error(`no package folder packages/${folder}`);
    }
    const manifest = manifestOf(root, folder) ?? {};
    if (
      !isCodeless(manifest) &&
      (manifest.main === undefined ||
        !existsSync(path.join(directory, manifest.main)))
    ) {
      throw new Error(
        `packages/${folder}: no built ${manifest.main ?? 'main'}; run pnpm build`,
      );
    }
    const listed = vsce(['ls', '--no-dependencies'], directory)
      .split('\n')
      .filter(line => line.split(/[\\/]/).includes('node_modules'));
    if (listed.length > 0) {
      throw new Error(
        `packages/${folder}: the VSIX would hold ${listed.join(', ')}`,
      );
    }
    const output = path.join(
      root,
      'dist',
      `${manifest.name ?? folder}-${manifest.version ?? '0.0.0'}.vsix`,
    );
    mkdirSync(path.dirname(output), {recursive: true});
    vsce(['package', '--no-dependencies', '--out', output], directory);
    outcomes.push(`${folder}: ${path.relative(root, output)}`);
  }
  return outcomes;
}

if (isMainModule(import.meta.url)) {
  try {
    for (const outcome of packageExtensions(
      REPOSITORY_ROOT,
      process.argv.slice(2),
    )) {
      console.log(`package: ${outcome}`);
    }
  } catch (error) {
    console.error(`package: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
