/**
 * @fileoverview The payload of a dev-container authority: the lowercase hex of a JSON text that names the host folder,
 * the Docker context and the configuration file, and its reading back. A plain host path in hex is the legacy form.
 */

import path from 'node:path';
import {type DecodedTarget, decodeAuthority} from 'lib-authority';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import {recordOf} from '../json-record.ts';

/** A `file` or `vscode-fileHost` URI as the editor writes it, in that member order. */
export interface SerializedUri {
  $mid: 1;
  fsPath?: string;
  external?: string;
  path: string;
  scheme: string;
}

/** What the editor's URI offers for the five members. */
interface UriParts {
  fsPath: string;
  path: string;
  scheme: string;
  toString(): string;
}

/** A folder opened in a container: the host folder, the engine it is pinned to if not the default, and the file. */
export interface DevContainerFolder extends PinnedEngine {
  kind: 'folder';
  hostPath: string;
  localDocker: boolean;
  configFile: SerializedUri;
}

/** A payload that is only a host path. */
export interface DevContainerLegacy {
  kind: 'legacy';
  hostPath: string;
}

/** What a payload names. */
export type DevContainerTarget = DevContainerFolder | DevContainerLegacy;

/** A payload that is not a target, and the step that refused it. */
export interface PayloadMalformed {
  malformed: 'hex' | 'json' | 'shape';
}

/** The five members of a URI in the order of the editor's own form, read without its `toJSON`. */
export function serializedUriOf(uri: UriParts): SerializedUri {
  return {
    $mid: 1,
    fsPath: uri.fsPath,
    external: uri.toString(),
    path: uri.path,
    scheme: uri.scheme,
  };
}

/** The engine members a payload's `settings` may name, in their fixed order. */
const ENGINE_MEMBERS = ['context', 'host', 'certPath', 'tlsVerify'] as const;

/** A payload's `settings` member for an engine, or nothing when it is the default. */
export function pinnedSettingsOf(
  engine: PinnedEngine,
): {settings: Record<string, string>} | Record<string, never> {
  const pinned = ENGINE_MEMBERS.flatMap((member): Array<[string, string]> => {
    const value = engine[member];
    return value === undefined ? [] : [[member, value]];
  });
  return pinned.length === 0 ? {} : {settings: Object.fromEntries(pinned)};
}

/** The payload of a target: its JSON text, members in a fixed order, as lowercase hex. */
export function devContainerPayloadOf(target: DevContainerFolder): string {
  const text = JSON.stringify({
    hostPath: target.hostPath,
    localDocker: target.localDocker,
    ...pinnedSettingsOf(target),
    configFile: target.configFile,
  });
  return Buffer.from(text, 'utf8').toString('hex');
}

/** Whether a member is absent or a string. */
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** The configuration file of a payload, or nothing when a member has the wrong type. */
function configFileOf(value: unknown): SerializedUri | undefined {
  const file = recordOf(value);
  if (
    file === undefined ||
    typeof file.path !== 'string' ||
    typeof file.scheme !== 'string' ||
    !optionalString(file.fsPath) ||
    !optionalString(file.external)
  ) {
    return undefined;
  }
  return {
    $mid: 1,
    ...(typeof file.fsPath === 'string' ? {fsPath: file.fsPath} : {}),
    ...(typeof file.external === 'string' ? {external: file.external} : {}),
    path: file.path,
    scheme: file.scheme,
  };
}

/** The engine of a payload: none, its members, or `false` for a `settings` member of the wrong shape. */
export function engineOf(settings: unknown): PinnedEngine | false {
  if (settings === undefined) {
    return {};
  }
  const record = recordOf(settings);
  if (record === undefined) {
    return false;
  }
  const engine: PinnedEngine = {};
  for (const member of ENGINE_MEMBERS) {
    const value = record[member];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || value === '') {
      return false;
    }
    engine[member] = value;
  }
  return Object.keys(engine).length === 0 ? false : engine;
}

/** The target a JSON object names, or the refusal for its shape. */
function folderOf(parsed: unknown): DevContainerFolder | PayloadMalformed {
  const record = recordOf(parsed);
  const engine = engineOf(record?.settings);
  const configFile = configFileOf(record?.configFile);
  if (
    typeof record?.hostPath !== 'string' ||
    record.hostPath === '' ||
    typeof record.localDocker !== 'boolean' ||
    engine === false ||
    configFile === undefined
  ) {
    return {malformed: 'shape'};
  }
  return {
    kind: 'folder',
    hostPath: record.hostPath,
    localDocker: record.localDocker,
    ...engine,
    configFile,
  };
}

/**
 * The folder target that a fresh Reopen would carry for the legacy host path `legacy`: the first of its configuration
 * `candidates`, which come in the order of the picker, with no Docker context; none when the folder has no configuration.
 */
