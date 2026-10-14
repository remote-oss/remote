/**
 * @fileoverview The host channel over `docker exec -i`: a script is piped to `sh -s` in the container with its input
 * after it, and a file is streamed into `tar -x` as a one-file archive. Environment values reach the container through
 * the `docker` process's own environment, never through its arguments.
 */

import {once} from 'node:events';
import {access, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import type {EngineHost, EngineProcess} from '../engine/engine-host.ts';
import {
  copyArguments,
  isEnvironmentName,
  scriptArguments,
} from './exec-arguments.ts';
import {exitOutcome} from './exec-failures.ts';
import {ustarHeader, ustarTrailer} from './tar-stream.ts';

/** How much of a file goes into one write. */
const PIECE = 64 * 1024;

/** How many of stderr's last lines a failure keeps. */
const STDERR_LINES = 20;

/** What the channel asks of the client's files. */
export interface ExecFiles {
  exists(file: string): Promise<boolean>;
}

/** The client's files over `node:fs`. */
const nodeFiles: ExecFiles = {
  exists: file =>
    access(file).then(
      () => true,
      () => false,
    ),
};

/** The failure of `kind` as the outcome of either operation. */
function failedWith(
  kind: 'spawnFailed' | 'cancelled' | 'copyFailed' | 'channelClosed',
  detail: string,
): {kind: 'failed'; failure: {kind: typeof kind; detail: string}} {
  return {kind: 'failed', failure: {kind, detail}};
}

/** Whether the signal has ended by now; read through a call because it changes while an operation runs. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Writes `data` and waits for the stream to take more, unless the process has ended. */
async function write(
  process: EngineProcess,
  data: Uint8Array | string,
): Promise<void> {
  if (process.stdin.write(data)) {
    return;
  }
  // A process that ended while the write waited will never drain: its end is the answer.
  await Promise.race([once(process.stdin, 'drain'), process.exited]);
}

/** Writes the local file in pieces, each after the stream took the last. */
async function writeFile(
  process: EngineProcess,
  localFile: string,
): Promise<void> {
  for await (const piece of createReadStream(localFile, {
    highWaterMark: PIECE,
  })) {
    await write(process, piece as Buffer);
  }
}

/** Splits what a stream prints into lines: `\n` ends a line, and a `\r` before it goes. */
function lineSplitter(onLine: (line: string) => void): {
  push(chunk: Buffer): void;
  flush(): void;
} {
  let pending = '';
  return {
    push: chunk => {
      const text = pending + chunk.toString('utf8');
      const lineEnd = text.lastIndexOf('\n');
      pending = text.slice(lineEnd + 1);
      const complete = lineEnd < 0 ? [] : text.slice(0, lineEnd).split('\n');
      for (const part of complete) {
        onLine(part.endsWith('\r') ? part.slice(0, -1) : part);
      }
    },
    flush: () => {
      if (pending !== '') {
        onLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending);
        pending = '';
      }
    },
  };
}

/** Follows what the process prints on stderr; the function gives its last lines, joined by newlines. */
function stderrTail(process: EngineProcess): () => string {
  const lines: string[] = [];
  const splitter = lineSplitter(line => {
    lines.push(line);
    lines.splice(0, lines.length - STDERR_LINES);
  });
  process.stderr.on('data', (chunk: Buffer) => {
    splitter.push(chunk);
  });
  return () => {
    splitter.flush();
    return lines.join('\n');
  };
}

/**
 * The failure of a container that stopped during an operation, or nothing: a status that signals a kill (137 or 143)
 * with nothing on stderr is the script's own result or a stopped container, and one `docker inspect` tells which.
 */
async function stoppedDuring(
  engine: EngineHost,
  containerId: string,
  status: number | undefined,
  stderr: string,
  cancellation: AbortSignal,
): Promise<ReturnType<typeof failedWith> | undefined> {
  if ((status !== 137 && status !== 143) || stderr !== '') {
    return undefined;
  }
  const inspected = await engine.run(
    ['inspect', '--type', 'container', '-f', '{{.State.Running}}', containerId],
    {kind: 'none'},
    {cancellation},
  );
  const gone =
    inspected.kind === 'ran' &&
    (inspected.stdout.trim() === 'false' ||
      inspected.stderr.includes('No such container'));
  return gone
    ? failedWith(
        'channelClosed',
        `the container stopped during the operation (exit ${String(status)})`,
      )
    : undefined;
}

