/* eslint-disable id-length -- the field names of Docker's inspect output */
import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliBridge} from '../../src/cli/cli-bridge.ts';
import type {CliTarget, UpOptions} from '../../src/cli/cli-arguments.ts';
import type {
  CliEvent,
  CliFailure,
  RunUserCommandsResult,
  UpResult,
} from '../../src/cli/cli-lines.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  containerLifecycleOf,
  type ContainerOutcome,
  type ContainerRequest,
  type ContainerStep,
} from '../../src/lifecycle/container-lifecycle.ts';
import {discoveryArguments, idLabels} from '../../src/lifecycle/labels.ts';

const FOLDER = '/w/a';
const CONFIG = '/w/a/.devcontainer/devcontainer.json';
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const REQUEST: ContainerRequest = {
  folder: FOLDER,
  configFile: CONFIG,
  dockerPath: 'docker',
  logLevel: 'info',
};
const UP: UpResult = {
  kind: 'up',
  containerId: NEW,
  remoteUser: 'vscode',
  remoteWorkspaceFolder: '/workspaces/a',
};
const LISTING = discoveryArguments(FOLDER).join(' ');

/** The `inspect` output of the containers, each `[id, status]`, with the volume mounted when `mounted`. */
function inspected(
  containers: ReadonlyArray<readonly [string, string]>,
  mounted = true,
): string {
  return JSON.stringify(
    containers.map(([containerId, status]) => ({
      Id: containerId,
      Created: '2026-10-14T03:00:28.1Z',
      State: {Status: status},
      Config: {
        Labels: {
          'devcontainer.local_folder': FOLDER,
          'devcontainer.config_file': CONFIG,
        },
      },
      Mounts: mounted
        ? [{Type: 'volume', Name: 'vscode', Destination: '/vscode'}]
        : [],
    })),
  );
}

function ran(stdout: string): EngineRunOutcome {
  return {kind: 'ran', status: 0, stdout, stderr: ''};
}

function exited(stderr: string, status = 1): EngineRunOutcome {
  return {kind: 'ran', status, stdout: '', stderr};
}

/** An engine answering each command line from its queue; the last answer repeats. */
function scriptedEngine(
  script: Record<string, EngineRunOutcome[]>,
  aborting?: {controller: AbortController; on: string},
): EngineHost & {commands: string[]; environments: unknown[]} {
  const commands: string[] = [];
  const environments: unknown[] = [];
  return {
    commands,
    environments,
    run: (argv, input, options) => {
      const key = argv.join(' ');
      commands.push(key);
      environments.push(options.environment);
      const queue = script[key] ?? [];
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      if (key === aborting?.on) {
        aborting.controller.abort();
      }
      return Promise.resolve(
        answer ?? {kind: 'failed', detail: `no answer for ${key}`},
      );
    },
    spawn: () => Promise.reject(new Error('the lifecycle never spawns')),
  };
}

interface FakeBridge extends CliBridge {
  ups: Array<{target: CliTarget; options: UpOptions}>;
  runs: Array<{containerId: string; signal: AbortSignal}>;
  upResult: UpResult;
  runResult: Promise<RunUserCommandsResult>;
}

function fakeBridge(): FakeBridge {
  const bridge: FakeBridge = {
    ups: [],
    runs: [],
    upResult: UP,
    runResult: Promise.resolve({kind: 'done'}),
    up: (target, options) => {
      bridge.ups.push({target, options});
      return Promise.resolve(bridge.upResult);
    },
    runUserCommands: (target, containerId, onEvent, signal) => {
      bridge.runs.push({containerId, signal});
      return bridge.runResult;
    },
    readConfiguration: () => Promise.reject(new Error('never read')),
  };
  return bridge;
}

const EMPTY_LISTING = {[LISTING]: [ran('')]};

