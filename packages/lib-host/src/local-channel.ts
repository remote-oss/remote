/**
 * @fileoverview The host channel of the machine it runs on: a script runs under the local `sh`, and a file is copied
 * with the local file system. A script's standard error is joined to its standard output inside the shell, so the lines
 * arrive in the order they were written. The channel logs nothing, so it has no secret to mask: the values of
 * `secretVariables` reach the script's environment and nowhere else.
 */

import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, constants as fileConstants, stat} from 'node:fs/promises';
import {constants as osConstants} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  type PlatformHint,
  type ScriptOutcome,
  type ScriptRequest,
} from './host-channel.ts';

/** What the channel is made of. */
export interface LocalChannelOptions {
  /** The key that names this machine in locks and records. */
  identity: string;
  /** The operating system as `process.platform` names it, read by the caller's composition root. */
  platform: NodeJS.Platform;
  /** The POSIX shell that runs the scripts; `/bin/sh` when absent. */
  shell?: string;
  /** Ends the process group `leader` with SIGKILL; throws when the group is gone. The signal to the group when absent. */
  endGroup?: (leader: number) => void;
}

/** The text a PowerShell script is refused with: this machine's agent runs POSIX scripts only. */
const POSIX_ONLY = 'this host runs POSIX scripts only';

/** The shell's own redirection of standard error into standard output, ahead of the script. */
const JOIN_ERROR_INTO_OUTPUT = 'exec 2>&1\n';

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

/** Delivers the lines of an output stream, in chunks that may split a line anywhere, to `onLine`. */
function lineReader(onLine: (line: string) => void): {
  write(chunk: string): void;
  end(): void;
} {
  let pending = '';
  return {
    write(chunk) {
      const text = pending + chunk;
      const end = text.lastIndexOf('\n') + 1;
      pending = text.slice(end);
      for (const line of text.slice(0, end).split('\n').slice(0, -1)) {
        onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      }
    },
    end() {
      if (pending !== '') {
        onLine(pending);
      }
    },
  };
}

/** The channel of this machine. */
export function localChannel(options: LocalChannelOptions): HostChannel {
  const shell = options.shell ?? '/bin/sh';
  const endGroup =
    options.endGroup ?? ((leader: number) => process.kill(-leader, 'SIGKILL'));
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
      return runShell(shell, endGroup, request, onLine);
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

/** Runs the script of `request` under `shell`, and gives how it ended. */
function runShell(
  shell: string,
  endGroup: (leader: number) => void,
  request: ScriptRequest,
  onLine: (line: string) => void,
): Promise<ScriptOutcome> {
  return new Promise<ScriptOutcome>(settle => {
    const child = spawn(
      shell,
      ['-c', JOIN_ERROR_INTO_OUTPUT + request.script],
      {
        env: {...process.env, ...request.environment},
        detached: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let cancelled = false;
    const reader = lineReader(line => {
      if (!cancelled) {
        onLine(line);
      }
    });
    function cancel(): void {
      cancelled = true;
      if (child.pid !== undefined) {
        try {
          endGroup(child.pid);
        } catch {
          // The group has ended already, and its close settles the run.
        }
      }
    }
    child.once('error', error => {
      settle(failFrom('spawnFailed', error));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      reader.write(chunk);
    });
    child.stdin.on('error', () => undefined);
    if (request.input.kind === 'text') {
      child.stdin.end(request.input.text);
    } else {
      createReadStream(request.input.localFile).pipe(child.stdin);
    }
    request.cancellation.addEventListener('abort', cancel, {once: true});
    child.once('close', (code, signal) => {
      request.cancellation.removeEventListener('abort', cancel);
      reader.end();
      settle(
        cancelled
          ? failFrom('cancelled', 'the script was cancelled')
          : {kind: 'exited', status: statusOf(code, signal)},
      );
    });
  });
}
