/**
 * @fileoverview The files whose change the window tells the user about: the configuration, the Dockerfile it names, the
 * compose files of a Compose configuration, and the Dockerfile its primary service builds from.
 */

import path from 'node:path';
import {
  composeFileNamesOf,
  dockerfileValueOf,
} from '../config/configuration-text.ts';

/**
 * Each watched file's identifier and absolute path. A value with a variable or an empty value names no Dockerfile. The
 * compose files are named by their values as written, and the service's Dockerfile by its path from the configuration's
 * folder.
 */
export function watchedFilesOf(
  parsed: Record<string, unknown> | undefined,
  configFile: string,
  serviceDockerfile?: string,
): ReadonlyMap<string, string> {
  const folder = path.dirname(configFile);
  const files = new Map([[path.basename(configFile), configFile]]);
  const value = parsed === undefined ? undefined : dockerfileValueOf(parsed);
  if (value !== undefined && value !== '' && !value.includes('${')) {
    files.set(value, path.resolve(folder, value));
  }
  for (const name of composeFileNamesOf(parsed?.dockerComposeFile) ?? []) {
    if (name !== '' && !name.includes('${')) {
      files.set(name, path.resolve(folder, name));
    }
  }
  if (serviceDockerfile !== undefined) {
    files.set(path.relative(folder, serviceDockerfile), serviceDockerfile);
  }
  return files;
}
