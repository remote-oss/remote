/**
 * @fileoverview The messages between the windows of a host and the helper that holds the host's one `ssh`
 * connection (S9): plain data over lib-helper's request and event channel. No answer to a prompt is stored in a
 * record, a log or any other message than the one that carries it to `ssh`.
 */

import type {PlainData} from 'lib-helper';
import {ABSOLUTE_HOST_PATH, type SessionLock} from 'lib-host';
import type {FailureHint, FailureReason} from '../diagnostics/classify.ts';
import type {FailureKind} from '../diagnostics/rules.ts';
import type {SpawnFailure} from '../process/session.ts';
import type {DetectedPlatform} from './platform-probe.ts';

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
  /** The data folder the held server was installed in: a later window checks the server and prunes old installs there. */
  dataFolder?: string;
  /**
   * The editor's command-line program the connection runs, which a later window on the connection uses: its control
   * port on the host, the token it requires, the connection token of the server its `serve` starts, and the script that
   * stops it, which the connection server runs when it ends. Both tokens are secrets: they must not reach a log.
   */
  sharedCli?: {
    port: number;
    controlToken: string;
    connectionToken: string;
    stopScript: string;
  };
}

/** The command-line program a connection's windows share. */
export type SharedCli = NonNullable<SharedRecord['sharedCli']>;

/** The end action of a connection server: it stops the command-line program the connection shares. */
export const STOP_SHARED_CLI = 'stopSharedCli';

/** How long the end action's stop of the shared program may take, in milliseconds. */
export const SHARED_CLI_STOP_MILLISECONDS = 10 * 1000;

/** How long the shared session has to answer the probe of a session check, in milliseconds. */
export const SESSION_PROBE_MILLISECONDS = 3000;

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
      /** The session-wide host lock of this run; absent for a run that takes none. */
      sessionLock?: SessionLock;
    }
  | {type: 'kill'}
  | {type: 'checkSession'};

/** Why a script did not run to its end. */
export type ScriptFailureReason = 'notConnected' | 'channelClosed' | 'timeout';

/** Why the helper refused a request. */
export type Refusal = 'notOwner' | 'alreadyConnecting' | 'alreadyConnected';

/** The helper's answer to a request. */
export type ConnectionReply =
  | {type: 'accepted'}
  | {type: 'refused'; reason: Refusal}
  | {type: 'questionRefused'; accepted: boolean}
  | {
      type: 'sharedRecord';
      record: SharedRecord | null;
      /** What the session's opening found when the host's platform was unknown; null when it was known. */
      detectedPlatform: DetectedPlatform | null;
      /** The pid of the ssh the helper runs, known once the connection is set up; absent from an earlier build. */
      sshProcessId?: number;
    }
  | {type: 'answered'; accepted: boolean}
  | {type: 'scriptEnded'; status: number}
  | {type: 'scriptFailed'; reason: ScriptFailureReason; detail: string}
  | {type: 'sessionChecked'; alive: boolean};

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
  | {
      type: 'connected';
      socksPort: number;
      /** The pid of the ssh the helper runs, which the helper knows once the connection is set up; absent from an earlier build. */
      sshProcessId?: number;
    }
  | {
      type: 'loginFailed';
      kind: FailureKind;
      reason?: FailureReason;
      hints: FailureHint[];
      /** `ssh`'s exit status, or `null` when it ended on a signal; absent from a helper of an earlier build. */
      exitStatus?: number | null;
      /** What the helper logged about the failure, for the window's own log; absent when it logged nothing. */
      detail?: string;
    }
  | {type: 'spawnFailed'; cause: SpawnFailure; detail: string}
  | {type: 'scriptLine'; runId: number; line: string}
  /** Lines of ssh's error stream, in order, since the last such event. */
  | {type: 'sshLines'; lines: string[]}
  /** Lines a `LocalCommand` wrote to ssh's standard output, for the window's log alone. */
  | {type: 'localCommandLines'; lines: string[]}
  | {type: 'transportLost'};

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a session lock: a non-empty path and one of the two actions. */
function isSessionLock(value: unknown): value is SessionLock {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const {path, action} = value as Record<string, unknown>;
  return (
    typeof path === 'string' &&
    path !== '' &&
    (action === 'open' || action === 'release')
  );
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

/** A Windows drive with no folder on it. */
const BARE_DRIVE = /^[A-Za-z]:$/;

/**
 * A data folder a record names, when the host can hold a server there: an absolute path, POSIX or Windows, with a
 * folder above its last name, and a last name that is a folder's own. Its reader splits it at its last `/` into the
 * install root and the folder's name, and the scripts read an empty install root as the home folder; so a value with
 * no `/`, a folder right under `/` or right on a drive, an empty last name, `.` or `..` gives a folder that isn't the
 * one the record was written for.
 */
function readDataFolder(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ABSOLUTE_HOST_PATH.test(value)) {
    return undefined;
  }
  const split = value.lastIndexOf('/');
  const name = value.slice(split + 1);
  return split <= 0 ||
    BARE_DRIVE.test(value.slice(0, split)) ||
    name === '' ||
    name === '.' ||
    name === '..'
    ? undefined
    : value;
}

