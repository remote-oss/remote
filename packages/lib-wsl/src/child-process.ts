/**
 * @fileoverview The process port over a started Node child process: its streams, its exit and its kill, with a write
 * that waits for the stream's own callback, which is the drain.
 */

import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import type {WslProcess} from './process-port.ts';

/** The process port of `child`, which has started. */
export function wslProcessOf(
  child: ChildProcessWithoutNullStreams,
): WslProcess {
  // A write after the input closed reports through its own callback; the stream's error event says it again.
  child.stdin.on('error', () => undefined);
  return {
    onOutput: listener =>
      child.stdout.on('data', (chunk: Buffer) => {
        listener(new Uint8Array(chunk));
      }),
    onError: listener =>
      child.stderr.on('data', (chunk: Buffer) => {
        listener(new Uint8Array(chunk));
      }),
    onExit: listener => {
      child.once('close', (status: number | null) => {
        listener(status ?? undefined);
      });
    },
    write: data =>
      new Promise<void>((written, failed) => {
        child.stdin.write(data, caught => {
          if (caught === undefined || caught === null) {
            written();
          } else {
            failed(caught);
          }
        });
      }),
    endInput: () => {
      child.stdin.end();
    },
    kill: () => {
      child.kill();
    },
  };
}
