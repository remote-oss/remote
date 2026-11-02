/**
 * @fileoverview The payload of a dev-container authority: the lowercase hex of a JSON text that names the host folder,
 * the Docker context and the configuration file, and its reading back. A plain host path in hex is the legacy form.
 */

import type {DecodedTarget} from 'lib-authority';
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

/** The payload of a target: its JSON text, members in a fixed order, as lowercase hex. */
export function devContainerPayloadOf(target: DevContainerFolder): string {
  const pinned = (
    ['context', 'host', 'certPath', 'tlsVerify'] as const
  ).flatMap((member): Array<[string, string]> => {
    const value = target[member];
    return value === undefined ? [] : [[member, value]];
  });
  const text = JSON.stringify({
    hostPath: target.hostPath,
    localDocker: target.localDocker,
    ...(pinned.length === 0 ? {} : {settings: Object.fromEntries(pinned)}),
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
function engineOf(settings: unknown): PinnedEngine | false {
  if (settings === undefined) {
    return {};
  }
  const record = recordOf(settings);
  if (record === undefined) {
    return false;
  }
  const engine: PinnedEngine = {};
  for (const member of ['context', 'host', 'certPath', 'tlsVerify'] as const) {
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

/** Reads a payload: a folder target, the legacy host path, or why it is neither. */
export function devContainerTargetOf(
  payload: string,
): DevContainerTarget | PayloadMalformed {
  if (!/^(?:[0-9a-f]{2})+$/.test(payload)) {
    return {malformed: 'hex'};
  }
  const text = Buffer.from(payload, 'hex').toString('utf8');
  if (!text.trimStart().startsWith('{')) {
    return {kind: 'legacy', hostPath: text};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {malformed: 'json'};
  }
  return folderOf(parsed);
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
