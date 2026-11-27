/**
 * @fileoverview The host channel of the machine it runs on: a script runs under the local `sh`, and a file is copied
 * with the local file system. A script's standard error is joined to its standard output inside the shell, so the lines
 * arrive in the order they were written. The script runs in a process group of its own: a cancel signals the group with
 * TERM, and with KILL when the shell outlives the grace period, and once the shell has ended with KILL for what is
 * left of the group, so a process the script detached into a session of its own is not touched. A line is handed on
 * at the shared bound when it has not ended by then, and the input waits for the shell to take each chunk. The channel logs
 * nothing, so it has no secret to mask: the values of `secretVariables` reach the script's environment and nowhere else.
 */

import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, constants as fileConstants, stat} from 'node:fs/promises';
import {constants as osConstants} from 'node:os';
import {Readable, type Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  type PlatformHint,
  type ScriptInput,
  type ScriptOutcome,
  type ScriptRequest,
} from './host-channel.ts';
import {BoundedLines, JOINED_ERRORS} from './channel-rules.ts';

/** What the channel is made of. */
export interface LocalChannelOptions {
  /** The key that names this machine in locks and records. */
  identity: string;
  /** The operating system as `process.platform` names it, read by the caller's composition root. */
  platform: NodeJS.Platform;
  /** The POSIX shell that runs the scripts; `/bin/sh` when absent. */
  shell?: string;
  /** Signals the process group `leader`; throws when the group is gone. The signal to the group when absent. */
  signalGroup?: (leader: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  /** How long a cancelled shell may take to end on TERM before it is killed, in milliseconds; five seconds when absent. */
  graceMilliseconds?: number;
}

/** The text a PowerShell script is refused with: this machine's agent runs POSIX scripts only. */
const POSIX_ONLY = 'this host runs POSIX scripts only';

/** The platform hint of each operating system the channel knows. */
const HINTS: Readonly<Partial<Record<NodeJS.Platform, PlatformHint>>> = {
  linux: 'linux',
  darwin: 'macOS',
};

/** Whether `error` is the abort of a cancelled operation. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** The exit status of a shell that ended: its own, or 128 plus the number of the signal that ended it. */
function statusOf(code: number | null, signal: NodeJS.Signals | null): number {
  return signal === null ? Number(code) : 128 + osConstants.signals[signal];
}

/** The size of each chunk of a text the script reads, in characters. */
const INPUT_CHUNK = 64 * 1024;

/** The chunks of `text` that the script's input is written in. */
function chunksOf(text: string): string[] {
  return Array.from(
    {length: Math.ceil(text.length / INPUT_CHUNK)},
    (skipped, index) =>
      text.slice(index * INPUT_CHUNK, (index + 1) * INPUT_CHUNK),
  );
}

/** Writes `input` to `stdin` one chunk at a time, each waiting for the shell to take the one before; a shell that stops reading is no failure. */
function feed(stdin: Writable, input: ScriptInput): void {
  const source =
    input.kind === 'file'
      ? createReadStream(input.localFile)
      : Readable.from(chunksOf(input.text));
  pipeline(source, stdin).catch(() => undefined);
}

/** The channel of this machine. */
export function localChannel(options: LocalChannelOptions): HostChannel {
  const shell = options.shell ?? '/bin/sh';
  const signalGroup =
    options.signalGroup ??
    ((leader: number, signal: 'SIGTERM' | 'SIGKILL') => {
      process.kill(-leader, signal);
    });
  const grace = options.graceMilliseconds ?? 5000;
  return {
    runScript: async (request, onLine): Promise<ScriptOutcome> => {
      if (request.interpreter !== 'posixShell') {
        return failFrom('spawnFailed', POSIX_ONLY);
      }
      if (request.cancellation.aborted) {
        return failFrom('cancelled', 'the script was cancelled before it ran');
      }
      if (request.input.kind === 'file') {
        try {
          await stat(request.input.localFile);
        } catch (caught) {
          return failFrom('spawnFailed', caught);
        }
      }
      return runShell({shell, signalGroup, grace}, request, onLine);
    },
    copyToHost: async (request: CopyRequest): Promise<CopyOutcome> => {
      if (request.cancellation.aborted) {
        return failFrom('cancelled', 'the copy was cancelled before it ran');
      }
      try {
        await pipeline(
          createReadStream(request.localFile),
          createWriteStream(request.remotePath),
          {signal: request.cancellation},
        );
        return {kind: 'copied'};
      } catch (caught) {
        return isAbort(caught)
          ? failFrom('cancelled', 'the copy was cancelled')
          : failFrom('copyFailed', caught);
      }
    },
    identity: () => options.identity,
    platformHint: () => HINTS[options.platform] ?? 'unknown',
    clientPathOnHost: async localFile => {
      try {
        await access(localFile, fileConstants.R_OK);
        return localFile;
      } catch {
        return undefined;
      }
    },
  };
}

/** What a run of a script is done with. */
interface Shell {
  shell: string;
  signalGroup: (leader: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  grace: number;
}

/** Runs the script of `request` under the shell, and gives how it ended. */
function runShell(
  {shell, signalGroup, grace}: Shell,
  request: ScriptRequest,
  onLine: (line: string) => void,
): Promise<ScriptOutcome> {
  return new Promise<ScriptOutcome>(settle => {
    const child = spawn(shell, ['-c', JOINED_ERRORS + request.script], {
      env: {...process.env, ...request.environment},
      detached: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const reader = new BoundedLines(line => {
      if (!cancelled) {
        onLine(line);
      }
    });
    function signal(name: 'SIGTERM' | 'SIGKILL'): void {
      if (child.pid !== undefined) {
        try {
          signalGroup(child.pid, name);
        } catch {
          // The group has ended already.
        }
      }
    }
    function cancel(): void {
      cancelled = true;
      signal('SIGTERM');
      killTimer = setTimeout(() => {
        signal('SIGKILL');
      }, grace);
    }
    child.once('error', error => {
      settle(failFrom('spawnFailed', error));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      reader.push(chunk);
    });
    feed(child.stdin, request.input);
    request.cancellation.addEventListener('abort', cancel, {once: true});
    child.once('exit', () => {
      if (cancelled) {
        clearTimeout(killTimer);
        signal('SIGKILL');
        settle(failFrom('cancelled', 'the script was cancelled'));
      }
    });
    child.once('close', (code, exitSignal) => {
      request.cancellation.removeEventListener('abort', cancel);
      reader.flush();
      settle(
        cancelled
          ? failFrom('cancelled', 'the script was cancelled')
          : {kind: 'exited', status: statusOf(code, exitSignal)},
      );
    });
  });
}
