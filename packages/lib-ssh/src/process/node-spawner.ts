/**
 * @fileoverview The process port on Node.js: a child process with piped standard streams, started with exactly the
 * environment it is given, and on POSIX as the leader of its own process group, which ends with it.
 */

import {spawn} from 'node:child_process';
import {
  endProcessGroup,
  type GroupSystem,
  NODE_GROUP_SYSTEM,
  reapProcessGroup,
} from './process-group.ts';
import type {
  ProcessHandle,
  ProcessSpawner,
  ProcessSpecification,
} from './ports.ts';

/** How long a process's standard streams may stay open after its exit before another process is taken to hold them. */
const STDIO_DRAIN_MILLISECONDS = 500;

/**
 * The spawner over `system`, which ends the groups and trees of the clients it starts. A start rejects with the
 * system's error, which carries a code, when the client cannot start.
 */
export function createNodeProcessSpawner(system: GroupSystem): ProcessSpawner {
  return (specification: ProcessSpecification) =>
    spawnClient(specification, system);
}

function spawnClient(
  specification: ProcessSpecification,
  system: GroupSystem,
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
        detached: system.posix,
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
        reapProcessGroup(child.pid, system);
        drain = setTimeout(() => {
          settle(status);
          releaseStreams();
        }, STDIO_DRAIN_MILLISECONDS);
      });
      child.once('close', settle);
      resolve({
        ...(child.pid === undefined ? {} : {processId: child.pid}),
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
          // A Windows client is ended by the tree kill while it runs, which a kill before it would defeat.
          if (system.posix) {
            child.kill();
          }
          endProcessGroup(child.pid, system);
          releaseStreams();
        },
      });
    });
  });
}

/** Starts a client process on Node.js. */
export const nodeProcessSpawner = createNodeProcessSpawner(NODE_GROUP_SYSTEM);
