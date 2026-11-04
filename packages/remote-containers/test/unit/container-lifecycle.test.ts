/* eslint-disable id-length -- the field names of Docker's inspect output */
import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliBridge} from '../../src/cli/cli-bridge.ts';
import type {ComposeResolution} from '../../src/compose/resolver.ts';

/** A resolution of a Compose project that is ready. */
type ComposeReady = Extract<ComposeResolution, {kind: 'ready'}>;
import type {StdinOf} from '../../src/cli/cli-host.ts';
import type {
  CliTarget,
  RunUserCommandsOptions,
  UpOptions,
} from '../../src/cli/cli-arguments.ts';
import type {
  CliEvent,
  CliFailure,
  ConfigurationResult,
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
  type LifecyclePresenter,
  type ContainerLifecycle,
} from '../../src/lifecycle/container-lifecycle.ts';
import {
  composeDiscoveryArguments,
  discoveryArguments,
  idLabels,
  labelsDiscoveryArguments,
  legacyDiscoveryArguments,
  volumeIdLabels,
  legacyIdLabels,
} from '../../src/lifecycle/labels.ts';

const FOLDER = '/w/a';
const CONFIG = '/w/a/.devcontainer/devcontainer.json';
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const LEGACY = 'c'.repeat(64);
const SECOND = 'd'.repeat(64);
const REQUEST: ContainerRequest = {
  folder: FOLDER,
  configFile: CONFIG,
  dockerPath: 'docker',
  logLevel: 'info',
  cacheVolume: true,
  workspaceMountConsistency: 'cached',
  mountGitWorktreeCommonDir: false,
  features: {defaultFeatures: {}, lockfile: true},
  mounts: [],
  windowsClient: false,
  runArgs: [],
  workspaceMount: undefined,
  pausedRetry: () => Promise.resolve(false),
};
const UP: UpResult = {
  kind: 'up',
  containerId: NEW,
  remoteUser: 'vscode',
  remoteWorkspaceFolder: '/workspaces/a',
};
/** A configuration that names an image. */
const CONFIGURED: ConfigurationResult = {
  kind: 'configuration',
  configuration: {image: 'alpine'},
  workspaceFolder: '/workspaces/a',
  workspaceMount: undefined,
  mergedConfiguration: undefined,
};
const LISTING = discoveryArguments(FOLDER).join(' ');
/** The lookups of the services `app` and `db` of the Compose project `proj`. */
const APP_LOOKUP = composeDiscoveryArguments('proj', 'app').join(' ');
const DB_LOOKUP = composeDiscoveryArguments('proj', 'db').join(' ');
const LEGACY_LISTING = legacyDiscoveryArguments(FOLDER).join(' ');

/** The `inspect` output of the containers, each `[id, status]`, with the volume mounted when `mounted`, labelled `labels`. */
function inspected(
  containers: ReadonlyArray<readonly [string, string]>,
  mounted = true,
  labels: Readonly<Record<string, string>> = {
    'devcontainer.local_folder': FOLDER,
    'devcontainer.config_file': CONFIG,
  },
): string {
  return JSON.stringify(
    containers.map(([containerId, status]) => ({
      Id: containerId,
      Created: '2026-10-14T03:00:28.1Z',
      State: {Status: status},
      Config: {Labels: labels},
      Mounts: mounted
        ? [{Type: 'volume', Name: 'vscode', Destination: '/vscode'}]
        : [],
    })),
  );
}

/** The `inspect` output of legacy-labelled containers, each `[id, status]`, with the volume mounted. */
function legacyInspected(
  containers: ReadonlyArray<readonly [string, string]>,
): string {
  return JSON.stringify(
    containers.map(([containerId, status]) => ({
      Id: containerId,
      Created: '2026-10-14T03:00:28.1Z',
      State: {Status: status},
      Config: {
        Labels: {
          'vsch.local.folder': FOLDER,
          'vsch.quality': 'stable',
        },
      },
      Mounts: [{Type: 'volume', Name: 'vscode', Destination: '/vscode'}],
    })),
  );
}

/** The engine's script of a discovery that finds the standard container `OLD` alone, in `status`. */
function standardListing(status: string): Record<string, EngineRunOutcome[]> {
  return {
    [LISTING]: [ran(`${OLD}\n`)],
    [LEGACY_LISTING]: [ran('')],
    [`inspect --type container ${OLD}`]: [ran(inspected([[OLD, status]]))],
    'volume create vscode': [ran('vscode')],
  };
}

/** The engine's script of a discovery that finds the legacy container alone, running. */
function legacyListing(): Record<string, EngineRunOutcome[]> {
  return {
    [LISTING]: [ran('')],
    [LEGACY_LISTING]: [ran(`${LEGACY}\n`)],
    [`inspect --type container ${LEGACY}`]: [
      ran(legacyInspected([[LEGACY, 'running']])),
    ],
    'volume create vscode': [ran('vscode')],
  };
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
  ups: Array<{
    target: CliTarget;
    options: UpOptions;
    stdin: StdinOf | undefined;
  }>;
  runs: Array<{
    target: CliTarget;
    containerId: string;
    signal: AbortSignal;
    stdin: StdinOf | undefined;
    options: RunUserCommandsOptions | undefined;
  }>;
  upResult: UpResult;
  /** What `read-configuration` gives, and how many times it was asked. */
  configuration: ConfigurationResult | CliFailure;
  reads: number;
  runResult: Promise<RunUserCommandsResult>;
  /** The events `up` and `run-user-commands` print, before they answer. */
  upEvents: CliEvent[];
  runEvents: CliEvent[];
}

function fakeBridge(): FakeBridge {
  const bridge: FakeBridge = {
    ups: [],
    runs: [],
    upResult: UP,
    configuration: CONFIGURED,
    reads: 0,
    runResult: Promise.resolve({kind: 'done'}),
    upEvents: [],
    runEvents: [],
    up: (target, options, onEvent, signal, onStdin) => {
      bridge.ups.push({target, options, stdin: onStdin});
      onStdin?.(() => undefined, 'plain');
      bridge.upEvents.forEach(onEvent);
      return Promise.resolve(bridge.upResult);
    },
    runUserCommands: (
      target,
      containerId,
      onEvent,
      signal,
      onStdin,
      options,
    ) => {
      bridge.runs.push({target, containerId, signal, stdin: onStdin, options});
      onStdin?.(() => undefined, 'plain');
      bridge.runEvents.forEach(onEvent);
      return bridge.runResult;
    },
    readConfiguration: () => {
      bridge.reads += 1;
      return Promise.resolve(bridge.configuration);
    },
    applyTemplate: () => Promise.reject(new Error('never applied')),
    outdated: () => Promise.reject(new Error('never read')),
    templateMetadata: () => Promise.reject(new Error('never read')),
  };
  return bridge;
}

/**
 * Prepares as the connector does, and starts the background run once the container is ready, with no relay variables
 * and nothing to personalize.
 */
async function prepareAndStart(
  lifecycle: ContainerLifecycle,
  ...given: Parameters<ContainerLifecycle['prepare']>
): Promise<ContainerOutcome> {
  const outcome = await lifecycle.prepare(...given);
  if (outcome.kind === 'ready') {
    lifecycle.startBackground({}, () => Promise.resolve());
  }
  return outcome;
}

const EMPTY_LISTING = {
  [LISTING]: [ran('')],
  [LEGACY_LISTING]: [ran('')],
  'volume create vscode': [ran('vscode')],
};

