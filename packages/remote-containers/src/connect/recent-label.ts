/**
 * @fileoverview The label a dev container window stores with its Open Recent entry when the entry is created: the host
 * folder's path with the home folder as `~`, then ` @ <context>` when the connection was made under a Docker context,
 * then the static suffix (STR:S428). An entry that has a label already is left alone, so a label never changes after it
 * is stored. The entries of one folder under two contexts differ in their authority, so each is labelled on its own.
 */

import type {Logger} from 'lib-log';
import type {DevContainerFolder} from '../authority/payload.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {workspaceSuffixOf} from './window-identity.ts';

/** What the window's Open Recent entry is about. */
export interface WindowEntry {
  type: 'folder' | 'workspace';
  uri: string;
  remoteAuthority: string;
}

/** What the editor keeps of an Open Recent entry. */
export interface StoredEntry {
  uri: string;
  label: string | undefined;
}

/** What storing the label needs of the editor. */
export interface RecentLabelPorts {
  homeFolder(): string;
  /** The window's own folder or workspace file, or undefined while it has none. */
  windowEntry(): WindowEntry | undefined;
  recentEntries(): Promise<StoredEntry[]>;
  addEntry(entry: WindowEntry & {label: string}): Promise<void>;
}

/** `hostPath` with `homeFolder` as `~` when it is the path or a folder above it; a longer name sharing the prefix is not. */
export function tildedPathOf(hostPath: string, homeFolder: string): string {
  const home = homeFolder.replace(/\/+$/, '');
  if (home === '') {
    return hostPath;
  }
  if (hostPath === home) {
    return '~';
  }
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}

/**
 * Adds the window's Open Recent entry with its label unless the editor holds an entry for it that has one; `context` is
 * the Docker context the connection was made under, or undefined for the default one.
 */
export async function storeRecentLabel(
  ports: RecentLabelPorts,
  translate: Translate,
  logger: Logger,
  target: DevContainerFolder,
  context: string | undefined,
): Promise<void> {
  try {
    const entry = ports.windowEntry();
    if (entry === undefined) {
      return;
    }
    const stored = (await ports.recentEntries()).find(
      each => each.uri === entry.uri,
    );
    if (stored?.label !== undefined) {
      return;
    }
    const suffix = workspaceSuffixOf(undefined, translate);
    await ports.addEntry({
      ...entry,
      label: `${tildedPathOf(target.hostPath, ports.homeFolder())}${context === undefined ? '' : ` @ ${context}`} [${suffix}]`,
    });
  } catch (caught: unknown) {
    logger.warn(
      `the Open Recent entry was not stored: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}
