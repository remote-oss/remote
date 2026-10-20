import {deepStrictEqual} from 'node:assert';
import type {RedirectRule} from 'lib-product';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  RecordingChannel,
  type RecordedCall,
} from 'lib-host/testing/recording-channel';
import {
  type CliPlacement,
  type DownloadResult,
  installCli,
  startCli,
  type StartOutcome,
  stopCli,
  type TransferDependencies,
} from '../../src/index.ts';
import {parametersFor} from './fake-host.ts';
import {answering, block, runOnce} from './scripted-steps.fixture.ts';

const ADDRESS = 'https://download.example.invalid/cli.tar.gz';

const REDIRECT: RedirectRule = {
  kind: 'hosts',
  hosts: ['download.example.invalid', 'cdn.example.invalid'],
};

const NEVER_CANCELLED = new AbortController().signal;

const CLI_PATH = '/home/user/.server-data/codium-insiders-abc123';

const TOKEN = 'tok-xyz';

const DOWNLOADED: DownloadResult = {
  kind: 'downloaded',
  facts: {},
  finalAddress: ADDRESS,
};

function baseParameters(): ReturnType<typeof parametersFor> & {
  cli: NonNullable<ReturnType<typeof parametersFor>['cli']>;
} {
  return {
    ...parametersFor(),
    launcher: 'codium-insiders',
    ['cli']: {
      name: 'codium-insiders-abc123',
      dataFolder: '/home/user/.server-data/cli',
    },
  };
}

function scriptRequests(channel: RecordingChannel): RecordedCall[] {
  return channel.calls.filter(call => call.operation === 'runScript');
}

function environmentsOf(channel: RecordingChannel): unknown[] {
  return channel.calls.flatMap(call =>
    call.operation === 'runScript' ? [call.request.environment] : [],
  );
}

function startingChannel(output: readonly string[]): RecordingChannel {
  return new RecordingChannel({
    identity: 'host',
    platformHint: 'linux',
    scripts: [answering(output)],
  });
}

function started(
  output: readonly string[],
  token = TOKEN,
): Promise<{outcome: StartOutcome; channel: RecordingChannel}> {
  const channel = startingChannel(output);
  return startCli(
    channel,
    baseParameters(),
    token,
    {lockLoop: runOnce},
    NEVER_CANCELLED,
  ).then(outcome => ({outcome, channel}));
}

/** A lock loop's answer after three attempts that all met a held lock. */
const EXHAUSTED = {
  kind: 'retriesExhausted' as const,
  last: {kind: 'noResultBlock' as const, exitStatus: 0},
  attempts: 3,
};

