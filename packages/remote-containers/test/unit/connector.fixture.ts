/**
 * @fileoverview The fakes of the connector's tests: a `docker` that answers by its arguments, a lifecycle, a CLI, a
 * server and a relay that the test steers, and the connector over them.
 */

import type {ConnectInput, Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  devContainerPayloadOf,
  type DevContainerFolder,
} from '../../src/authority/payload.ts';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import type {CliBridge} from '../../src/cli/cli-bridge.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import {
  type ContainerConnector,
  type ContainerConnectorDependencies,
  containerConnectorOf,
} from '../../src/connect/connector.ts';
import type {OpenRelay, RelayRequest} from '../../src/connect/host-relay.ts';
import type {
  ServerRequest,
  ServerResult,
} from '../../src/connect/server-steps.ts';
import type {
  EngineHost,
  EngineOptions,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {cacheVolumeOf} from '../../src/lifecycle/cache-volume.ts';
import type {
  ContainerLifecycle,
  ContainerOutcome,
  ContainerRequest,
  ContainerStep,
} from '../../src/lifecycle/container-lifecycle.ts';
import {fakeEngine, type ProcessScript, type SpawnPlan} from './fake-engine.ts';

/** The connection token of the fixture's server, a secret no log may hold. */
export const SECRET_TOKEN = 'tok-s3cret';

/** The folder a dev container is made for. */
export const FOLDER: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/work/proj',
  localDocker: false,
  configFile: {
    $mid: 1,
    fsPath: '/work/proj/.devcontainer/devcontainer.json',
    external: 'file:///work/proj/.devcontainer/devcontainer.json',
    path: '/work/proj/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
};

/** The input of a resolve of `payload`. */
export function inputOf(
  payload: string,
  changes: Partial<ConnectInput> = {},
): ConnectInput {
  return {
    target: {payload},
    rawHostString: payload,
    attempt: 1,
    isReconnection: false,
    windowId: 'window-1',
    windowWorkspace: undefined,
    ...changes,
  };
}

/** The payload of the authority of that folder. */
export const PAYLOAD = devContainerPayloadOf(FOLDER);

/** The state `docker inspect` gives the container. */
interface InspectState {
  /** The answer: the state, `missing`, or a failure of the engine. */
  answer:
    | {status: string; startedAt: string}
    | 'missing'
    | 'unreachable'
    | 'refused'
    | 'garbled'
    | 'incomplete';
}

/** What `docker` was asked, by one call. */
interface EngineCall {
  argv: readonly string[];
  environment: Readonly<Record<string, string>> | undefined;
}

/** What a test steers and reads: the fakes, their answers and what they recorded. */
export interface Scene {
  connector: ContainerConnector;
  engineCalls: EngineCall[];
  engineFiles: string[];
  cliEnvironments: Array<Readonly<Record<string, string | undefined>>>;
  inspect: InspectState;
  /** What the version query answers: its status and stderr. */
  version: {status: number; stderr: string};
  prepared: ContainerRequest[];
  /** What the extension's store holds under the rebuild key, and the error its reading throws, if any. */
  intentStore: unknown;
  intentError: Error | undefined;
  configurationReads: Array<{
    target: CliTarget;
    containerId: string | undefined;
  }>;
  serverRequests: ServerRequest[];
  relayRequests: RelayRequest[];
  relays: Array<{
    closed: number;
    failListeners: Array<() => void>;
    hostPort: number;
  }>;
  stopped: number;
  revealed: number;
  sink: MemorySink;
  /** The outcome of `prepare`; a function to hold it. */
  outcome: ContainerOutcome | (() => Promise<ContainerOutcome>);
  steps: ContainerStep[];
  cliEvents: CliEvent[];
  /** What the configuration read answers; a function to hold it or to change it from one read to the next. */
  configuration:
    | Awaited<ReturnType<CliBridge['readConfiguration']>>
    | (() => ReturnType<CliBridge['readConfiguration']>);
  /** The delay of each timer set, in order. */
  timerDelays: number[];
  /** The callbacks of the timers still pending. */
  timers: Array<() => void>;
  server: ServerResult | (() => Promise<ServerResult>);
  phasesOfServer: Array<'installing' | 'startingServer'>;
  /** The percents of the server download the server step reports. */
  percentsOfServer: number[];
  relayOutcome: 'open' | Failed;
  dockerPath: unknown;
  /** What the settings' `inspect` answers for the two `cacheVolume` settings; nothing, when the scene leaves it absent. */
  cacheVolumeInspect:
    {globalValue?: unknown; workspaceValue?: unknown} | undefined;
  /** The user's values of the workspace mount's consistency, of its deprecated twin and of the worktree setting. */
  workspaceMountConsistency: unknown;
  legacyWorkspaceMountConsistency: unknown;
  mountGitWorktreeCommonDir: unknown;
  /** The user's values of the setting for the extensions of a new container, and of its deprecated twin. */
  defaultExtensions: unknown;
  deprecatedDefaultExtensions: unknown;
  /** The exit statuses of the next `kill -0` runs. */
  killStatuses: number[];
  /** What the runs over the channel were given on their input, as text. */
  killScripts: string[];
  /** What the environment probe's process does, and the probe scripts it was given. */
  probe: ProcessScript;
  probeScripts: string[];
  /** Holds the opening of the relay until it settles. */
  relayGate: (() => Promise<void>) | undefined;
  /** Whether the editor says the folder is trusted, and what its trust request answers: true, false or a refusal. */
  trusted: boolean;
  trustAnswer: boolean | Error | (() => Promise<boolean>);
  /** What the connect asked of the trust port, of the modal and of the window, in order. */
  trustCalls: string[];
  /** The `setupAgain` calls the trust check made. */
  setupAgains: number;
  /** How many reads of the configuration had run, and how many engine calls had been made, when trust was read. */
  atTrust: {reads: number; engineCalls: number} | undefined;
}

/** What a probe that worked prints: noise, the markers and two variables. */
const PROBE_OUTPUT =
  'motd\nremote-oss-env-probe-begin\nALPHA=probe\0BRAVO=probe\0\nremote-oss-env-probe-end\n';

/** A container prepared and ready. */
export const READY: Extract<ContainerOutcome, {kind: 'ready'}> = {
  kind: 'ready',
  containerId: 'c1c1c1c1c1c1c1c1',
  remoteUser: 'node',
  remoteWorkspaceFolder: '/workspaces/proj',
  volumeMounted: false,
  created: true,
};

/** A server that started. */
export const STARTED_SERVER: ServerResult = {
  kind: 'started',
  port: 41000,
  connectionToken: SECRET_TOKEN,
  processId: 77,
  reused: false,
  nodePath: '/home/node/.fixture-server/bin/abc123/node',
  relayPath: '/home/node/.fixture-server/relay.js',
};

/** Dialogs that show nothing and answer that nobody chose. */
function silentDialogs() {
  return {
    revealLog: () => undefined,
    openExternal: () => Promise.resolve(undefined),
    showError: () => Promise.resolve(undefined),
  };
}

/** The connector over fakes, and the knobs that steer them. */
export function sceneOf(
  overrides: Partial<Pick<Scene, 'dockerPath'>> = {},
): Scene {
  const sink = new MemorySink();
  const scene: Scene = {
    connector: undefined as unknown as ContainerConnector,
    engineCalls: [],
    engineFiles: [],
    cliEnvironments: [],
    inspect: {answer: {status: 'running', startedAt: '2026-10-14T10:00:00Z'}},
    version: {status: 0, stderr: ''},
    prepared: [],
    intentStore: undefined,
    intentError: undefined,
    configurationReads: [],
    serverRequests: [],
    relayRequests: [],
    relays: [],
    stopped: 0,
    revealed: 0,
    sink,
    outcome: READY,
    steps: [],
    cliEvents: [],
    configuration: {
      kind: 'configuration',
      configuration: {name: 'Proj'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    },
    server: STARTED_SERVER,
    phasesOfServer: ['installing', 'startingServer'],
    percentsOfServer: [],
    relayOutcome: 'open',
    dockerPath: 'docker',
    cacheVolumeInspect: undefined,
    workspaceMountConsistency: undefined,
    legacyWorkspaceMountConsistency: undefined,
    mountGitWorktreeCommonDir: undefined,
    defaultExtensions: undefined,
    deprecatedDefaultExtensions: undefined,
    killStatuses: [],
    killScripts: [],
    probe: process => {
      process.print(PROBE_OUTPUT);
      process.exit(0);
    },
    probeScripts: [],
    relayGate: undefined,
    trusted: true,
    trustAnswer: true,
    trustCalls: [],
    setupAgains: 0,
    atTrust: undefined,
    timerDelays: [],
    timers: [],
    ...overrides,
  };
  const kills = fakeEngine(
    ...Array.from({length: 8}, (): SpawnPlan => async process => {
      await process.stdinEnded;
      const script = process.stdin().toString('utf8');
      if (script.includes('remote-oss-env-probe-begin')) {
        scene.probeScripts.push(script);
        await scene.probe(process);
        return;
      }
      scene.killScripts.push(script);
      process.exit(scene.killStatuses.shift() ?? 0);
    }),
  );
  function runAnswer(argv: readonly string[]): EngineRunOutcome {
    if (argv[0] === 'version') {
      return {
        kind: 'ran',
        status: scene.version.status,
        stdout: '',
        stderr: scene.version.stderr,
      };
    }
    const {answer} = scene.inspect;
    if (answer === 'unreachable') {
      return {kind: 'failed', detail: 'spawn docker ENOENT'};
    }
    if (answer === 'missing') {
      return {
        kind: 'ran',
        status: 1,
        stdout: '',
        stderr: 'Error: No such container: c1',
      };
    }
    if (answer === 'refused') {
      return {
        kind: 'ran',
        status: 1,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
      };
    }
    if (answer === 'incomplete') {
      return {
        kind: 'ran',
        status: 0,
        stdout: '{"Status":"running"}',
        stderr: '',
      };
    }
    if (answer === 'garbled') {
      return {kind: 'ran', status: 0, stdout: 'not json', stderr: ''};
    }
    return {
      kind: 'ran',
      status: 0,
      stdout: JSON.stringify({
        Status: answer.status,
        StartedAt: answer.startedAt,
      }),
      stderr: '',
    };
  }
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options: EngineOptions) => {
      scene.engineCalls.push({argv, environment: options.environment});
      return Promise.resolve(runAnswer(argv));
    },
    spawn: (argv, options) => {
      scene.engineCalls.push({argv, environment: options.environment});
      return kills.spawn(argv, options);
    },
  };
  const bridge: CliBridge = {
    // eslint-disable-next-line id-length -- the bridge's method is named up
    up: () => Promise.reject(new Error('the connector never runs up')),
    runUserCommands: () =>
      Promise.reject(new Error('the connector never runs user commands')),
    readConfiguration: (target, containerId, onEvent) => {
      scene.configurationReads.push({target, containerId});
      for (const event of scene.cliEvents) {
        onEvent(event);
      }
      return typeof scene.configuration === 'function'
        ? scene.configuration()
        : Promise.resolve(scene.configuration);
    },
  };
  const lifecycle: ContainerLifecycle = {
    prepare: async (request, onStep, onCliEvent) => {
      scene.prepared.push(request);
      for (const step of scene.steps) {
        onStep(step);
      }
      for (const event of scene.cliEvents) {
        onCliEvent(event);
      }
      return typeof scene.outcome === 'function'
        ? scene.outcome()
        : scene.outcome;
    },
    stopBackground: () => {
      scene.stopped += 1;
    },
  };
  const dependencies: ContainerConnectorDependencies = {
    engineFor: file => {
      scene.engineFiles.push(file);
      return engine;
    },
    cliFor: environment => {
      scene.cliEnvironments.push(environment);
      return bridge;
    },
    lifecycleFor: () => lifecycle,
    lifecyclePresenter: {
      output: () => undefined,
      backgroundStarted: () => undefined,
      ended: () => undefined,
      attachStdin: () => undefined,
      terminalSize: () => ({rows: 24, columns: 80}),
    },
    settings: () => ({
      dockerPath: scene.dockerPath,
      serverDownloadBaseUrl: undefined,
      serverDownloadFolder: undefined,
      cacheVolume: () =>
        cacheVolumeOf(
          scene.cacheVolumeInspect?.globalValue,
          scene.cacheVolumeInspect?.globalValue,
        ),
      workspaceMountConsistency: scene.workspaceMountConsistency,
      legacyWorkspaceMountConsistency: scene.legacyWorkspaceMountConsistency,
      mountGitWorktreeCommonDir: scene.mountGitWorktreeCommonDir,
      defaultExtensions: scene.defaultExtensions,
      deprecatedDefaultExtensions: scene.deprecatedDefaultExtensions,
    }),
    preflight: {
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
      searchPath: () => '/usr/bin',
      clock: () => 0,
      setTimer: (milliseconds, callback) => {
        scene.timerDelays.push(milliseconds);
        scene.timers.push(callback);
        return () => {
          scene.timers = scene.timers.filter(each => each !== callback);
        };
      },
      translate: template => template,
      dialogs: silentDialogs(),
    },
    editorEnvironment: {HOME: '/home/u', GITHUB_TOKEN: 's3cr3t-token'},
    intents: {
      get: () => {
        if (scene.intentError !== undefined) {
          throw scene.intentError;
        }
        return scene.intentStore;
      },
      update: (key, value) => {
        scene.intentStore = value;
        return Promise.resolve();
      },
    },
    trust: {
      isTrusted: () => {
        scene.atTrust = {
          reads: scene.configurationReads.length,
          engineCalls: scene.engineCalls.length,
        };
        scene.trustCalls.push('isTrusted');
        return scene.trusted;
      },
      request: message => {
        scene.trustCalls.push(`request ${message}`);
        const {trustAnswer} = scene;
        if (typeof trustAnswer === 'function') {
          return trustAnswer();
        }
        return typeof trustAnswer === 'boolean'
          ? Promise.resolve(trustAnswer)
          : Promise.reject(trustAnswer);
      },
    },
    trustNeeds: {
      translate: template => template,
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
      setupAgain: () => {
        scene.setupAgains += 1;
        return Promise.resolve();
      },
    },
    showDeclined: (message, detail) => {
      scene.trustCalls.push(`showDeclined ${message} | ${detail}`);
      return Promise.resolve();
    },
    reopenLocally: hostPath => {
      scene.trustCalls.push(`reopenLocally ${hostPath}`);
      return Promise.resolve();
    },
    runServer: async request => {
      scene.serverRequests.push(request);
      for (const phase of scene.phasesOfServer) {
        request.onPhase(phase);
      }
      for (const percent of scene.percentsOfServer) {
        request.onDownloadPercent(percent);
      }
      return typeof scene.server === 'function' ? scene.server() : scene.server;
    },
    openRelay: async (request: RelayRequest) => {
      scene.relayRequests.push(request);
      await scene.relayGate?.();
      if (scene.relayOutcome !== 'open') {
        return Promise.resolve({
          kind: 'failed' as const,
          failure: scene.relayOutcome,
        });
      }
      const record = {
        closed: 0,
        failListeners: [] as Array<() => void>,
        hostPort: 41000 + scene.relays.length,
      };
      scene.relays.push(record);
      const relay: OpenRelay = {
        kind: 'open',
        hostPort: record.hostPort,
        close: () => {
          record.closed += 1;
        },
        onClosed: listener => {
          record.failListeners.push(listener);
        },
      };
      return Promise.resolve(relay);
    },
    clock: (() => {
      let now = 0;
      return () => {
        now += 25;
        return now;
      };
    })(),
    logger: createLogger(sink, {minimumLevel: () => 'debug'}),
    revealLog: () => {
      scene.revealed += 1;
    },
  };
  scene.connector = containerConnectorOf(dependencies);
  return scene;
}
