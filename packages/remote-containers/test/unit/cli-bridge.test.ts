import {deepStrictEqual} from 'node:assert';
import {mock} from 'node:test';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import {cliBridgeOf} from '../../src/cli/cli-bridge.ts';
import type {
  CliHost,
  CliLine,
  CliRun,
  StdinOf,
  StdinPresentation,
} from '../../src/cli/cli-host.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import type {OverrideStore} from '../../src/cli/override-files.ts';

const TARGET: CliTarget = {
  workspaceFolder: '/work/ws1',
  configFile: '/work/ws1/.devcontainer/devcontainer.json',
  dockerPath: 'docker',
  idLabels: ['a=b'],
  mountWorkspaceGitRoot: true,
  mountGitWorktreeCommonDir: false,
  mounts: [],
  logLevel: 'info',
};

const UP_OPTIONS = {
  removeExistingContainer: false,
  buildNoCache: false,
  workspaceMountConsistency: 'cached',
};

const UP_LINE =
  '{"outcome":"success","containerId":"c1","remoteUser":"root","remoteWorkspaceFolder":"/workspaces/ws1"}';

type Script = (
  cliArguments: readonly string[],
  onLine: (line: CliLine) => void,
  cancellation: AbortSignal,
  onStdin?: StdinOf,
  presentation?: StdinPresentation,
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
  const stdinOf: Array<StdinOf | undefined> = [];
  const presentationOf: Array<StdinPresentation | undefined> = [];
  const written: string[] = [];
  const removed: string[] = [];
  const sink = new MemorySink();
  const host: CliHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (cliArguments, onLine, cancellation, onStdin, presentation) => {
      stdinOf.push(onStdin);
      presentationOf.push(presentation);
      calls.push([...cliArguments]);
      return script(cliArguments, onLine, cancellation, onStdin, presentation);
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
  return {bridge, calls, stdinOf, presentationOf, written, removed, sink};
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

  it('F-0415 7.E6: up, run-user-commands and read-configuration hand their onStdin to the host', async () => {
    const {bridge, stdinOf} = setup(
      ending('{"outcome":"success","result":"done"}'),
    );
    function onStdin(): void {
      void 0;
    }
    await Promise.all([
      bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER, onStdin),
      bridge.runUserCommands(TARGET, 'c1', () => undefined, NEVER, onStdin),
    ]);
    await bridge.readConfiguration(
      TARGET,
      'c1',
      () => undefined,
      NEVER,
      onStdin,
    );
    deepStrictEqual(
      [stdinOf.length, stdinOf.every(each => each === onStdin)],
      [3, true],
    );
  });

  it('F-0415 7.E6: up, run-user-commands and read-configuration hand their presentation to the host', async () => {
    const {bridge, presentationOf} = setup(
      ending('{"outcome":"success","result":"done"}'),
    );
    await bridge.up(
      TARGET,
      UP_OPTIONS,
      () => undefined,
      NEVER,
      undefined,
      'plain',
    );
    await bridge.runUserCommands(
      TARGET,
      'c1',
      () => undefined,
      NEVER,
      undefined,
      'echoed',
    );
    await bridge.readConfiguration(
      TARGET,
      'c1',
      () => undefined,
      NEVER,
      undefined,
      'plain',
    );
    deepStrictEqual(presentationOf, ['plain', 'echoed', 'plain']);
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

describe('the daemon refusal in the bridge (card containers-11)', () => {
  const SETUP_FAILED =
    '{"outcome":"error","message":"Command failed: docker run x","description":"An error occurred setting up the container.","containerId":"c1"}';
  const MOUNT =
    'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /nope\n\nRun \'docker run --help\' for more information\n';
  const PORT =
    'docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint e (da74): Bind for 0.0.0.0:47321 failed: port is already allocated\n';

  /** A script that prints each stderr event, then ends with `result`. */
  function printing(
    events: Array<{type: string; text: string; channel?: string}>,
    result: string,
  ): Script {
    return (cliArguments, onLine) => {
      for (const event of events) {
        onLine({stream: 'stderr', line: JSON.stringify(event)});
      }
      return Promise.resolve({kind: 'ran', result, status: 1});
    };
  }

  /** What `up` gave under `events`. */
  async function upGave(
    events: Array<{type: string; text: string; channel?: string}>,
    result = SETUP_FAILED,
  ) {
    const {bridge} = setup(printing(events, result));
    return bridge.up(TARGET, UP_OPTIONS, () => undefined, NEVER);
  }

  it('F-0410 AC-11: a run whose raw stderr refuses the mount fails setupFailed with refusal invalidMount', async () => {
    const result = await upGave([{type: 'raw', text: MOUNT}]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? result.refusal : result,
      'invalidMount',
    );
  });

  it('F-0410 7.E1: the restart path coloured text event gives invalidMount', async () => {
    const coloured =
      '\u001b[1m\u001b[31mError response from daemon: invalid mount config for type "bind": bind source path does not exist: /tmp/x\u001b[39m\u001b[22m\r\n';
    const result = await upGave([{type: 'text', text: coloured}]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? result.refusal : result,
      'invalidMount',
    );
  });

  it('F-0410 7.E2: a port refusal that ends with a CR and an LF is read without the CR', async () => {
    const result = await upGave([
      {type: 'text', text: PORT.replace('\n', '\r\n')},
    ]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? result.refusal : result,
      'portAllocated',
    );
  });

  it('F-0410: two refusals in one event, the later line wins', async () => {
    const result = await upGave([{type: 'raw', text: MOUNT + PORT}]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? result.refusal : result,
      'portAllocated',
    );
  });

  it('F-0410 AC-12: a port refusal gives portAllocated, and the containerId stays', async () => {
    const result = await upGave([{type: 'raw', text: PORT}]);
    deepStrictEqual(
      result.kind === 'setupFailed'
        ? [result.refusal, result.containerId]
        : result,
      ['portAllocated', 'c1'],
    );
  });

  it("ADR-0010: a hook's raw output with the refusal line on its own channel gives no refusal", async () => {
    const result = await upGave([
      {type: 'raw', text: MOUNT, channel: 'postCreate'},
    ]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? 'refusal' in result : result,
      false,
    );
  });

  it('F-0410: two refusals, the last one wins', async () => {
    const result = await upGave([
      {type: 'raw', text: MOUNT},
      {type: 'raw', text: PORT},
    ]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? result.refusal : result,
      'portAllocated',
    );
  });

  it('F-0410: a refusal on a run that fails some other way leaves that result unchanged', async () => {
    const result = await upGave(
      [{type: 'raw', text: MOUNT}],
      '{"outcome":"error","message":"Command failed: docker buildx build x","description":"d"}',
    );
    deepStrictEqual(result.kind, 'buildFailed');
  });

  it('F-0410: a setupFailed with no refusal line has no refusal key', async () => {
    const result = await upGave([{type: 'raw', text: 'plain output\n'}]);
    deepStrictEqual(
      result.kind === 'setupFailed' ? 'refusal' in result : result,
      false,
    );
  });
});