async function settle(): Promise<void> {
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

/** A presenter that records what it is told, in order. */
function recordingPresenter(): {
  calls: string[];
  writers: Array<(data: string) => void>;
  presenter: LifecyclePresenter;
} {
  const calls: string[] = [];
  const writers: Array<(data: string) => void> = [];
  return {
    calls,
    writers,
    presenter: {
      output: (event, runStart) => {
        calls.push(
          `output ${event.type} ${event.text.trim()} from ${String(runStart)}`,
        );
      },
      backgroundStarted: () => {
        calls.push('started');
      },
      ended: () => {
        calls.push('ended');
      },
      attachStdin: write => {
        calls.push('attach-stdin');
        writers.push(write);
      },
      terminalSize: () => ({rows: 30, columns: 100}),
    },
  };
}

/** A lifecycle over the scripted engine with an empty listing and `clock`, and the calls its presenter gets. */
function lifecycleOver(
  bridge: CliBridge,
  clock: () => number = () => 0,
): {
  calls: string[];
  presenter: LifecyclePresenter;
  lifecycle: ReturnType<typeof containerLifecycleOf>;
  sink: MemorySink;
} {
  const {calls, presenter} = recordingPresenter();
  const sink = new MemorySink();
  return {
    calls,
    presenter,
    sink,
    lifecycle: containerLifecycleOf({
      engine: scriptedEngine(EMPTY_LISTING),
      cli: bridge,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      presenter,
      clock,
    }),
  };
}

/** The messages `sink` holds at warn that say lifecycle commands were skipped. */
function skipWarningsOf(sink: MemorySink): string[] {
  return sink.lines
    .filter(line => line.level === 'warn' && line.message.includes('skipped'))
    .map(line => line.message);
}

/** A lifecycle over `bridge` after one `prepare` whose background run waits for `settleFirst`. */
async function preparedWithHeldRun(bridge: FakeBridge): Promise<{
  calls: string[];
  lifecycle: ReturnType<typeof containerLifecycleOf>;
  settleFirst: (result: RunUserCommandsResult) => void;
  prepareAgain: () => Promise<ContainerOutcome>;
}> {
  const first: {settle?: (result: RunUserCommandsResult) => void} = {};
  bridge.runResult = new Promise(resolve => {
    first.settle = resolve;
  });
  const {calls, lifecycle} = lifecycleOver(bridge);
  async function prepareAgain(): Promise<ContainerOutcome> {
    return prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
  }
  await prepareAgain();
  return {
    calls,
    lifecycle,
    settleFirst: result => first.settle?.(result),
    prepareAgain,
  };
}

/** A raw or start event of the `postCreate` channel, or of no channel. */
function lifecycleEvent(
  type: 'raw' | 'start' | 'stop',
  text: string,
  channel: string | undefined,
): CliEvent {
  return {
    kind: 'log',
    level: 3,
    text,
    channel,
    type,
    timestamp: 1000,
    startTimestamp: undefined,
  };
}

/** Runs one `prepare`, giving the steps, the outcome, the log lines and the bridge. */
/** What a run's single `up` was given for its mounts, and whether the run read a mounted volume. */
function mountings(result: {
  bridge: FakeBridge;
  outcome: ContainerOutcome;
}): [unknown, boolean] {
  return [
    result.bridge.ups.length === 1
      ? result.bridge.ups[0]?.target.mounts
      : ['no up'],
    result.outcome.kind === 'ready' && result.outcome.volumeMounted,
  ];
}

/** What a run's single `up` was given for its id labels, or none when it never ran. */
function targetIdLabels(result: {bridge: FakeBridge}): readonly string[] {
  return result.bridge.ups.length === 1
    ? (result.bridge.ups[0]?.target.idLabels ?? [])
    : [];
}

async function prepared(
  engine: EngineHost,
  bridge = fakeBridge(),
  cancellation = new AbortController().signal,
  request: ContainerRequest = REQUEST,
): Promise<{
  steps: ContainerStep[];
  outcome: ContainerOutcome;
  lines: string[];
  bridge: FakeBridge;
  events: CliEvent[];
  presented: string[];
}> {
  const sink = new MemorySink();
  const {calls, presenter} = recordingPresenter();
  const lifecycle = containerLifecycleOf({
    engine,
    cli: bridge,
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
    presenter,
    clock: () => 5000,
  });
  const steps: ContainerStep[] = [];
  const events: CliEvent[] = [];
  const outcome = await prepareAndStart(
    lifecycle,
    request,
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
    presented: calls,
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
        ups: result.bridge.ups.map(up => ({
          target: up.target,
          options: up.options,
        })),
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
              mountGitWorktreeCommonDir: false,
              features: {defaultFeatures: {}, lockfile: true},
              mounts: ['type=volume,source=vscode,target=/vscode'],
              logLevel: 'info',
              terminalSize: {rows: 30, columns: 100},
            },
            options: {
              removeExistingContainer: false,
              buildNoCache: false,
              workspaceMountConsistency: 'cached',
            },
          },
        ],
        runs: [NEW, NEW],
        lines: ['info: the lifecycle commands finished'],
      },
    );
  });

  it('uses a running container of the pair and reports it as not created', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${NEW}\n`)],
        [LEGACY_LISTING]: [ran('')],
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
      const result = await prepared(scriptedEngine(standardListing(status)));
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
        [LEGACY_LISTING]: [ran('')],
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
        [LEGACY_LISTING]: [ran('')],
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
        [LEGACY_LISTING]: [ran('')],
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
        [LEGACY_LISTING]: [ran('')],
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
          [LEGACY_LISTING]: [ran('')],
          [`inspect --type container ${OLD}`]: [exited(text)],
        }),
      );
      deepStrictEqual(result.outcome, {
        kind: 'discoveryFailed',
        detail: 'a container disappeared during discovery',
      });
    });
  }

  for (const [name, stderr] of [
    [
      'a WARNING line that mentions it',
      `WARNING: lost track: No such container: ${OLD}\n`,
    ],
    [
      'a line with a prefix before the form',
      `x: Error: No such container: ${OLD}\n`,
    ],
  ] as const) {
    it(`reports ${name} as a failure to inspect, with no second discovery`, async () => {
      const engine = scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [LEGACY_LISTING]: [ran('')],
        [`inspect --type container ${OLD}`]: [exited(stderr)],
      });
      const result = await prepared(engine);
      deepStrictEqual(
        [
          result.outcome.kind,
          engine.commands.filter(command => command === LISTING).length,
        ],
        ['discoveryFailed', 1],
      );
    });
  }

  it('finds the form on a later line and under a carriage return', async () => {
    const engine = scriptedEngine({
      [LISTING]: [ran(`${OLD}\n`), ran('')],
      [LEGACY_LISTING]: [ran('')],
      [`inspect --type container ${OLD}`]: [
        exited(`WARNING: slow\r\nError: No such container: ${OLD}\r\n`),
      ],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
    });
    const result = await prepared(engine);
    deepStrictEqual(
      [
        result.outcome.kind,
        engine.commands.filter(command => command === LISTING).length,
      ],
      ['ready', 2],
    );
  });

  /** A rebuild of a folder whose one container, `OLD`, has the state `status`; the CLI gives `NEW`. */
  function rebuiltFrom(status: string, buildNoCache = false) {
    return prepared(
      scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [LEGACY_LISTING]: [ran('')],
        [`inspect --type container ${OLD}`]: [ran(inspected([[OLD, status]]))],
        [`rm --force ${OLD}`]: [ran('')],
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
        'volume create vscode': [ran('vscode')],
      }),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, rebuild: {buildNoCache}},
    );
  }

  it('F-0408 AC-14, 6.2: a container that already runs gets no starting step, and an exited one, none at all and a rebuild of a running one each get it before the container is ready', async () => {
    const steps: Record<string, readonly string[]> = {};
    for (const status of ['running', 'exited']) {
      const result = await prepared(
        scriptedEngine({
          ...standardListing(status),
          [`inspect --type container ${NEW}`]: [
            ran(inspected([[NEW, 'running']])),
          ],
        }),
      );
      steps[status] = result.steps;
    }
    steps.none = (
      await prepared(
        scriptedEngine({
          ...EMPTY_LISTING,
          [`inspect --type container ${NEW}`]: [
            ran(inspected([[NEW, 'running']])),
          ],
        }),
      )
    ).steps;
    steps.rebuild = (await rebuiltFrom('running')).steps;
    const started = ['findingContainer', 'startingContainer', 'containerReady'];
    deepStrictEqual(steps, {
      running: ['findingContainer', 'containerReady'],
      exited: started,
      none: started,
      rebuild: started,
    });
  });

  it('F-0405 BR-3: a rebuild runs up with removeExistingContainer, always creates, and logs what it removes', async () => {
    const result = await rebuiltFrom('running');
    deepStrictEqual(
      [
        result.bridge.ups.map(each => each.options),
        result.outcome.kind === 'ready' && result.outcome.created,
        result.lines,
      ],
      [
        [
          {
            removeExistingContainer: true,
            buildNoCache: false,
            workspaceMountConsistency: 'cached',
          },
        ],
        true,
        [
          'info: rebuilding: removed the container aaaaaaaaaaaa',
          'info: rebuilding: the dev container CLI removes aaaaaaaaaaaa first',
          'info: the lifecycle commands finished',
        ],
      ],
    );
  });

  it('F-0405 5.1: a no-cache rebuild passes buildNoCache, and a folder with no container logs that', async () => {
    const result = await prepared(
      scriptedEngine(EMPTY_LISTING),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, rebuild: {buildNoCache: true}},
    );
    deepStrictEqual(
      [result.bridge.ups.map(each => each.options), result.lines[0]],
      [
        [
          {
            removeExistingContainer: true,
            buildNoCache: true,
            workspaceMountConsistency: 'cached',
          },
        ],
        'info: rebuilding: the dev container CLI removes no container first',
      ],
    );
  });

  it('F-0405 6.9: a rebuild replaces a paused container instead of failing', async () => {
    const result = await rebuiltFrom('paused');
    deepStrictEqual(
      [result.outcome.kind, result.bridge.ups.length],
      ['ready', 1],
    );
  });

  it('F-0405 BR-3: a rebuild whose container gets another id writes no warning about it', async () => {
    const result = await rebuiltFrom('exited');
    deepStrictEqual(
      result.lines.filter(line => line.includes('was chosen')),
      [],
    );
  });

  /** An open of a paused container whose retry is `retried`, over `listing`; the CLI gives `NEW`. */
  function retried(
    listing: Record<string, EngineRunOutcome[]>,
    script: Record<string, EngineRunOutcome[]> = {},
    options: {request?: Partial<ContainerRequest>; abort?: boolean} = {},
  ) {
    const asked: string[] = [];
    const controller = new AbortController();
    return prepared(
      scriptedEngine(
        {
          ...listing,
          [`stop ${OLD}`]: [ran('')],
          [`inspect --type container ${NEW}`]: [
            ran(inspected([[NEW, 'running']])),
          ],
          ...script,
        },
        options.abort === true ? {controller, on: `stop ${OLD}`} : undefined,
      ),
      fakeBridge(),
      controller.signal,
      {
        ...REQUEST,
        pausedRetry: containerId => {
          asked.push(containerId);
          return Promise.resolve(true);
        },
        ...options.request,
      },
    ).then(result => ({...result, asked}));
  }

  it("F-0409 AC-22, ruling 12 (C7's half): a paused container whose retry is taken is stopped, then started by up under its own labels", async () => {
    const result = await retried(standardListing('paused'));
    deepStrictEqual(
      {
        asked: result.asked,
        outcome: result.outcome.kind,
        steps: result.steps,
        stops: result.bridge.ups.length,
        idLabels: targetIdLabels(result),
        lines: result.lines.filter(line => line.includes('retrying')),
      },
      {
        asked: [OLD],
        outcome: 'ready',
        steps: ['findingContainer', 'startingContainer', 'containerReady'],
        stops: 1,
        idLabels: idLabels(FOLDER, CONFIG),
        lines: ['info: retrying: stopped the paused container aaaaaaaaaaaa'],
      },
    );
  });

  it("F-0409 AC-22, ruling 12: the stop is the engine's stop of the full id, and comes before up", async () => {
    const engine = scriptedEngine({
      ...standardListing('paused'),
      [`stop ${OLD}`]: [ran('')],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
    });
    await prepared(engine, fakeBridge(), new AbortController().signal, {
      ...REQUEST,
      pausedRetry: () => Promise.resolve(true),
    });
    deepStrictEqual(engine.commands.slice(-3), [
      `stop ${OLD}`,
      'volume create vscode',
      `inspect --type container ${NEW}`,
    ]);
  });

  it('F-0409 AC-22: a paused legacy container whose retry is taken is started under the legacy labels', async () => {
    const result = await retried({
      [LISTING]: [ran('')],
      [LEGACY_LISTING]: [ran(`${OLD}\n`)],
      [`inspect --type container ${OLD}`]: [
        ran(legacyInspected([[OLD, 'paused']])),
      ],
    });
    deepStrictEqual(
      [result.outcome.kind, targetIdLabels(result)],
      ['ready', legacyIdLabels(FOLDER)],
    );
  });

  it('F-0409 AC-7, ruling 12: without a retry a paused container stays unusable, and the retry is asked only for a paused one on an ordinary open', async () => {
    const asked: string[] = [];
    const request: ContainerRequest = {
      ...REQUEST,
      pausedRetry: containerId => {
        asked.push(containerId);
        return Promise.resolve(false);
      },
    };
    const paused = await prepared(
      scriptedEngine(standardListing('paused')),
      fakeBridge(),
      new AbortController().signal,
      request,
    );
    const restarting = await prepared(
      scriptedEngine(standardListing('restarting')),
      fakeBridge(),
      new AbortController().signal,
      request,
    );
    const rebuilt = await prepared(
      scriptedEngine({
        ...standardListing('paused'),
        [`rm --force ${OLD}`]: [ran('')],
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
      fakeBridge(),
      new AbortController().signal,
      {...request, rebuild: {buildNoCache: false}},
    );
    deepStrictEqual(
      [paused.outcome, restarting.outcome.kind, rebuilt.outcome.kind, asked],
      [
        {kind: 'unusable', containerId: OLD, status: 'paused'},
        'unusable',
        'ready',
        [OLD],
      ],
    );
  });

  it('F-0409 ruling 12: a stop that fails ends the connect without calling the CLI, with the line that says why', async () => {
    const result = await retried(standardListing('paused'), {
      [`stop ${OLD}`]: [exited('Error response from daemon: cannot stop')],
    });
    deepStrictEqual(
      [result.outcome, result.bridge.ups.length],
      [
        {
          kind: 'discoveryFailed',
          detail:
            "the paused container aaaaaaaaaaaa couldn't be stopped: Error response from daemon: cannot stop",
        },
        0,
      ],
    );
  });

  it('F-0409 ruling 12: a connect cancelled while the stop runs is cancelled, and calls no CLI', async () => {
    const result = await retried(standardListing('paused'), {}, {abort: true});
    deepStrictEqual(
      [result.outcome, result.bridge.ups.length],
      [{kind: 'cancelled'}, 0],
    );
  });

  /** An open whose `up` fails with a build failure, over an engine that answers `script` and the request `request`. */
  function failingUp(
    script: Record<string, EngineRunOutcome[]>,
    request: ContainerRequest = REQUEST,
    during?: (bridge: FakeBridge) => void,
  ) {
    const bridge = fakeBridge();
    bridge.upResult = {kind: 'buildFailed', message: 'm'};
    during?.(bridge);
    return prepared(
      scriptedEngine(script),
      bridge,
      new AbortController().signal,
      request,
    ).then(result => result.outcome);
  }

  it('F-0409 AC-34, ruling 14: a failure of up names the container the engine holds afterwards, one the connect kept or one it made, and none when there is none', async () => {
    const failed = {kind: 'buildFailed', message: 'm'};
    const made = {
      [LISTING]: [ran(''), ran(`${NEW}\n`)],
      [LEGACY_LISTING]: [ran('')],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'created']]))],
    };
    const removed = {
      ...standardListing('exited'),
      [`rm --force ${OLD}`]: [ran('')],
      [LISTING]: [ran(`${OLD}\n`), ran('')],
    };
    const unreadable: Record<string, EngineRunOutcome[]> = {
      [LISTING]: [ran(''), {kind: 'failed', detail: 'spawn dk ENOENT'}],
      [LEGACY_LISTING]: [ran('')],
    };
    deepStrictEqual(
      [
        await failingUp(standardListing('exited')),
        await failingUp(made),
        await failingUp(removed, {...REQUEST, rebuild: {buildNoCache: false}}),
        await failingUp(unreadable),
        await failingUp(EMPTY_LISTING),
      ],
      [
        {...failed, foundContainerId: OLD},
        {...failed, foundContainerId: NEW},
        failed,
        failed,
        failed,
      ],
    );
  });

  it('F-0409 AC-34: a failure of up in a cancelled connect looks for no container', async () => {
    const engine = scriptedEngine(standardListing('exited'));
    const controller = new AbortController();
    const bridge = fakeBridge();
    bridge.up = () => {
      controller.abort();
      return Promise.resolve({kind: 'cancelled'});
    };
    const result = await prepared(engine, bridge, controller.signal);
    deepStrictEqual(
      [result.outcome, engine.commands.length],
      [{kind: 'cancelled'}, 4],
    );
  });

  it('F-0409: an ordinary open is unchanged: up keeps the container and a paused one is unusable', async () => {
    const result = await prepared(scriptedEngine(standardListing('paused')));
    deepStrictEqual(
      [result.outcome.kind, result.bridge.ups.length],
      ['unusable', 0],
    );
  });

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
        ...standardListing('exited'),
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
          [LEGACY_LISTING]: [ran('')],
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
      {leaked: [], environments: [undefined, undefined, undefined, undefined]},
    );
  });

  it('stopBackground aborts the signal the bridge got, and a second prepare aborts the first run', async () => {
    const bridge = fakeBridge();
    bridge.runResult = new Promise(() => undefined);
    const {lifecycle} = lifecycleOver(bridge);
    const signal = new AbortController().signal;
    lifecycle.stopBackground();
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      signal,
    );
    await prepareAndStart(
      lifecycle,
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

  it('F-0409 AC-1: discovery lists both label sets and inspects them once', async () => {
    const engine = scriptedEngine({
      [LISTING]: [ran(`${OLD}\n${NEW}\n`)],
      [LEGACY_LISTING]: [ran(`${NEW}\n${LEGACY}\n`)],
      [`inspect --type container ${OLD} ${NEW} ${LEGACY}`]: [
        ran(
          inspected([
            [OLD, 'running'],
            [NEW, 'running'],
            [LEGACY, 'running'],
          ]),
        ),
      ],
      'volume create vscode': [ran('vscode')],
    });
    const result = await prepared(engine);
    deepStrictEqual(
      {commands: engine.commands, kind: result.outcome.kind},
      {
        commands: [
          LISTING,
          LEGACY_LISTING,
          `inspect --type container ${OLD} ${NEW} ${LEGACY}`,
          'volume create vscode',
          `inspect --type container ${NEW}`,
        ],
        kind: 'ready',
      },
    );
  });

  it('F-0409: a failed legacy query is a discovery failure', async () => {
    const engine = scriptedEngine({
      [LISTING]: [ran('')],
      [LEGACY_LISTING]: [{kind: 'failed', detail: 'legacy daemon is down'}],
    });
    const result = await prepared(engine);
    deepStrictEqual(
      {
        outcome: result.outcome,
        ups: result.bridge.ups.length,
        commands: engine.commands,
      },
      {
        outcome: {
          kind: 'discoveryFailed',
          detail: 'legacy daemon is down',
        },
        ups: 0,
        commands: [LISTING, LEGACY_LISTING],
      },
    );
  });

  it('F-0409 AC-1: a legacy container is brought up with the legacy id labels', async () => {
    const engine = scriptedEngine(legacyListing());
    const bridge = fakeBridge();
    bridge.upResult = {...UP, containerId: LEGACY};
    const result = await prepared(engine, bridge);
    deepStrictEqual(
      {
        outcome: result.outcome,
        idLabels: targetIdLabels(result),
      },
      {
        outcome: {
          kind: 'ready',
          containerId: LEGACY,
          remoteUser: 'vscode',
          remoteWorkspaceFolder: '/workspaces/a',
          volumeMounted: true,
          created: false,
        },
        idLabels: legacyIdLabels(FOLDER),
      },
    );
  });

  it('F-0411 3.2: the worktree setting and the consistency of the request reach the up of a new container, with the target of its reads', async () => {
    const results = [];
    for (const request of [
      REQUEST,
      {
        ...REQUEST,
        workspaceMountConsistency: 'delegated',
        mountGitWorktreeCommonDir: true,
        features: {defaultFeatures: {}, lockfile: true},
      },
    ]) {
      const result = await prepared(
        scriptedEngine(EMPTY_LISTING),
        fakeBridge(),
        new AbortController().signal,
        request,
      );
      results.push(
        result.bridge.ups.map(up => [
          up.target.mountGitWorktreeCommonDir,
          up.options.workspaceMountConsistency,
        ]),
      );
    }
    deepStrictEqual(results, [[[false, 'cached']], [[true, 'delegated']]]);
  });

  it('F-0411 7.E5: a consistency outside the enum reaches the CLI as written', async () => {
    const result = await prepared(
      scriptedEngine(EMPTY_LISTING),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, workspaceMountConsistency: 'fast'},
    );
    deepStrictEqual(
      result.bridge.ups.map(up => up.options.workspaceMountConsistency),
      ['fast'],
    );
  });

  it('F-0419 AC-3: cacheVolume false mounts nothing', async () => {
    const result = await prepared(
      scriptedEngine(EMPTY_LISTING),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, cacheVolume: false},
    );
    deepStrictEqual(mountings(result), [[], false]);
  });

  it('F-0419: cacheVolume true mounts the volume', async () => {
    const result = await prepared(
      scriptedEngine({
        ...EMPTY_LISTING,
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
    );
    deepStrictEqual(mountings(result), [
      ['type=volume,source=vscode,target=/vscode'],
      true,
    ]);
  });
  /** A fresh connect's engine: an empty listing, and the CLI's `NEW` running with the volume mounted. */
  function freshEngine(overrides: Record<string, EngineRunOutcome[]> = {}) {
    return scriptedEngine({
      ...EMPTY_LISTING,
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
      ...overrides,
    });
  }

  it('F-0419 AC-29: with cacheVolume on, the vscode volume is created before up', async () => {
    const engine = freshEngine();
    const bridge = fakeBridge();
    await prepared(engine, bridge);
    deepStrictEqual(
      [engine.commands, bridge.ups.length],
      [
        [
          LISTING,
          LEGACY_LISTING,
          'volume create vscode',
          `inspect --type container ${NEW}`,
        ],
        1,
      ],
    );
  });

  it('F-0419 AC-3: with cacheVolume off, no volume is created', async () => {
    const engine = freshEngine();
    const bridge = fakeBridge();
    await prepared(engine, bridge, new AbortController().signal, {
      ...REQUEST,
      cacheVolume: false,
    });
    deepStrictEqual(
      [bridge.ups.length, engine.commands.includes('volume create vscode')],
      [1, false],
    );
  });

  it('F-0419 AC-29: a volume that can not be created is logged at warn, and up still runs', async () => {
    const engine = freshEngine({
      'volume create vscode': [exited('no space left on device')],
    });
    const bridge = fakeBridge();
    const result = await prepared(engine, bridge);
    deepStrictEqual(
      [
        result.lines.filter(line =>
          line.startsWith(
            'warn: the vscode volume could not be created before the build:',
          ),
        ).length,
        bridge.ups.length,
      ],
      [1, 1],
    );
  });

  it('containers-101, F-0201 AC-4: Podman fails to create a volume that exists as Podman 5.8.9 words it, and the volume that is there is enough: nothing is logged, and up still runs', async () => {
    const engine = freshEngine({
      'volume create vscode': [
        exited(
          'Error: volume with name vscode already exists: volume already exists',
        ),
      ],
      'volume inspect vscode': [ran('[{"Name":"vscode"}]')],
    });
    const bridge = fakeBridge();
    const result = await prepared(engine, bridge);
    deepStrictEqual(
      [
        result.lines.filter(line => line.includes('vscode volume')),
        engine.commands.filter(command => command.startsWith('volume ')),
        bridge.ups.length,
      ],
      [[], ['volume create vscode', 'volume inspect vscode'], 1],
    );
  });

  /** A rebuild `prepare` over the engine, with the default bridge and a fresh signal. */
  async function rebuilt(
    engine: EngineHost,
    cancellation: AbortSignal = new AbortController().signal,
  ) {
    return prepared(engine, fakeBridge(), cancellation, {
      ...REQUEST,
      rebuild: {buildNoCache: false},
    });
  }

  it('F-0405 with F-0409: a rebuild removes the legacy container first, and uses the standard labels', async () => {
    const engine = scriptedEngine({
      ...legacyListing(),
      [`rm --force ${LEGACY}`]: [ran('')],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
    });
    const result = await rebuilt(engine);
    deepStrictEqual(
      {
        commands: engine.commands,
        idLabels: targetIdLabels(result),
        lines: result.lines,
      },
      {
        commands: [
          LISTING,
          LEGACY_LISTING,
          `inspect --type container ${LEGACY}`,
          `rm --force ${LEGACY}`,
          'volume create vscode',
          `inspect --type container ${NEW}`,
        ],
        idLabels: idLabels(FOLDER, CONFIG),
        lines: [
          `info: rebuilding: removed the legacy container ${LEGACY.slice(0, 12)}`,
          `info: rebuilding: the dev container CLI removes ${LEGACY.slice(0, 12)} first`,
          'info: the lifecycle commands finished',
        ],
      },
    );
  });

  it('F-0405 with F-0409: a failed legacy removal stops the rebuild', async () => {
    const engine = scriptedEngine({
      ...legacyListing(),
      [`rm --force ${LEGACY}`]: [exited('device or resource busy')],
    });
    const result = await rebuilt(engine);
    deepStrictEqual(
      {
        outcome: result.outcome,
        ups: result.bridge.ups.length,
        commands: engine.commands,
      },
      {
        outcome: {
          kind: 'discoveryFailed',
          detail: `the legacy container ${LEGACY.slice(
            0,
            12,
          )} couldn't be removed: device or resource busy`,
        },
        ups: 0,
        commands: [
          LISTING,
          LEGACY_LISTING,
          `inspect --type container ${LEGACY}`,
          `rm --force ${LEGACY}`,
        ],
      },
    );
  });

  it('F-0405 with F-0409: an abort during a legacy removal is cancelled, with no up and no further removals', async () => {
    const abort = new AbortController();
    const engine = scriptedEngine(
      {
        [LISTING]: [ran('')],
        [LEGACY_LISTING]: [ran(`${LEGACY}\n${SECOND}\n`)],
        [`inspect --type container ${LEGACY} ${SECOND}`]: [
          ran(
            legacyInspected([
              [LEGACY, 'running'],
              [SECOND, 'running'],
            ]),
          ),
        ],
        [`rm --force ${LEGACY}`]: [ran('')],
      },
      {controller: abort, on: `rm --force ${LEGACY}`},
    );
    const result = await rebuilt(engine, abort.signal);
    deepStrictEqual(
      {
        outcome: result.outcome,
        ups: result.bridge.ups.length,
        removals: engine.commands.filter(command => command.startsWith('rm ')),
      },
      {
        outcome: {kind: 'cancelled'},
        ups: 0,
        removals: [`rm --force ${LEGACY}`],
      },
    );
  });

  it('F-0405 with F-0409: a rebuild does not remove a legacy container that is already removing', async () => {
    const engine = scriptedEngine({
      [LISTING]: [ran('')],
      [LEGACY_LISTING]: [ran(`${LEGACY}\n`)],
      [`inspect --type container ${LEGACY}`]: [
        ran(legacyInspected([[LEGACY, 'removing']])),
      ],
    });
    const result = await rebuilt(engine);
    deepStrictEqual(
      {
        kind: result.outcome.kind,
        removals: engine.commands.filter(command => command.startsWith('rm ')),
      },
      {kind: 'ready', removals: []},
    );
  });

  it('F-0405: a rebuild with no container to replace removes nothing itself', async () => {
    const engine = scriptedEngine(EMPTY_LISTING);
    const result = await rebuilt(engine);
    deepStrictEqual(
      [
        result.outcome.kind,
        engine.commands.filter(command => command.startsWith('rm ')),
      ],
      ['ready', []],
    );
  });

  it('F-0405 5.0 step 3, #1307: a rebuild removes the folder’s container itself before it calls the CLI, so that the CLI’s check of the Features stops nothing', async () => {
    const order: string[] = [];
    const engine = scriptedEngine({
      [LISTING]: [ran(`${OLD}\n`)],
      [LEGACY_LISTING]: [ran('')],
      [`inspect --type container ${OLD}`]: [ran(inspected([[OLD, 'running']]))],
      [`rm --force ${OLD}`]: [ran('')],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
      'volume create vscode': [ran('vscode')],
    });
    const bridge = fakeBridge();
    const up = bridge.up.bind(bridge);
    bridge.up = (...parameters) => {
      order.push(
        ...engine.commands.filter(command => command.startsWith('rm ')),
        'up',
      );
      return up(...parameters);
    };
    await prepared(engine, bridge, new AbortController().signal, {
      ...REQUEST,
      rebuild: {buildNoCache: false},
    });
    deepStrictEqual(order, [`rm --force ${OLD}`, 'up']);
  });

  /** A rebuild of a folder whose container `OLD` runs, over a bridge that reads `configuration`. */
  async function rebuiltReading(
    configuration: ConfigurationResult | CliFailure,
  ) {
    const engine = scriptedEngine({
      ...standardListing('running'),
      [`rm --force ${OLD}`]: [ran('')],
      [`inspect --type container ${NEW}`]: [ran(inspected([[NEW, 'running']]))],
    });
    const bridge = fakeBridge();
    bridge.configuration = configuration;
    const result = await prepared(
      engine,
      bridge,
      new AbortController().signal,
      {
        ...REQUEST,
        rebuild: {buildNoCache: false},
      },
    );
    return {
      removed: engine.commands.filter(command => command.startsWith('rm ')),
      ups: result.bridge.ups.length,
      reads: result.bridge.reads,
      lines: result.lines,
    };
  }

  it('F-0405 AC-31: a configuration that names no container source removes nothing, and the CLI’s up still runs', async () => {
    const result = await rebuiltReading({
      ...CONFIGURED,
      configuration: {name: 'bare', image: ''},
    });
    deepStrictEqual(
      [
        result.removed,
        result.ups,
        result.reads,
        result.lines.includes(
          'info: rebuilding: the configuration names no container source; the existing container is kept',
        ),
      ],
      [[], 1, 1, true],
    );
  });

  it('F-0405 AC-31: a configuration that cannot be read removes nothing', async () => {
    const result = await rebuiltReading({
      kind: 'malformedResult',
      field: 'configuration',
    });
    deepStrictEqual(
      [
        result.removed,
        result.lines.includes(
          'info: rebuilding: the configuration could not be read; the existing container is kept',
        ),
      ],
      [[], true],
    );
  });

  it('F-0405 AC-31: a configuration that names a source removes the container before up, as it did', async () => {
    const result = await rebuiltReading(CONFIGURED);
    deepStrictEqual([result.removed, result.reads], [[`rm --force ${OLD}`], 1]);
  });

  it('F-0405 AC-31: a rebuild cancelled while the configuration is read removes nothing and is cancelled', async () => {
    const controller = new AbortController();
    const bridge = fakeBridge();
    bridge.readConfiguration = () => {
      controller.abort();
      return Promise.resolve({kind: 'cancelled'});
    };
    const engine = scriptedEngine(standardListing('running'));
    const result = await prepared(engine, bridge, controller.signal, {
      ...REQUEST,
      rebuild: {buildNoCache: false},
    });
    deepStrictEqual(
      [
        result.outcome.kind,
        engine.commands.filter(command => command.startsWith('rm ')),
      ],
      ['cancelled', []],
    );
  });

  it('F-0405 5.0 step 3, #1307: a failed removal of a container that is not legacy stops the rebuild before the CLI', async () => {
    const result = await prepared(
      scriptedEngine({
        [LISTING]: [ran(`${OLD}\n`)],
        [LEGACY_LISTING]: [ran('')],
        [`inspect --type container ${OLD}`]: [
          ran(inspected([[OLD, 'running']])),
        ],
        [`rm --force ${OLD}`]: [exited('device or resource busy')],
      }),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, rebuild: {buildNoCache: false}},
    );
    deepStrictEqual(
      [result.outcome, result.bridge.ups.length],
      [
        {
          kind: 'discoveryFailed',
          detail: `the container ${OLD.slice(0, 12)} couldn't be removed: device or resource busy`,
        },
        0,
      ],
    );
  });

  it('F-0415 BR-8: only channel postCreate reaches the presenter, and the log keeps every event', async () => {
    const bridge = fakeBridge();
    bridge.upEvents = [
      lifecycleEvent('start', 'Run: docker x', undefined),
      lifecycleEvent('raw', 'on-create', 'postCreate'),
    ];
    const result = await prepared(scriptedEngine(EMPTY_LISTING), bridge);
    deepStrictEqual(
      [result.presented.slice(1, 2), result.events.length],
      [['output raw on-create from 5000'], 2],
    );
  });

  it('F-0415 AC-6: the progress starts before run-user-commands and the run ends when it settles, after its output', async () => {
    const bridge = fakeBridge();
    bridge.runEvents = [lifecycleEvent('raw', 'post-create', 'postCreate')];
    const result = await prepared(scriptedEngine(EMPTY_LISTING), bridge);
    deepStrictEqual(result.presented, [
      'attach-stdin',
      'started',
      'attach-stdin',
      'output raw post-create from 5000',
      'attach-stdin',
      'output raw post-create from 5000',
      'ended',
    ]);
  });

  it('F-0415 AC-6: a failed run-user-commands ends the run too', async () => {
    const bridge = fakeBridge();
    bridge.runResult = Promise.resolve({
      kind: 'lifecycleFailed',
      hook: 'postCreateCommand',
      part: undefined,
      message: '',
      containerId: NEW,
    });
    deepStrictEqual(
      (await prepared(scriptedEngine(EMPTY_LISTING), bridge)).presented,
      ['attach-stdin', 'started', 'attach-stdin', 'ended'],
    );
  });

  it('F-0415 AC-41: a failure of onCreateCommand in up ends the run, and one of initializeCommand does not', async () => {
    const results = [];
    for (const hook of ['onCreateCommand', 'initializeCommand']) {
      const bridge = fakeBridge();
      bridge.upResult = {
        kind: 'lifecycleFailed',
        hook,
        part: undefined,
        message: '',
        containerId: undefined,
      };
      results.push(
        (await prepared(scriptedEngine(EMPTY_LISTING), bridge)).presented,
      );
    }
    deepStrictEqual(results, [['attach-stdin', 'ended'], ['attach-stdin']]);
  });

  it('F-0415 AC-41: a cancel or another failure of up never ends the run', async () => {
    const results = [];
    for (const failure of [
      {kind: 'cancelled'},
      {kind: 'buildFailed', message: 'no'},
    ] as const) {
      const bridge = fakeBridge();
      bridge.upResult = failure;
      results.push(
        (await prepared(scriptedEngine(EMPTY_LISTING), bridge)).presented,
      );
    }
    deepStrictEqual(results, [['attach-stdin'], ['attach-stdin']]);
  });

  it('F-0415 AC-38: a window torn down while the commands run ends the run once; before it started, nothing', async () => {
    const bridge = fakeBridge();
    bridge.runResult = new Promise(() => undefined);
    const {calls, lifecycle} = lifecycleOver(bridge);
    lifecycle.stopBackground();
    const before = [...calls];
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    lifecycle.stopBackground();
    lifecycle.stopBackground();
    deepStrictEqual(
      [before, calls],
      [[], ['attach-stdin', 'started', 'attach-stdin', 'ended']],
    );
  });

  it('F-0415 AC-38: a run that a second prepare replaced does not end the second one when it settles', async () => {
    const bridge = fakeBridge();
    const {calls, settleFirst, prepareAgain} =
      await preparedWithHeldRun(bridge);
    bridge.runResult = new Promise(() => undefined);
    await prepareAgain();
    settleFirst({kind: 'cancelled'});
    await settle();
    deepStrictEqual(calls, [
      'attach-stdin',
      'started',
      'attach-stdin',
      'attach-stdin',
      'started',
      'attach-stdin',
    ]);
  });

  it('F-0415 AC-35: runStart is the clock at the start of prepare, in up and in the background', async () => {
    const bridge = fakeBridge();
    bridge.upEvents = [lifecycleEvent('raw', 'on-create', 'postCreate')];
    bridge.runEvents = [lifecycleEvent('raw', 'post-create', 'postCreate')];
    let now = 0;
    const {calls, lifecycle} = lifecycleOver(bridge, () => (now += 1000));
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    await settle();
    deepStrictEqual(
      calls.filter(call => call.startsWith('output')),
      [
        'output raw on-create from 1000',
        'output raw post-create from 1000',
        'output raw post-create from 1000',
      ],
    );
  });

  it('F-0415 7.E6: a window torn down after the run ended adds no second end', async () => {
    const bridge = fakeBridge();
    const {calls, lifecycle} = lifecycleOver(bridge);
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    await settle();
    lifecycle.stopBackground();
    deepStrictEqual(calls, [
      'attach-stdin',
      'started',
      'attach-stdin',
      'attach-stdin',
      'ended',
    ]);
  });

  it('F-0415 5.0 step 10: a stopped run that settles while a new prepare runs does not end the new run', async () => {
    const bridge = fakeBridge();
    const {calls, lifecycle, settleFirst, prepareAgain} =
      await preparedWithHeldRun(bridge);
    lifecycle.stopBackground();
    const held: {answer?: (result: UpResult) => void} = {};
    bridge.up = () =>
      new Promise(resolve => {
        held.answer = resolve;
      });
    bridge.runResult = new Promise(() => undefined);
    const second = prepareAgain();
    await settle();
    settleFirst({kind: 'cancelled'});
    await settle();
    held.answer?.(UP);
    await second;
    deepStrictEqual(calls, [
      'attach-stdin',
      'started',
      'attach-stdin',
      'ended',
      'started',
      'attach-stdin',
    ]);
  });

  it('F-0415 7.E6: up and run-user-commands hand their CLI stdin to the presenter, by its attachStdin', async () => {
    const bridge = fakeBridge();
    const {calls, presenter, lifecycle} = lifecycleOver(bridge);
    const outcome = await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    await settle();
    deepStrictEqual(
      [
        outcome.kind,
        bridge.ups[0]?.stdin === presenter.attachStdin,
        bridge.runs[0]?.stdin === presenter.attachStdin,
        calls.filter(call => call === 'attach-stdin'),
      ],
      ['ready', true, true, ['attach-stdin', 'attach-stdin', 'attach-stdin']],
    );
  });

  it("ADR-0011: up and run-user-commands carry the presenter's terminal size, read-configuration none", async () => {
    const bridge = fakeBridge();
    const {lifecycle} = lifecycleOver(bridge);
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    await settle();
    deepStrictEqual(
      [bridge.ups[0]?.target.terminalSize, bridge.runs[0]?.target.terminalSize],
      [
        {rows: 30, columns: 100},
        {rows: 30, columns: 100},
      ],
    );
  });

  /** One preparation of `lifecycle` with the standard request, ending at `signal`. */
  function prepareOf(
    lifecycle: ReturnType<typeof containerLifecycleOf>,
    signal: AbortSignal = new AbortController().signal,
    request: ContainerRequest = REQUEST,
  ): Promise<ContainerOutcome> {
    return prepareAndStart(
      lifecycle,
      request,
      () => undefined,
      () => undefined,
      signal,
    );
  }

  /** A lifecycle whose compose step gives `resolution`, over a fresh bridge; gives the bridge, the engine's commands and the log. */
  function composeLifecycle(
    resolution: ComposeResolution,
    bridge: FakeBridge = fakeBridge(),
    cancelling?: AbortController,
    script: Record<string, EngineRunOutcome[]> = {
      ...EMPTY_LISTING,
      [APP_LOOKUP]: [ran('')],
    },
  ): {
    bridge: FakeBridge;
    engine: ReturnType<typeof scriptedEngine>;
    lines: () => string[];
    lifecycle: ReturnType<typeof containerLifecycleOf>;
  } {
    const sink = new MemorySink();
    const engine = scriptedEngine(script);
    return {
      bridge,
      engine,
      lines: () => sink.lines.map(line => line.message),
      lifecycle: containerLifecycleOf({
        engine,
        cli: bridge,
        logger: createLogger(sink, {minimumLevel: () => 'info'}),
        presenter: recordingPresenter().presenter,
        clock: () => 0,
        userDataFolder: '/storage/data',
        compose: () => {
          cancelling?.abort();
          return Promise.resolve(resolution);
        },
      }),
    };
  }

  /** The Compose resolution of a project named `projectName`. */
  function composeReady(projectName: string): ComposeResolution {
    return {
      kind: 'ready',
      projectName,
      service: 'app',
      scope: ['app', 'db'],
      composeFile: undefined,
      serviceDockerfile: undefined,
      upEnvironment: {BUILDX_BAKE_ENTITLEMENTS_FS: '0'},
      model: {
        resolvedName: undefined,
        declaredName: undefined,
        services: new Map(),
      },
    };
  }

  it('F-0413 AC-8: the CLI runs with the project name in its environment and the data folder, for up and for the background commands', async () => {
    const bridge = fakeBridge();
    const {lifecycle} = composeLifecycle(composeReady('proj'), bridge);
    const outcome = await prepareOf(lifecycle);
    await settle();
    deepStrictEqual(
      [
        outcome.kind,
        bridge.ups[0]?.target.environment,
        bridge.ups[0]?.target.userDataFolder,
        bridge.runs[0]?.target.environment,
      ],
      [
        'ready',
        {COMPOSE_PROJECT_NAME: 'proj', BUILDX_BAKE_ENTITLEMENTS_FS: '0'},
        '/storage/data',
        {COMPOSE_PROJECT_NAME: 'proj'},
      ],
    );
  });

  /** A Compose resolution whose primary service `app` has the `volumes` entries. */
  function composeWithVolumes(volumes: readonly unknown[]): ComposeResolution {
    const ready = composeReady('proj');
    return ready.kind === 'ready'
      ? {
          ...ready,
          model: {
            ...ready.model,
            services: new Map([['app', {build: undefined, volumes}]]),
          },
        }
      : ready;
  }

  /** What a Compose prepare does with the cache volume on and the `mounts` and `volumes` it is given. */
  async function reservedRun(
    mounts: readonly unknown[],
    volumes: readonly unknown[],
    cacheVolume = true,
  ) {
    const scene = composeLifecycle(composeWithVolumes(volumes));
    const outcome = await prepareOf(
      scene.lifecycle,
      new AbortController().signal,
      {...REQUEST, mounts, cacheVolume},
    );
    return {
      outcome,
      ups: scene.bridge.ups.length,
      commands: scene.engine.commands,
    };
  }

  it('F-0419 AC-20: a mounts entry at /vscode fails the Compose connect naming mounts, before the engine or the CLI is asked for anything', async () => {
    deepStrictEqual(
      await reservedRun(['type=volume,source=d,target=/vscode/x'], []),
      {
        outcome: {
          kind: 'reservedMount',
          property: 'mounts',
          target: '/vscode/x',
        },
        ups: 0,
        commands: [],
      },
    );
  });

  it('F-0419 AC-20: a service volume below /vscode fails the Compose connect naming the service’s volumes', async () => {
    deepStrictEqual(await reservedRun([], ['data:/vscode/cache:ro']), {
      outcome: {
        kind: 'reservedMount',
        property: 'services.app.volumes',
        target: '/vscode/cache',
      },
      ups: 0,
      commands: [],
    });
  });

  it('F-0419 AC-21: a project volume named vscode mounted elsewhere is no collision', async () => {
    const run = await reservedRun([], ['vscode:/data', '/vscodex:/vscodex']);
    deepStrictEqual([run.outcome.kind, run.ups], ['ready', 1]);
  });

  it('F-0419 AC-34: with cacheVolume off a reserved target is not checked', async () => {
    const run = await reservedRun([], ['data:/vscode'], false);
    deepStrictEqual([run.outcome.kind, run.ups], ['ready', 1]);
  });

  /** What a prepare of an image configuration does with the cache volume on and the properties it is given. */
  async function imageRun(
    changes: Partial<ContainerRequest>,
  ): Promise<{outcome: ContainerOutcome; ups: number; commands: unknown[]}> {
    const scene = composeLifecycle({kind: 'none'});
    const outcome = await prepareOf(
      scene.lifecycle,
      new AbortController().signal,
      {...REQUEST, ...changes},
    );
    return {
      outcome,
      ups: scene.bridge.ups.length,
      commands: scene.engine.commands,
    };
  }

  it('F-0419 AC-14: a mounts entry at /vscode fails an image configuration naming mounts, before the engine or the CLI is asked for anything', async () => {
    deepStrictEqual(
      await imageRun({mounts: ['type=volume,source=d,target=/vscode/data']}),
      {
        outcome: {
          kind: 'reservedMount',
          property: 'mounts',
          target: '/vscode/data',
        },
        ups: 0,
        commands: [],
      },
    );
  });

  for (const runArgs of [
    ['-v', 'data:/vscode/x'],
    ['--volume=data:/vscode'],
    ['--volume', '/vscode'],
    ['--mount', 'type=bind,source=/s,target=/vscode'],
    ['--mount=type=volume,source=d,dst=/vscode/y'],
  ]) {
    it(`F-0419 AC-23: runArgs ${JSON.stringify(runArgs)} fail an image configuration naming runArgs, before anything is asked`, async () => {
      const run = await imageRun({runArgs});
      deepStrictEqual(
        [
          run.outcome.kind,
          'property' in run.outcome ? run.outcome.property : undefined,
          run.ups,
          run.commands,
        ],
        ['reservedMount', 'runArgs', 0, []],
      );
    });
  }

  it('F-0419 AC-23: a workspaceMount at /vscode fails an image configuration naming workspaceMount', async () => {
    deepStrictEqual(
      await imageRun({
        workspaceMount: 'source=/work,target=/vscode,type=bind',
      }),
      {
        outcome: {
          kind: 'reservedMount',
          property: 'workspaceMount',
          target: '/vscode',
        },
        ups: 0,
        commands: [],
      },
    );
  });

  it('F-0419 AC-14: the first reserved property is reported, in the order mounts, runArgs, workspaceMount', async () => {
    const run = await imageRun({
      mounts: ['type=volume,source=d,target=/data'],
      runArgs: ['-v', 'data:/vscode'],
      workspaceMount: 'source=/work,target=/vscode,type=bind',
    });
    deepStrictEqual(
      'property' in run.outcome ? run.outcome.property : undefined,
      'runArgs',
    );
  });

  it('F-0419 AC-14: a volume named vscode mounted outside /vscode, /vscodex and options that name no target are no collision', async () => {
    const run = await imageRun({
      mounts: ['type=volume,source=vscode,target=/cache'],
      runArgs: [
        '-v',
        'vscode:/cache',
        '--mount',
        'type=tmpfs',
        '-v',
        '/vscodex',
        '--rm',
        1,
        '-v',
      ],
      workspaceMount: 'source=/work,target=/vscodex,type=bind',
    });
    deepStrictEqual([run.outcome.kind, run.ups], ['ready', 1]);
  });

  it('F-0419 AC-23: a single letter before :/ is a volume name off Windows, which fails, and a drive on Windows, which is no collision', async () => {
    const runArgs = ['-v', 'x:/vscode'];
    const linux = await imageRun({runArgs, windowsClient: false});
    const windows = await imageRun({runArgs, windowsClient: true});
    deepStrictEqual(
      [linux.outcome.kind, windows.outcome.kind],
      ['reservedMount', 'ready'],
    );
  });

  it('F-0419 7.E2: with cacheVolume off a reserved target of an image configuration is not checked', async () => {
    const run = await imageRun({
      cacheVolume: false,
      mounts: ['type=volume,source=d,target=/vscode'],
      runArgs: ['-v', 'data:/vscode'],
      workspaceMount: 'source=/work,target=/vscode,type=bind',
    });
    deepStrictEqual([run.outcome.kind, run.ups], ['ready', 1]);
  });

  it('F-0419 AC-22: a rebuild with a reserved target fails before the old container is removed or anything is created', async () => {
    deepStrictEqual(
      await imageRun({
        rebuild: {buildNoCache: false},
        mounts: ['type=volume,source=d,target=/vscode'],
      }),
      {
        outcome: {
          kind: 'reservedMount',
          property: 'mounts',
          target: '/vscode',
        },
        ups: 0,
        commands: [],
      },
    );
  });

  /** The bridges of a Compose project and of an image configuration, each after its prepare. */
  async function preparedBoth(): Promise<{
    compose: FakeBridge;
    image: FakeBridge;
  }> {
    const compose = fakeBridge();
    const image = fakeBridge();
    await prepareOf(composeLifecycle(composeReady('proj'), compose).lifecycle);
    await prepareOf(composeLifecycle({kind: 'none'}, image).lifecycle);
    return {compose, image};
  }

  it('F-0417 BR-4: a Compose connect tells the project, the service and the scope before the CLI is called, and an image connect tells nothing', async () => {
    const told: unknown[] = [];
    const compose = fakeBridge();
    await prepareOf(
      composeLifecycle(composeReady('proj'), compose).lifecycle,
      new AbortController().signal,
      {
        ...REQUEST,
        composeIdentified: membership =>
          told.push([membership, compose.ups.length]),
      },
    );
    await prepareOf(
      composeLifecycle({kind: 'none'}).lifecycle,
      new AbortController().signal,
      {...REQUEST, composeIdentified: membership => told.push(membership)},
    );
    deepStrictEqual(told, [
      [{project: 'proj', service: 'app', scope: ['app', 'db']}, 0],
    ]);
  });

  it('F-0419 AC-8: a Compose project mounts the shared vscode volume as an external one, and an image configuration as before', async () => {
    const {compose, image} = await preparedBoth();
    deepStrictEqual(
      [compose.ups[0]?.target.mounts, image.ups[0]?.target.mounts],
      [
        ['type=volume,source=vscode,target=/vscode,external=true'],
        ['type=volume,source=vscode,target=/vscode'],
      ],
    );
  });

  it('F-0419 AC-34: with cacheVolume off a Compose project passes no mount', async () => {
    const bridge = fakeBridge();
    await prepareOf(
      composeLifecycle(composeReady('proj'), bridge).lifecycle,
      new AbortController().signal,
      {...REQUEST, cacheVolume: false},
    );
    deepStrictEqual(bridge.ups[0]?.target.mounts, []);
  });

  it('F-0413 AC-17: the entitlement variable reaches the environment of up for a Compose project, and neither the background commands nor an image configuration', async () => {
    const {compose, image} = await preparedBoth();
    await settle();
    deepStrictEqual(
      [
        compose.ups[0]?.target.environment,
        compose.runs[0]?.target.environment,
        image.ups[0]?.target.environment,
      ],
      [
        {
          COMPOSE_PROJECT_NAME: 'proj',
          BUILDX_BAKE_ENTITLEMENTS_FS: '0',
        },
        {COMPOSE_PROJECT_NAME: 'proj'},
        undefined,
      ],
    );
  });

  it('F-0201 AC-11: the program of the second route reaches the CLI as the Compose path, and the plugin route gives none', async () => {
    const standalone = fakeBridge();
    const plugin = fakeBridge();
    await prepareOf(
      composeLifecycle(
        {...(composeReady('proj') as ComposeReady), composeFile: '/opt/dc'},
        standalone,
      ).lifecycle,
    );
    await prepareOf(composeLifecycle(composeReady('proj'), plugin).lifecycle);
    deepStrictEqual(
      [standalone, plugin].map(each => each.ups[0]?.target.composePath),
      ['/opt/dc', undefined],
    );
  });

  it('F-0413 AC-51: a configuration that is no Compose one gets the data folder and no environment', async () => {
    const bridge = fakeBridge();
    const {lifecycle} = composeLifecycle({kind: 'none'}, bridge);
    await prepareOf(lifecycle);
    deepStrictEqual(
      [bridge.ups[0]?.target.environment, bridge.ups[0]?.target.userDataFolder],
      [undefined, '/storage/data'],
    );
  });

  it('F-0413 AC-57: a Compose configuration that fails to resolve fails the preparation before the engine or the CLI is touched', async () => {
    const bridge = fakeBridge();
    const {lifecycle, engine} = composeLifecycle(
      {kind: 'failed', detail: 'the project name "X" is not valid'},
      bridge,
    );
    const outcome = await prepareOf(lifecycle);
    deepStrictEqual(
      [outcome, engine.commands, bridge.ups.length],
      [
        {kind: 'discoveryFailed', detail: 'the project name "X" is not valid'},
        [],
        0,
      ],
    );
  });

  it('F-0413 AC-57: a connect cancelled while the Compose configuration is read ends cancelled, without the engine', async () => {
    const cancelling = new AbortController();
    const {lifecycle, engine} = composeLifecycle(
      composeReady('proj'),
      fakeBridge(),
      cancelling,
    );
    const outcome = await prepareOf(lifecycle, cancelling.signal);
    deepStrictEqual([outcome, engine.commands], [{kind: 'cancelled'}, []]);
  });

  it('F-0413 BR-4: a project name the CLI reports that differs from the computed one is one warn line, and the same name none', async () => {
    const differing = fakeBridge();
    differing.upResult = {...UP, composeProjectName: 'other'};
    const same = fakeBridge();
    same.upResult = {...UP, composeProjectName: 'proj'};
    const first = composeLifecycle(composeReady('proj'), differing);
    const second = composeLifecycle(composeReady('proj'), same);
    for (const each of [first, second]) {
      await prepareOf(each.lifecycle);
    }
    deepStrictEqual(
      [first, second].map(each =>
        each.lines().filter(line => line.includes('Compose project')),
      ),
      [
        [
          'the dev container CLI used the Compose project other where proj was computed',
        ],
        [],
      ],
    );
  });

  /** A script whose lookup of `app` finds `OLD` in `status`, and whose lookup of `db` finds the `NEW` container. */
  function composeScript(status: string): Record<string, EngineRunOutcome[]> {
    return {
      [APP_LOOKUP]: [ran(`${OLD}\n`)],
      [DB_LOOKUP]: [ran(`${NEW}\n`)],
      [`inspect --type container ${OLD}`]: [ran(inspected([[OLD, status]]))],
      'volume create vscode': [ran('vscode')],
      [`rm --force ${OLD}`]: [ran(OLD)],
      [`rm --force ${NEW}`]: [ran(NEW)],
    };
  }

  it('F-0413 AC-10, AC-44: the container of a Compose project is found by its project and service labels, not the folder’s, and the CLI is asked to attach with nothing removed', async () => {
    const bridge = fakeBridge();
    bridge.upResult = {...UP, containerId: OLD};
    const {lifecycle, engine} = composeLifecycle(
      composeReady('proj'),
      bridge,
      undefined,
      composeScript('running'),
    );
    const outcome = await prepareOf(lifecycle);
    deepStrictEqual(
      [
        engine.commands.slice(0, 2),
        outcome.kind === 'ready' ? outcome.created : outcome,
        bridge.ups[0]?.options.removeExistingContainer,
      ],
      [[APP_LOOKUP, `inspect --type container ${OLD}`], false, false],
    );
  });

  it('F-0413 AC-46, AC-55: a Compose project whose primary container is gone is created, and an exited or created one goes to the CLI too', async () => {
    const results = [];
    for (const status of ['exited', 'created']) {
      const bridge = fakeBridge();
      const {lifecycle} = composeLifecycle(
        composeReady('proj'),
        bridge,
        undefined,
        composeScript(status),
      );
      results.push([(await prepareOf(lifecycle)).kind, bridge.ups.length]);
    }
    const missing = fakeBridge();
    const created = await prepareOf(
      composeLifecycle(composeReady('proj'), missing).lifecycle,
    );
    results.push([
      created.kind === 'ready' ? created.created : created,
      missing.ups.length,
    ]);
    deepStrictEqual(results, [
      ['ready', 1],
      ['ready', 1],
      [true, 1],
    ]);
  });

  it('F-0409 AC-27 (Compose): a paused primary container is unusable with no CLI call, and the other service’s container is not looked up', async () => {
    const bridge = fakeBridge();
    const {lifecycle, engine} = composeLifecycle(
      composeReady('proj'),
      bridge,
      undefined,
      composeScript('paused'),
    );
    deepStrictEqual(
      [
        await prepareOf(lifecycle),
        bridge.ups.length,
        engine.commands.includes(DB_LOOKUP),
      ],
      [{kind: 'unusable', containerId: OLD, status: 'paused'}, 0, false],
    );
  });

  it('F-0405 AC-21 (Compose): a rebuild removes the containers of every service in the scope before the CLI builds, which is not asked to remove, and builds without cache when told', async () => {
    const bridge = fakeBridge();
    const {lifecycle, engine, lines} = composeLifecycle(
      composeReady('proj'),
      bridge,
      undefined,
      composeScript('running'),
    );
    await prepareOf(lifecycle, undefined, {
      ...REQUEST,
      rebuild: {buildNoCache: true},
    });
    deepStrictEqual(
      [
        engine.commands.filter(command => command.startsWith('rm ')),
        engine.commands.indexOf(`rm --force ${NEW}`) <
          engine.commands.indexOf('volume create vscode'),
        bridge.ups[0]?.options,
        lines().filter(line => line.startsWith('rebuilding')).length,
      ],
      [
        [`rm --force ${OLD}`, `rm --force ${NEW}`],
        true,
        {
          removeExistingContainer: false,
          buildNoCache: true,
          workspaceMountConsistency: 'cached',
        },
        2,
      ],
    );
  });

  it('F-0405 AC-21 (Compose): a rebuild whose listing or removal fails ends with the reason before the CLI is called, and one cancelled meanwhile is cancelled', async () => {
    const results = [];
    const listing = composeScript('running');
    listing[DB_LOOKUP] = [exited('Cannot connect to the Docker daemon')];
    const removal = composeScript('running');
    removal[`rm --force ${OLD}`] = [
      exited('removal of the container is already in progress'),
    ];
    for (const script of [listing, removal]) {
      const bridge = fakeBridge();
      const {lifecycle} = composeLifecycle(
        composeReady('proj'),
        bridge,
        undefined,
        script,
      );
      results.push([
        await prepareOf(lifecycle, undefined, {
          ...REQUEST,
          rebuild: {buildNoCache: false},
        }),
        bridge.ups.length,
      ]);
    }
    for (const stopAt of [
      `ps -a -q --no-trunc --filter label=com.docker.compose.project=proj --filter label=com.docker.compose.service=db`,
      `rm --force ${OLD}`,
    ]) {
      const cancelling = new AbortController();
      const bridge = fakeBridge();
      const engine = scriptedEngine(composeScript('running'), {
        controller: cancelling,
        on: stopAt,
      });
      const lifecycle = containerLifecycleOf({
        engine,
        cli: bridge,
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
        presenter: recordingPresenter().presenter,
        clock: () => 0,
        compose: () => Promise.resolve(composeReady('proj')),
      });
      results.push([
        await prepareOf(lifecycle, cancelling.signal, {
          ...REQUEST,
          rebuild: {buildNoCache: false},
        }),
        bridge.ups.length,
      ]);
    }
    deepStrictEqual(results, [
      [
        {
          kind: 'discoveryFailed',
          detail: 'Cannot connect to the Docker daemon',
        },
        0,
      ],
      [
        {
          kind: 'discoveryFailed',
          detail: `the container ${OLD.slice(0, 12)} of the service app couldn't be removed: removal of the container is already in progress`,
        },
        0,
      ],
      [{kind: 'cancelled'}, 0],
      [{kind: 'cancelled'}, 0],
    ]);
  });

  it('F-0409 AC-34 (Compose): a failure of up names the container the Compose lookup finds afterwards', async () => {
    const bridge = fakeBridge();
    bridge.upResult = {kind: 'malformedResult', field: 'containerId'};
    const {lifecycle} = composeLifecycle(
      composeReady('proj'),
      bridge,
      undefined,
      {
        ...composeScript('running'),
        [APP_LOOKUP]: [ran(''), ran(`${OLD}\n`)],
      },
    );
    deepStrictEqual(await prepareOf(lifecycle), {
      kind: 'malformedResult',
      field: 'containerId',
      foundContainerId: OLD,
    });
  });

  it('brief-personalization §1 step 4: the blocking run takes the blocking stop and the relay variables, on the ready container; with none ready it is skipped at warn', async () => {
    const bridge = fakeBridge();
    const {lifecycle, sink} = lifecycleOver(bridge);
    const before = await lifecycle.runBlocking(
      {},
      new AbortController().signal,
    );
    await lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    const done = await lifecycle.runBlocking(
      {SSH_AUTH_SOCK: '/tmp/s.sock'},
      new AbortController().signal,
    );
    deepStrictEqual(
      [
        before.kind,
        done,
        bridge.runs.map(run => [run.containerId, run.options]),
        skipWarningsOf(sink),
      ],
      [
        'done',
        {kind: 'done'},
        [
          [
            NEW,
            {
              skipNonBlocking: true,
              remoteEnvironment: {SSH_AUTH_SOCK: '/tmp/s.sock'},
            },
          ],
        ],
        ['the blocking lifecycle commands were skipped: no container is ready'],
      ],
    );
  });

  it('F-0410 with brief-personalization §1 step 4: a failed blocking run ends the run and names the container for the failure', async () => {
    const bridge = fakeBridge();
    const {calls, lifecycle} = lifecycleOver(bridge);
    await lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    bridge.runResult = Promise.resolve({
      kind: 'lifecycleFailed',
      hook: 'onCreateCommand',
      part: undefined,
      message: 'exit 1',
      containerId: NEW,
    });
    const failed = await lifecycle.runBlocking(
      {},
      new AbortController().signal,
    );
    bridge.runResult = Promise.resolve({kind: 'cancelled'});
    const cancelled = await lifecycle.runBlocking(
      {},
      new AbortController().signal,
    );
    deepStrictEqual(
      [failed, cancelled, calls.filter(call => call === 'ended')],
      [
        {
          kind: 'lifecycleFailed',
          hook: 'onCreateCommand',
          part: undefined,
          message: 'exit 1',
          containerId: NEW,
          foundContainerId: NEW,
        },
        {kind: 'cancelled', foundContainerId: NEW},
        ['ended'],
      ],
    );
  });

  it('brief-personalization §1 steps 6 to 8: the background stops for the personalization, then runs the rest; a failed first run skips both; nothing starts with no ready container, at warn', async () => {
    const order: string[] = [];
    const bridge = fakeBridge();
    const {lifecycle, sink} = lifecycleOver(bridge);
    lifecycle.startBackground({}, () => {
      order.push('never');
      return Promise.resolve();
    });
    await lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    lifecycle.startBackground({DISPLAY: ':1'}, () => {
      order.push(`personalize after ${String(bridge.runs.length)}`);
      return Promise.resolve();
    });
    await settle();
    await settle();
    const failing = fakeBridge();
    failing.runResult = Promise.resolve({kind: 'cancelled'});
    const second = lifecycleOver(failing);
    await second.lifecycle.prepare(
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    second.lifecycle.startBackground({}, () => {
      order.push('after a failure');
      return Promise.resolve();
    });
    await settle();
    await settle();
    deepStrictEqual(
      [
        order,
        bridge.runs.map(run => run.options),
        failing.runs.length,
        skipWarningsOf(sink),
      ],
      [
        ['personalize after 1'],
        [
          {stopForPersonalization: true, remoteEnvironment: {DISPLAY: ':1'}},
          {remoteEnvironment: {DISPLAY: ':1'}},
        ],
        1,
        [
          'the background lifecycle commands were skipped: no container is ready',
        ],
      ],
    );
  });
});

