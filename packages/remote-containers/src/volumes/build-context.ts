/**
 * @fileoverview The build context of our bootstrap image, written fresh for every build: the Dockerfile and a copy of
 * the dev container CLI the extension bundles, in a temporary folder removed after the build.
 */

import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BOOTSTRAP_DOCKERFILE, CONTEXT_CLI_FOLDER} from './bootstrap.ts';
import type {BuildContext} from './bootstrap-start.ts';

/** Removes a context's folder and all it holds. */
function removeFolder(folder: string): Promise<void> {
  return rm(folder, {recursive: true, force: true});
}

/** Writes a context under `temporaryRoot` with the CLI copied from `cliFolder`. */
export async function writeBuildContext(
  cliFolder: string,
  temporaryRoot: string,
): Promise<BuildContext> {
  const folder = await mkdtemp(
    path.join(temporaryRoot, 'vsc-volume-bootstrap-'),
  );
  try {
    await writeFile(path.join(folder, 'Dockerfile'), BOOTSTRAP_DOCKERFILE);
    await cp(cliFolder, path.join(folder, CONTEXT_CLI_FOLDER), {
      recursive: true,
    });
  } catch (error: unknown) {
    await removeFolder(folder);
    throw error;
  }
  return {folder, dispose: () => removeFolder(folder)};
}