describe('the CLI on the host (card cli-03b, contracts V7a)', () => {
  describe('startCli', () => {
    const HOST_TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

    const STARTED = block(
      'Ok',
      'cli.port=41234',
      'cli.pid=77',
      'cli.log=/l',
      `cli.connectionToken=${HOST_TOKEN}`,
    );

    it('§S10: the run carries the token as VSCODE_CLI_REQUIRE_TOKEN in its environment', async () => {
      const {channel} = await started(STARTED);
      deepStrictEqual(environmentsOf(channel), [
        {VSCODE_CLI_REQUIRE_TOKEN: TOKEN},
      ]);
    });

    it('§S10: the text of the script does not hold the token', async () => {
      const {channel} = await started(STARTED);
      deepStrictEqual(
        channel.calls.some(
          call =>
            call.operation === 'runScript' &&
            call.request.script.includes(TOKEN),
        ),
        false,
      );
    });

    it("F-2409 BR-11: a result block with the port, the process and the host's token is a started CLI with that token", async () => {
      const {outcome} = await started(STARTED);
      deepStrictEqual(outcome, {
        kind: 'started',
        server: {
          endpoint: {kind: 'port', port: 41234},
          processId: 77,
          connectionToken: HOST_TOKEN,
          reused: false,
        },
        notices: [],
      });
    });

    it("athena on #412: the started CLI's connection token is the host's, never the control token", async () => {
      const {outcome} = await started(STARTED);
      deepStrictEqual(
        outcome.kind === 'started' && outcome.server.connectionToken !== TOKEN,
        true,
      );
    });

    it('athena on #412: an Ok block without the connection token is unreadable', async () => {
      const {outcome} = await started(
        block('Ok', 'cli.port=41234', 'cli.pid=77', 'cli.log=/l'),
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'unreadableServerFacts'},
      });
    });

    it("athena on #412: ServerFailedToStart with cli.tokenInvalid is serverStart naming the host's token file", async () => {
      const {outcome} = await started(
        block('ServerFailedToStart', 'cli.tokenInvalid=yes'),
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {
          kind: 'serverStart',
          detail:
            "the host's connection token file is not a private file holding a token",
        },
      });
    });

    it('V7a: ServerFailedToStart is serverStart', async () => {
      const {outcome} = await started(block('ServerFailedToStart'));
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'serverStart'},
      });
    });

    it('themis on #430: ServerFailedToStart with cli.tokenMissing is serverStart saying the token did not reach the host', async () => {
      const {outcome} = await started(
        block('ServerFailedToStart', 'cli.tokenMissing=yes'),
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {
          kind: 'serverStart',
          detail: "the CLI's token did not reach the host",
        },
      });
    });

    it('V5: another status is scriptFailed', async () => {
      const {outcome} = await started(block('LockBusy'));
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'scriptFailed', status: 'LockBusy'},
      });
    });

    it('V7a: a port out of range is unreadable', async () => {
      const {outcome} = await started(
        block('Ok', 'cli.port=70000', 'cli.pid=77'),
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'unreadableServerFacts'},
      });
    });

    it('V7a: a process id that is not one is unreadable', async () => {
      const {outcome} = await started(
        block('Ok', 'cli.port=41234', 'cli.pid=1'),
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'unreadableServerFacts'},
      });
    });

    it('V7a: output with no result block is noResultBlock', async () => {
      const {outcome} = await started(['nothing']);
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'noResultBlock'},
      });
    });

    it('V5: a lock loop that gives up is retriesExhausted', async () => {
      const outcome = await startCli(
        startingChannel(STARTED),
        baseParameters(),
        TOKEN,
        {lockLoop: () => Promise.resolve(EXHAUSTED)},
        NEVER_CANCELLED,
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'retriesExhausted', attempts: 3},
      });
    });

    it('a channel that fails is channelFailed', async () => {
      const failure = {kind: 'channelClosed', detail: 'closed'} as const;
      const outcome = await startCli(
        new RecordingChannel({
          identity: 'host',
          platformHint: 'linux',
          scripts: [
            {
              interpreter: 'posixShell',
              matches: () => true,
              lines: [],
              ending: {kind: 'fail', failure},
            },
          ],
        }),
        baseParameters(),
        TOKEN,
        {lockLoop: runOnce},
        NEVER_CANCELLED,
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'channelFailed', failure},
      });
    });
  });

  describe('installCli', () => {
    function placement(
      overrides: Partial<CliPlacement['plan']> = {},
    ): CliPlacement {
      return {
        plan: {
          kind: 'cli',
          cliPath: CLI_PATH,
          cliDataFolder: '/home/user/.server-data/cli',
          download: true,
          where: 'host',
          clientFallback: false,
          dataFolder: '/home/user/.server-data',
          lockPlace: '/home/user/.server-data/bin/abc123',
          notes: [],
          ...overrides,
        },
        address: ADDRESS,
        redirect: REDIRECT,
        transfer: {
          clientFolder: '/client/tmp',
          cache: {kind: 'none'},
          downloadBounds: {
            deadlineMilliseconds: 30_000,
            stallMilliseconds: 5000,
            maximumBytes: 1_000_000,
          },
          temporaryToken: 'token1',
          verification: ['none'],
          hostFolder: '/host/tmp',
          discardDeadlineMilliseconds: 30,
        },
      };
    }

    interface Run {
      outcome: Awaited<ReturnType<typeof installCli>>;
      channel: RecordingChannel;
      downloads: number;
      redirects: RedirectRule[];
      phases: string[];
    }

    async function install(
      overrides: Partial<CliPlacement['plan']>,
      outputs: ReadonlyArray<readonly string[]>,
      downloadResults: readonly DownloadResult[] = [DOWNLOADED],
    ): Promise<Run> {
      const channel = new RecordingChannel({
        identity: 'host',
        platformHint: 'linux',
        scripts: outputs.map(answering),
        copies: [{matches: () => true, ending: {kind: 'copied'}}],
      });
      let downloads = 0;
      const redirects: RedirectRule[] = [];
      const phases: string[] = [];
      const results = [...downloadResults];
      const dependencies: TransferDependencies = {
        channel,
        credentials: {readNetrc: () => Promise.resolve(undefined)},
        download: {
          download: request => {
            downloads += 1;
            redirects.push(request.redirect);
            return Promise.resolve(results.shift() ?? DOWNLOADED);
          },
        },
        files: {
          remove: () => Promise.resolve(),
          exists: () => Promise.resolve(false),
          size: () => Promise.resolve(0),
          sha256: () => Promise.resolve(''),
          rename: () => Promise.resolve({kind: 'renamed'}),
        },
        lockLoop: runOnce,
        logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
        onPhase: phase => {
          phases.push(phase.kind);
        },
      };
      const outcome = await installCli(
        baseParameters(),
        placement(overrides),
        dependencies,
        NEVER_CANCELLED,
      );
      return {outcome, channel, downloads, redirects, phases};
    }

    const PLACED = block('Ok', `cli.path=${CLI_PATH}`);

    it('F-2103 POST-2: a host download that works reports the CLI path of the plan', async () => {
      const {outcome} = await install({}, [PLACED]);
      deepStrictEqual(outcome, {kind: 'placed', path: CLI_PATH});
    });

    it('brief §4: with plan.download false one script run is made, with no download and no copy', async () => {
      const installed = await install({download: false}, [PLACED]);
      deepStrictEqual(
        [
          scriptRequests(installed.channel).length,
          installed.downloads,
          installed.channel.calls.length,
          installed.phases,
        ],
        [1, 0, 1, []],
      );
    });

    it('server-22: the client download of the CLI is handed the redirect rule of the placement', async () => {
      const installed = await install({where: 'client'}, [PLACED]);
      deepStrictEqual(installed.redirects, [REDIRECT]);
    });

    it('§S10: every run of the install has an empty environment', async () => {
      const installed = await install({}, [PLACED]);
      deepStrictEqual(environmentsOf(installed.channel), [{}]);
    });

    it('V7a: the install runs the installCli step', async () => {
      const installed = await install({}, [PLACED]);
      deepStrictEqual(
        installed.channel.calls.every(
          call =>
            call.operation !== 'runScript' ||
            (call.request.script.includes('CLI_STAGING') &&
              call.request.script.includes('cli.path')),
        ),
        true,
      );
    });

    it('F-3902 rule 6: a failed host download falls back to the client download and the copy', async () => {
      const installed = await install({clientFallback: true}, [
        block('ServerDownloadFailed'),
        PLACED,
      ]);
      deepStrictEqual(
        [
          installed.outcome,
          installed.downloads,
          installed.phases.includes('copying'),
        ],
        [{kind: 'placed', path: CLI_PATH}, 1, true],
      );
    });

    it('a failure of the install is the transfer failure', async () => {
      const {outcome} = await install({}, [block('ServerDownloadFailed')]);
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'serverDownload', cause: 'downloadFailed'},
      });
    });
  });
});