describe('the container of a clone in a volume (card containers-151)', () => {
  const VOLUME_CONFIG = '/workspaces/r/.devcontainer/devcontainer.json';
  const VOLUME_LABELS = volumeIdLabels({
    repositoryPath: 'https://github.com/o/r',
    volumeName: 'r-1',
    folder: 'r',
    configFile: VOLUME_CONFIG,
  });
  const VOLUME_LISTING = labelsDiscoveryArguments(VOLUME_LABELS).join(' ');
  const VOLUME_REQUEST: ContainerRequest = {
    ...REQUEST,
    folder: '/workspaces/r',
    configFile: VOLUME_CONFIG,
    idLabels: VOLUME_LABELS,
  };

  /** The discovery queries a run made. */
  function queriesOf(engine: {commands: string[]}): string[] {
    return engine.commands.filter(command => command.startsWith('ps '));
  }

  it('F-0701 BR-3: with no container, discovery asks by the volume’s labels alone, and up gets them', async () => {
    const engine = scriptedEngine({
      [VOLUME_LISTING]: [ran('')],
      'volume create vscode': [ran('vscode')],
    });
    const result = await prepared(
      engine,
      fakeBridge(),
      new AbortController().signal,
      VOLUME_REQUEST,
    );
    deepStrictEqual(
      [queriesOf(engine), targetIdLabels(result), result.outcome.kind],
      [[VOLUME_LISTING], VOLUME_LABELS, 'ready'],
    );
  });

  it('F-0701 BR-3: a running container with the volume’s labels is used as it is', async () => {
    const labels = Object.fromEntries(
      VOLUME_LABELS.map(label => label.split('=', 2)),
    ) as Record<string, string>;
    const engine = scriptedEngine({
      [VOLUME_LISTING]: [ran(`${NEW}\n`)],
      [`inspect --type container ${NEW}`]: [
        ran(inspected([[NEW, 'running']], false, labels)),
      ],
    });
    const result = await prepared(
      engine,
      fakeBridge(),
      new AbortController().signal,
      VOLUME_REQUEST,
    );
    deepStrictEqual(
      [
        result.outcome.kind === 'ready' && result.outcome.created,
        result.outcome.kind === 'ready' && result.outcome.containerId,
        targetIdLabels(result),
      ],
      [false, NEW, VOLUME_LABELS],
    );
  });
  it('F-0701, ADR-0009: the background run goes to its own bridge with its own target, and its end is told once', async () => {
    const upBridge = fakeBridge();
    const backgroundBridge = fakeBridge();
    const ended: string[] = [];
    const lifecycle = containerLifecycleOf({
      engine: scriptedEngine({
        ...EMPTY_LISTING,
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
      cli: upBridge,
      logger: createLogger(undefined, {minimumLevel: () => 'info'}),
      presenter: recordingPresenter().presenter,
      clock: () => 0,
      backgroundStage: {
        cli: backgroundBridge,
        targetOf: target => ({...target, workspaceFolder: '/stand-in'}),
        ended: () => ended.push('ended'),
      },
    });
    await prepareAndStart(
      lifecycle,
      REQUEST,
      () => undefined,
      () => undefined,
      new AbortController().signal,
    );
    await settle();
    deepStrictEqual(
      [
        upBridge.ups.length,
        upBridge.runs.length,
        backgroundBridge.runs.map(run => [
          run.containerId,
          run.target.workspaceFolder,
        ]),
        ended,
      ],
      [
        1,
        0,
        [
          [NEW, '/stand-in'],
          [NEW, '/stand-in'],
        ],
        ['ended'],
      ],
    );
  });
});
