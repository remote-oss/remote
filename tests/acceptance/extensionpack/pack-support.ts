/**
 * @fileoverview What the extension pack's command-line rows share: the repository's built VSIX files and the pack's
 * identity, a profile of the editor under the run's folder, and the editor's command-line launcher run on it with the
 * gallery unreachable.
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';

/** The repository's root folder. */
export const REPOSITORY = path.join(import.meta.dirname, '..', '..', '..');
/** The folder `pnpm package` writes the VSIX files to. */
export const DIST = path.join(REPOSITORY, 'dist');
/** The extension pack's id. */
export const PACK_ID = 'remote-oss.vscode-remote-extensionpack';
/** The extension pack's version, from its manifest. */
export const PACK_VERSION = (
  JSON.parse(
    readFileSync(
      path.join(REPOSITORY, 'packages', 'remote-extensionpack', 'package.json'),
      'utf8',
    ),
  ) as {version: string}
).version;

/** The editor's gallery variables pointed at a closed port, as the launch has them for the editor itself. */
const UNREACHABLE_GALLERY = {
  VSCODE_GALLERY_SERVICE_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_ITEM_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_CONTROL_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_RESOURCE_URL_TEMPLATE:
    'http://127.0.0.1:1/{publisher}/{name}/{version}/{path}',
};

/** The folders of one command-line profile: its extensions, its user data and its logs, under the run's folder. */
export function profileOf(name: string) {
  const base = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'extensionpack-cli',
    name,
  );
  mkdirSync(base, {recursive: true});
  return {
    extensions: path.join(base, 'extensions'),
    userData: path.join(base, 'user-data'),
    logs: path.join(base, 'state'),
  };
}

/** The folders of one command-line profile. */
export type Profile = ReturnType<typeof profileOf>;

/** Runs the editor's command-line launcher on `profile` with `options`, the gallery unreachable, and gives what it did. */
export function launcher(profile: Profile, options: string[]) {
  const result = spawnSync(
    path.join(
      path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
      'bin',
      'codium-insiders',
    ),
    [
      `--extensions-dir=${profile.extensions}`,
      `--user-data-dir=${profile.userData}`,
      ...options,
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        ...UNREACHABLE_GALLERY,
        XDG_STATE_HOME: profile.logs,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout.split('\n').filter(line => line !== ''),
    stderr: result.stderr
      .split('\n')
      .filter(
        line =>
          line !== '' &&
          !line.includes('DEP0169') &&
          !line.includes('trace-deprecation'),
      ),
  };
}

/** The extensions a profile holds, by their folder names. */
export function installedIn(profile: Profile): string[] {
  return readdirSync(profile.extensions).filter(entry =>
    entry.startsWith('remote-oss.'),
  );
}

/** The paths below `folder` named after the pack's id, except core's cache of the VSIX files it installed. */
export function namedAfterPack(folder: string): string[] {
  return readdirSync(folder, {recursive: true})
    .map(String)
    .filter(
      entry =>
        entry.toLowerCase().includes(PACK_ID) &&
        !entry.includes('CachedExtensionVSIXs'),
    );
}

/** The manifest fields these rows read. */
export interface Manifest {
  extensionPack?: string[];
  extensionDependencies?: string[];
}

/** The manifest of the package folder `folder` of the repository. */
export function manifestOf(folder: string): Manifest {
  return JSON.parse(
    readFileSync(
      path.join(REPOSITORY, 'packages', folder, 'package.json'),
      'utf8',
    ),
  ) as Manifest;
}

/** The package folder of an extension identifier of the family: its name after the publisher, the pack's own folder aside. */
export function folderOf(identifier: string): string {
  return identifier === PACK_ID
    ? 'remote-extensionpack'
    : (identifier.split('.')[1] ?? '');
}

/** The VSIX file of extension `identifier` that `pnpm package` built. */
function vsixOf(identifier: string): string {
  const name =
    identifier === PACK_ID
      ? 'vscode-remote-extensionpack'
      : folderOf(identifier);
  return path.join(
    DIST,
    readdirSync(DIST).find(file => new RegExp(`^${name}-\\d`).test(file)) ??
      `${name}-missing.vsix`,
  );
}

/** The arguments that install the VSIX files of `identifiers`, in order. */
export function installing(identifiers: readonly string[]): string[] {
  return identifiers.flatMap(identifier => [
    '--install-extension',
    vsixOf(identifier),
  ]);
}
