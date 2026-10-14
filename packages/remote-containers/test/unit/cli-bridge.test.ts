import {deepStrictEqual} from 'node:assert';
import {mock} from 'node:test';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import {cliBridgeOf} from '../../src/cli/cli-bridge.ts';
import type {CliHost, CliLine, CliRun} from '../../src/cli/cli-host.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import type {OverrideStore} from '../../src/cli/override-files.ts';

const TARGET: CliTarget = {
  workspaceFolder: '/work/ws1',
  configFile: '/work/ws1/.devcontainer/devcontainer.json',
  dockerPath: 'docker',
  idLabels: ['a=b'],
  mountWorkspaceGitRoot: true,
  mounts: [],
  logLevel: 'info',
};

const UP_OPTIONS = {removeExistingContainer: false, buildNoCache: false};

const UP_LINE =
  '{"outcome":"success","containerId":"c1","remoteUser":"root","remoteWorkspaceFolder":"/workspaces/ws1"}';

type Script = (
  cliArguments: readonly string[],
  onLine: (line: CliLine) => void,
  cancellation: AbortSignal,
) => Promise<CliRun>;

/** A bridge over a scripted host, a config file with `configText`, and a recording override store. */
function setup(
  script: Script,
  options: {
    configText?: string;
    environment?: Record<string, string | undefined>;
    removeFails?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  const written: string[] = [];
  const removed: string[] = [];
  const sink = new MemorySink();
  const host: CliHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (cliArguments, onLine, cancellation) => {
      calls.push([...cliArguments]);
      return script(cliArguments, onLine, cancellation);
    },
  };
  const overrides: OverrideStore = {
    write: text => {
      written.push(text);
      return Promise.resolve('/store/o.json');
    },
    remove: file => {
      removed.push(file);
      return options.removeFails === true
        ? Promise.reject(new Error('busy'))
        : Promise.resolve();
    },
  };
  const bridge = cliBridgeOf(
    host,
    {
      readText: () =>
        options.configText === undefined
          ? Promise.reject(new Error('no file'))
          : Promise.resolve(options.configText),
    },
    overrides,
    options.environment ?? {},
    createLogger(sink, {minimumLevel: () => 'info'}),
  );
  return {bridge, calls, written, removed, sink};
}

/** A script that ends with `result` and `status`. */
function ending(result: string | undefined, status: number | null = 0): Script {
  return () => Promise.resolve({kind: 'ran', result, status});
}

/** A script that prints `line` on stderr, then ends with `result`. */
function onStderr(line: string, result: string | undefined): Script {
  return (cliArguments, onLine) => {
    onLine({stream: 'stderr', line});
    return Promise.resolve({kind: 'ran', result, status: 0});
  };
}

const NEVER = new AbortController().signal;

