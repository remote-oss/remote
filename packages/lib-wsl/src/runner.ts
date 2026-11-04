/**
 * @fileoverview D1, the runner of `wsl.exe`: where it is, its management verbs with their output decoded, and a
 * program run in a distro through `exec`. Every run is one process with an argument list and no shell; none is
 * retried; and the values of the added environment never reach a command line or a log.
 */

import {decodeManagementOutput} from './decode.ts';
import {LineDecoder} from './line-decoder.ts';
import type {
  StartError,
  WslFiles,
  WslProcess,
  WslProcessSpawner,
  WslSession,
} from './process-port.ts';

/** Why a run of `wsl.exe` did not give its result. */
export type WslFailureKind =
  | 'wslMissing'
  | 'wslNeedsUpdate'
  | 'spawnFailed'
  | 'cancelled'
  | 'distroUnknown'
  | 'distroUnregistered'
  | 'startFailed';

/** A run that failed: its kind, and the message `wsl.exe` or the system gave. */
export interface WslFailure {
  kind: WslFailureKind;
  detail: string;
}

/** A run that could not give its result. */
export interface RunFailed {
  kind: 'failed';
  failure: WslFailure;
}

/** The management verbs of `wsl.exe` that area D uses. */
export type ManageVerb =
  'status' | 'version' | 'list' | 'listOnline' | 'install' | 'setDefault';

/** A management verb with its operands (the distro name of `install` and `setDefault`). */
export interface ManageRequest {
  verb: ManageVerb;
  operands: readonly string[];
  cancellation: AbortSignal;
}

/** A management verb that ran: its decoded text and its exit status. */
export interface ManageRan {
  kind: 'ran';
  text: string;
  status: number;
}

/** What goes to the standard input of a program run in a distro: nothing, a text, or a file after a text. */
export type ExecInput =
  | {kind: 'none'}
  | {kind: 'text'; text: string}
  | {kind: 'file'; prefix: string; localFile: string};

/** A program to run in a distro. */
export interface ExecRequest {
  /** The registered spelling of the distro's name; never empty. */
  distro: string;
  /** Run as this user (`-u`). Only the root install of remote-containers' Install Docker names one; otherwise absent. */
  user?: string;
  /** The working folder (`~` or a path); the distro's own default when absent. */
  folder?: string;
  program: string;
  programArguments: readonly string[];
  /** Variables added for this run, passed through `WSLENV`. */
  environment: Readonly<Record<string, string>>;
  input: ExecInput;
  cancellation: AbortSignal;
}

/** A program that ran to its end. Its status is a result for the caller to interpret. */
export interface ExecExited {
  kind: 'exited';
  status: number;
}

/** The runner of `wsl.exe`. */
export interface WslRunner {
  /** The `wsl.exe` to run, or `wslMissing`. */
  locate(): Promise<{kind: 'located'; path: string} | RunFailed>;
  /** Runs a management verb and decodes its output. */
  manage(request: ManageRequest): Promise<ManageRan | RunFailed>;
  /** Runs a program in a distro; each output line goes to `onLine` before the outcome settles. */
  exec(
    request: ExecRequest,
    onLine: (line: string) => void,
  ): Promise<ExecExited | RunFailed>;
}

/** The arguments of each management verb, before its operands. */
const VERB_ARGUMENTS: Readonly<Record<ManageVerb, readonly string[]>> = {
  status: ['--status'],
  version: ['--version'],
  list: ['--list', '--verbose'],
  listOnline: ['--list', '--online'],
  install: ['--install', '-d'],
  setDefault: ['--set-default'],
};

/** What an inbox `wsl.exe` prints for a verb it does not have; its verbs after 2019 print the real answer. */
const UNKNOWN_VERB = /invalid command line argument/i;

/** The exit status with which `wsl.exe` reports its own failure: -1, which a process reports unsigned. */
const WSL_FAILED_STATUSES: readonly number[] = [-1, 0xffffffff];

/**
 * What `wsl.exe` prints when it, and not the program, failed, and the failure it means. These texts are the English
 * ones of the current release (provisional, contracts D1); a text that matches none leaves the exit status as the
 * program's own.
 */
const EXEC_ERRORS: ReadonlyArray<readonly [RegExp, WslFailureKind]> = [
  [/There is no distribution with the supplied name/i, 'distroUnknown'],
  [
    /WSL_E_DISTRO_NOT_FOUND|distribution (?:does not exist|is not registered)/i,
    'distroUnregistered',
  ],
  [
    /Wsl\/(?:Service\/)?(?:CreateInstance|Start)|could not be started/i,
    'startFailed',
  ],
];

