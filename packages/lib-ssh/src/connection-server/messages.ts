/**
 * @fileoverview The messages between the windows of a host and the helper that holds the host's one `ssh`
 * connection (S9): plain data over lib-helper's request and event channel. No answer to a prompt is stored in a
 * record, a log or any other message than the one that carries it to `ssh`.
 */

import type {PlainData} from 'lib-helper';
import type {FailureHint, FailureReason} from '../diagnostics/classify.ts';
import type {FailureKind} from '../diagnostics/rules.ts';
import type {SpawnFailure} from '../process/session.ts';

/** The agent link a connection's first window planned: none and why, or the link's path and its target. */
export type StoredAgentLink =
  | {kind: 'none'; reason: 'settingOff' | 'noForwardedSocket'}
  | {kind: 'link'; linkPath: string; target: string};

/** The display a connection's first window planned: none and why, or the display's value. */
export type StoredDisplay =
  | {kind: 'none'; reason: 'settingOff' | 'noSessionDisplay'}
  | {kind: 'display'; value: string};

/** What a later window needs to reuse the server of a connection; held by the helper, never written to a file. */
export interface SharedRecord {
  remotePort: number;
  operatingSystem: string;
  architecture: string;
  temporaryFolder: string;
  connectionToken: string;
  /** The first window's agent link plan, which a later window of the connection keeps. */
  agentLink?: StoredAgentLink;
  /** The first window's display plan, which a later window of the connection keeps. */
  display?: StoredDisplay;
}

/** What a window asks of the helper. */
export type ConnectionRequest =
  | {type: 'connect'}
  | {type: 'sharedRecord'}
  | {type: 'setSharedRecord'; record: SharedRecord}
  | {type: 'answer'; promptId: number; text: string}
  | {type: 'refuse'; promptId: number}
  | {
      type: 'runScript';
      runId: number;
      script: string;
      /** Variables added to the script's environment. */
      environment: Readonly<Record<string, string>>;
      /** What the script reads on its standard input, as base64; null for none. */
      inputBase64: string | null;
      /** How long the run may take once it has started, in milliseconds. */
      deadlineMilliseconds: number;
    }
  | {type: 'kill'};

/** Why a script did not run to its end. */
export type ScriptFailureReason = 'notConnected' | 'channelClosed' | 'timeout';

/** Why the helper refused a request. */
export type Refusal = 'notOwner' | 'alreadyConnecting' | 'alreadyConnected';

/** The helper's answer to a request. */
export type ConnectionReply =
  | {type: 'accepted'}
  | {type: 'refused'; reason: Refusal}
  | {type: 'questionRefused'; accepted: boolean}
  | {type: 'sharedRecord'; record: SharedRecord | null}
  | {type: 'answered'; accepted: boolean}
  | {type: 'scriptEnded'; status: number}
  | {type: 'scriptFailed'; reason: ScriptFailureReason; detail: string};

/** The kind of question `ssh` asked. */
export type PromptSurface =
  'fingerprintPick' | 'continuationPick' | 'maskedInput';

/** What the helper tells its leases. */
export type ConnectionEvent =
  | {
      type: 'prompt';
      promptId: number;
      surface: PromptSurface;
      text: string;
    }
  | {type: 'promptClosed'; promptId: number}
  | {type: 'ownerChanged'; owner: number}
  | {type: 'waitingForOtherWindow'}
  | {type: 'connected'; socksPort: number}
  | {
      type: 'loginFailed';
      kind: FailureKind;
      reason?: FailureReason;
      hints: FailureHint[];
      /** `ssh`'s exit status, or `null` when it ended on a signal; absent from a helper of an earlier build. */
      exitStatus?: number | null;
    }
  | {type: 'spawnFailed'; cause: SpawnFailure; detail: string}
  | {type: 'scriptLine'; runId: number; line: string}
  | {type: 'transportLost'};

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isFields(value) &&
    Object.values(value).every(item => typeof item === 'string')
  );
}

/** A stored agent link plan, or undefined for a value of any other shape. */
function readAgentLink(value: unknown): StoredAgentLink | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  if (
    value.kind === 'none' &&
    (value.reason === 'settingOff' || value.reason === 'noForwardedSocket')
  ) {
    return {kind: 'none', reason: value.reason};
  }
  return value.kind === 'link' &&
    typeof value.linkPath === 'string' &&
    typeof value.target === 'string'
    ? {kind: 'link', linkPath: value.linkPath, target: value.target}
    : undefined;
}

/** A stored display plan, or undefined for a value of any other shape. */
function readDisplay(value: unknown): StoredDisplay | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  if (
    value.kind === 'none' &&
    (value.reason === 'settingOff' || value.reason === 'noSessionDisplay')
  ) {
    return {kind: 'none', reason: value.reason};
  }
  return value.kind === 'display' && typeof value.value === 'string'
    ? {kind: 'display', value: value.value}
    : undefined;
}

function readSharedRecord(value: unknown): SharedRecord | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  const {
    remotePort,
    operatingSystem,
    architecture,
    temporaryFolder,
    connectionToken,
  } = value;
  if (
    typeof remotePort !== 'number' ||
    typeof operatingSystem !== 'string' ||
    typeof architecture !== 'string' ||
    typeof temporaryFolder !== 'string' ||
    typeof connectionToken !== 'string'
  ) {
    return undefined;
  }
  const agentLink = readAgentLink(value.agentLink);
  const display = readDisplay(value.display);
  return {
    remotePort,
    operatingSystem,
    architecture,
    temporaryFolder,
    connectionToken,
    ...(agentLink === undefined ? {} : {agentLink}),
    ...(display === undefined ? {} : {display}),
  };
}

