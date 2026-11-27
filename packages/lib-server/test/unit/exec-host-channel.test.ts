import {deepStrictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finished} from 'node:stream/promises';
import {
  channelContractCases,
  LARGE_COPY_LENGTH,
  LONG_LINE_LENGTH,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {localProcesses} from 'lib-host/testing/local-processes';
import {execServerChannel} from '../../src/cli-control/exec-host-channel.ts';
import {
  type ExecReadStream,
  type ExecServer,
  ExecServerFailure,
} from '../../src/cli-control/exec-server.ts';

/** The members of an exec server the channel uses. */
type ChannelServer = Pick<ExecServer, 'spawn' | 'fs'>;

/** A read stream over the `data` and `end` of a local process's output. */
function readStreamOf(output: NodeJS.ReadableStream): ExecReadStream {
  return {
    onDidReceiveMessage: listener => {
      output.on('data', listener);
      return {
        dispose: () => {
          output.off('data', listener);
        },
      };
    },
    onEnd: new Promise(resolve => {
      output.once('end', resolve);
    }),
  };
}

/** An exec server whose spawns are local processes and whose file system is the local one. */
function localExecServer(): ChannelServer {
  return {
    spawn: (command, argumentList, options) => {
      const child = spawn(command, argumentList, {
        env: {...process.env, ...options?.env},
      });
      return Promise.resolve({
        stdin: {
          write: data => {
            child.stdin.write(data);
          },
          end: () => {
            child.stdin.end();
          },
        },
        stdout: readStreamOf(child.stdout),
        stderr: readStreamOf(child.stderr),
        onExit: new Promise(resolve => {
          child.once('close', code => {
            resolve({status: code ?? -1});
          });
        }),
      });
    },
    // eslint-disable-next-line id-length -- the exec server's member
    fs: {
      mkdirp: async (folder: string) => {
        await mkdir(folder, {recursive: true});
      },
      write: (file: string) => {
        const output = createWriteStream(file);
        return Promise.resolve({
          stream: {
            write: (data: Uint8Array) => {
              output.write(data);
            },
            end: () => {
              output.end();
            },
          },
          done: finished(output),
        });
      },
    } as unknown as ExecServer['fs'],
  };
}

/** The error of a control connection that closed. */
function closed(): ExecServerFailure {
  return new ExecServerFailure({kind: 'closed'});
}

/** `server` with its first spawns failing with `failures`, one each, in order. */
function failingSpawns(
  server: ChannelServer,
  ...failures: Error[]
): ChannelServer {
  return {
    ...server,
    spawn: (...spawnArguments) => {
      const failure = failures.shift();
      return failure === undefined
        ? server.spawn(...spawnArguments)
        : Promise.reject(failure);
    },
  };
}

/** `server` whose file system fails with `failure` at the step `step`. */
function failingFiles(
  server: ChannelServer,
  step: 'write' | 'done',
  failure: Error,
): ChannelServer {
  return {
    ...server,
    // eslint-disable-next-line id-length -- the exec server's member
    fs: {
      ...server.fs,
      write: async file => {
        if (step === 'done') {
          const written = await server.fs.write(file);
          return {
            ...written,
            done: written.done.then(() => Promise.reject(failure)),
          };
        }
        throw failure;
      },
    },
  };
}

/** The commands that print `lines`, one each. */
function printing(lines: readonly string[]): string[] {
  return lines.map(line => `printf '%s\\n' '${line}'`);
}

/** The script that plays `scenario` out on a real shell. */
function scriptOf(scenario: ContractScenario): string {
  switch (scenario.kind) {
    case 'printsLines':
      return [
        ...printing(scenario.lines),
        `exit ${String(scenario.status)}`,
      ].join('; ');
    case 'printsUntilCancelled':
    case 'streamsUntilCancelled':
      return [...printing(scenario.lines), 'sleep 30'].join('; ');
    case 'digestsInput':
      return "sha256sum | cut -d ' ' -f 1";
    case 'backgroundsThenWaits':
      return `sleep 40 & printf '%s\\n' "$!"; wait`;
    case 'detachesThenWaits':
      return `(sleep 40 >/dev/null 2>&1 & printf '%s\\n' "$!"); sleep 30`;
    case 'printsBothStreams':
      return "printf 'out one\\n'; printf 'err one\\n' >&2; printf 'out two\\n'";
    case 'printsLongLine':
      return `head -c ${String(LONG_LINE_LENGTH)} /dev/zero | tr '\\0' x`;
    default:
      return 'true';
  }
}

describe('host channel over an exec server: the lib-host contract', function () {
  this.timeout(20000);
  let folder: string;
  let localFile: string;

  before(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'exec-channel-'));
    // The contract copies one folder in; the channel no longer makes that folder.
    await mkdir(path.join(folder, 'copied'));
  });

  after(async () => {
    await rm(folder, {recursive: true, force: true});
  });

  const harness: ChannelHarness = {
    scriptFailures: ['channelClosed', 'spawnFailed'],
    copyFailures: ['copyFailed', 'channelClosed'],
    reachesClientFiles: false,
    processes: localProcesses,
    boundedCopy: {
      kind: 'notApplicable',
      reason: "the exec server's write stream gives no drain signal",
    },
    stage: async (scenario): Promise<StagedChannel> => {
      localFile = path.join(folder, `input-${String(Math.random())}`);
      const content =
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(
              scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 4096,
            );
      if (scenario.kind !== 'missingInputFile') {
        await writeFile(localFile, content);
      }
      let server = localExecServer();
      if (scenario.kind === 'scriptFails') {
        server = failingSpawns(
          server,
          scenario.failure === 'channelClosed' ? closed() : new Error('EMFILE'),
        );
      } else if (scenario.kind === 'failsThenSucceeds') {
        server = failingSpawns(
          server,
          scenario.failure === 'channelClosed' ? closed() : new Error('EMFILE'),
        );
      } else if (scenario.kind === 'copyFails') {
        server =
          scenario.failure === 'channelClosed'
            ? failingFiles(server, 'write', closed())
            : failingFiles(server, 'write', new Error('EACCES'));
      }
      return {
        channel: execServerChannel(server, 'ssh-remote+host', 'linux'),
        script: {
          script: scriptOf(scenario),
          interpreter: 'posixShell',
          environment: {},
          input: stagedInputOf(scenario, localFile),
        },
        copy: {localFile, remotePath: path.join(folder, 'copied', 'archive')},
      };
    },
  };

  for (const contractCase of channelContractCases(harness)) {
    it(
      contractCase.name,
      contractCase.pending === true ? undefined : contractCase.check,
    );
  }
});

