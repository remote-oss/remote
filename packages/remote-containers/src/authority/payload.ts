/**
 * @fileoverview The payload of a `dev-container` authority: the lowercase hex of a JSON text that names the host
 * folder, the Docker context when it is not the default, and the configuration file as the editor serializes its URI.
 * A payload that is a plain host path is the older form.
 */

/** A `file` or `vscode-fileHost` URI as the editor serializes it, in that member order. */
export interface SerializedUri {
  $mid: 1;
  fsPath?: string;
  external?: string;
  path: string;
  scheme: string;
}

/** A folder opened in a dev container. */
export interface DevContainerFolder {
  kind: 'folder';
  /** The absolute host folder. */
  hostPath: string;
  /** Always false when written. */
  localDocker: boolean;
  /** A Docker context that is not the default. */
  context?: string;
  configFile: SerializedUri;
}

/** The older payload: a plain host path. */
interface DevContainerLegacy {
  kind: 'legacy';
  hostPath: string;
}

/** What a payload names: a folder with its configuration, or the older plain host path. */
export type DevContainerTarget = DevContainerFolder | DevContainerLegacy;

/** A payload that does not decode, and the step that failed. */
export interface PayloadMalformed {
  malformed: 'hex' | 'json' | 'shape';
}

/** What a URI shows without being serialized: the five members are built from these. */
export interface UriParts {
  fsPath: string;
  path: string;
  scheme: string;
  toString(): string;
}

/** The URI as the five members of its serialized form, without asking the editor to serialize it. */
export function serializedUriOf(uri: UriParts): SerializedUri {
  return {
    $mid: 1,
    fsPath: uri.fsPath,
    external: uri.toString(),
    path: uri.path,
    scheme: uri.scheme,
  };
}

/** The payload for a folder target. */
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

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/** The configuration file of a payload, or nothing when it is not one. */
function configFileOf(value: unknown): SerializedUri | undefined {
  if (!isFields(value) || !isText(value.path) || !isText(value.scheme)) {
    return undefined;
  }
  const {fsPath, external} = value;
  if (
    (fsPath !== undefined && !isText(fsPath)) ||
    (external !== undefined && !isText(external))
  ) {
    return undefined;
  }
  return {
    $mid: 1,
    ...(fsPath === undefined ? {} : {fsPath}),
    ...(external === undefined ? {} : {external}),
    path: value.path,
    scheme: value.scheme,
  };
}

/** The target a payload names, or why it does not decode. */
export function devContainerTargetOf(
  payload: string,
): DevContainerTarget | PayloadMalformed {
  if (
    payload === '' ||
    payload.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(payload)
  ) {
    return {malformed: 'hex'};
  }
  const text = Buffer.from(payload, 'hex').toString('utf8');
  if (!text.trimStart().startsWith('{')) {
    return {kind: 'legacy', hostPath: text};
  }
  let parsed: Fields;
  try {
    parsed = JSON.parse(text) as Fields;
  } catch {
    return {malformed: 'json'};
  }
  const {hostPath, localDocker, settings} = parsed;
  const configFile = configFileOf(parsed.configFile);
  const context = isFields(settings) ? settings.context : undefined;
  if (
    !isText(hostPath) ||
    hostPath === '' ||
    typeof localDocker !== 'boolean' ||
    (settings !== undefined &&
      (!isFields(settings) || !isText(context) || context === '')) ||
    configFile === undefined
  ) {
    return {malformed: 'shape'};
  }
  return {
    kind: 'folder',
    hostPath,
    localDocker,
    ...(isText(context) ? {context} : {}),
    configFile,
  };
}