/** The request a body is, or undefined when it is none. */
export function readConnectionRequest(
  body: PlainData,
): ConnectionRequest | undefined {
  if (!isFields(body)) {
    return undefined;
  }
  switch (body.type) {
    case 'connect':
    case 'sharedRecord':
    case 'kill':
      return {type: body.type};
    case 'setSharedRecord': {
      const record = readSharedRecord(body.record);
      return record === undefined
        ? undefined
        : {type: 'setSharedRecord', record};
    }
    case 'answer':
      return typeof body.promptId === 'number' && typeof body.text === 'string'
        ? {type: 'answer', promptId: body.promptId, text: body.text}
        : undefined;
    case 'refuse':
      return typeof body.promptId === 'number'
        ? {type: 'refuse', promptId: body.promptId}
        : undefined;
    case 'runScript':
      return typeof body.runId === 'number' &&
        typeof body.script === 'string' &&
        isStringRecord(body.environment) &&
        (body.inputBase64 === null || typeof body.inputBase64 === 'string') &&
        typeof body.deadlineMilliseconds === 'number' &&
        body.deadlineMilliseconds > 0
        ? {
            type: 'runScript',
            runId: body.runId,
            script: body.script,
            environment: body.environment,
            inputBase64: body.inputBase64,
            deadlineMilliseconds: body.deadlineMilliseconds,
          }
        : undefined;
    default:
      return undefined;
  }
}

const REFUSALS: readonly string[] = [
  'notOwner',
  'alreadyConnecting',
  'alreadyConnected',
];

const SCRIPT_FAILURES: readonly string[] = [
  'notConnected',
  'channelClosed',
  'timeout',
];

const SURFACES: readonly string[] = [
  'fingerprintPick',
  'continuationPick',
  'maskedInput',
];

/** The reply a body is, or undefined when it is none. */
export function readConnectionReply(
  body: PlainData,
): ConnectionReply | undefined {
  if (!isFields(body)) {
    return undefined;
  }
  switch (body.type) {
    case 'accepted':
      return {type: 'accepted'};
    case 'refused':
      return typeof body.reason === 'string' && REFUSALS.includes(body.reason)
        ? {type: 'refused', reason: body.reason as Refusal}
        : undefined;
    case 'questionRefused':
      return typeof body.accepted === 'boolean'
        ? {type: 'questionRefused', accepted: body.accepted}
        : undefined;
    case 'sharedRecord': {
      if (body.record === null) {
        return {type: 'sharedRecord', record: null};
      }
      const record = readSharedRecord(body.record);
      return record === undefined ? undefined : {type: 'sharedRecord', record};
    }
    case 'answered':
      return typeof body.accepted === 'boolean'
        ? {type: 'answered', accepted: body.accepted}
        : undefined;
    case 'scriptEnded':
      return typeof body.status === 'number'
        ? {type: 'scriptEnded', status: body.status}
        : undefined;
    case 'scriptFailed':
      return typeof body.reason === 'string' &&
        SCRIPT_FAILURES.includes(body.reason) &&
        typeof body.detail === 'string'
        ? {
            type: 'scriptFailed',
            reason: body.reason as ScriptFailureReason,
            detail: body.detail,
          }
        : undefined;
    default:
      return undefined;
  }
}

/** The event a body is, or undefined when it is none. */
export function readConnectionEvent(
  body: PlainData,
): ConnectionEvent | undefined {
  if (!isFields(body)) {
    return undefined;
  }
  switch (body.type) {
    case 'prompt':
      return typeof body.promptId === 'number' &&
        typeof body.surface === 'string' &&
        SURFACES.includes(body.surface) &&
        typeof body.text === 'string'
        ? {
            type: 'prompt',
            promptId: body.promptId,
            surface: body.surface as PromptSurface,
            text: body.text,
          }
        : undefined;
    case 'promptClosed':
      return typeof body.promptId === 'number'
        ? {type: 'promptClosed', promptId: body.promptId}
        : undefined;
    case 'ownerChanged':
      return typeof body.owner === 'number'
        ? {type: 'ownerChanged', owner: body.owner}
        : undefined;
    case 'connected':
      return typeof body.socksPort === 'number'
        ? {type: 'connected', socksPort: body.socksPort}
        : undefined;
    case 'loginFailed':
      return readLoginFailed(body);
    case 'spawnFailed':
      return (body.cause === 'clientVanished' ||
        body.cause === 'spawnFailed') &&
        typeof body.detail === 'string'
        ? {type: 'spawnFailed', cause: body.cause, detail: body.detail}
        : undefined;
    case 'scriptLine':
      return typeof body.runId === 'number' && typeof body.line === 'string'
        ? {type: 'scriptLine', runId: body.runId, line: body.line}
        : undefined;
    case 'waitingForOtherWindow':
    case 'transportLost':
      return {type: body.type};
    default:
      return undefined;
  }
}

function readLoginFailed(fields: Fields): ConnectionEvent | undefined {
  if (
    typeof fields.kind !== 'string' ||
    !Array.isArray(fields.hints) ||
    !(
      fields.exitStatus === undefined ||
      fields.exitStatus === null ||
      typeof fields.exitStatus === 'number'
    )
  ) {
    return undefined;
  }
  // The helper of this library wrote the kind, the reason and the hints from S5's classification.
  const failed = {
    type: 'loginFailed',
    kind: fields.kind as FailureKind,
    hints: fields.hints as FailureHint[],
    ...(fields.exitStatus === undefined ? {} : {exitStatus: fields.exitStatus}),
  } as const;
  return fields.reason === undefined
    ? failed
    : {...failed, reason: fields.reason as FailureReason};
}
