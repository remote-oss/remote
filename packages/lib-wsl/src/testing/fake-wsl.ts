/**
 * @fileoverview D4f, the fake `wsl.exe` for tests: a process spawner and a set of local files that play the answers a
 * test scripts, with the management outputs the specs show (UTF-16LE with a byte-order mark, or UTF-8), and the
 * `sh -c` prelude and `cat` of the host channel emulated as the distro would run them.
 */

import {createHash} from 'node:crypto';
import type {
  StartError,
  WslFiles,
  WslProcess,
  WslProcessSpawner,
  WslProcessSpecification,
  WslSession,
} from '../process-port.ts';

/** `text` as the bytes a management verb prints: UTF-16LE after a byte-order mark. */
export function utf16Output(text: string): Uint8Array {
  const body = Buffer.from(text, 'utf16le');
  return Uint8Array.from([0xff, 0xfe, ...body]);
}

/** `text` as the bytes a program in a distro prints: UTF-8. */
export function utf8Output(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** What the fake does for one started process. */
export type FakeRun =
  /** Prints, then exits with `status`. */
  | {
      kind: 'exits';
      stdout?: Uint8Array;
      stderr?: Uint8Array;
      status: number | undefined;
    }
  /** Cannot start: the spawner rejects with this error. */
  | {kind: 'failsToStart'; error: StartError}
  /** Prints the lowercase hex SHA-256 of what follows the `sh -c` prelude on its input, then exits 0. */
  | {kind: 'digestsInput'}
  /** Prints `lines`, then runs until it is killed. */
  | {kind: 'printsUntilKilled'; lines: readonly string[]}
  /** Reads its input to the end into the file named by the last argument, then exits 0. */
  | {kind: 'writesInput'}
  /** Reads its input to the end, then exits as `exits` says. */
  | {kind: 'afterInput'; then: Extract<FakeRun, {kind: 'exits'}>};

/** The fake's records, and the ports to give the runner. */
export interface FakeWsl {
  spawner: WslProcessSpawner;
  files: WslFiles;
  session: WslSession;
  /** Every process the spawner started or refused, in order. */
  readonly started: WslProcessSpecification[];
  /** The bytes each `writesInput` run was given, by the file it was named. */
  readonly written: Map<string, Uint8Array>;
  /** The local files, by path. */
  readonly local: Map<string, Uint8Array>;
}

/** The fake, deciding each run by `decide`. */
export function fakeWsl(
  decide: (specification: WslProcessSpecification) => FakeRun,
  session: Partial<WslSession> = {},
): FakeWsl {
  const started: WslProcessSpecification[] = [];
  const written = new Map<string, Uint8Array>();
  const local = new Map<string, Uint8Array>();
  const base: WslSession = {
    systemRoot: 'C:\\Windows',
    environment: {PATH: 'C:\\Windows\\System32'},
    ...session,
  };
  local.set(`${base.systemRoot ?? ''}\\System32\\wsl.exe`, new Uint8Array(0));

  /** The number of bytes of the `sh -c` prelude, from the command `preludeCommand` makes. */
  function preludeBytes(specification: WslProcessSpecification): number {
    const command = specification.programArguments.find(each =>
      each.includes('count='),
    );
    return Number(/count=(\d+)/.exec(command ?? '')?.[1] ?? 0);
  }

  function run(
    specification: WslProcessSpecification,
    behaviour: FakeRun,
  ): WslProcess {
    const outputs: Array<(chunk: Uint8Array) => void> = [];
    const errors: Array<(chunk: Uint8Array) => void> = [];
    const exits: Array<(status: number | undefined) => void> = [];
    const input: Uint8Array[] = [];
    let ended = false;
    function finish(status: number | undefined): void {
      if (!ended) {
        ended = true;
        for (const listener of exits) {
          listener(status);
        }
      }
    }
    function say(
      stdout: Uint8Array | undefined,
      stderr: Uint8Array | undefined,
      status: number | undefined,
    ): void {
      setImmediate(() => {
        for (const listener of outputs) {
          if (stdout !== undefined) {
            listener(stdout);
          }
        }
        for (const listener of errors) {
          if (stderr !== undefined) {
            listener(stderr);
          }
        }
        finish(status);
      });
    }
    function allInput(): Uint8Array {
      return Buffer.concat(input);
    }
    if (behaviour.kind === 'exits') {
      say(behaviour.stdout, behaviour.stderr, behaviour.status);
    } else if (behaviour.kind === 'printsUntilKilled') {
      setImmediate(() => {
        for (const listener of outputs) {
          listener(utf8Output(`${behaviour.lines.join('\n')}\n`));
        }
      });
    }
    return {
      onOutput: listener => outputs.push(listener),
      onError: listener => errors.push(listener),
      onExit: listener => exits.push(listener),
      write: chunk => {
        input.push(chunk);
        return Promise.resolve();
      },
      endInput: () => {
        if (behaviour.kind === 'digestsInput') {
          const content = allInput().subarray(preludeBytes(specification));
          say(
            utf8Output(
              `${createHash('sha256').update(content).digest('hex')}\n`,
            ),
            undefined,
            0,
          );
        } else if (behaviour.kind === 'writesInput') {
          written.set(
            String(specification.programArguments.at(-1)),
            allInput(),
          );
          say(undefined, undefined, 0);
        } else if (behaviour.kind === 'afterInput') {
          say(
            behaviour.then.stdout,
            behaviour.then.stderr,
            behaviour.then.status,
          );
        }
      },
      kill: () => {
        finish(undefined);
      },
    };
  }

  return {
    spawner: specification => {
      started.push(specification);
      const behaviour = decide(specification);
      if (behaviour.kind === 'failsToStart') {
        return Promise.reject(
          Object.assign(new Error(behaviour.error.message), {
            ...(behaviour.error.code === undefined
              ? {}
              : {code: behaviour.error.code}),
          }),
        );
      }
      return Promise.resolve(run(specification, behaviour));
    },
    files: {
      exists: file => Promise.resolve(local.has(file)),
      read: (file: string) => {
        const bytes = local.get(file) ?? new Uint8Array(0);
        return (async function* () {
          yield await Promise.resolve(bytes);
        })();
      },
    },
    session: base,
    started,
    written,
    local,
  };
}