async function settle(): Promise<void> {
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

/** Runs one `prepare`, giving the steps, the outcome, the log lines and the bridge. */
async function prepared(
  engine: EngineHost,
  bridge = fakeBridge(),
  cancellation = new AbortController().signal,
): Promise<{
  steps: ContainerStep[];
  outcome: ContainerOutcome;
  lines: string[];
  bridge: FakeBridge;
  events: CliEvent[];
}> {
  const sink = new MemorySink();
  const lifecycle = containerLifecycleOf({
    engine,
    cli: bridge,
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  });
  const steps: ContainerStep[] = [];
  const events: CliEvent[] = [];
  const outcome = await lifecycle.prepare(
    REQUEST,
    step => steps.push(step),
    event => events.push(event),
    cancellation,
  );
  await settle();
  return {
    steps,
    outcome,
    lines: sink.lines.map(line => `${line.level}: ${line.message}`),
    bridge,
    events,
  };
}

describe('containerLifecycleOf', () => {
  it('creates when the folder has no container and reads the volume', async () => {
    const result = await prepared(
      scriptedEngine({
        ...EMPTY_LISTING,
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
    );
    deepStrictEqual(
      {
        steps: result.steps,
        outcome: result.outcome,
        ups: result.bridge.ups,
        runs: result.bridge.runs.map(run => run.containerId),
        lines: result.lines,
      },
      {
        steps: ['findingContainer', 'startingContainer', 'containerReady'],
        outcome: {
          kind: 'ready',
          containerId: NEW,
          remoteUser: 'vscode',
          remoteWorkspaceFolder: '/workspaces/a',
          volumeMounted: true,
          created: true,
        },
        ups: [
          {
            target: {
              workspaceFolder: FOLDER,
              configFile: CONFIG,
              dockerPath: 'docker',
              idLabels: idLabels(FOLDER, CONFIG),
              mountWorkspaceGitRoot: true,
              mounts: ['type=volume,source=vscode,target=/vscode'],
              logLevel: 'info',
            },
            options: {removeExistingContainer: false, buildNoCache: false},
          },
        ],
        runs: [NEW],
        lines: ['info: the lifecycle commands finished'],
      },
    );
  });

  it('uses a running container of the pair and reports it as not created', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${NEW}\n`)],
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']], false)),
        ],
      }),
    );
    deepStrictEqual(result.outcome, {
      kind: 'ready',
      containerId: NEW,
      remoteUser: 'vscode',
      remoteWorkspaceFolder: '/workspaces/a',
      volumeMounted: false,
      created: false,
    });
  });

  it("F-0409 AC-7 (C7's half) and AC-46 (C7's half): a paused or restarting container is unusable and the CLI is not called", async () => {
    const outcomes = [];
    for (const status of ['paused', 'restarting']) {
      const result = await prepared(
        scriptedEngine({
          [LISTING]: [ran(`${OLD}\n`)],
          [`inspect --type container ${OLD}`]: [
            ran(inspected([[OLD, status]])),
          ],
        }),
      );
      outcomes.push({
        outcome: result.outcome,
        ups: result.bridge.ups.length,
        steps: result.steps,
      });
    }
    deepStrictEqual(outcomes, [
      {
        outcome: {kind: 'unusable', containerId: OLD, status: 'paused'},
        ups: 0,
        steps: ['findingContainer'],
      },
      {
        outcome: {kind: 'unusable', containerId: OLD, status: 'restarting'},
        ups: 0,
        steps: ['findingContainer'],
      },
    ]);
  });

  it('reports a listing that could not start, without calling the CLI', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [{kind: 'failed', detail: 'spawn dk ENOENT'}],
      }),
    );
    deepStrictEqual(
      {outcome: result.outcome, ups: result.bridge.ups.length},
      {outcome: {kind: 'discoveryFailed', detail: 'spawn dk ENOENT'}, ups: 0},
    );
  });

  it('names the first stderr line of a failing command, or its status', async () => {
    const lines = [];
    for (const answer of [exited('denied\nmore'), exited('', 125)]) {
      lines.push(
        (await prepared(scriptedEngine({[LISTING]: [answer]}))).outcome,
      );
    }
    deepStrictEqual(lines, [
      {kind: 'discoveryFailed', detail: 'denied'},
      {kind: 'discoveryFailed', detail: 'docker ended with status 125'},
    ]);
  });

  it('reports an inspect failure other than a vanished container', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [`inspect --type container ${OLD}`]: [exited('daemon is down')],
      }),
    );
    deepStrictEqual(result.outcome, {
      kind: 'discoveryFailed',
      detail: 'daemon is down',
    });
  });

  it('reports an inspect output that cannot be read', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [`inspect --type container ${OLD}`]: [ran('nonsense')],
      }),
    );
    deepStrictEqual(result.outcome, {
      kind: 'discoveryFailed',
      detail: 'inspect: not JSON',
    });
  });

  for (const text of [
    `Error response from daemon: No such container: ${OLD}`,
    `Error: No such container: ${OLD}`,
  ]) {
    it(`runs discovery again when a container vanished (${text.slice(0, 12)})`, async () => {
      const engine = scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`), ran('')],
        [`inspect --type container ${OLD}`]: [exited(text)],
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      });
      const result = await prepared(engine);
      deepStrictEqual(
        {
          kind: result.outcome.kind,
          listings: engine.commands.filter(command => command === LISTING)
            .length,
        },
        {kind: 'ready', listings: 2},
      );
    });

    it(`fails when a container vanishes twice (${text.slice(0, 12)})`, async () => {
      const result = await prepared(
        scriptedEngine({
          [LISTING]: [ran(`${OLD}\n`)],
          [`inspect --type container ${OLD}`]: [exited(text)],
        }),
      );
      deepStrictEqual(result.outcome, {
        kind: 'discoveryFailed',
        detail: 'a container disappeared during discovery',
      });
    });
  }

  it('returns each failure of up unchanged and starts no lifecycle commands', async () => {
    const failures: CliFailure[] = [
      {
        kind: 'lifecycleFailed',
        hook: 'onCreateCommand',
        part: undefined,
        message: 'm',
        containerId: NEW,
      },
      {kind: 'configurationFailed', message: 'm'},
      {kind: 'buildFailed', message: 'm'},
      {kind: 'pullFailed', message: 'm'},
      {
        kind: 'setupFailed',
        message: 'm',
        description: 'mount collision at /vscode',
        containerId: undefined,
      },
      {kind: 'noResult', status: 1},
      {kind: 'malformedResult', field: 'containerId'},
      {kind: 'spawnFailed', message: 'm'},
      {kind: 'cancelled'},
    ];
    const seen = [];
    for (const failure of failures) {
      const bridge = fakeBridge();
      bridge.upResult = failure;
      const result = await prepared(scriptedEngine(EMPTY_LISTING), bridge);
      seen.push([result.outcome, bridge.runs.length]);
    }
    deepStrictEqual(
      seen,
      failures.map(failure => [failure, 0]),
    );
  });

  it("warns with both short ids when the CLI used another container and goes on with the CLI's", async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [`inspect --type container ${OLD}`]: [
          ran(inspected([[OLD, 'exited']])),
        ],
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
    );
    deepStrictEqual(
      {
        containerId:
          result.outcome.kind === 'ready' ? result.outcome.containerId : '',
        lines: result.lines,
      },
      {
        containerId: NEW,
        lines: [
          'warn: the dev container CLI used bbbbbbbbbbbb where aaaaaaaaaaaa was chosen',
          'info: the lifecycle commands finished',
        ],
      },
    );
  });

  it('warns and reports no volume when the mounts cannot be read', async () => {
    const result = await prepared(scriptedEngine(EMPTY_LISTING));
    deepStrictEqual(
      {
        mounted:
          result.outcome.kind === 'ready' && result.outcome.volumeMounted,
        lines: result.lines[0],
      },
      {
        mounted: false,
        lines: `warn: could not read the mounts of the container: no answer for inspect --type container ${NEW}`,
      },
    );
  });

  it('returns cancelled when the abort comes during the listing', async () => {
    const abort = new AbortController();
    const result = await prepared(
      scriptedEngine(EMPTY_LISTING, {controller: abort, on: LISTING}),
      fakeBridge(),
      abort.signal,
    );
    deepStrictEqual(
      {outcome: result.outcome, ups: result.bridge.ups.length},
      {outcome: {kind: 'cancelled'}, ups: 0},
    );
  });

  it('returns cancelled when the abort comes during the inspection', async () => {
    const abort = new AbortController();
    const result = await prepared(
      scriptedEngine(
        {
          [LISTING]: [ran(`${OLD}\n`)],
          [`inspect --type container ${OLD}`]: [exited('x')],
        },
        {controller: abort, on: `inspect --type container ${OLD}`},
      ),
      fakeBridge(),
      abort.signal,
    );
    deepStrictEqual(result.outcome, {kind: 'cancelled'});
  });

  it('warns once, with the kind and the hook, when the lifecycle commands fail', async () => {
    const bridge = fakeBridge();
    bridge.runResult = Promise.resolve({
      kind: 'lifecycleFailed',
      hook: 'postCreateCommand',
      part: undefined,
      message: 'Command failed: echo s3cr3t-token',
      containerId: NEW,
    });
    const result = await prepared(scriptedEngine(EMPTY_LISTING), bridge);
    deepStrictEqual(result.lines.slice(-1), [
      'warn: the lifecycle commands failed: lifecycleFailed (postCreateCommand)',
    ]);
  });

  it('warns with the kind alone for a failure that has no hook', async () => {
    const bridge = fakeBridge();
    bridge.runResult = Promise.resolve({kind: 'noResult', status: 2});
    const result = await prepared(scriptedEngine(EMPTY_LISTING), bridge);
    deepStrictEqual(result.lines.slice(-1), [
      'warn: the lifecycle commands failed: noResult',
    ]);
  });

  it('R-26: no secret reaches the log and no engine run carries an environment', async () => {
    const bridge = fakeBridge();
    bridge.runResult = Promise.resolve({
      kind: 'setupFailed',
      message: 'Command failed: echo s3cr3t-token',
      description: 's3cr3t-token',
      containerId: NEW,
    });
    const engine = scriptedEngine(EMPTY_LISTING);
    const result = await prepared(engine, bridge);
    deepStrictEqual(
      {
        leaked: result.lines.filter(line => line.includes('s3cr3t-token')),
        environments: engine.environments,
      },
      {leaked: [], environments: [undefined, undefined]},
    );
  });

  it('stopBackground aborts the signal the bridge got, and a second prepare aborts the first run', async () => {
    const bridge = fakeBridge();
    bridge.runResult = new Promise(() => undefined);
    const lifecycle = containerLifecycleOf({
      engine: scriptedEngine(EMPTY_LISTING),
      cli: bridge,
      logger: createLogger(undefined, {minimumLevel: () => 'info'}),
    });
    const signal = new AbortController().signal;
    lifecycle.stopBackground();
    await lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      signal,
    );
    await lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      signal,
    );
    const afterSecond = bridge.runs.map(run => run.signal.aborted);
    lifecycle.stopBackground();
    deepStrictEqual(
      [afterSecond, bridge.runs.map(run => run.signal.aborted)],
      [
        [true, false],
        [true, true],
      ],
    );
  });
});
