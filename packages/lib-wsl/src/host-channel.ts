/**
 * @fileoverview D4, the host channel over WSL: lib-host's channel implemented with D1. A script runs as `sh` in the
 * distro, a file is copied by `cat` into the path, and a client file is read in place when the distro mounts its
 * drive. Every failure is a value of lib-host's closed set, with the WSL kind kept in the detail.
 */

import {
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  preludeCommand,
  type PlatformHint,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import type {
  ExecInput,
  RunFailed,
  WslFailureKind,
  WslRunner,
} from './runner.ts';
import type {PathMapper} from './path-mapper.ts';

/** The channel kind of each failure of the runner. */
const CHANNEL_KINDS: Readonly<Record<WslFailureKind, ChannelFailureKind>> = {
  distroUnknown: 'channelClosed',
  distroUnregistered: 'channelClosed',
  startFailed: 'channelClosed',
  wslMissing: 'spawnFailed',
  wslNeedsUpdate: 'spawnFailed',
  spawnFailed: 'spawnFailed',
  cancelled: 'cancelled',
};

/** The channel's failure for a failed run, the WSL kind kept in the detail. */
function channelFailure(
  failure: RunFailed,
  overrides: Partial<Record<WslFailureKind, ChannelFailureKind>> = {},
): ReturnType<typeof failFrom> {
  const {kind, detail} = failure.failure;
  return failFrom(overrides[kind] ?? CHANNEL_KINDS[kind], `${kind}: ${detail}`);
}

/** What the channel is made of. */
export interface WslHostChannelPorts {
  runner: WslRunner;
  mapper: PathMapper;
  /** The registered spelling of the distro's name: the channel's identity. */
  distro: string;
}

/** A path on a drive of Windows, as `X:\\` or `X:/` begins it. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** The input of a script: the prelude command's bytes in front of the script's own input. */
function scriptInput(request: ScriptRequest): {
  program: string[];
  input: ExecInput;
} {
  const prelude = `${request.script}\n`;
  const count = Buffer.byteLength(prelude, 'utf8');
  return {
    program: ['-c', preludeCommand(count)],
    input:
      request.input.kind === 'text'
        ? {kind: 'text', text: prelude + request.input.text}
        : {kind: 'file', prefix: prelude, localFile: request.input.localFile},
  };
}

/** The channel over WSL. */
export function createWslHostChannel(ports: WslHostChannelPorts): HostChannel {
  const {runner, mapper, distro} = ports;
  return {
    runScript: async (request, onLine): Promise<ScriptOutcome> => {
      if (request.interpreter !== 'posixShell') {
        return failFrom(
          'spawnFailed',
          'a distro runs a script for the POSIX shell only',
        );
      }
      const planned = scriptInput(request);
      const outcome = await runner.exec(
        {
          distro,
          folder: '~',
          program: 'sh',
          programArguments: planned.program,
          environment: request.environment,
          input: planned.input,
          cancellation: request.cancellation,
        },
        onLine,
      );
      return outcome.kind === 'failed'
        ? channelFailure(outcome)
        : {kind: 'exited', status: outcome.status};
    },
    copyToHost: async (request: CopyRequest): Promise<CopyOutcome> => {
      const outcome = await runner.exec(
        {
          distro,
          folder: '~',
          program: 'sh',
          programArguments: ['-c', 'cat > "$1"', 'sh', request.remotePath],
          environment: {},
          input: {kind: 'file', prefix: '', localFile: request.localFile},
          cancellation: request.cancellation,
        },
        () => undefined,
      );
      if (outcome.kind === 'failed') {
        return channelFailure(outcome, {spawnFailed: 'copyFailed'});
      }
      return outcome.status === 0
        ? {kind: 'copied'}
        : failFrom(
            'copyFailed',
            `cat ended with status ${String(outcome.status)}`,
          );
    },
    identity: () => distro,
    platformHint: (): PlatformHint => 'linux',
    clientPathOnHost: async localFile => {
      if (!DRIVE_PATH.test(localFile)) {
        return undefined;
      }
      const cancellation = new AbortController().signal;
      const mapped = await mapper.toDistro(localFile, distro, cancellation);
      if (mapped.kind !== 'mapped' || mapped.mapped.distro !== distro) {
        return undefined;
      }
      const readable = await runner.exec(
        {
          distro,
          folder: '~',
          program: 'sh',
          programArguments: [
            '-c',
            'test -r "$1"',
            'sh',
            mapped.mapped.linuxPath,
          ],
          environment: {},
          input: {kind: 'none'},
          cancellation,
        },
        () => undefined,
      );
      return readable.kind !== 'failed' && readable.status === 0
        ? mapped.mapped.linuxPath
        : undefined;
    },
  };
}
