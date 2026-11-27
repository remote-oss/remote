/**
 * @fileoverview lib-host's channel over a host's exec server: a script runs as `sh` on the host through one spawn, and
 * a file is written through the exec server's file system. Only a number is on a command line: the script travels as
 * a prelude ahead of its input on standard input, and the added variables go in the spawn's environment. The shell
 * joins its standard error to its output and reports its process id on its first line. A cancellation ends the shell's
 * whole tree with lib-host's tree-kill script, run through the exec server. Nothing reaches the shell's input before it
 * has reported its process id, so an input that can't be read ends the tree before the script could read part of it.
 * Inputs and copies go in chunks of at most 64 KiB, with a turn of the event loop between them: the exec server's write
 * stream gives no drain signal. Every failure is a value of lib-host's closed set, with the exec server's message as
 * detail; nothing is retried here.
 */

import {EventEmitter, once} from 'node:events';
import {createReadStream} from 'node:fs';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {
  BoundedLines,
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  JOINED_ERRORS,
  LONGEST_PENDING_LINE,
  type PlatformHint,
  preludeCommand,
  type ScriptOutcome,
  type ScriptRequest,
  TREE_KILL_SCRIPT,
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
  server: Pick<ExecServer, 'spawn' | 'fs'>,
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
  server: Pick<ExecServer, 'spawn'>,
  request: ScriptRequest,
  onLine: (line: string) => void,
): Promise<ScriptOutcome> {
  const {cancellation} = request;
  if (cancellation.aborted) {
    return failFrom('cancelled', 'cancelled before the run');
  }
  const cancelled = new Promise<'cancelled'>(resolve => {
    cancellation.addEventListener(
      'abort',
      () => {
        resolve('cancelled');
      },
      {once: true},
    );
  });
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
        JOINED_ERRORS +
          REPORT_PROCESS_ID +
          preludeCommand(Buffer.byteLength(prelude, 'utf8')),
      ],
      {env: {...request.environment}},
    );
  } catch (failure) {
    return failFrom(kindOf(failure, 'spawnFailed'), failure);
  }
  let processId: number | undefined;
  const shellEvents = new EventEmitter();
  const reported = once(shellEvents, 'reported').then(
    ([shellId]) => shellId as number,
  );
  const decoder = new TextDecoder();
  const lines = new BoundedLines(line => {
    if (processId === undefined && PROCESS_ID.test(line)) {
      processId = Number(line);
      shellEvents.emit('reported', processId);
    } else if (!cancellation.aborted) {
      onLine(line);
    }
  });
  command.stdout.onDidReceiveMessage(data => {
    lines.push(decoder.decode(data, {stream: true}));
  });
  const outputEnded = command.stdout.onEnd.then(
    () => undefined,
    () => undefined,
  );
  const unfed = reported.then(shellId =>
    feedUnlessCancelled(command.stdin, prelude, input, cancellation).then(
      () => new Promise<never>(ignoreSettling),
      (failure: unknown) => ({kind: 'unfed' as const, failure, shellId}),
    ),
  );
  const ended = await Promise.race([
    command.onExit.then(
      exit => ({kind: 'exit' as const, status: exit.status}),
      (failure: unknown) => ({kind: 'lost' as const, failure}),
    ),
    cancelled,
    unfed,
  ]);
  if (ended === 'cancelled') {
    if (processId !== undefined) {
      await endTree(server, processId);
    }
    command.stdin.end();
    return failFrom('cancelled', 'the run was cancelled');
  }
  if (ended.kind === 'unfed') {
    await endTree(server, ended.shellId);
    command.stdin.end();
    return failFrom('spawnFailed', ended.failure);
  }
  if (ended.kind === 'lost') {
    return failFrom(kindOf(ended.failure, 'channelClosed'), ended.failure);
  }
  await outputEnded;
  lines.push(decoder.decode());
  lines.flush();
  return {kind: 'exited', status: ended.status};
}

/**
 * Feeds the shell, or nothing when the run was cancelled first: a shell cancelled before it reported its process id gets
 * no program, and the end of its input then ends it.
 */
async function feedUnlessCancelled(
  stdin: {write(data: Uint8Array): void; end(): void},
  prelude: string,
  input: ScriptRequest['input'],
  cancellation: AbortSignal,
): Promise<void> {
  if (!cancellation.aborted) {
    await feed(stdin, prelude, input);
  }
}

/** Ends the process tree of `processId` on the host, waiting for lib-host's tree-kill script; a failure leaves it. */
async function endTree(
  server: Pick<ExecServer, 'spawn'>,
  processId: number,
): Promise<void> {
  try {
    const killing = await server.spawn('sh', [
      '-c',
      TREE_KILL_SCRIPT,
      'tree-kill',
      String(processId),
    ]);
    killing.stdin.end();
    await killing.onExit;
  } catch {
    // The host's tree is out of reach; the run still reports its cancel.
  }
}

/**
 * The chunks of the local file `file`, each of at most 64 KiB, a turn of the event loop before each one after the first.
 * @yields {Buffer} Each chunk, in the file's order.
 */
async function* chunksOf(file: string): AsyncGenerator<Buffer> {
  let first = true;
  for await (const chunk of createReadStream(file, {
    highWaterMark: LONGEST_PENDING_LINE,
  })) {
    if (!first) {
      await new Promise(resolve => setImmediate(resolve));
    }
    first = false;
    yield chunk as Buffer;
  }
}

/** Leaves a promise that waits for nothing pending; the race it joins ends another way. */
function ignoreSettling(): void {
  // A promise that never settles: the run's exit or cancellation decides it.
}

/** Writes the prelude, then the input, to the command's standard input, and closes it; rejects when the input can't be read. */
async function feed(
  stdin: {write(data: Uint8Array): void; end(): void},
  prelude: string,
  input: ScriptRequest['input'],
): Promise<void> {
  stdin.write(Buffer.from(prelude, 'utf8'));
  if (input.kind === 'text') {
    stdin.write(Buffer.from(input.text, 'utf8'));
  } else {
    for await (const chunk of chunksOf(input.localFile)) {
      stdin.write(chunk);
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
    for await (const chunk of chunksOf(request.localFile)) {
      if (isAborted(cancellation)) {
        written.stream.end();
        return failFrom('cancelled', 'the copy was cancelled');
      }
      written.stream.write(chunk);
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
