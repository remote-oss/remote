/**
 * @fileoverview The files whose change the window tells the user about: the configuration, and the Dockerfile it names.
 */

import path from 'node:path';
import {dockerfileValueOf} from '../config/configuration-text.ts';

/** Each watched file's identifier and absolute path. A value with a variable or an empty value names no Dockerfile. */
export function watchedFilesOf(
  parsed: Record<string, unknown> | undefined,
  configFile: string,
): ReadonlyMap<string, string> {
  const files = new Map([[path.basename(configFile), configFile]]);
  const value = parsed === undefined ? undefined : dockerfileValueOf(parsed);
  if (value !== undefined && value !== '' && !value.includes('${')) {
    files.set(value, path.resolve(path.dirname(configFile), value));
  }
  return files;
}
