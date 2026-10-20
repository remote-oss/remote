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

/** What identifies a dev container before its id is known: the folder and configuration it is for. */
export interface ContainerIdentity {
  hostPath: string;
  /** The configuration file's path on the host. */
  configFile: string;
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

/** The register request of `record`, or its problem. */
function readRegister(
  record: Record<string, unknown>,
  connectionId: string,
): ReadRequest {
  const {identity, engine} = record;
  const hostPath = isRecord(identity)
    ? textOf(identity, 'hostPath')
    : undefined;
  const configFile = isRecord(identity)
    ? textOf(identity, 'configFile')
    : undefined;
  const dockerPath = isRecord(engine)
    ? textOf(engine, 'dockerPath')
    : undefined;
  const environment = isRecord(engine)
    ? environmentOf(engine.environment)
    : undefined;
  if (hostPath === undefined || configFile === undefined) {
    return {
      kind: 'malformed',
      problem: 'register needs the identity with a hostPath and a configFile',
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
      identity: {hostPath, configFile},
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
