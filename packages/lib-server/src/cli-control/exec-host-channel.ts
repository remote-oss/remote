/**
 * @fileoverview lib-host's channel over a host's exec server: a script runs as `sh` on the host through one spawn, and
 * a file is written through the exec server's file system. Only a number is on a command line: the script travels as
 * a prelude ahead of its input on standard input, and the added variables go in the spawn's environment. The shell
 * reports its process id on its first line, which a cancellation kills. Every failure is a value of lib-host's closed
 * set, with the exec server's message as detail; nothing is retried here.
 */

import {createReadStream} from 'node:fs';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  type PlatformHint,
  preludeCommand,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import {type ExecServer, ExecServerFailure} from './exec-server.ts';

/** A name an environment variable can have. */
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A process id as the shell prints it. */
const PROCESS_ID = /^[1-9][0-9]*$/;

/** The command before the prelude: the shell's own process id, on a line of its own. */
const REPORT_PROCESS_ID = 'printf "%s\\n" "$$"; ';

/** The channel over `server`, whose host is `identity` on `platform`. */
export function execServerChannel(
  server: Pick<ExecServer, 'spawn' | 'kill' | 'fs'>,
  identity: string,
  platform: PlatformHint,
): HostChannel {
  return {
    runScript: (request, onLine) => runOn(server, request, onLine),
    copyToHost: request => copyOn(server, request),
    identity: () => identity,
    platformHint: () => platform,
  };
}

/** Runs `request` as `sh` on the host, its output lines to `onLine` before the outcome. */
async function runOn(
  server: Pick<ExecServer, 'spawn' | 'kill'>,
  request: ScriptRequest,
  onLine: (line: string) => void,
): Promise<ScriptOutcome> {
  const {cancellation} = request;
  if (cancellation.aborted) {
    return failFrom('cancelled', 'cancelled before the run');
  }
  if (request.interpreter === 'powershell') {
    return failFrom(
      'spawnFailed',
      'a PowerShell script does not run over an exec server',
    );
  }
  const badName = Object.keys(request.environment).find(
    name => !ENVIRONMENT_NAME.test(name),
  );
  if (badName !== undefined) {
    return failFrom(
      'spawnFailed',
      `'${badName}' is not a name an environment variable can have`,
    );
  }
  const {input} = request;
  if (input.kind === 'file' && !(await exists(input.localFile))) {
    return failFrom('spawnFailed', `no such local file: ${input.localFile}`);
  }
  const prelude = `${request.script}\n`;
  let command: Awaited<ReturnType<ExecServer['spawn']>>;
  try {
    command = await server.spawn(
      'sh',
      [
        '-c',
        REPORT_PROCESS_ID + preludeCommand(Buffer.byteLength(prelude, 'utf8')),
      ],
      {env: {...request.environment}},
    );
  } catch (failure) {
    return failFrom(kindOf(failure, 'spawnFailed'), failure);
  }
  let processId: number | undefined;
  const lines = new Lines(line => {
    if (processId === undefined && PROCESS_ID.test(line)) {
      processId = Number(line);
    } else if (!cancellation.aborted) {
      onLine(line);
    }
  });
  command.stdout.onDidReceiveMessage(data => {
    lines.push(data);
  });
  const outputEnded = command.stdout.onEnd.then(
    () => undefined,
    () => undefined,
  );
  void feed(command.stdin, prelude, input);
  const cancelled = new Promise<'cancelled'>(resolve => {
    cancellation.addEventListener(
      'abort',
      () => {
        resolve('cancelled');
      },
      {once: true},
    );
  });
  const ended = await Promise.race([
    command.onExit.then(
      exit => ({kind: 'exit' as const, status: exit.status}),
      (failure: unknown) => ({kind: 'lost' as const, failure}),
    ),
    cancelled,
  ]);
  if (ended === 'cancelled') {
    if (processId !== undefined) {
      await server.kill(processId).catch(() => undefined);
    }
    return failFrom('cancelled', 'the run was cancelled');
  }
  if (ended.kind === 'lost') {
    return failFrom(kindOf(ended.failure, 'channelClosed'), ended.failure);
  }
  await outputEnded;
  lines.flush();
  return {kind: 'exited', status: ended.status};
}

/** Writes the prelude, then the input, to the command's standard input, and closes it. */
async function feed(
  stdin: {write(data: Uint8Array): void; end(): void},
  prelude: string,
  input: ScriptRequest['input'],
): Promise<void> {
  stdin.write(Buffer.from(prelude, 'utf8'));
  if (input.kind === 'text') {
    stdin.write(Buffer.from(input.text, 'utf8'));
  } else {
    for await (const chunk of createReadStream(input.localFile)) {
      stdin.write(chunk as Buffer);
    }
  }
  stdin.end();
}

/** Places the local file of `request` at its remote path through the exec server's file system. */
async function copyOn(
  server: Pick<ExecServer, 'fs'>,
  request: CopyRequest,
): Promise<CopyOutcome> {
  const {cancellation} = request;
  if (cancellation.aborted) {
    return failFrom('cancelled', 'cancelled before the copy');
  }
  if (!(await exists(request.localFile))) {
    return failFrom('copyFailed', `no such local file: ${request.localFile}`);
  }
  try {
    await server.fs.mkdirp(path.posix.dirname(request.remotePath));
    const written = await server.fs.write(request.remotePath);
    for await (const chunk of createReadStream(request.localFile)) {
      if (isAborted(cancellation)) {
        written.stream.end();
        return failFrom('cancelled', 'the copy was cancelled');
      }
      written.stream.write(chunk as Buffer);
    }
    written.stream.end();
    await written.done;
  } catch (failure) {
    return failFrom(kindOf(failure, 'copyFailed'), failure);
  }
  return {kind: 'copied'};
}

/** The failure kind of `failure`: a closed control connection, or `otherwise`. */
function kindOf(
  failure: unknown,
  otherwise: ChannelFailureKind,
): ChannelFailureKind {
  return failure instanceof ExecServerFailure &&
    failure.failure.kind === 'closed'
    ? 'channelClosed'
    : otherwise;
}

/** Whether `signal` has been aborted by now, which a check made earlier can't tell. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Whether the local file `file` exists. */
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The lines of a byte stream, each told without its line end once it is whole. */
class Lines {
  private pending = '';
  private readonly decoder = new TextDecoder();
  private readonly onLine: (line: string) => void;

  /** Lines told to `onLine`. */
  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  /** Takes the next bytes, telling each line they complete. */
  push(data: Uint8Array): void {
    const text = this.pending + this.decoder.decode(data, {stream: true});
    const lastEnd = text.lastIndexOf('\n');
    this.pending = text.slice(lastEnd + 1);
    for (const line of lastEnd < 0 ? [] : text.slice(0, lastEnd).split('\n')) {
      this.onLine(line.replace(/\r$/u, ''));
    }
  }

  /** Tells the last line, when it had no line end. */
  flush(): void {
    this.pending += this.decoder.decode();
    if (this.pending !== '') {
      this.onLine(this.pending.replace(/\r$/u, ''));
      this.pending = '';
    }
  }
}