describe('host channel over an exec server', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'exec-channel-'));
  });

  afterEach(async () => {
    await rm(folder, {recursive: true, force: true});
  });

  /** A run of `script` with `environment`, its lines and its outcome. */
  async function ranScript(
    script: string,
    environment: Record<string, string> = {},
    interpreter: 'posixShell' | 'powershell' = 'posixShell',
  ): Promise<[string[], unknown]> {
    const lines: string[] = [];
    const outcome = await execServerChannel(
      localExecServer(),
      'ssh-remote+host',
      'linux',
    ).runScript(
      {
        script,
        interpreter,
        environment,
        input: {kind: 'text', text: ''},
        cancellation: new AbortController().signal,
      },
      line => lines.push(line),
    );
    return [lines, outcome];
  }

  it('gives the script its variables through the environment, never on a command line, and a last line with no end', async () => {
    deepStrictEqual(
      await ranScript('printf "%s|%s" "$GREETING" "$0"', {
        GREETING: 'hello there',
      }),
      [['hello there|sh'], {kind: 'exited', status: 0}],
    );
  });

  it('keeps every line of the output, a CR LF end read as a line end', async () => {
    deepStrictEqual(await ranScript("printf 'one\\r\\ntwo\\r'"), [
      ['one', 'two'],
      {kind: 'exited', status: 0},
    ]);
  });

  it('refuses a PowerShell script and a variable name a shell cannot have', async () => {
    deepStrictEqual(
      [
        (await ranScript('Write-Output 1', {}, 'powershell'))[1],
        (await ranScript('true', {'BAD NAME': 'x'}))[1],
      ],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'spawnFailed',
            detail: 'a PowerShell script does not run over an exec server',
          },
        },
        {
          kind: 'failed',
          failure: {
            kind: 'spawnFailed',
            detail: "'BAD NAME' is not a name an environment variable can have",
          },
        },
      ],
    );
  });

  it('reports a run the exec server lost as a closed channel', async () => {
    const server = localExecServer();
    const lost: ChannelServer = {
      ...server,
      spawn: async (...spawnArguments) => ({
        ...(await server.spawn(...spawnArguments)),
        onExit: Promise.reject(closed()),
      }),
    };
    const outcome = await execServerChannel(
      lost,
      'ssh-remote+host',
      'linux',
    ).runScript(
      {
        script: 'true',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: new AbortController().signal,
      },
      () => undefined,
    );
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {kind: 'channelClosed', detail: closed().message},
    });
  });

  it('says what it is and which platform it reaches', () => {
    const channel = execServerChannel(
      localExecServer(),
      'ssh-remote+host',
      'macOS',
    );
    deepStrictEqual(
      [channel.identity(), channel.platformHint()],
      ['ssh-remote+host', 'macOS'],
    );
  });

  it('copies a file into a folder that exists, refuses a folder that doesn’t without making it, and reports a file that is missing, a write that fails, and a cancelled copy', async () => {
    const localFile = path.join(folder, 'local');
    await writeFile(localFile, Buffer.alloc(200_000, 7));
    await mkdir(path.join(folder, 'made', 'deeper'), {recursive: true});
    const remotePath = path.join(folder, 'made', 'deeper', 'remote');
    const channel = execServerChannel(localExecServer(), 'host', 'linux');
    const copied = await channel.copyToHost({
      localFile,
      remotePath,
      cancellation: new AbortController().signal,
    });
    const content = await readFile(remotePath);
    const absentPath = path.join(folder, 'absent', 'remote');
    const absent = await channel.copyToHost({
      localFile,
      remotePath: absentPath,
      cancellation: new AbortController().signal,
    });
    const missing = await channel.copyToHost({
      localFile: path.join(folder, 'none'),
      remotePath,
      cancellation: new AbortController().signal,
    });
    const failedAtEnd = await execServerChannel(
      failingFiles(localExecServer(), 'done', new Error('ENOSPC')),
      'host',
      'linux',
    ).copyToHost({
      localFile,
      remotePath,
      cancellation: new AbortController().signal,
    });
    const controller = new AbortController();
    const copying = channel.copyToHost({
      localFile,
      remotePath: path.join(folder, 'cancelled'),
      cancellation: controller.signal,
    });
    controller.abort();
    deepStrictEqual(
      [
        copied,
        content.length,
        absent,
        existsSync(path.join(folder, 'absent')),
        missing,
        failedAtEnd,
        await copying,
      ],
      [
        {kind: 'copied'},
        200_000,
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: `ENOENT: no such file or directory, open '${absentPath}'`,
          },
        },
        false,
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: `no such local file: ${path.join(folder, 'none')}`,
          },
        },
        {kind: 'failed', failure: {kind: 'copyFailed', detail: 'ENOSPC'}},
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'the copy was cancelled'},
        },
      ],
    );
  });

  it("kills the run's shell on the host when it is cancelled, so the rest of the script never runs", async () => {
    const marker = path.join(folder, 'after-cancel');
    const controller = new AbortController();
    const running = execServerChannel(
      localExecServer(),
      'host',
      'linux',
    ).runScript(
      {
        script: `printf 'started\\n'; sleep 0.5; touch '${marker}'`,
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: controller.signal,
      },
      () => {
        controller.abort();
      },
    );
    const outcome = await running;
    await new Promise(resolve => setTimeout(resolve, 900));
    deepStrictEqual(
      [
        outcome,
        await readFile(marker).then(
          () => 'written',
          () => 'absent',
        ),
      ],
      [
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'the run was cancelled'},
        },
        'absent',
      ],
    );
  });

  /** A run of `script` with no input, cancelled by `controller`, its lines told to `onLine`. */
  function runWith(
    server: ChannelServer,
    request: Partial<
      Parameters<ReturnType<typeof execServerChannel>['runScript']>[0]
    >,
    onLine: (line: string) => void,
  ): ReturnType<ReturnType<typeof execServerChannel>['runScript']> {
    return execServerChannel(server, 'host', 'linux').runScript(
      {
        script: 'true',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: new AbortController().signal,
        ...request,
      },
      onLine,
    );
  }

  /** A server whose one spawn sends `pieces` on its output, reporting its exit with `status` first. */
  function scriptedServer(pieces: string[], status: number): ChannelServer {
    return {
      ...localExecServer(),
      spawn: () => {
        const listeners: Array<(data: Uint8Array) => void> = [];
        const ended = new Promise<void>(resolve => {
          setTimeout(() => {
            for (const piece of pieces) {
              for (const listener of listeners) {
                listener(Buffer.from(piece));
              }
            }
            resolve();
          }, 30);
        });
        const quiet: ExecReadStream = {
          onDidReceiveMessage: () => ({dispose: () => undefined}),
          onEnd: Promise.resolve(),
        };
        return Promise.resolve({
          stdin: {write: () => undefined, end: () => undefined},
          stdout: {
            onDidReceiveMessage: listener => {
              listeners.push(listener);
              return {dispose: () => undefined};
            },
            onEnd: ended,
          },
          stderr: quiet,
          onExit: Promise.resolve({status}),
        });
      },
    };
  }

  it('cancels a run before its shell reported its process id, ending no tree', async () => {
    const server = localExecServer();
    const spawned: string[][] = [];
    const unreporting: ChannelServer = {
      ...server,
      spawn: (command, argumentList, options) => {
        spawned.push(argumentList);
        return server.spawn('sh', ['-c', 'sleep 0.5'], options);
      },
    };
    const controller = new AbortController();
    const running = runWith(
      unreporting,
      {cancellation: controller.signal},
      () => undefined,
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    deepStrictEqual(
      [await running, spawned.length],
      [
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'the run was cancelled'},
        },
        1,
      ],
    );
  });

  /** The outcome of a cancelled run. */
  const CANCELLED = {
    kind: 'failed',
    failure: {kind: 'cancelled', detail: 'the run was cancelled'},
  };

  /** Runs `script` on `server` under `cancellation`, and gives its outcome and whether `marker` was then written. */
  async function cancelledAndUnwritten(
    server: ChannelServer,
    script: string,
    cancellation: AbortSignal,
    marker: string,
  ): Promise<[unknown, string]> {
    const outcome = await runWith(
      server,
      {script, cancellation},
      () => undefined,
    );
    return [outcome, await markerAfterCancel(marker)];
  }

  /** Whether `marker` was written by the time a cancelled script's next command would have run. */
  async function markerAfterCancel(marker: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 900));
    return readFile(marker).then(
      () => 'written',
      () => 'absent',
    );
  }

  it('ends a run cancelled while its spawn was still under way, before the script runs', async () => {
    const marker = path.join(folder, 'during-spawn');
    const server = localExecServer();
    const slow: ChannelServer = {
      ...server,
      spawn: async (...spawnArguments) => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return server.spawn(...spawnArguments);
      },
    };
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 40);
    deepStrictEqual(
      await cancelledAndUnwritten(
        slow,
        `sleep 0.3; touch '${marker}'`,
        controller.signal,
        marker,
      ),
      [CANCELLED, 'absent'],
    );
  });

  it('ends a run with a file input cancelled straight after the call, while its file is being checked', async () => {
    const localFile = path.join(folder, 'input');
    await writeFile(localFile, 'input\n');
    const controller = new AbortController();
    const running = runWith(
      localExecServer(),
      {
        script: 'cat >/dev/null',
        input: {kind: 'file', localFile},
        cancellation: controller.signal,
      },
      () => undefined,
    );
    controller.abort();
    deepStrictEqual(await running, CANCELLED);
  });

  it('lets the shell of a run cancelled during its spawn end, given no program', async () => {
    const server = localExecServer();
    let exited: Promise<unknown> = Promise.resolve();
    const slow: ChannelServer = {
      ...server,
      spawn: async (...spawnArguments) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        const command = await server.spawn(...spawnArguments);
        exited = command.onExit;
        return command;
      },
    };
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 20);
    await runWith(
      slow,
      {script: 'sleep 30', cancellation: controller.signal},
      () => undefined,
    );
    deepStrictEqual(
      await Promise.race([
        exited.then(() => 'ended'),
        new Promise(resolve =>
          setTimeout(() => {
            resolve('still running');
          }, 1000),
        ),
      ]),
      'ended',
    );
  });

  it('ends a run cancelled the moment its spawn returned, before the script runs', async () => {
    const marker = path.join(folder, 'after-spawn');
    const server = localExecServer();
    const controller = new AbortController();
    const cancelling: ChannelServer = {
      ...server,
      spawn: async (...spawnArguments) => {
        const command = await server.spawn(...spawnArguments);
        controller.abort();
        return command;
      },
    };
    deepStrictEqual(
      await cancelledAndUnwritten(
        cancelling,
        `touch '${marker}'`,
        controller.signal,
        marker,
      ),
      [CANCELLED, 'absent'],
    );
  });

  it('keeps the output that comes after the exec server reported the exit', async () => {
    const lines: string[] = [];
    const outcome = await runWith(
      scriptedServer(['123\n', 'late line\n'], 0),
      {},
      line => lines.push(line),
    );
    deepStrictEqual(
      [outcome, lines],
      [{kind: 'exited', status: 0}, ['late line']],
    );
  });

  it('tells no line after the cancel, even one in the same piece of output', async () => {
    const controller = new AbortController();
    const lines: string[] = [];
    const server = scriptedServer(['123\nbefore\nafter\n'], 0);
    await runWith(server, {cancellation: controller.signal}, line => {
      lines.push(line);
      controller.abort();
    });
    deepStrictEqual(lines, ['before']);
  });

  it("still reports a cancel when the tree-kill script can't be started", async () => {
    const server = localExecServer();
    let spawns = 0;
    const refusing: ChannelServer = {
      ...server,
      spawn: (...spawnArguments) => {
        spawns += 1;
        return spawns === 1
          ? server.spawn(...spawnArguments)
          : Promise.reject(closed());
      },
    };
    const controller = new AbortController();
    const outcome = await runWith(
      refusing,
      {
        script: "printf 'started\\n'; sleep 30",
        cancellation: controller.signal,
      },
      () => {
        controller.abort();
      },
    );
    deepStrictEqual(
      [outcome, spawns],
      [
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'the run was cancelled'},
        },
        2,
      ],
    );
  });

  it('reports the status the exec server gives a shell a signal ended', async () => {
    deepStrictEqual(
      await runWith(localExecServer(), {script: 'kill -9 $$'}, () => undefined),
      {
        kind: 'exited',
        status: -1,
      },
    );
  });

  it("fails a run whose input can't be read once it starts, ending the shell before the script reads part of it", async () => {
    const marker = path.join(folder, 'read-part');
    const outcome = await runWith(
      localExecServer(),
      {
        script: `cat >/dev/null; touch '${marker}'`,
        input: {kind: 'file', localFile: folder},
      },
      () => undefined,
    );
    await new Promise(resolve => setTimeout(resolve, 300));
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
        outcome.kind === 'failed' && outcome.failure.detail.includes('EISDIR'),
        await readFile(marker).then(
          () => 'written',
          () => 'absent',
        ),
      ],
      ['spawnFailed', true, 'absent'],
    );
  });
});