/** How much of a run's output is kept to classify a failure of `wsl.exe` itself, in bytes. */
const CLASSIFY_BYTES = 8192;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What the runner is made of. */
export interface WslRunnerPorts {
  spawner: WslProcessSpawner;
  files: WslFiles;
  session: WslSession;
}

/** The system's error code and message of a failure to start a process. */
function startDetail(caught: unknown): StartError {
  if (caught instanceof Error) {
    return {
      message: caught.message,
      ...('code' in caught && typeof caught.code === 'string'
        ? {code: caught.code}
        : {}),
    };
  }
  return {message: String(caught)};
}

/** A failed run of `kind`. */
function failed(kind: WslFailureKind, detail: string): RunFailed {
  return {kind: 'failed', failure: {kind, detail}};
}

/** The bytes of two pieces, joined. */
function joined(first: Uint8Array, second: Uint8Array): Uint8Array {
  const both = new Uint8Array(first.length + second.length);
  both.set(first);
  both.set(second, first.length);
  return both;
}

/** How a process that was watched ended. */
type Ending = {kind: 'exit'; status: number | undefined} | {kind: 'cancelled'};

/** Runs `wsl.exe` through `ports`. */
export function createWslRunner(ports: WslRunnerPorts): WslRunner {
  const {spawner, files, session} = ports;

  async function locate(): Promise<
    {kind: 'located'; path: string} | RunFailed
  > {
    if (session.systemRoot !== undefined) {
      const system = `${session.systemRoot}\\System32\\wsl.exe`;
      if (await files.exists(system)) {
        return {kind: 'located', path: system};
      }
    }
    const folders = (session.environment.PATH ?? session.environment.Path ?? '')
      .split(';')
      .filter(folder => folder !== '');
    for (const folder of folders) {
      const candidate = `${folder.replace(/\\$/, '')}\\wsl.exe`;
      if (await files.exists(candidate)) {
        return {kind: 'located', path: candidate};
      }
    }
    return failed(
      'wslMissing',
      'wsl.exe is neither in System32 nor on the PATH',
    );
  }

  /** Starts `program` with `programArguments`, or why it cannot start. */
  async function start(
    program: string,
    programArguments: readonly string[],
    environment: Readonly<Record<string, string>>,
  ): Promise<{kind: 'started'; process: WslProcess} | RunFailed> {
    try {
      return {
        kind: 'started',
        process: await spawner({program, programArguments, environment}),
      };
    } catch (caught) {
      const error = startDetail(caught);
      return failed(
        error.code === 'ENOENT' ? 'wslMissing' : 'spawnFailed',
        error.message,
      );
    }
  }

  /** Waits for the process to exit, or ends it when the caller cancels. */
  function supervise(
    handle: WslProcess,
    cancellation: AbortSignal,
  ): Promise<Ending> {
    return new Promise(resolve => {
      handle.onExit(status => {
        cancellation.removeEventListener('abort', cancel);
        resolve({kind: 'exit', status});
      });
      function cancel(): void {
        resolve({kind: 'cancelled'});
        handle.kill();
      }
      cancellation.addEventListener('abort', cancel, {once: true});
    });
  }

  async function manage(
    request: ManageRequest,
  ): Promise<ManageRan | RunFailed> {
    if (request.cancellation.aborted) {
      return failed('cancelled', 'cancelled before the run');
    }
    const located = await locate();
    if (located.kind === 'failed') {
      return located;
    }
    const started = await start(
      located.path,
      [...VERB_ARGUMENTS[request.verb], ...request.operands],
      session.environment,
    );
    if (started.kind === 'failed') {
      return started;
    }
    const {process: handle} = started;
    let output: Uint8Array = new Uint8Array(0);
    handle.onOutput(chunk => {
      output = joined(output, chunk);
    });
    handle.onError(chunk => {
      output = joined(output, chunk);
    });
    handle.endInput();
    const ending = await supervise(handle, request.cancellation);
    if (ending.kind === 'cancelled') {
      return failed('cancelled', 'cancelled while wsl.exe ran');
    }
    const text = decodeManagementOutput(output);
    if (ending.status === undefined) {
      return failed('spawnFailed', 'wsl.exe ended by a signal');
    }
    if (ending.status !== 0 && UNKNOWN_VERB.test(text)) {
      return failed('wslNeedsUpdate', text.trim());
    }
    return {kind: 'ran', text, status: ending.status};
  }

  /** The arguments that run the program in the distro. */
  function execArguments(request: ExecRequest): string[] {
    return [
      '-d',
      request.distro,
      ...(request.user === undefined ? [] : ['-u', request.user]),
      ...(request.folder === undefined ? [] : ['--cd', request.folder]),
      '--exec',
      request.program,
      ...request.programArguments,
    ];
  }

  /** The environment of the run: the session's, the added variables, and `WSLENV` naming them. */
  function execEnvironment(
    added: Readonly<Record<string, string>>,
  ): Record<string, string> {
    const names = Object.keys(added);
    const inherited = session.environment.WSLENV;
    return {
      ...session.environment,
      ...added,
      ...(names.length === 0
        ? {}
        : {
            WSLENV: [...(inherited === undefined ? [] : [inherited]), ...names]
              .filter(each => each !== '')
              .join(':'),
          }),
    };
  }

  /** Writes the input of a run to its process, then closes it; a failure shows in the process's exit. */
  async function feed(handle: WslProcess, input: ExecInput): Promise<void> {
    try {
      if (input.kind === 'text') {
        await handle.write(new TextEncoder().encode(input.text));
      } else if (input.kind === 'file') {
        await handle.write(new TextEncoder().encode(input.prefix));
        for await (const chunk of files.read(input.localFile)) {
          await handle.write(chunk);
        }
      }
    } catch {
      // The process ended before it read its input; its exit says how.
    }
    handle.endInput();
  }

  /** The failure `wsl.exe` itself reported in `rawOutput`, if the text names one. */
  function reportedFailure(rawOutput: Uint8Array): RunFailed | undefined {
    const text = decodeManagementOutput(rawOutput);
    const match = EXEC_ERRORS.find(([pattern]) => pattern.test(text));
    return match === undefined ? undefined : failed(match[1], text.trim());
  }

  async function exec(
    request: ExecRequest,
    onLine: (line: string) => void,
  ): Promise<ExecExited | RunFailed> {
    const {cancellation} = request;
    if (cancellation.aborted) {
      return failed('cancelled', 'cancelled before the run');
    }
    const badName = Object.keys(request.environment).find(
      name => !ENVIRONMENT_NAME.test(name),
    );
    if (badName !== undefined) {
      return failed(
        'spawnFailed',
        `'${badName}' is not a name an environment variable can have`,
      );
    }
    if (
      request.input.kind === 'file' &&
      !(await files.exists(request.input.localFile))
    ) {
      return failed(
        'spawnFailed',
        `no such local file: ${request.input.localFile}`,
      );
    }
    const located = await locate();
    if (located.kind === 'failed') {
      return located;
    }
    const started = await start(
      located.path,
      execArguments(request),
      execEnvironment(request.environment),
    );
    if (started.kind === 'failed') {
      return started;
    }
    const {process: handle} = started;
    let delivering = true;
    let kept: Uint8Array = new Uint8Array(0);
    const lines = new LineDecoder(line => {
      if (delivering) {
        onLine(line);
      }
    });
    const errorLines = new LineDecoder(line => {
      if (delivering) {
        onLine(line);
      }
    });
    function keep(chunk: Uint8Array): void {
      if (kept.length < CLASSIFY_BYTES) {
        kept = joined(kept, chunk.subarray(0, CLASSIFY_BYTES - kept.length));
      }
    }
    handle.onOutput(chunk => {
      keep(chunk);
      lines.push(chunk);
    });
    handle.onError(chunk => {
      keep(chunk);
      errorLines.push(chunk);
    });
    void feed(handle, request.input);
    const ending = await supervise(handle, cancellation);
    if (ending.kind === 'cancelled') {
      delivering = false;
      return failed('cancelled', 'cancelled while the program ran');
    }
    lines.flush();
    errorLines.flush();
    if (ending.status === undefined) {
      return failed('spawnFailed', 'wsl.exe ended by a signal');
    }
    return (
      (WSL_FAILED_STATUSES.includes(ending.status)
        ? reportedFailure(kept)
        : undefined) ?? {kind: 'exited', status: ending.status}
    );
  }

  return {locate, manage, exec};
}
