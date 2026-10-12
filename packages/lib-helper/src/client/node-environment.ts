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
import type {SpawnSpecification} from './spawn.ts';

/** Starts the process detached and lets it outlive this one; rejects when it cannot start. */
function nodeSpawner(specification: SpawnSpecification): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(specification.command, specification.commandArguments, {
      detached: specification.detached,
      stdio: specification.stdio,
      windowsHide: specification.windowsHide,
      env: specification.environment,
    });
    child.once('error', reject);
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
    spawn: nodeSpawner,
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
