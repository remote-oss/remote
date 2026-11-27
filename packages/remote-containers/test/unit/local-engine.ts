/**
 * @fileoverview An engine whose programs run on this machine, in place of `docker exec` into a container: a spawn runs
 * its arguments directly, and its abort ends that one process alone, as ending the `docker` client ends only the client
 * and leaves what it started in the container. The channel's rows over it run the real shell, the real `ps` and the real
 * tree-kill script.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import {preludeCommand, TREE_KILL_SCRIPT} from 'lib-host';
import type {ExecCommands} from '../../src/exec/exec-channel.ts';
import type {
  EngineHost,
  EngineOptions,
  EngineRunOutcome,
  EngineSpawn,
} from '../../src/engine/engine-host.ts';

/** Starts `argv` here with piped streams, ended with SIGKILL, alone, when `options` is cancelled. */
function started(
  argv: readonly string[],
  options: EngineOptions,
): ChildProcess {
  const [program = '', ...programArguments] = argv;
  const child = spawn(program, programArguments, {
    env: {...process.env, ...options.environment},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  options.cancellation.addEventListener(
    'abort',
    () => {
      child.kill('SIGKILL');
    },
    {once: true},
  );
  return child;
}

/** The engine whose programs run here. */
export function localEngine(): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) =>
      new Promise<EngineRunOutcome>(settle => {
        const child = started(argv, options);
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.stdin?.end(input.kind === 'text' ? input.text : '');
        child.once('error', error => {
          settle({kind: 'failed', detail: error.message});
        });
        child.once('close', status => {
          settle({kind: 'ran', status: status ?? undefined, stdout, stderr});
        });
      }),
    spawn: (argv, options) => {
      const child = started(argv, options);
      return Promise.resolve<EngineSpawn>({
        kind: 'spawned',
        process: {
          stdin: child.stdin as NodeJS.WritableStream,
          stdout: child.stdout as NodeJS.ReadableStream,
          stderr: child.stderr as NodeJS.ReadableStream,
          exited: new Promise<number | undefined>(resolve => {
            child.once('close', status => {
              resolve(status ?? undefined);
            });
          }),
          kill: () => {
            child.kill('SIGKILL');
          },
        },
      });
    },
  };
}

/** The commands whose programs are the ones the container's would run under `shell`, with no `docker` before them. */
export function localCommandsOver(shell: string): ExecCommands {
  return {
    identity: 'this-machine',
    script: (names, count, front) => [
      'sh',
      '-c',
      front + preludeCommand(count),
    ],
    treeKill: processId => [
      shell,
      '-c',
      TREE_KILL_SCRIPT,
      'tree-kill',
      String(processId),
    ],
    copy: directory => ['tar', '-x', '-f', '-', '-C', directory],
    environment: 'process',
    stopped: () => Promise.resolve(undefined),
  };
}
