/**
 * @fileoverview A process on the exec server's host as Node streams: the host's POSIX shell starts the command and
 * reports the id that a stop ends it by, so that a cancelled spawn and a kill end the process however far it got. The
 * command's environment goes in the spawn's options, which the host merges onto its own, never in the arguments.
 */

import {PassThrough, Writable} from 'node:stream';
import type {ExecReadStream, ExecServer} from './exec-server.ts';

/** A process id as the shell prints it. */
const PROCESS_ID = /^[1-9][0-9]*$/;

/** The longest first line read as a process id; a longer one without a line break is no process id. */
const LONGEST_REPORT = 32;

/** Why a spawn whose first line was no process id fails. */
const NO_PROCESS_ID = 'the command on the host did not report its process id';

/** The script that prints its shell's process id on a line of its own, then becomes the command its arguments name. */
export const REPORTING_SCRIPT = 'printf "%s\\n" "$$"; exec "$@"';

/** A process on the host, with its streams and its end. */
export interface HostProcess {
  /** The id the host reported: the process's own, which is the command's once the shell has become it. */
  processId: number;
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  /** Settles once with the exit status, or undefined when the connection failed or the process was signalled. */
  exited: Promise<number | undefined>;
  /** Ends the input and ends the process by its id, unless it has exited. */
  kill(): void;
}

/** A spawn that started, or why it couldn't. */
export type HostSpawn =
  {kind: 'spawned'; process: HostProcess} | {kind: 'failed'; detail: string};

/** What to start on the host. */
export interface HostSpawnRequest {
  /** The program and its arguments, which the script runs as `"$@"`. */
  command: readonly string[];
  /** Variables added to the host's own for this process; one with no value is left out. */
  environment: Readonly<Record<string, string | undefined>> | undefined;
  /** Ends the process, and ends it as soon as its id is known when it is aborted before. */
  cancellation: AbortSignal;
  /** Ends the process the host reported `processId` for; a kill without it only ends the input. */
  endById?: (processId: number) => Promise<void>;
}

/** `environment` without the variables that have no value. */
function definedValues(
  environment: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

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
 * Starts the command of `request` on `server`'s host under the shell. A cancelled spawn and a kill end the process's
 * standard input and end the process by the id it reported; a spawn whose first line was no id fails.
 */
export async function spawnOnHost(
  server: Pick<ExecServer, 'spawn'>,
  request: HostSpawnRequest,
): Promise<HostSpawn> {
  let command;
  try {
    command = await server.spawn(
      'sh',
      ['-c', REPORTING_SCRIPT, 'sh', ...request.command],
      {env: definedValues(request.environment)},
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
      try {
        command.stdin.write(new Uint8Array(chunk));
      } catch (caught) {
        done(caught instanceof Error ? caught : new Error(String(caught)));
        return;
      }
      done();
    },
    final: done => {
      command.stdin.end();
      done();
    },
  });
  let ended = false;
  const exited = command.onExit.then(
    exit => exit.status,
    () => undefined,
  );
  function kill(): void {
    stdin.end();
    void stdout.processId
      .then(processId =>
        processId === undefined || ended || request.endById === undefined
          ? undefined
          : request.endById(processId),
      )
      .catch(() => undefined);
  }
  // Once the command has exited its id may name another process, so a later stop only ends the input.
  void exited.then(() => {
    ended = true;
    request.cancellation.removeEventListener('abort', kill);
  });
  if (request.cancellation.aborted) {
    kill();
  }
  request.cancellation.addEventListener('abort', kill, {once: true});
  const processId = await stdout.processId;
  if (processId === undefined) {
    kill();
    return {kind: 'failed', detail: NO_PROCESS_ID};
  }
  return {
    kind: 'spawned',
    process: {
      processId,
      stdin,
      stdout: stdout.output,
      stderr: stderr.output,
      exited,
      kill,
    },
  };
}
