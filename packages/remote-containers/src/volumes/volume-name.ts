/**
 * @fileoverview The name of a unique volume: the repository's name, the ref or pull request it names, and the SHA-256
 * of the source, so that two sources never share a volume and one source always finds its own.
 */

import {createHash} from 'node:crypto';
import type {CloneSource} from './clone-source.ts';

/** A character Docker refuses in a volume name. */
const REFUSED_CHARACTER = /[^A-Za-z0-9_.-]/g;

/** The name made valid for Docker: each refused character becomes `-`, and what doesn't start with a letter or digit goes. */
function dockerSafe(name: string): string {
  return name.replace(REFUSED_CHARACTER, '-').replace(/^[^A-Za-z0-9]+/, '');
}

/** The part of the name a ref or a pull request adds: the ref with its slashes as `-`, or `pull-<n>`. */
function segmentOf(source: CloneSource): string | undefined {
  if (source.pullRequest !== undefined) {
    return `pull-${String(source.pullRequest)}`;
  }
  return source.ref?.replaceAll('/', '-');
}

/**
 * The unique volume's name, `<repository>[-<segment>]-<digest>`: the digest is over the source as typed or resolved,
 * and only the name is made valid for Docker, while the folder and the labels keep the repository's real name.
 */
export function uniqueVolumeName(source: CloneSource): string {
  const digest = createHash('sha256')
    .update(source.repositoryPath, 'utf8')
    .digest('hex');
  const segment = segmentOf(source);
  const name = [
    source.repositoryName,
    ...(segment === undefined ? [] : [segment]),
  ].join('-');
  return dockerSafe(`${name}-${digest}`);
}
