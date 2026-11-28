/**
 * @fileoverview An exec server whose commands are processes of this machine, so that the rows of what runs on a host
 * can run its scripts under a real shell.
 */

import {spawn} from 'node:child_process';
import type {Readable} from 'node:stream';
import type {ExecReadStream, ExecServer} from '../cli-control/exec-server.ts';
import {hostStream} from './fake-exec-host.ts';

/**
 * An exec server whose commands are processes of this machine, so that the scripts run under a real shell. Each runs
 * with `base` and the spawn's own variables.
 */
export function localExecServer(
  base: Readonly<Record<string, string>>,
): Pick<ExecServer, 'spawn'> {
  return {
    spawn: (command, argumentList, options) => {
      const child = spawn(command, argumentList, {
        env: {...base, ...options?.env},
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      function streamOf(readable: Readable): ExecReadStream {
        const stream = hostStream();
        readable.on('data', (chunk: Buffer) => {
          stream.send(chunk.toString());
        });
        readable.on('end', () => {
          stream.end();
        });
        return stream.stream;
      }
      return Promise.resolve({
        stdin: {
          write: data => {
            child.stdin.write(data);
          },
          end: () => {
            child.stdin.end();
          },
        },
        stdout: streamOf(child.stdout),
        stderr: streamOf(child.stderr),
        onExit: new Promise(resolve => {
          child.once('close', (status: number | null) => {
            resolve({status: status ?? 1});
          });
        }),
      });
    },
  };
}
