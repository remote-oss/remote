/**
 * @fileoverview The client side's surroundings on Node.js: real files, sockets, processes and timers.
 */

import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {nodeEndpointPort} from '../endpoint/node-endpoint.ts';
import {runtimeFolder} from '../endpoint/path.ts';
import {nodeFilePort} from '../registry/node-file-port.ts';
import type {ClientEnvironment} from './acquire.ts';
import type {Spawner} from './spawn.ts';

/** What a spawner needs of a process it started: Node.js's child process, or a fake in tests. */
export interface StartedProcess {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'spawn', listener: () => void): unknown;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  unref(): void;
}

/** Starts a process, as Node.js's `spawn` does. */
export type ProcessSpawn = (
  command: string,
  commandArguments: readonly string[],
  options: {
    detached: boolean;
    stdio: 'ignore';
    windowsHide: boolean;
    env: Readonly<Record<string, string | undefined>>;
  },
) => StartedProcess;

/**
 * A spawner over `spawnProcess`. It starts the process detached and lets it outlive this one, resolving once it has
 * started; with `waitForExit`, it resolves only once the process exits with 0. It rejects when the process cannot
 * start, or when a process it waits for exits otherwise.
 */
export function spawnerOf(spawnProcess: ProcessSpawn): Spawner {
  return specification =>
    new Promise((resolve, reject) => {
      const child = spawnProcess(
        specification.command,
        specification.commandArguments,
        {
          detached: specification.detached,
          stdio: specification.stdio,
          windowsHide: specification.windowsHide,
          env: specification.environment,
        },
      );
      child.once('error', reject);
      if (specification.waitForExit === true) {
        child.once('exit', code => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`the launcher exited with ${String(code)}`));
          }
        });
        return;
      }
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
}

/** A timer on Node.js's clock: calls `callback` after `milliseconds`; the returned function cancels it. */
export function nodeTimer(
  milliseconds: number,
  callback: () => void,
): () => void {
  const handle = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(handle);
  };
}

/** The waits of a client, which the consumer names: they are its policy, not this library's. */
export type ClientWaits = Pick<
  ClientEnvironment,
  'helloLimitMilliseconds' | 'startLimitMilliseconds' | 'retryMilliseconds'
>;

/** The client environment of this process, with `runtime` the editor's executable and the consumer's `waits`. */
export function nodeClientEnvironment(
  runtime: string,
  waits: ClientWaits,
): ClientEnvironment {
  return {
    files: nodeFilePort,
    endpoints: nodeEndpointPort(),
    spawn: spawnerOf(spawn),
    timer: nodeTimer,
    clock: Date.now,
    newNonce: () => randomBytes(16).toString('hex'),
    runtime,
    endpointFolder: runtimeFolder(process.platform, process.env, tmpdir()),
    processId: process.pid,
    parentEnvironment: process.env,
    ...waits,
  };
}
