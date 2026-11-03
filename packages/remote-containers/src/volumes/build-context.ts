/**
 * @fileoverview The build context of our bootstrap image, written fresh for every build: the image's definition, the
 * dev container CLI the extension bundles and its preload, in a temporary folder removed after the build.
 */

import {copyFile, cp, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {CONTEXT_NAMES} from './bootstrap.ts';
import type {BuildContext} from './bootstrap-start.ts';

/** The files of the installed extension the context is made of. */
export interface ContextSources {
  dockerfile: string;
  cliFolder: string;
  preload: string;
}

/** Removes a context's folder and all it holds. */
function removeFolder(folder: string): Promise<void> {
  return rm(folder, {recursive: true, force: true});
}

/** Writes a context under `temporaryRoot` from `sources`. */
export async function writeBuildContext(
  sources: ContextSources,
  temporaryRoot: string,
): Promise<BuildContext> {
  const folder = await mkdtemp(
    path.join(temporaryRoot, 'vsc-volume-bootstrap-'),
  );
  try {
    await copyFile(sources.dockerfile, path.join(folder, 'Dockerfile'));
    await copyFile(sources.preload, path.join(folder, CONTEXT_NAMES.preload));
    await cp(sources.cliFolder, path.join(folder, CONTEXT_NAMES.cliFolder), {
      recursive: true,
    });
  } catch (error: unknown) {
    await removeFolder(folder);
    throw error;
  }
  return {folder, dispose: () => removeFolder(folder)};
}
