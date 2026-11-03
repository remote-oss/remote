/**
 * @fileoverview The messages of the shutdown helper, as plain data: what a window tells it about its connection to a
 * dev container, and how it answers. A message that is not one of these is answered with its problem and changes nothing.
 */

/** The engine a connection used: no secret, only where `docker` is and the variables that pick the engine. */
export interface EngineCoordinates {
  dockerPath: string;
  /** `DOCKER_CONTEXT` and `DOCKER_HOST` as the connection's engine had them; absent when unset. */
  environment: Readonly<Record<string, string>>;
}

/**
 * What identifies a dev container before its id is known: the folder and configuration it is for, or, for a clone in a
 * volume, the volume and the folder in it.
 */
export type ContainerIdentity =
  | {
      hostPath: string;
      /** The configuration file's path on the host. */
      configFile: string;
    }
  | {volumeName: string; folder: string};

/** Whether two identities name the same dev container. */
export function sameIdentity(
  left: ContainerIdentity,
  right: ContainerIdentity,
): boolean {
  if ('hostPath' in left) {
    return (
      'hostPath' in right &&
      left.hostPath === right.hostPath &&
      left.configFile === right.configFile
    );
  }
  return (
    'volumeName' in right &&
    left.volumeName === right.volumeName &&
    left.folder === right.folder
  );
}

/** The `docker ps` filters that find the dev container of an identity by its labels. */
export function identityFilters(identity: ContainerIdentity): string[] {
  const labels =
    'hostPath' in identity
      ? [
          `devcontainer.local_folder=${identity.hostPath}`,
          `devcontainer.config_file=${identity.configFile}`,
        ]
      : [
          `vsch.local.repository.volume=${identity.volumeName}`,
          `vsch.local.repository.folder=${identity.folder}`,
        ];
  return labels.flatMap(label => ['--filter', `label=${label}`]);
}

/** What a window's connection tells the helper. */
export type ShutdownRequest =
  | {
      type: 'register';
      connectionId: string;
      identity: ContainerIdentity;
      engine: EngineCoordinates;
    }
  | {
      type: 'container';
      connectionId: string;
      containerId: string;
      action: 'stop' | 'none';
    }
  | {type: 'leave'; connectionId: string};

/** The helper's answer to a request. */
export type ShutdownReply =
  {accepted: true} | {accepted: false; problem: string};

/** A request as read from plain data, or why it is none. */
export type ReadRequest =
  | {kind: 'request'; request: ShutdownRequest}
  | {kind: 'malformed'; problem: string};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The non-empty text of a member, or undefined. */
function textOf(
  record: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = record[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The environment of an engine: a record of text, empty when the member is absent; undefined for anything else. */
function environmentOf(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  return entries.every(([, each]) => typeof each === 'string')
    ? (Object.fromEntries(entries) as Record<string, string>)
    : undefined;
}

/** The identity a member holds: a folder's, a volume's, or none. */
function identityOf(value: unknown): ContainerIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const hostPath = textOf(value, 'hostPath');
  const configFile = textOf(value, 'configFile');
  if (hostPath !== undefined && configFile !== undefined) {
    return {hostPath, configFile};
  }
  const volumeName = textOf(value, 'volumeName');
  const folder = textOf(value, 'folder');
  return volumeName !== undefined && folder !== undefined
    ? {volumeName, folder}
    : undefined;
}

/** The register request of `record`, or its problem. */
function readRegister(
  record: Record<string, unknown>,
  connectionId: string,
): ReadRequest {
  const {engine} = record;
  const identity = identityOf(record.identity);
  const dockerPath = isRecord(engine)
    ? textOf(engine, 'dockerPath')
    : undefined;
  const environment = isRecord(engine)
    ? environmentOf(engine.environment)
    : undefined;
  if (identity === undefined) {
    return {
      kind: 'malformed',
      problem:
        'register needs the identity with a hostPath and a configFile, or a volumeName and a folder',
    };
  }
  if (dockerPath === undefined || environment === undefined) {
    return {
      kind: 'malformed',
      problem:
        'register needs the engine with a dockerPath and an environment of text',
    };
  }
  return {
    kind: 'request',
    request: {
      type: 'register',
      connectionId,
      identity,
      engine: {dockerPath, environment},
    },
  };
}

/** The container request of `record`, or its problem. */
function readContainer(
  record: Record<string, unknown>,
  connectionId: string,
): ReadRequest {
  const containerId = textOf(record, 'containerId');
  const {action} = record;
  if (containerId === undefined || (action !== 'stop' && action !== 'none')) {
    return {
      kind: 'malformed',
      problem: 'container needs a containerId and an action of stop or none',
    };
  }
  return {
    kind: 'request',
    request: {type: 'container', connectionId, containerId, action},
  };
}

/** The request that `body` is, or why it is none. */
export function readShutdownRequest(body: unknown): ReadRequest {
  if (!isRecord(body)) {
    return {kind: 'malformed', problem: 'the message is not an object'};
  }
  const connectionId = textOf(body, 'connectionId');
  if (connectionId === undefined) {
    return {kind: 'malformed', problem: 'the message has no connectionId'};
  }
  switch (body.type) {
    case 'register':
      return readRegister(body, connectionId);
    case 'container':
      return readContainer(body, connectionId);
    case 'leave':
      return {kind: 'request', request: {type: 'leave', connectionId}};
    default:
      return {kind: 'malformed', problem: 'the message type is unknown'};
  }
}
