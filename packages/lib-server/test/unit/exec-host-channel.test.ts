import {deepStrictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finished} from 'node:stream/promises';
import {
  channelContractCases,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {execServerChannel} from '../../src/cli-control/exec-host-channel.ts';
import {
  type ExecReadStream,
  type ExecServer,
  ExecServerFailure,
} from '../../src/cli-control/exec-server.ts';

/** The members of an exec server the channel uses. */
type ChannelServer = Pick<ExecServer, 'spawn' | 'kill' | 'fs'>;

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
    kill: processId => {
      process.kill(processId, 'SIGKILL');
      return Promise.resolve();
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
  step: 'mkdirp' | 'write' | 'done',
  failure: Error,
): ChannelServer {
  return {
    ...server,
    // eslint-disable-next-line id-length -- the exec server's member
    fs: {
      ...server.fs,
      mkdirp: folder =>
        step === 'mkdirp' ? Promise.reject(failure) : server.fs.mkdirp(folder),
      write: async file => {
        if (step === 'write') {
          throw failure;
        }
        const written = await server.fs.write(file);
        return step === 'done'
          ? {...written, done: written.done.then(() => Promise.reject(failure))}
          : written;
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
  });

  after(async () => {
    await rm(folder, {recursive: true, force: true});
  });

  const harness: ChannelHarness = {
    scriptFailures: ['channelClosed', 'spawnFailed'],
    copyFailures: ['copyFailed', 'channelClosed'],
    reachesClientFiles: false,
    stage: async (scenario): Promise<StagedChannel> => {
      localFile = path.join(folder, `input-${String(Math.random())}`);
      const content =
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(4096);
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
            ? failingFiles(server, 'mkdirp', closed())
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
    it(contractCase.name, contractCase.check);
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

  it('copies a file into a folder it makes, and reports a file that is missing, a write that fails, and a cancelled copy', async () => {
    const localFile = path.join(folder, 'local');
    await writeFile(localFile, Buffer.alloc(200_000, 7));
    const remotePath = path.join(folder, 'made', 'deeper', 'remote');
    const channel = execServerChannel(localExecServer(), 'host', 'linux');
    const copied = await channel.copyToHost({
      localFile,
      remotePath,
      cancellation: new AbortController().signal,
    });
    const content = await readFile(remotePath);
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
      [copied, content.length, missing, failedAtEnd, await copying],
      [
        {kind: 'copied'},
        200_000,
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

  it('cancels a run before its shell reported its process id, killing nothing', async () => {
    const server = localExecServer();
    const killed: number[] = [];
    const unreporting: ChannelServer = {
      ...server,
      spawn: () => server.spawn('sh', ['-c', 'sleep 2'], {}),
      kill: processId => {
        killed.push(processId);
        return Promise.resolve();
      },
    };
    const controller = new AbortController();
    const running = execServerChannel(unreporting, 'host', 'linux').runScript(
      {
        script: 'true',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: controller.signal,
      },
      () => undefined,
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    deepStrictEqual(
      [await running, killed],
      [
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'the run was cancelled'},
        },
        [],
      ],
    );
  });
});