/** Whether `value` is a text that isn't empty. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A shared program the record names: a TCP port, and two tokens and a stop script that aren't empty; none for any other value. */
function readSharedCli(value: unknown): SharedCli | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  const {port, controlToken, connectionToken, stopScript} = value;
  return typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    isText(controlToken) &&
    isText(connectionToken) &&
    isText(stopScript)
    ? {port, controlToken, connectionToken, stopScript}
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
  const dataFolder = readDataFolder(value.dataFolder);
  const sharedCli = readSharedCli(value.sharedCli);
  return {
    remotePort,
    operatingSystem,
    architecture,
    temporaryFolder,
    connectionToken,
    ...(agentLink === undefined ? {} : {agentLink}),
    ...(display === undefined ? {} : {display}),
    ...(dataFolder === undefined ? {} : {dataFolder}),
    ...(sharedCli === undefined ? {} : {sharedCli}),
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
    case 'checkSession':
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
        body.deadlineMilliseconds > 0 &&
        (body.sessionLock === undefined || isSessionLock(body.sessionLock))
        ? {
            type: 'runScript',
            runId: body.runId,
            script: body.script,
            environment: body.environment,
            inputBase64: body.inputBase64,
            deadlineMilliseconds: body.deadlineMilliseconds,
            ...(body.sessionLock === undefined
              ? {}
              : {sessionLock: body.sessionLock}),
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

const DETECTED_PLATFORMS: readonly DetectedPlatform[] = ['windows', 'posix'];

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
      const detectedPlatform = DETECTED_PLATFORMS.find(
        each => each === body.detectedPlatform,
      );
      if (
        body.detectedPlatform !== undefined &&
        body.detectedPlatform !== null &&
        detectedPlatform === undefined
      ) {
        return undefined;
      }
      const record =
        body.record === null ? null : readSharedRecord(body.record);
      const sshProcessId =
        typeof body.sshProcessId === 'number' ? body.sshProcessId : undefined;
      return record === undefined
        ? undefined
        : {
            type: 'sharedRecord',
            record,
            detectedPlatform: detectedPlatform ?? null,
            ...(sshProcessId === undefined ? {} : {sshProcessId}),
          };
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
    case 'sessionChecked':
      return typeof body.alive === 'boolean'
        ? {type: 'sessionChecked', alive: body.alive}
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
    case 'connected': {
      if (typeof body.socksPort !== 'number') {
        return undefined;
      }
      const sshProcessId =
        typeof body.sshProcessId === 'number' ? body.sshProcessId : undefined;
      return {
        type: 'connected',
        socksPort: body.socksPort,
        ...(sshProcessId === undefined ? {} : {sshProcessId}),
      };
    }
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
    case 'sshLines':
    case 'localCommandLines':
      return Array.isArray(body.lines) &&
        body.lines.every(line => typeof line === 'string')
        ? {type: body.type, lines: body.lines}
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
    ) ||
    !(fields.detail === undefined || typeof fields.detail === 'string')
  ) {
    return undefined;
  }
  // The helper of this library wrote the kind, the reason and the hints from S5's classification.
  const failed = {
    type: 'loginFailed',
    kind: fields.kind as FailureKind,
    hints: fields.hints as FailureHint[],
    ...(fields.exitStatus === undefined ? {} : {exitStatus: fields.exitStatus}),
    ...(fields.detail === undefined ? {} : {detail: fields.detail}),
  } as const;
  return fields.reason === undefined
    ? failed
    : {...failed, reason: fields.reason as FailureReason};
}
