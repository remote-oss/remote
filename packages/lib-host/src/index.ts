/**
 * @fileoverview lib-host: the host channel through which the server lifecycle runs scripts on a remote side and
 * places files there, whatever the transport.
 */

export {posixQuote, preludeCommand} from './shell-words.ts';
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
  type ScriptRequest,
} from './host-channel.ts';
