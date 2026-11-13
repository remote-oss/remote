/**
 * @fileoverview lib-wsl's process, file and session ports on this machine: a program is started with an argument
 * list and never through a shell, files are read from the local disk, and the session is this process's own.
 */

import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {access} from 'node:fs/promises';
import type {
  WslFiles,
  WslProcess,
  WslProcessSpawner,
  WslSession,
} from 'lib-wsl';

/** Starts `program` with its arguments and environment; rejects with the system's code and message when it cannot. */
export function localSpawner(
  specification: Parameters<WslProcessSpawner>[0],
): Promise<WslProcess> {
  return new Promise<WslProcess>((resolve, reject) => {
    const child = spawn(
      specification.program,
      [...specification.programArguments],
      {
        env: {...specification.environment},
        shell: false,
        windowsHide: true,
      },
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      // A write after the input closed reports through its own callback; the stream's error event says it again.
      child.stdin.on('error', () => undefined);
      resolve({
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
      });
    });
  });
}

/** The local disk. */
export const localFiles: WslFiles = {
  exists: file =>
    access(file).then(
      () => true,
      () => false,
    ),
  read: file => createReadStream(file),
};

/** This process's session: its `SystemRoot` and environment. */
export function localSession(
  environment: Readonly<Record<string, string | undefined>>,
): WslSession {
  const defined = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {systemRoot: defined.SystemRoot, environment: defined};
}