describe('the CLI bridge (card containers-04)', () => {
  it('C3: a run whose pre-pass changes nothing writes no override file and passes none', async () => {
    const {bridge, calls, written} = setup(ending(UP_LINE), {
      configText: '{"image": "alpine"}',
    });
    await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    deepStrictEqual(
      [written, calls[0]?.includes('--override-config')],
      [[], false],
    );
  });

  it('C3: a run whose pre-pass changes something writes the override file, passes it, and removes it after success', async () => {
    const {bridge, calls, written, removed} = setup(ending(UP_LINE), {
      configText: '{"name": "${localEnv:V:dflt}"}',
      environment: {V: ''},
    });
    const result = await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    const flag = calls[0]?.indexOf('--override-config') ?? -1;
    deepStrictEqual(
      [result.kind, written, calls[0]?.[flag + 1], removed],
      ['up', ['{"name": "dflt"}'], '/store/o.json', ['/store/o.json']],
    );
  });

  it('F-0412 Q-1: a configuration whose image is dropped writes the override without it and logs why', async () => {
    const {bridge, written, sink} = setup(ending(UP_LINE), {
      configText: '{"image": "alpine:3.22", "dockerFile": "Dockerfile"}',
    });
    await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    deepStrictEqual(
      [
        written.map(text => JSON.parse(text) as unknown),
        sink.lines.map(line => line.message),
      ],
      [
        [{dockerFile: 'Dockerfile'}],
        [
          "the configuration's image is ignored, because it also builds from a Dockerfile (F-0412 Q-1)",
        ],
      ],
    );
  });

  it('C3: the override file is removed after a lifecycle failure and after a cancel', async () => {
    const config = {
      configText: '{"name": "${localEnv:V:dflt}"}',
      environment: {V: ''},
    };
    const failing = setup(
      ending(
        '{"outcome":"error","message":"m","description":"onCreateCommand from devcontainer.json failed."}',
        1,
      ),
      config,
    );
    const failure = await failing.bridge.up(
      TARGET,
      UP_OPTIONS,
      () => undefined,
      NEVER,
    );
    const controller = new AbortController();
    const cancelling = setup(
      (cliArguments, onLine, cancellation) =>
        new Promise(resolve => {
          function ended(): void {
            resolve({kind: 'ran', result: undefined, status: null});
          }
          if (cancellation.aborted) {
            ended();
          }
          cancellation.addEventListener('abort', ended);
        }),
      config,
    );
    const running = cancelling.bridge.up(
      TARGET,
      UP_OPTIONS,
      () => undefined,
      controller.signal,
    );
    controller.abort();
    deepStrictEqual(
      [failure.kind, await running, failing.removed, cancelling.removed],
      [
        'lifecycleFailed',
        {kind: 'cancelled'},
        ['/store/o.json'],
        ['/store/o.json'],
      ],
    );
  });

  it('C3: a cancel before the run still cancels', async () => {
    const controller = new AbortController();
    controller.abort();
    const {bridge} = setup((cliArguments, onLine, cancellation) =>
      Promise.resolve({
        kind: 'ran',
        result: undefined,
        status: cancellation.aborted ? null : 0,
      }),
    );
    deepStrictEqual(
      await bridge.runUserCommands(
        TARGET,
        'c1',
        () => undefined,
        controller.signal,
      ),
      {kind: 'cancelled'},
    );
  });

  it('C3: a failed removal logs one warn line naming the file and does not change the result', async () => {
    const {bridge, sink} = setup(ending(UP_LINE), {
      configText: '{"name": "${localEnv:V:dflt}"}',
      environment: {V: ''},
      removeFails: true,
    });
    const result = await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    deepStrictEqual(
      [result.kind, sink.lines.map(line => [line.level, line.message])],
      [
        'up',
        [['warn', 'could not remove the override file /store/o.json: busy']],
      ],
    );
  });

  it('C3: a failed removal that throws something else is logged as text', async () => {
    const sink = new MemorySink();
    const bridge = cliBridgeOf(
      // eslint-disable-next-line id-length -- the port's method is named run
      {run: ending(UP_LINE)},
      {readText: () => Promise.resolve('{"name": "${localEnv:V:d}"}')},
      {
        write: () => Promise.resolve('/store/o.json'),
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a rejection that is not an Error
        remove: () => Promise.reject('plain text'),
      },
      {V: ''},
      createLogger(sink, {minimumLevel: () => 'info'}),
    );
    await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ['could not remove the override file /store/o.json: plain text'],
    );
  });

  /** The events of a run whose stderr is `lines`, with the token variable referenced. */
  async function eventsOfStderr(lines: readonly string[]): Promise<string[]> {
    const events: CliEvent[] = [];
    const {bridge} = setup(
      (cliArguments, onLine) => {
        for (const line of lines) {
          onLine({stream: 'stderr', line});
        }
        return Promise.resolve({kind: 'ran', result: UP_LINE, status: 0});
      },
      {
        configText: '{"containerEnv": {"T": "${localEnv:GITHUB_TOKEN}"}}',
        environment: {GITHUB_TOKEN: 's3cr3t-token'},
      },
    );
    await bridge.up(TARGET, UP_OPTIONS, event => events.push(event), NEVER);
    return events.map(event =>
      event.kind === 'log'
        ? `${event.channel ?? '-'}: ${event.text}`
        : `progress: ${event.status}`,
    );
  }

  function rawLine(text: string, channel = 'postCreate'): string {
    return JSON.stringify({type: 'raw', level: 3, text, channel});
  }

  it('R-26: raw events that split a value reach the caller as one raw event with the reference', async () => {
    deepStrictEqual(
      await eventsOfStderr([rawLine('echo s3cr3t-'), rawLine('token\n')]),
      ['postCreate: echo ${localEnv:GITHUB_TOKEN}\n'],
    );
  });

  it('R-26: a held tail is flushed, scrubbed, when the progress of its channel succeeds', async () => {
    const succeeded = JSON.stringify({
      type: 'progress',
      name: 'Running',
      status: 'succeeded',
      channel: 'postCreate',
    });
    deepStrictEqual(
      await eventsOfStderr([rawLine('abc s3cr3t-token'), succeeded]),
      ['postCreate: abc ${localEnv:GITHUB_TOKEN}', 'progress: succeeded'],
    );
  });

  it('R-26: the progress of another channel leaves a held tail where it is, and the end of the process flushes it', async () => {
    const other = JSON.stringify({
      type: 'progress',
      name: 'Running',
      status: 'succeeded',
      channel: 'postStart',
    });
    deepStrictEqual(await eventsOfStderr([rawLine('abc'), other]), [
      'progress: succeeded',
      'postCreate: abc',
    ]);
  });

  it('ADR-0010: stderr noise that looks like a result is a log event and never the result', async () => {
    const noise = 'npm WARN {"outcome":"success","containerId":"x"}';
    const events: CliEvent[] = [];
    const {bridge} = setup(onStderr(noise, undefined));
    const outcome = await bridge.up(
      TARGET,
      UP_OPTIONS,
      event => events.push(event),
      NEVER,
    );
    deepStrictEqual(
      [events, outcome],
      [
        [
          {
            kind: 'log',
            level: 3,
            text: noise,
            channel: undefined,
            type: 'text',
            timestamp: undefined,
            startTimestamp: undefined,
          },
        ],
        {kind: 'noResult', status: 0},
      ],
    );
  });

  it('C3: a process that ends without a result line is noResult for up', async () => {
    const {bridge} = setup(ending(undefined, 137));
    deepStrictEqual(
      await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER),
      {kind: 'noResult', status: 137},
    );
  });

  it('C3: read-configuration that ends without a line is a configuration failure with the last error line, scrubbed', async () => {
    const {bridge} = setup(
      (cliArguments, onLine) => {
        onLine({
          stream: 'stderr',
          line: '{"type":"text","level":2,"text":"Error: no s3cr3t-token here\\n    at x"}',
        });
        return Promise.resolve({kind: 'ran', result: undefined, status: 1});
      },
      {
        configText: '{"a": "${localEnv:GITHUB_TOKEN}"}',
        environment: {GITHUB_TOKEN: 's3cr3t-token'},
      },
    );
    deepStrictEqual(
      await bridge.readConfiguration(TARGET, undefined, () => undefined, NEVER),
      {
        kind: 'configurationFailed',
        message: 'Error: no ${localEnv:GITHUB_TOKEN} here',
      },
    );
  });

  it('C3: read-configuration with a container id passes it, and reads the configuration', async () => {
    const {bridge, calls} = setup(
      ending(
        '{"configuration":{"name":"n"},"workspace":{"workspaceFolder":"/w"}}',
      ),
    );
    const result = await bridge.readConfiguration(
      TARGET,
      'abc',
      () => undefined,
      NEVER,
    );
    deepStrictEqual(
      [result.kind, calls[0]?.slice(-3)],
      [
        'configuration',
        ['--container-id', 'abc', '--include-merged-configuration'],
      ],
    );
  });

  it('C3: run-user-commands passes the container id and gives done', async () => {
    const {bridge, calls} = setup(
      ending('{"outcome":"success","result":"done"}'),
    );
    const result = await bridge.runUserCommands(
      TARGET,
      'abc',
      () => undefined,
      NEVER,
    );
    deepStrictEqual(
      [result, calls[0]?.slice(-2)],
      [{kind: 'done'}, ['--container-id', 'abc']],
    );
  });

  it('C3: a host that cannot start the CLI is spawnFailed', async () => {
    const {bridge} = setup(() =>
      Promise.resolve({kind: 'spawnFailed', message: 'ENOENT'}),
    );
    deepStrictEqual(
      await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER),
      {kind: 'spawnFailed', message: 'ENOENT'},
    );
  });

  it('C3: a config file that cannot be read is left for the CLI', async () => {
    const {bridge, written} = setup(ending(UP_LINE));
    const result = await bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
    deepStrictEqual([result.kind, written], ['up', []]);
  });

  it('R-26: an event with the value of a referenced variable reaches the caller with the reference, and the result message likewise', async () => {
    const events: CliEvent[] = [];
    const {bridge} = setup(
      (cliArguments, onLine) => {
        onLine({
          stream: 'stderr',
          line: '{"type":"start","level":2,"text":"Run: docker run -e T=s3cr3t-token alpine"}',
        });
        onLine({
          stream: 'stderr',
          line: '{"type":"progress","name":"Running s3cr3t-token","status":"running","stepDetail":"echo s3cr3t-token"}',
        });
        onLine({
          stream: 'stderr',
          line: '{"type":"progress","name":"Done","status":"succeeded"}',
        });
        return Promise.resolve({
          kind: 'ran',
          result:
            '{"outcome":"error","message":"Command failed: docker run -e T=s3cr3t-token alpine","description":"An error occurred setting up the container."}',
          status: 1,
        });
      },
      {
        configText: '{"containerEnv": {"T": "${localEnv:GITHUB_TOKEN}"}}',
        environment: {
          GITHUB_TOKEN: 's3cr3t-token',
          OTHER_TOKEN: 'another-long-value',
        },
      },
    );
    const result = await bridge.up(
      TARGET,
      UP_OPTIONS,
      event => events.push(event),
      NEVER,
    );
    deepStrictEqual(
      [
        events.map(event =>
          event.kind === 'log'
            ? event.text
            : `${event.name} | ${String(event.detail)}`,
        ),
        result.kind === 'setupFailed' ? result.message : result,
      ],
      [
        [
          'Run: docker run -e T=${localEnv:GITHUB_TOKEN} alpine',
          'Running ${localEnv:GITHUB_TOKEN} | echo ${localEnv:GITHUB_TOKEN}',
          'Done | undefined',
        ],
        'Command failed: docker run -e T=${localEnv:GITHUB_TOKEN} alpine',
      ],
    );
  });

  it('C3: a process that runs 30 s after its result line is ended, logged, and the result read is returned', async () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
      const {bridge, sink} = setup((cliArguments, onLine, cancellation) => {
        onLine({stream: 'stdout', line: UP_LINE});
        return new Promise(resolve => {
          cancellation.addEventListener('abort', () => {
            resolve({kind: 'ran', result: UP_LINE, status: null});
          });
        });
      });
      const running = bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
      await Promise.resolve();
      await Promise.resolve();
      mock.timers.tick(30_000);
      const result = await running;
      deepStrictEqual(
        [result.kind, sink.lines.map(line => [line.level, line.message])],
        [
          'up',
          [
            [
              'warn',
              'the dev container CLI kept running after its result; ended',
            ],
          ],
        ],
      );
    } finally {
      mock.timers.reset();
    }
  });
});
