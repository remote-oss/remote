/**
 * @fileoverview The host channel over `docker exec -i`: a script is given to a shell in the container ahead of its input, and a file is streamed into `tar -x` as a one-file archive. Environment values reach the container through
 * the `docker` process's own environment, never through its arguments.
 */

import {once} from 'node:events';
import {access, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {
  BoundedLines,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  JOINED_ERRORS,
  PROCESS_ID,
  REPORT_PROCESS_ID,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import type {EngineHost, EngineProcess} from '../engine/engine-host.ts';
import {
  copyArguments,
  isEnvironmentName,
  scriptArguments,
  treeKillArguments,
} from './exec-arguments.ts';
import {exitOutcome} from './exec-failures.ts';
import {lineSplitter} from '../line-splitter.ts';
import {ustarHeader, ustarTrailer} from './tar-stream.ts';

/** How much of a file goes into one write. */
const PIECE = 64 * 1024;

/** The front of the container shell's program: its standard error joined to its output, then its own process id on a line. */
const SHELL_FRONT = JOINED_ERRORS + REPORT_PROCESS_ID;

/** How long the exec that ends a cancelled script's tree may take, in milliseconds: longer than the tree-kill script's own 5 s. */
const TREE_KILL_MILLISECONDS = 15_000;

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

/** What differs between the engines that carry the channel: the commands, where environment values travel, and what a kill means. */
export interface ExecCommands {
  /** The identity the channel reports: the container's id, or the pod's address. */
  identity: string;
  /** The arguments that run `front` and then the prelude, which evaluates the first `scriptByteCount` bytes of standard input. */
  script(
    environmentNames: readonly string[],
    scriptByteCount: number,
    front: string,
  ): string[];
  /** The arguments that end the process tree of the shell `processId` in the target. */
  treeKill(processId: number): string[];
  /** The arguments that unpack a tar archive from standard input into `directory`. */
  copy(directory: string): string[];
  /**
   * Where the environment values go: into the engine process's own environment (`process`), or ahead of the script as
   * `export` lines on standard input (`script`), for an engine that cannot pass a variable on.
   */
  environment: 'process' | 'script';
  /** The failure of a target that stopped during an operation, or nothing. */
  stopped(
    status: number | undefined,
    stderr: string,
    cancellation: AbortSignal,
  ): Promise<ReturnType<typeof failedWith> | undefined>;
}

/** The commands of the container `containerId`, whose commands run as `user`, over `engine`'s `docker`. */
function dockerExecCommands(
  engine: EngineHost,
  containerId: string,
  user: string,
): ExecCommands {
  return {
    identity: containerId,
    script: (names, count, front) =>
      scriptArguments(containerId, user, names, count, front),
    treeKill: processId => treeKillArguments(containerId, user, processId),
    copy: directory => copyArguments(containerId, user, directory),
    environment: 'process',
    stopped: (status, stderr, cancellation) =>
      stoppedDuring(engine, containerId, status, stderr, cancellation),
  };
}

/** The host channel of the container `containerId`, whose commands run as `user`. */
export function execChannelOf(
  engine: EngineHost,
  containerId: string,
  user: string,
  files: ExecFiles = nodeFiles,
): HostChannel {
  return execChannelOver(
    engine,
    dockerExecCommands(engine, containerId, user),
    files,
  );
}

/** The `export` lines that put `environment` ahead of a script; every name was checked, every value is single-quoted. */
function exportLines(environment: Readonly<Record<string, string>>): string {
  return Object.entries(environment)
    .map(
      ([name, value]) => `export ${name}='${value.replaceAll("'", "'\\''")}'\n`,
    )
    .join('');
}

/**
 * Ends the process tree of the shell `shellId` in the target, through a second exec that runs lib-host's tree-kill
 * script, and waits for it within a bound; a shell that has told no id has run nothing, and a failing exec leaves the
 * tree, which the cancel still reports.
 */
async function endTree(
  engine: EngineHost,
  commands: ExecCommands,
  shellId: number | undefined,
): Promise<void> {
  if (shellId === undefined) {
    return;
  }
  await engine
    .run(
      commands.treeKill(shellId),
      {kind: 'none'},
      {
        cancellation: AbortSignal.timeout(TREE_KILL_MILLISECONDS),
      },
    )
    .catch(() => undefined);
}

/** The host channel over `commands`, run through `engine`. */
export function execChannelOver(
  engine: EngineHost,
  commands: ExecCommands,
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
    const scriptBytes = Buffer.from(
      commands.environment === 'script'
        ? exportLines(request.environment) + request.script
        : request.script,
      'utf8',
    );
    const own = new AbortController();
    const spawned = await engine.spawn(
      commands.script(names, scriptBytes.length, SHELL_FRONT),
      {
        ...(commands.environment === 'process'
          ? {environment: request.environment}
          : {}),
        cancellation: own.signal,
      },
    );
    if (spawned.kind === 'failed') {
      return failedWith('spawnFailed', spawned.detail);
    }
    const {process} = spawned;
    let shellId: number | undefined;
    const report: {tell: (processId: number | undefined) => void} = {
      tell: () => undefined,
    };
    const reported = new Promise<number | undefined>(resolve => {
      report.tell = resolve;
    });
    const decoder = new StringDecoder('utf8');
    const lines = new BoundedLines(line => {
      if (shellId === undefined && PROCESS_ID.test(line)) {
        shellId = Number(line);
        report.tell(shellId);
      } else if (!isAborted(request.cancellation)) {
        onLine(line);
      }
    });
    process.stdout.on('data', (chunk: Buffer) => {
      lines.push(decoder.write(chunk));
    });
    const stderr = stderrTail(process);
    process.stdin.on('error', () => undefined);
    // The shell gets its program only once it has told its process id, so a cancel always has a tree to end.
    const feeding = reported
      .then(async known => {
        if (known === undefined || isAborted(request.cancellation)) {
          process.stdin.end();
          return;
        }
        await write(process, scriptBytes);
        if (request.input.kind === 'text') {
          await write(process, request.input.text);
        } else {
          await writeFile(process, request.input.localFile);
        }
        process.stdin.end();
      })
      .catch(() => undefined);
    let ending: Promise<void> | undefined;
    function endScript(): void {
      ending = endTree(engine, commands, shellId).then(() => {
        own.abort();
      });
    }
    if (isAborted(request.cancellation)) {
      // The request was cancelled while the shell was starting, before it could tell its id.
      endScript();
    } else {
      request.cancellation.addEventListener('abort', endScript, {once: true});
    }
    const status = await process.exited;
    // A signal shared by many runs must not end the tree of a shell that has ended.
    request.cancellation.removeEventListener('abort', endScript);
    report.tell(undefined);
    await feeding;
    lines.push(decoder.end());
    lines.flush();
    if (isAborted(request.cancellation)) {
      await ending;
      return failedWith('cancelled', 'cancelled while the script ran');
    }
    const tail = stderr();
    return (
      (await commands.stopped(status, tail, request.cancellation)) ??
      exitOutcome(status, tail, 'script')
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
    const spawned = await engine.spawn(commands.copy(directory), {
      cancellation: request.cancellation,
    });
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
    })().catch(() => undefined);
    const status = await process.exited;
    await feeding;
    if (isAborted(request.cancellation)) {
      return failedWith('cancelled', 'cancelled while the file was copied');
    }
    const tail = stderr();
    return (
      (await commands.stopped(status, tail, request.cancellation)) ??
      exitOutcome(status, tail, 'copy')
    );
  }

  return {
    runScript,
    copyToHost,
    identity: () => commands.identity,
    platformHint: () => 'linux',
  };
}
