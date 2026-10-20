/**
 * @fileoverview The control manifest the run gives the dev container CLI. The CLI reads `control-manifest.json` from its
 * cache folder while the file is less than five minutes old, and fetches the published manifest otherwise. The folder
 * is `<temporary folder>/devcontainercli-<user name>` on Linux: the product passes the CLI no `--cache-folder`, and the
 * harness sets no temporary folder for the editor, so the folder is this process's own (measured: a run's `devcontainer
 * up` left its fetched manifest there).
 */

import {mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {controlManifestText} from '../../../tools/acceptance-control-manifest.ts';
import {variable} from './harness.ts';

/** The name of the manifest in the CLI's cache folder. */
const MANIFEST_FILE = 'control-manifest.json';

/** The folder the CLI keeps its cache in, and so the manifest it reads first. */
function cliCacheFolder(): string {
  return path.join(os.tmpdir(), `devcontainercli-${os.userInfo().username}`);
}

/** The cached manifest's file. */
export function cachedManifestFile(): string {
  return path.join(cliCacheFolder(), MANIFEST_FILE);
}

/** Writes the run's manifest, fresh, where the CLI reads its cached one. */
export async function seedControlManifest(): Promise<void> {
  await mkdir(cliCacheFolder(), {recursive: true});
  await writeFile(
    cachedManifestFile(),
    controlManifestText(variable('HARNESS_TEMPLATE_REGISTRY')),
  );
}

/** Removes the CLI's cached manifest, so that its next run fetches one. */
export async function removeControlManifest(): Promise<void> {
  await rm(cachedManifestFile(), {force: true});
}
