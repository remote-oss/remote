/**
 * @fileoverview The process port on Node.js: a child process with piped standard streams, started with exactly the
 * environment it is given, and on POSIX as the leader of its own process group, which ends with it.
 */

import {spawn} from 'node:child_process';
import {sep} from 'node:path';
import type {ProcessHandle, ProcessSpecification} from './ports.ts';

/** How long a process's standard streams may stay open after its exit before another process is taken to hold them. */
const STDIO_DRAIN_MILLISECONDS = 500;

/** Whether a client can lead a process group of its own, which only a POSIX system has; the path separator tells it. */
const OWNS_GROUP = sep === '/';

/** Ends every process in the group that `leader` leads, which is what a client's own children (ProxyCommand, ProxyJump) are in. */
export function endProcessGroup(leader: number | undefined): void {
  if (!OWNS_GROUP || leader === undefined) {
    return;
  }
  try {
    process.kill(-leader, 'SIGKILL');
  } catch {
    // The group is already gone.
  }
}

/** Starts a client process; rejects with the system's error, which carries a code, when it cannot start it. */
export function nodeProcessSpawner(
  specification: ProcessSpecification,
): Promise<ProcessHandle> {
  return new Promise<ProcessHandle>((resolve, reject) => {
    const child = spawn(
      specification.program,
      [...specification.programArguments],
      {
        env: {...specification.environment},
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // On POSIX the client leads its own process group, so ending the group ends what it started.
        detached: OWNS_GROUP,
      },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // The system's error carries its code and message, which is what a StartError is.
    child.once('error', reject);
    child.once('spawn', () => {
      // A write to a closed pipe is reported through the process's exit, not as an unhandled error.
      child.stdin.on('error', () => undefined);
      const exitListeners: Array<(status: number | undefined) => void> = [];
      let exited = false;
      let drain: NodeJS.Timeout | undefined;
      function releaseStreams(): void {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }
      function settle(status: number | null): void {
        clearTimeout(drain);
        if (exited) {
          return;
        }
        exited = true;
        for (const listener of exitListeners) {
          listener(status ?? undefined);
        }
      }
      child.once('exit', (status: number | null) => {
        endProcessGroup(child.pid);
        drain = setTimeout(() => {
          settle(status);
          releaseStreams();
        }, STDIO_DRAIN_MILLISECONDS);
      });
      child.once('close', settle);
      resolve({
        onOutput: listener => child.stdout.on('data', listener),
        onError: listener => child.stderr.on('data', listener),
        onExit: listener => {
          exitListeners.push(listener);
        },
        write: data =>
          new Promise<void>(resolve => {
            // The callback runs once the data is flushed or the pipe has failed; a failure shows in the exit.
            child.stdin.write(data, () => {
              resolve();
            });
          }),
        endInput: () => child.stdin.end(),
        kill: () => {
          child.kill();
          endProcessGroup(child.pid);
          releaseStreams();
        },
      });
    });
  });
}
