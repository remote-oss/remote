/**
 * @fileoverview The messages between the windows of a host and the helper that holds the host's one `ssh`
 * connection (S9): plain data over lib-helper's request and event channel. No answer to a prompt is stored in a
 * record, a log or any other message than the one that carries it to `ssh`.
 */

import type {PlainData} from 'lib-helper';

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