describe("the CLI's stop (card cli-04, themis on #458)", () => {
  /** A stop of process 4242 over a channel that prints `output`. */
  async function stopped(output: readonly string[]) {
    const channel = startingChannel(output);
    const outcome = await stopCli(
      channel,
      baseParameters(),
      4242,
      NEVER_CANCELLED,
    );
    return {outcome, channel};
  }

  /** The script text of a stop that ran. */
  async function stopScript(): Promise<string> {
    const {channel} = await stopped(block('Ok', 'cli.stopped=yes'));
    const script = scriptRequests(channel)[0];
    return script?.operation === 'runScript' ? script.request.script : '';
  }

  it('themis on #458: the stop checks the process is still the CLI, by its first two arguments, before it kills it', async () => {
    const text = await stopScript();
    deepStrictEqual(
      text.indexOf('is_cli_process "$CLI_STOP_PID"') <
        text.indexOf('kill "$CLI_STOP_PID"'),
      true,
    );
  });

  it('athena on #412: the stop kills the CLI process only, never its children, so the server stays', async () => {
    const text = await stopScript();
    deepStrictEqual(
      [text.includes('kill "$CLI_STOP_PID"'), text.includes('pkill')],
      [true, false],
    );
  });

  it('themis on #458: the check compares the first argument with the CLI file and the second with command-shell', async () => {
    const text = await stopScript();
    deepStrictEqual(
      text.includes(
        '[ "$CLI_ARGUMENT_0" = "$CLI_FILE" ] && [ "$CLI_ARGUMENT_1" = command-shell ]',
      ),
      true,
    );
  });

  it('themis on #458: the stop is given the process id of the CLI', async () => {
    const {channel} = await stopped(block('Ok', 'cli.stopped=yes'));
    const script = scriptRequests(channel)[0];
    deepStrictEqual(
      script?.operation === 'runScript' &&
        script.request.script.includes("CLI_STOP_PID='4242'"),
      true,
    );
  });

  it('themis on #458: a CLI that was ended is stopped', async () => {
    const {outcome} = await stopped(block('Ok', 'cli.stopped=yes'));
    deepStrictEqual(outcome, {kind: 'stopped'});
  });

  it('themis on #458: a process that is no longer the CLI is not running', async () => {
    const {outcome} = await stopped(block('Ok', 'cli.stopped=no'));
    deepStrictEqual(outcome, {kind: 'notRunning'});
  });

  it('themis on #458: the stop carries no secret and needs no host lock', async () => {
    const {channel} = await stopped(block('Ok', 'cli.stopped=yes'));
    deepStrictEqual(environmentsOf(channel), [{}]);
  });

  it('themis on #458: a stop whose script gives no result block failed', async () => {
    const {outcome} = await stopped([]);
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {kind: 'noResultBlock'},
    });
  });

  it('themis on #458: a stop whose script fails reports its status', async () => {
    const {outcome} = await stopped(block('CreateInstallDirFailed'));
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {kind: 'scriptFailed', status: 'CreateInstallDirFailed'},
    });
  });
});
