/**
 * @fileoverview A host channel whose host is this machine, so that the rows of what runs scripts on a host run them
 * under a real POSIX shell: a script runs under `sh -c` with its text or file on standard input, and a copy is a copy
 * of a file.
 */

import {spawn} from 'node:child_process';
import {copyFileSync, createReadStream, mkdirSync} from 'node:fs';
import path from 'node:path';
import {failFrom, type HostChannel, type ScriptOutcome} from 'lib-host';

/** The channel of this machine; each script runs with `base` and its request's variables. */
export function localHostChannel(
  base: Readonly<Record<string, string>>,
): HostChannel {
  return {
    runScript: (request, onLine) =>
      new Promise<ScriptOutcome>(resolve => {
        const child = spawn('sh', ['-c', request.script], {
          env: {...base, ...request.environment},
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let pending = '';
        child.stdout.on('data', (chunk: Buffer) => {
          pending += chunk.toString();
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          lines.forEach(onLine);
        });
        child.once('close', (status: number | null) => {
          if (pending !== '') {
            onLine(pending);
          }
          resolve({kind: 'exited', status: status ?? 1});
        });
        child.once('error', error => {
          resolve(failFrom('spawnFailed', error));
        });
        if (request.input.kind === 'text') {
          child.stdin.end(request.input.text);
        } else {
          createReadStream(request.input.localFile).pipe(child.stdin);
        }
      }),
    copyToHost: request => {
      try {
        mkdirSync(path.dirname(request.remotePath), {recursive: true});
        copyFileSync(request.localFile, request.remotePath);
        return Promise.resolve({kind: 'copied'});
      } catch (caught) {
        return Promise.resolve(failFrom('copyFailed', caught));
      }
    },
    identity: () => 'this machine',
    platformHint: () => 'linux',
  };
}
