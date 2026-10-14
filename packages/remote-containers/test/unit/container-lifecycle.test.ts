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
import {
  discoveryArguments,
  idLabels,
  legacyDiscoveryArguments,
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
};
const UP: UpResult = {
  kind: 'up',
  containerId: NEW,
  remoteUser: 'vscode',
  remoteWorkspaceFolder: '/workspaces/a',
};
const LISTING = discoveryArguments(FOLDER).join(' ');
const LEGACY_LISTING = legacyDiscoveryArguments(FOLDER).join(' ');

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

const EMPTY_LISTING = {[LISTING]: [ran('')], [LEGACY_LISTING]: [ran('')]};

async function settle(): Promise<void> {
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
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
        [`inspect --type container ${NEW}`]: [
          ran(inspected([[NEW, 'running']])),
        ],
      }),
      fakeBridge(),
      new AbortController().signal,
      {...REQUEST, rebuild: {buildNoCache}},
    );
  }

  it('F-0405 BR-3: a rebuild runs up with removeExistingContainer, always creates, and logs what it removes', async () => {
    const result = await rebuiltFrom('running');
    deepStrictEqual(
      [
        result.bridge.ups.map(each => each.options),
        result.outcome.kind === 'ready' && result.outcome.created,
        result.lines,
      ],
      [
        [{removeExistingContainer: true, buildNoCache: false}],
        true,
        [
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
        [{removeExistingContainer: true, buildNoCache: true}],
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
      {leaked: [], environments: [undefined, undefined, undefined]},
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
    });
    const result = await prepared(engine);
    deepStrictEqual(
      {commands: engine.commands, kind: result.outcome.kind},
      {
        commands: [
          LISTING,
          LEGACY_LISTING,
          `inspect --type container ${OLD} ${NEW} ${LEGACY}`,
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

  it('F-0405: a rebuild with no legacy container removes nothing itself', async () => {
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
});
