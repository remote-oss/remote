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
  JOINED_ERRORS,
  PROCESS_ID,
  preludeCommand,
  type PlatformHint,
  REPORT_PROCESS_ID,
  type ScriptOutcome,
  type ScriptRequest,
  TREE_KILL_SCRIPT,
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
  /** Where the channel says what it could not do, as a line of text. */
  logLine: (message: string) => void;
  /** How long a cancel waits for the shell's process id and for the tree to end, in milliseconds; 15 s when not given. */
  treeKillBoundMs?: number;
}

/** The longest a cancel waits for the shell's process id, and for the tree to end, by the contract's second-run bound. */
const TREE_KILL_BOUND_MS = 15_000;

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
    program: ['-c', JOINED_ERRORS + REPORT_PROCESS_ID + preludeCommand(count)],
    input:
      request.input.kind === 'text'
        ? {kind: 'text', text: prelude + request.input.text}
        : {kind: 'file', prefix: prelude, localFile: request.input.localFile},
  };
}

/** What `promise` gives, or `fallback` once `bound` milliseconds have passed. */
async function within<T>(
  promise: Promise<T>,
  bound: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<T>(resolve => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, bound);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ends the process tree of the shell `processId` in the distro with lib-host's shared script: TERM first, KILL after 5 s.
 * The second `wsl.exe` that runs it is ended at `bound`; the answer is whether the script confirmed with status 0.
 */
async function endTree(
  runner: WslRunner,
  distro: string,
  processId: number,
  bound: number,
): Promise<boolean> {
  const limit = new AbortController();
  const timer = setTimeout(() => {
    limit.abort();
  }, bound);
  try {
    const outcome = await runner.exec(
      {
        distro,
        folder: '~',
        program: 'sh',
        programArguments: ['-c', TREE_KILL_SCRIPT, 'sh', String(processId)],
        environment: {},
        input: {kind: 'none'},
        cancellation: limit.signal,
      },
      () => undefined,
    );
    return outcome.kind === 'exited' && outcome.status === 0;
  } finally {
    clearTimeout(timer);
  }
}

/** The channel over WSL. */
export function createWslHostChannel(ports: WslHostChannelPorts): HostChannel {
  const {runner, mapper, distro, logLine} = ports;
  return {
    runScript: async (request, onLine): Promise<ScriptOutcome> => {
      if (request.interpreter !== 'posixShell') {
        return failFrom(
          'spawnFailed',
          'a distro runs a script for the POSIX shell only',
        );
      }
      if (request.cancellation.aborted) {
        return failFrom('cancelled', 'cancelled before the run');
      }
      const planned = scriptInput(request);
      // A cancel ends the script's whole tree in the distro before it ends `wsl.exe`: the shell reports its process id as
      // its first line, and the shared script walks the tree from it. A cancel before the id is known waits for it.
      const inner = new AbortController();
      const bound = ports.treeKillBoundMs ?? TREE_KILL_BOUND_MS;
      const waiting: Array<(processId: number | undefined) => void> = [];
      const reported = new Promise<number | undefined>(resolve => {
        waiting.push(resolve);
      });
      function reportProcessId(processId: number | undefined): void {
        for (const resolve of waiting) {
          resolve(processId);
        }
      }
      const progress: {stopping: Promise<void> | undefined} = {
        stopping: undefined,
      };
      async function endScript(): Promise<void> {
        try {
          const target = await within(reported, bound, undefined);
          if (target === undefined) {
            logLine(
              `cancelled before the shell reported its process id in ${distro}: only wsl.exe is ended`,
            );
          } else if (!(await endTree(runner, distro, target, bound))) {
            logLine(
              `the tree of process ${String(target)} in ${distro} was not confirmed ended within ${String(bound)} ms: wsl.exe is ended anyway`,
            );
          }
        } finally {
          inner.abort();
        }
      }
      function onAbort(): void {
        progress.stopping = endScript().catch(() => undefined);
      }
      request.cancellation.addEventListener('abort', onAbort, {once: true});
      let seen = false;
      const outcome = await runner
        .exec(
          {
            distro,
            folder: '~',
            program: 'sh',
            programArguments: planned.program,
            environment: request.environment,
            input: planned.input,
            cancellation: inner.signal,
          },
          line => {
            if (!seen && PROCESS_ID.test(line)) {
              seen = true;
              reportProcessId(Number(line));
            } else {
              onLine(line);
            }
          },
        )
        .finally(() => {
          request.cancellation.removeEventListener('abort', onAbort);
        });
      reportProcessId(undefined);
      if (progress.stopping !== undefined) {
        await progress.stopping;
        return failFrom('cancelled', 'cancelled while the script ran');
      }
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
