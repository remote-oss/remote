/**
 * @fileoverview The Docker CLI on a remote host, reached through the host's exec server: a dev container opened from a
 * Remote - SSH window runs every `docker` there. The engine's variables go in the spawn's environment, which the host
 * merges onto its own, never in the arguments. The host is a POSIX one: the command starts under `sh`, which reports
 * the process id that a stop kills.
 */

import {PassThrough, Writable} from 'node:stream';
import type {ExecReadStream, ExecServer} from 'lib-server';
import type {
  EngineHost,
  EngineOptions,
  EngineProcess,
  EngineSpawn,
} from './engine-host.ts';
import {spawnedEngineHost} from './engine-runs.ts';

/** Prints the shell's own process id on a line of its own, then becomes the command its arguments name. */
const REPORTING_SCRIPT = 'printf "%s\\n" "$$"; exec "$@"';

/** A process id as the shell prints it. */
const PROCESS_ID = /^[1-9][0-9]*$/;

/** The longest first line read as a process id; a longer one without a line break is no process id. */
const LONGEST_REPORT = 32;

/** Why a spawn whose first line was no process id fails. */
const NO_PROCESS_ID = 'the command on the host did not report its process id';

/** What the host sends on a stream, and the process id its first line reported, if it was asked for one. */
interface HostOutput {
  output: PassThrough;
  processId: Promise<number | undefined>;
}

/**
 * A Node stream that carries what the host sends on `remote`, and ends when it does, whether `onEnd` resolves or
 * rejects. With `reporting`, the first line is the process id, which the stream leaves out.
 */
function outputOf(remote: ExecReadStream, reporting: boolean): HostOutput {
  const output = new PassThrough();
  const processId = new Promise<number | undefined>(report => {
    let head: Buffer | undefined = reporting ? Buffer.alloc(0) : undefined;
    const listening = remote.onDidReceiveMessage(data => {
      if (head === undefined) {
        output.write(Buffer.from(data));
        return;
      }
      head = Buffer.concat([head, Buffer.from(data)]);
      const lineEnd = head.indexOf('\n');
      if (lineEnd < 0 && head.length < LONGEST_REPORT) {
        return;
      }
      const line = lineEnd < 0 ? '' : head.subarray(0, lineEnd).toString();
      const rest = head.subarray(lineEnd + 1);
      head = undefined;
      report(PROCESS_ID.test(line) ? Number(line) : undefined);
      output.write(rest);
    });
    function close(): void {
      listening.dispose();
      report(undefined);
      output.end();
    }
    remote.onEnd.then(close, close);
  });
  return {output, processId};
}

/**
 * The `docker` named `dockerPath` on the exec server's host. A cancelled spawn and a kill end the process's standard
 * input and kill the process by the id it reported.
 */
export function execServerEngineHost(
  server: Pick<ExecServer, 'spawn' | 'kill'>,
  dockerPath: string,
): EngineHost {
  async function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    let command;
    try {
      command = await server.spawn(
        'sh',
        ['-c', REPORTING_SCRIPT, 'sh', dockerPath, ...argv],
        {env: {...options.environment}},
      );
    } catch (caught) {
      return {
        kind: 'failed',
        detail: caught instanceof Error ? caught.message : String(caught),
      };
    }
    const stdout = outputOf(command.stdout, true);
    const stderr = outputOf(command.stderr, false);
    const stdin = new Writable({
      write: (chunk: Buffer, encoding, done) => {
        command.stdin.write(new Uint8Array(chunk));
        done();
      },
      final: done => {
        command.stdin.end();
        done();
      },
    });
    function stop(): void {
      stdin.end();
      void stdout.processId
        .then(processId =>
          processId === undefined ? undefined : server.kill(processId),
        )
        .catch(() => undefined);
    }
    if (options.cancellation.aborted) {
      stop();
    }
    options.cancellation.addEventListener('abort', stop, {once: true});
    if ((await stdout.processId) === undefined) {
      stop();
      return {kind: 'failed', detail: NO_PROCESS_ID};
    }
    const process: EngineProcess = {
      stdin,
      stdout: stdout.output,
      stderr: stderr.output,
      exited: command.onExit.then(
        exit => exit.status,
        () => undefined,
      ),
      kill: stop,
    };
    return {kind: 'spawned', process};
  }

  return spawnedEngineHost(spawn);
}
