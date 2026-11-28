/**
 * @fileoverview The install folder `remote.SSH.serverInstallPath` names for a host, read the same way by every
 * extension that installs a server there: the alias that keys the per-host settings, the entry of a map setting for
 * that alias, and the folder with its character check.
 */

import {isMap} from '../cli-control/rpc.ts';

/** A host as an SSH authority names it: a plain host text as typed, or a structured host with its user and port. */
export type HostTarget =
  | {kind: 'plain'; text: string}
  | {kind: 'host'; hostName: string; user?: string; port?: number};

/** The alias that keys the per-host settings: the host part of the authority, without a user or a port. */
export function hostAlias(target: HostTarget): string {
  const written = target.kind === 'host' ? target.hostName : target.text;
  const name = written.slice(written.lastIndexOf('@') + 1);
  return target.kind === 'plain' ? name.replace(/^([^:]+):\d+$/, '$1') : name;
}

/** The entry of a map setting whose key is the alias, exactly as written; none for any other value or key. */
export function exactEntry(setting: unknown, alias: string): unknown {
  return isMap(setting) && Object.hasOwn(setting, alias)
    ? setting[alias]
    : undefined;
}

/**
 * An install folder: absolute, or the remote user's home folder as `~` alone or `~/` and a path. The path holds ASCII
 * letters and digits, `/`, `-`, `_`, `.` and the space.
 */
const INSTALL_FOLDER = /^(?:\/[A-Za-z0-9/_. -]*|~(?:\/[A-Za-z0-9/_. -]*)?)$/;

/** The install folder setting for the alias: none, a usable folder, or a value that is not allowed. */
export type InstallFolder =
  | {kind: 'default'}
  | {kind: 'folder'; folder: string}
  | {kind: 'invalid'; value: string};

/**
 * Reads `remote.SSH.serverInstallPath` for the alias. An entry that is not text counts as none, an empty text means
 * the default, and a text that does not start with `/`, is not `~` or `~/` and a path, or holds another character is
 * invalid. The folder is kept exactly as written; the host expands a leading `~` against its user's home folder.
 */
export function installFolderFor(
  setting: unknown,
  alias: string,
): InstallFolder {
  const entry = exactEntry(setting, alias);
  if (typeof entry !== 'string' || entry === '') {
    return {kind: 'default'};
  }
  return INSTALL_FOLDER.test(entry)
    ? {kind: 'folder', folder: entry}
    : {kind: 'invalid', value: entry};
}
