/**
 * @fileoverview The messages between the windows of a host and the helper that holds the host's one `ssh`
 * connection (S9): plain data over lib-helper's request and event channel. No answer to a prompt is stored in a
 * record, a log or any other message than the one that carries it to `ssh`.
 */

import type {PlainData} from 'lib-helper';
import type {FailureHint, FailureReason} from '../diagnostics/classify.ts';
import type {FailureKind} from '../diagnostics/rules.ts';

/** What a later window needs to reuse the server of a connection; held by the helper, never written to a file. */
export interface SharedRecord {
  remotePort: number;
  operatingSystem: string;
  architecture: string;
  temporaryFolder: string;
  connectionToken: string;
}

/** What a window asks of the helper. */
export type ConnectionRequest =
  | {type: 'connect'}
  | {type: 'sharedRecord'}
  | {type: 'setSharedRecord'; record: SharedRecord}
  | {type: 'answer'; promptId: number; text: string}
  | {type: 'kill'};

/** Why the helper refused a request. */
export type Refusal = 'notOwner' | 'alreadyConnecting' | 'alreadyConnected';

/** The helper's answer to a request. */
export type ConnectionReply =
  | {type: 'accepted'}
  | {type: 'refused'; reason: Refusal}
  | {type: 'sharedRecord'; record: SharedRecord | null}
  | {type: 'answered'; accepted: boolean};

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
    }
  | {type: 'transportLost'};

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  return typeof remotePort === 'number' &&
    typeof operatingSystem === 'string' &&
    typeof architecture === 'string' &&
    typeof temporaryFolder === 'string' &&
    typeof connectionToken === 'string'
    ? {
        remotePort,
        operatingSystem,
        architecture,
        temporaryFolder,
        connectionToken,
      }
    : undefined;
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
    default:
      return undefined;
  }
}

const REFUSALS: readonly string[] = [
  'notOwner',
  'alreadyConnecting',
  'alreadyConnected',
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
    case 'waitingForOtherWindow':
    case 'transportLost':
      return {type: body.type};
    default:
      return undefined;
  }
}

function readLoginFailed(fields: Fields): ConnectionEvent | undefined {
  if (typeof fields.kind !== 'string' || !Array.isArray(fields.hints)) {
    return undefined;
  }
  // The helper of this library wrote the kind, the reason and the hints from S5's classification.
  const failed = {
    type: 'loginFailed',
    kind: fields.kind as FailureKind,
    hints: fields.hints as FailureHint[],
  } as const;
  return fields.reason === undefined
    ? failed
    : {...failed, reason: fields.reason as FailureReason};
}
