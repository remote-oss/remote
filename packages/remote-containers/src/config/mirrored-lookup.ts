/**
 * @fileoverview The lookup of a repository's configuration in the folders the user keeps for it
 * (`dev.containers.repositoryConfigurationPaths`): for each remote of the opened folder and each root, the
 * configurations in the folder the remote's URL maps to. Nothing external is looked up, the `git` read included, until
 * the folder is trusted, and nothing at all without a root.
 */

import type {Logger} from 'lib-log';
import {tildePath} from '../authoring/user-data-store.ts';
import {type Candidate, discoverConfigurations} from './discovery.ts';
import path from 'node:path';
import {
  loggableRelativeOf,
  loggableUrlOf,
  mirroredFolderIn,
  mirroredPathsOf,
  remoteUrlsOf,
} from './mirrored-paths.ts';

/** What the lookup needs of its surroundings. */
export interface MirroredLookupPorts {
  /** Whether the opened folder is trusted. */
  trusted(): boolean;
  /** The roots of the setting, read when the lookup runs. */
  roots(): readonly string[];
  /** What `git config --get-regexp '^remote\..*\.url$'` prints in `folder`; none when it printed nothing or failed. */
  remotes(folder: string): Promise<string | undefined>;
  /** The entries of a folder, as discovery reads them. */
  list: Parameters<typeof discoverConfigurations>[1]['list'];
  /** Orders the names of subfolders. */
  compare: (left: string, right: string) => number;
  /** The user's home folder, which the pick writes as `~`. */
  home: string;
  logger: Logger;
}

/**
 * The configurations that the remotes of `folder` map to under the roots, each once, in the order found: the roots in
 * the order of the setting, then the remotes in the order `git` printed them. The candidate paths checked go to the log,
 * with the userinfo of a remote's authority left out, since a remote may carry a credential there.
 */
export async function mirroredCandidatesOf(
  ports: MirroredLookupPorts,
  folder: string,
  derive: (url: string) => string[] = mirroredPathsOf,
): Promise<Candidate[]> {
  const roots = ports.roots();
  if (!ports.trusted() || roots.length === 0) {
    return [];
  }
  const urls = remoteUrlsOf((await ports.remotes(folder)) ?? '');
  const found = new Map<string, Candidate>();
  for (const url of urls) {
    const [relative] = derive(url);
    if (relative === undefined) {
      ports.logger.info(
        `the remote ${loggableUrlOf(url)} names no mirrored folder`,
      );
      continue;
    }
    for (const root of roots) {
      const place = mirroredFolderIn(root, relative);
      if (place === undefined) {
        ports.logger.info(
          `the mirrored folder of ${loggableUrlOf(url)} is not under ${root}`,
        );
        continue;
      }
      ports.logger.info(
        `looking for a configuration in ${path.resolve(root, loggableRelativeOf(relative))}`,
      );
      for (const candidate of await discoverConfigurations(
        place,
        ports,
        ports.compare,
      )) {
        found.set(candidate.file, {
          ...candidate,
          relative: tildePath(candidate.file, ports.home),
        });
      }
    }
  }
  return [...found.values()];
}
