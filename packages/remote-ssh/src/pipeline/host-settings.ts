/**
 * @fileoverview What the settings say about one host: the alias that keys the per-host settings, the entry of a map
 * for that alias, the install folder with its character check, the proxy text that applies, the grace time and the
 * lock options. Every function reads values as the editor reports them and gives a value the server steps can use;
 * none of them writes a setting.
 */

import type {SshTarget} from 'lib-ssh';
import {parseTypedHost} from '../connect/typed-input.ts';
import type {ConnectTarget} from './steps.ts';

/** The alias that keys the per-host settings: the host part of the authority, without a user or a port. */
export function hostAlias(target: ConnectTarget): string {
  const written = target.kind === 'host' ? target.hostName : target.text;
  const name = written.slice(written.lastIndexOf('@') + 1);
  return target.kind === 'plain' ? name.replace(/^([^:]+):\d+$/, '$1') : name;
}

/** The target as `ssh` is given it: a plain host text read as typed, a structured host with its user and port. */
export function sshTargetOf(target: ConnectTarget): SshTarget {
  if (target.kind === 'plain') {
    return parseTypedHost(target.text);
  }
  return {
    host: target.hostName,
    ...(target.user === undefined ? {} : {user: target.user}),
    ...(target.port === undefined ? {} : {port: target.port}),
  };
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entry of a map setting whose key is the alias, exactly as written; none for any other value or key. */
export function exactEntry(setting: unknown, alias: string): unknown {
  return isMap(setting) && Object.hasOwn(setting, alias)
    ? setting[alias]
    : undefined;
}

/** The characters an install folder may hold: ASCII letters and digits, `/`, `-`, `_`, `.` and the space. */
const INSTALL_FOLDER = /^\/[A-Za-z0-9/_. -]*$/;

/** The install folder setting for the alias: none, a usable folder, or a value that is not allowed. */
export type InstallFolder =
  | {kind: 'default'}
  | {kind: 'folder'; folder: string}
  | {kind: 'invalid'; value: string};

/**
 * Reads `remote.SSH.serverInstallPath` for the alias. An entry that is not text counts as none, an empty text means
 * the default, and a text that does not start with `/` or holds another character is invalid. The folder is kept
 * exactly as written.
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

/**
 * The pre-connection script that applies to the alias, or none: a text applies to every host, an object by the alias
 * exactly as written, and an empty text, a missing or empty entry, or a value of another type is no script.
 */
export function preconnectScriptFor(
  setting: unknown,
  alias: string,
): string | undefined {
  const script =
    typeof setting === 'string' ? setting : entryText(setting, alias);
  return script === '' ? undefined : script;
}

/** The text of a per-host map entry that is a string, or the empty text. */
export function entryText(setting: unknown, alias: string): string {
  const entry = exactEntry(setting, alias);
  return typeof entry === 'string' ? entry : '';
}

/** The proxy entry that applies: a text for all hosts, or the alias entry, else the `*` entry; empty means none. */
export function effectiveProxyText(setting: unknown, alias: string): string {
  if (typeof setting === 'string') {
    return setting;
  }
  const chosen = [exactEntry(setting, alias), exactEntry(setting, '*')].find(
    entry => entry !== undefined && entry !== null && entry !== '',
  );
  if (chosen === undefined) {
    return '';
  }
  return typeof chosen === 'string' ? chosen : JSON.stringify(chosen);
}

/** The seconds of reconnection grace: a number of 1 or more, else 0, which passes no option. */
export function graceSecondsOf(setting: unknown): number {
  return typeof setting === 'number' && setting >= 1 ? setting : 0;
}

/** A setting that is a boolean as it is, else the default the manifest declares. */
export function flagOf(setting: unknown, fallback: boolean): boolean {
  return typeof setting === 'boolean' ? setting : fallback;
}

/** The settings as the editor reports them, before any is read for a host. */
export interface RawServerSettings {
  serverInstallPath: unknown;
  bindHost: unknown;
  serverPickPortsFromRange: unknown;
  httpProxy: unknown;
  httpsProxy: unknown;
  reconnectionGraceTime: unknown;
  defaultExtensions: unknown;
  useFlock: unknown;
  lockfilesInTmp: unknown;
  useCurlAndWgetConfigurationFiles: unknown;
}

/** What the settings say about one host, in the form the server steps use. */
export interface HostServerSettings {
  installFolder: InstallFolder;
  /** The bind host for the alias, or `127.0.0.1`. */
  bindHost: string;
  /** The port range text for the alias, or the empty text for a random free port. */
  portRange: string;
  httpProxy: string;
  httpsProxy: string;
  graceSeconds: number;
  /** The entries as written; the runtime drops those that are no extension identifier. */
  defaultExtensions: readonly string[];
  useFlock: boolean;
  lockfilesInTmp: boolean;
  useConfigurationFiles: boolean;
}

const LOOPBACK = '127.0.0.1';

/** The extension entries that are texts, in the order written; any other value is no entry. */
function extensionEntries(setting: unknown): string[] {
  return Array.isArray(setting)
    ? setting.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Reads every setting the server steps use for the alias. */
export function hostServerSettings(
  reported: RawServerSettings,
  alias: string,
): HostServerSettings {
  return {
    installFolder: installFolderFor(reported.serverInstallPath, alias),
    bindHost: entryText(reported.bindHost, alias) || LOOPBACK,
    portRange: entryText(reported.serverPickPortsFromRange, alias),
    httpProxy: effectiveProxyText(reported.httpProxy, alias),
    httpsProxy: effectiveProxyText(reported.httpsProxy, alias),
    graceSeconds: graceSecondsOf(reported.reconnectionGraceTime),
    defaultExtensions: extensionEntries(reported.defaultExtensions),
    useFlock: flagOf(reported.useFlock, true),
    lockfilesInTmp: flagOf(reported.lockfilesInTmp, false),
    useConfigurationFiles: flagOf(
      reported.useCurlAndWgetConfigurationFiles,
      false,
    ),
  };
}