export function folderTargetOf(
  legacy: DevContainerLegacy,
  candidates: ReadonlyArray<{file: string}>,
): DevContainerFolder | undefined {
  const first = candidates[0];
  return first === undefined
    ? undefined
    : {
        kind: 'folder',
        hostPath: legacy.hostPath,
        localDocker: false,
        configFile: {$mid: 1, path: first.file, scheme: 'file'},
      };
}

/** The text a payload holds, or the refusal for a payload that is not lowercase hex. */
export function payloadTextOf(payload: string): string | PayloadMalformed {
  return /^(?:[0-9a-f]{2})+$/.test(payload)
    ? Buffer.from(payload, 'hex').toString('utf8')
    : {malformed: 'hex'};
}

/** The JSON a payload's text holds, or the refusal for a text that is not JSON. */
export function payloadJsonOf(
  text: string,
): {json: unknown} | PayloadMalformed {
  try {
    return {json: JSON.parse(text)};
  } catch {
    return {malformed: 'json'};
  }
}

/** The record a payload's JSON holds, none when the JSON is another kind of value; or the refusal at the step that failed. */
export function payloadRecordOf(
  payload: string,
): {record: Record<string, unknown> | undefined} | PayloadMalformed {
  const text = payloadTextOf(payload);
  if (typeof text !== 'string') {
    return text;
  }
  const parsed = payloadJsonOf(text);
  return 'malformed' in parsed ? parsed : {record: recordOf(parsed.json)};
}

/** Reads a payload: a folder target, the legacy host path, or why it is neither. */
export function devContainerTargetOf(
  payload: string,
): DevContainerTarget | PayloadMalformed {
  const text = payloadTextOf(payload);
  if (typeof text !== 'string') {
    return text;
  }
  if (!text.trimStart().startsWith('{')) {
    return {kind: 'legacy', hostPath: text};
  }
  const parsed = payloadJsonOf(text);
  return 'malformed' in parsed ? parsed : folderOf(parsed.json);
}

/** The folder a window's decoded target names, or none when it has no target yet or the target names no folder. */
export function decodedFolderOf(
  decoded: DecodedTarget | undefined,
): DevContainerFolder | undefined {
  const target =
    decoded === undefined || !('payload' in decoded.target)
      ? undefined
      : devContainerTargetOf(decoded.target.payload);
  return target !== undefined && 'kind' in target && target.kind === 'folder'
    ? target
    : undefined;
}

/** Where a dev container window's folder came from, as its payload names it. */
export interface ReopenOrigin {
  kind: 'local';
  /** The host folder the container was opened from. */
  folder: string;
  /** The host file the window's workspace file maps to, when it lies under the folder's mount. */
  workspaceFile?: string;
}

/** The host side of a path, read with the client platform's separators: `path.win32` on a win32 client, `path.posix` on every other. */
function hostPathsOf(platform: string): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * The host file a workspace file under the folder's mount maps to, or none: the container path stays posix, the host
 * side takes the client platform's separators, and the containment test is case-insensitive on a win32 client.
 */
function workspaceFileOf(
  hostPath: string,
  platform: string,
  workspaceFile: string | undefined,
): string | undefined {
  if (workspaceFile === undefined) {
    return undefined;
  }
  const hostPaths = hostPathsOf(platform);
  const normalized = path.posix.normalize(workspaceFile);
  const mountTarget = `/workspaces/${hostPaths.basename(hostPath)}/`;
  if (normalized.startsWith('..') || !normalized.startsWith(mountTarget)) {
    return undefined;
  }
  const mapped = hostPaths.join(hostPath, normalized.slice(mountTarget.length));
  const prefix = hostPath + hostPaths.sep;
  const staysUnder =
    platform === 'win32'
      ? mapped.toLowerCase().startsWith(prefix.toLowerCase())
      : mapped.startsWith(prefix);
  return staysUnder ? mapped : undefined;
}

/**
 * The origin a dev container window can be reopened at, on the client `platform`: the payload's host folder, whatever
 * folder the window shows now, plus the host file the window's workspace file maps to when it lies under the folder's
 * mount. None for a window that isn't a dev container, or whose payload names no folder on this machine.
 */
export function windowOriginOf(
  authority: string | undefined,
  platform: string,
  workspaceFile?: string,
): ReopenOrigin | undefined {
  if (authority === undefined) {
    return undefined;
  }
  const decoded = decodeAuthority(authority);
  if (
    'malformed' in decoded ||
    decoded.family !== 'dev-container' ||
    !('payload' in decoded.target)
  ) {
    return undefined;
  }
  const target = devContainerTargetOf(decoded.target.payload);
  if (
    'malformed' in target ||
    (target.kind === 'folder' && target.configFile.scheme !== 'file')
  ) {
    return undefined;
  }
  const origin: ReopenOrigin = {kind: 'local', folder: target.hostPath};
  const file = workspaceFileOf(target.hostPath, platform, workspaceFile);
  return file === undefined ? origin : {...origin, workspaceFile: file};
}
