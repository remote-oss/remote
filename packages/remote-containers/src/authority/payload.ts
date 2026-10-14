/**
 * @fileoverview The payload of a dev-container authority: the lowercase hex of a JSON text that names the host folder,
 * the Docker context and the configuration file, and its reading back. A plain host path in hex is the legacy form.
 */

import type {DecodedTarget} from 'lib-authority';
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

/** A folder opened in a container: the host folder, the Docker context if it is not the default, and the file. */
export interface DevContainerFolder {
  kind: 'folder';
  hostPath: string;
  localDocker: boolean;
  context?: string;
  configFile: SerializedUri;
}

/** A payload that is only a host path. */
interface DevContainerLegacy {
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
  const text = JSON.stringify({
    hostPath: target.hostPath,
    localDocker: target.localDocker,
    ...(target.context === undefined
      ? {}
      : {settings: {context: target.context}}),
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

/** The Docker context of a payload: none, a name, or `false` for a `settings` member of the wrong shape. */
function contextOf(settings: unknown): string | undefined | false {
  if (settings === undefined) {
    return undefined;
  }
  const record = recordOf(settings);
  return record !== undefined &&
    typeof record.context === 'string' &&
    record.context !== ''
    ? record.context
    : false;
}

/** The target a JSON object names, or the refusal for its shape. */
function folderOf(parsed: unknown): DevContainerFolder | PayloadMalformed {
  const record = recordOf(parsed);
  const context = contextOf(record?.settings);
  const configFile = configFileOf(record?.configFile);
  if (
    typeof record?.hostPath !== 'string' ||
    record.hostPath === '' ||
    typeof record.localDocker !== 'boolean' ||
    context === false ||
    configFile === undefined
  ) {
    return {malformed: 'shape'};
  }
  return {
    kind: 'folder',
    hostPath: record.hostPath,
    localDocker: record.localDocker,
    ...(context === undefined ? {} : {context}),
    configFile,
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
