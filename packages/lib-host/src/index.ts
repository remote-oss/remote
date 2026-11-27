/**
 * @fileoverview lib-host: the host channel through which the server lifecycle runs scripts on a remote side and
 * places files there, whatever the transport.
 */

export {ABSOLUTE_HOST_PATH} from './absolute-path.ts';
export {
  BoundedLines,
  JOINED_ERRORS,
  LONGEST_PENDING_LINE,
  TREE_KILL_SCRIPT,
} from './channel-rules.ts';
export {
  posixQuote,
  powershellQuote,
  preludeCommand,
  windowsArgument,
} from './shell-words.ts';
export {
  type ChannelFailure,
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  hostPathOf,
  type Interpreter,
  type OperationFailed,
  type PlatformHint,
  type ScriptInput,
  type ScriptOutcome,
  linesOfScript,
  type ScriptRequest,
  type SessionLock,
} from './host-channel.ts';
export {localChannel, type LocalChannelOptions} from './local-channel.ts';