/** The host channel of the container `containerId`, whose commands run as `user`. */
export function execChannelOf(
  engine: EngineHost,
  containerId: string,
  user: string,
  files: ExecFiles = nodeFiles,
): HostChannel {
  async function runScript(
    request: ScriptRequest,
    onLine: (line: string) => void,
  ): Promise<ScriptOutcome> {
    if (request.cancellation.aborted) {
      return failedWith('cancelled', 'cancelled before the script ran');
    }
    if (request.interpreter !== 'posixShell') {
      return failedWith(
        'spawnFailed',
        'the powershell interpreter is not available in a container',
      );
    }
    const names = Object.keys(request.environment);
    const badName = names.find(name => !isEnvironmentName(name));
    if (badName !== undefined) {
      return failedWith(
        'spawnFailed',
        `the environment variable name "${badName}" is not a valid name`,
      );
    }
    if (
      request.input.kind === 'file' &&
      !(await files.exists(request.input.localFile))
    ) {
      return failedWith(
        'spawnFailed',
        `the input file ${request.input.localFile} does not exist`,
      );
    }
    const scriptBytes = Buffer.from(request.script, 'utf8');
    const spawned = await engine.spawn(
      scriptArguments(containerId, user, names, scriptBytes.length),
      {environment: request.environment, cancellation: request.cancellation},
    );
    if (spawned.kind === 'failed') {
      return failedWith('spawnFailed', spawned.detail);
    }
    const {process} = spawned;
    const splitter = lineSplitter(line => {
      if (!isAborted(request.cancellation)) {
        onLine(line);
      }
    });
    process.stdout.on('data', (chunk: Buffer) => {
      splitter.push(chunk);
    });
    const stderr = stderrTail(process);
    process.stdin.on('error', () => undefined);
    const feeding = (async (): Promise<void> => {
      await write(process, scriptBytes);
      if (request.input.kind === 'text') {
        await write(process, request.input.text);
      } else {
        await writeFile(process, request.input.localFile);
      }
      process.stdin.end();
    })();
    const status = await process.exited;
    await feeding.catch(() => undefined);
    splitter.flush();
    if (isAborted(request.cancellation)) {
      return failedWith('cancelled', 'cancelled while the script ran');
    }
    const tail = stderr();
    return (
      (await stoppedDuring(
        engine,
        containerId,
        status,
        tail,
        request.cancellation,
      )) ?? exitOutcome(status, tail, 'script')
    );
  }

  async function copyToHost(request: CopyRequest): Promise<CopyOutcome> {
    if (request.cancellation.aborted) {
      return failedWith('cancelled', 'cancelled before the copy');
    }
    const directory = path.posix.dirname(request.remotePath);
    const name = path.posix.basename(request.remotePath);
    let header: Buffer;
    let size: number;
    try {
      size = (await stat(request.localFile)).size;
      header = ustarHeader(name, size);
    } catch (caught) {
      return failFrom('copyFailed', caught);
    }
    const spawned = await engine.spawn(
      copyArguments(containerId, user, directory),
      {cancellation: request.cancellation},
    );
    if (spawned.kind === 'failed') {
      return failedWith('spawnFailed', spawned.detail);
    }
    const {process} = spawned;
    const stderr = stderrTail(process);
    process.stdin.on('error', () => undefined);
    const feeding = (async (): Promise<void> => {
      await write(process, header);
      await writeFile(process, request.localFile);
      await write(process, ustarTrailer(size));
      process.stdin.end();
    })();
    const status = await process.exited;
    await feeding.catch(() => undefined);
    if (isAborted(request.cancellation)) {
      return failedWith('cancelled', 'cancelled while the file was copied');
    }
    const tail = stderr();
    return (
      (await stoppedDuring(
        engine,
        containerId,
        status,
        tail,
        request.cancellation,
      )) ?? exitOutcome(status, tail, 'copy')
    );
  }

  return {
    runScript,
    copyToHost,
    identity: () => containerId,
    platformHint: () => 'linux',
  };
}
