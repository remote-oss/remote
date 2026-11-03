/**
 * @fileoverview The version check after Configure Container Features writes a configuration: the dev container CLI's
 * `outdated` runs on a copy of the written text in a scratch folder of this machine, and what it finds goes to the log
 * and nowhere else. A check that fails is one line in the log; it never reaches the user.
 */

import type {Logger} from 'lib-log';
import type {CliTarget} from '../cli/cli-arguments.ts';
import {cliFailureText, type OutdatedResult} from '../cli/cli-lines.ts';

/** What the check needs of its surroundings. */
export interface VersionCheckPorts {
  /** Asks the CLI which Features of the target's configuration are behind. */
  outdated(
    target: CliTarget,
    cancellation: AbortSignal,
  ): Promise<OutdatedResult>;
  /** Makes a scratch folder holding `text` as its `.devcontainer/devcontainer.json`, and gives the folder and the file. */
  scratch(text: string): Promise<{folder: string; file: string}>;
  /** Removes a scratch folder. */
  discard(folder: string): Promise<void>;
  logger: Logger;
}

/** The target for the CLI's `outdated`, which reads registries and needs no container engine. */
function targetOf(folder: string, file: string): CliTarget {
  return {
    workspaceFolder: folder,
    configFile: file,
    dockerPath: '',
    idLabels: [],
    mountWorkspaceGitRoot: true,
    mountGitWorktreeCommonDir: false,
    features: {defaultFeatures: {}, lockfile: true},
    mounts: [],
    logLevel: 'info',
  };
}

/** The log line for `result` of the configuration named `relative`. */
export function versionLine(relative: string, result: OutdatedResult): string {
  if (result.kind !== 'outdated') {
    return `the version check of ${relative} failed: ${cliFailureText(result)}`;
  }
  const listed = Object.entries(result.features).map(
    ([reference, versions]) =>
      `${reference} is at ${versions.current ?? 'no version'}, wanted ${versions.wanted ?? 'none'}, latest ${versions.latest ?? 'unknown'}`,
  );
  return listed.length === 0
    ? `the version check of ${relative} found no Feature with a version`
    : `the version check of ${relative}: ${listed.join('; ')}`;
}

/** The check over `ports`: for the text of a configuration written, one line in the log, whatever happens. */
export function versionCheckOf(
  ports: VersionCheckPorts,
): (text: string, relative: string) => Promise<void> {
  return async (text, relative) => {
    let scratch: {folder: string; file: string} | undefined;
    try {
      scratch = await ports.scratch(text);
      const result = await ports.outdated(
        targetOf(scratch.folder, scratch.file),
        new AbortController().signal,
      );
      ports.logger.info(versionLine(relative, result));
    } catch (caught) {
      ports.logger.info(
        `the version check of ${relative} failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      if (scratch !== undefined) {
        await ports.discard(scratch.folder).catch(() => undefined);
      }
    }
  };
}
